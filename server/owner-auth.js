"use strict";

const crypto = require("node:crypto");
const { promisify } = require("node:util");

const scrypt = promisify(crypto.scrypt);
const HASH_PREFIX = "scrypt";
const SCRYPT_N = 16384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const SCRYPT_KEY_BYTES = 32;
const SCRYPT_SALT_BYTES = 16;
const SCRYPT_MAX_MEMORY = 32 * 1024 * 1024;
const MINIMUM_PASSWORD_BYTES = 20;
const MAXIMUM_PASSWORD_BYTES = 1024;
const MAX_TRACKED_SOURCES = 256;

function passwordBytes(value) {
  return Buffer.byteLength(String(value || ""), "utf8");
}

function assertPasswordStrength(password) {
  const bytes = passwordBytes(password);
  if (bytes < MINIMUM_PASSWORD_BYTES) {
    throw new Error(`Owner password must contain at least ${MINIMUM_PASSWORD_BYTES} UTF-8 bytes.`);
  }
  if (bytes > MAXIMUM_PASSWORD_BYTES) {
    throw new Error(`Owner password must not exceed ${MAXIMUM_PASSWORD_BYTES} UTF-8 bytes.`);
  }
}

function decodeBase64Url(value, name) {
  const encoded = String(value || "");
  if (!encoded || !/^[A-Za-z0-9_-]+$/.test(encoded)) {
    throw new Error(`${name} must be unpadded base64url.`);
  }
  const decoded = Buffer.from(encoded, "base64url");
  if (decoded.toString("base64url") !== encoded) {
    throw new Error(`${name} is not canonical base64url.`);
  }
  return decoded;
}

function parseOwnerPasswordHash(encodedHash) {
  const parts = String(encodedHash || "").split("$");
  if (parts.length !== 6 || parts[0] !== HASH_PREFIX) {
    throw new Error("SHEETIFYIMG_OWNER_AUTH_PASSWORD_HASH must use the supported scrypt format.");
  }
  const [algorithm, rawN, rawR, rawP, rawSalt, rawDigest] = parts;
  const parameters = [rawN, rawR, rawP].map(Number);
  if (parameters.some((value) => !Number.isSafeInteger(value) || value <= 0)) {
    throw new Error("SHEETIFYIMG_OWNER_AUTH_PASSWORD_HASH contains invalid scrypt parameters.");
  }
  const [N, r, p] = parameters;
  if (N !== SCRYPT_N || r !== SCRYPT_R || p !== SCRYPT_P) {
    throw new Error("SHEETIFYIMG_OWNER_AUTH_PASSWORD_HASH uses unsupported scrypt parameters.");
  }
  const salt = decodeBase64Url(rawSalt, "Owner password salt");
  const digest = decodeBase64Url(rawDigest, "Owner password digest");
  if (salt.length !== SCRYPT_SALT_BYTES || digest.length !== SCRYPT_KEY_BYTES) {
    throw new Error("SHEETIFYIMG_OWNER_AUTH_PASSWORD_HASH has an invalid salt or digest length.");
  }
  return Object.freeze({ algorithm, N, r, p, salt, digest });
}

async function derivePasswordDigest(password, parsed) {
  return scrypt(String(password), parsed.salt, parsed.digest.length, {
    N: parsed.N,
    r: parsed.r,
    p: parsed.p,
    maxmem: SCRYPT_MAX_MEMORY
  });
}

async function generateOwnerPasswordHash(password, options = {}) {
  assertPasswordStrength(password);
  const salt = options.salt || crypto.randomBytes(SCRYPT_SALT_BYTES);
  if (!Buffer.isBuffer(salt) || salt.length !== SCRYPT_SALT_BYTES) {
    throw new Error(`Owner password salt must contain ${SCRYPT_SALT_BYTES} bytes.`);
  }
  const parsed = {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
    salt,
    digest: Buffer.alloc(SCRYPT_KEY_BYTES)
  };
  const digest = await derivePasswordDigest(password, parsed);
  return [
    HASH_PREFIX,
    SCRYPT_N,
    SCRYPT_R,
    SCRYPT_P,
    salt.toString("base64url"),
    digest.toString("base64url")
  ].join("$");
}

async function verifyOwnerPassword(password, encodedHash) {
  const parsed = parseOwnerPasswordHash(encodedHash);
  if (passwordBytes(password) > MAXIMUM_PASSWORD_BYTES) {
    return false;
  }
  const candidate = await derivePasswordDigest(password, parsed);
  return candidate.length === parsed.digest.length
    && crypto.timingSafeEqual(candidate, parsed.digest);
}

function parseBasicAuthorization(headerValue) {
  const match = String(headerValue || "").match(/^Basic\s+([A-Za-z0-9+/]+={0,2})$/i);
  if (!match) {
    return null;
  }
  let decoded;
  try {
    decoded = Buffer.from(match[1], "base64").toString("utf8");
  } catch {
    return null;
  }
  const separator = decoded.indexOf(":");
  if (separator <= 0 || decoded.includes("\0")) {
    return null;
  }
  return {
    username: decoded.slice(0, separator),
    password: decoded.slice(separator + 1)
  };
}

function safeEqualBuffer(left, right) {
  return Buffer.isBuffer(left)
    && Buffer.isBuffer(right)
    && left.length === right.length
    && crypto.timingSafeEqual(left, right);
}

function authorizationFingerprint(headerValue) {
  return crypto.createHash("sha256").update(String(headerValue || ""), "utf8").digest();
}

function requestSource(request) {
  const cloudflareIp = String(request.headers["cf-connecting-ip"] || "").trim();
  return cloudflareIp || String(request.socket?.remoteAddress || "unknown");
}

function challenge(response) {
  response.writeHead(401, {
    "www-authenticate": "Basic realm=\"SheetifyIMG\", charset=\"UTF-8\"",
    "content-type": "text/plain; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    "referrer-policy": "no-referrer"
  });
  response.end("Authentifizierung erforderlich.\n");
}

function createOwnerAuthGate(config = {}) {
  const enabled = config.enabled === true;
  if (!enabled) {
    return Object.freeze({
      enabled: false,
      authorize: async () => true
    });
  }
  const username = String(config.username || "");
  const passwordHash = String(config.passwordHash || "");
  parseOwnerPasswordHash(passwordHash);
  let authorizedFingerprint = null;
  const failures = new Map();

  const rememberFailure = (source) => {
    const previous = failures.get(source) || { count: 0, retryAt: 0 };
    const count = previous.count + 1;
    const delayMs = count < 3 ? 0 : Math.min(30000, 1000 * (2 ** Math.min(5, count - 3)));
    failures.delete(source);
    failures.set(source, { count, retryAt: Date.now() + delayMs });
    while (failures.size > MAX_TRACKED_SOURCES) {
      failures.delete(failures.keys().next().value);
    }
  };

  const authorize = async (request, response) => {
    const header = String(request.headers.authorization || "");
    const fingerprint = authorizationFingerprint(header);
    if (authorizedFingerprint && safeEqualBuffer(fingerprint, authorizedFingerprint)) {
      return true;
    }

    const source = requestSource(request);
    const failure = failures.get(source);
    if (failure?.retryAt > Date.now()) {
      challenge(response);
      return false;
    }

    const credentials = parseBasicAuthorization(header);
    const valid = credentials?.username === username
      && await verifyOwnerPassword(credentials.password, passwordHash);
    if (!valid) {
      rememberFailure(source);
      challenge(response);
      return false;
    }

    failures.delete(source);
    authorizedFingerprint = fingerprint;
    return true;
  };

  return Object.freeze({ enabled: true, authorize });
}

module.exports = {
  MINIMUM_PASSWORD_BYTES,
  createOwnerAuthGate,
  generateOwnerPasswordHash,
  parseBasicAuthorization,
  parseOwnerPasswordHash,
  verifyOwnerPassword
};
