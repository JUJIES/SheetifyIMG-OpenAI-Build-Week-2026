"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { loadEnvFile, loadLocalEnv } = require("../core/localEnv");
const { resolvePlanningFlow } = require("../core/planningFlowConfig");
const { parseOwnerPasswordHash } = require("./owner-auth");

const RUNTIME_MODES = Object.freeze({
  DEVELOPMENT: "development",
  PRODUCTION: "production"
});

function nonEmpty(value) {
  return String(value || "").trim();
}

function normalizedRuntimeMode(env = process.env) {
  const value = nonEmpty(env.SHEETIFYIMG_RUNTIME_MODE || env.NODE_ENV).toLowerCase();
  return value === RUNTIME_MODES.PRODUCTION
    ? RUNTIME_MODES.PRODUCTION
    : RUNTIME_MODES.DEVELOPMENT;
}

function booleanValue(value, fallback) {
  const normalized = nonEmpty(value).toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) {
    return true;
  }
  if (["0", "false", "no", "off"].includes(normalized)) {
    return false;
  }
  return fallback;
}

function positiveInteger(value, fallback, name) {
  if (value === undefined || value === null || value === "") {
    return fallback;
  }
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer.`);
  }
  return parsed;
}

function portNumber(value, fallback) {
  const parsed = positiveInteger(value, fallback, "PORT");
  if (parsed > 65535) {
    throw new Error("PORT must be between 1 and 65535.");
  }
  return parsed;
}

function emailValue(value, fallback, name) {
  const email = nonEmpty(value) || fallback;
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error(`${name} must be a valid email address.`);
  }
  return email.toLowerCase();
}

function hostnameList(value, fallback, name) {
  const hostnames = (nonEmpty(value) || fallback)
    .split(",")
    .map((entry) => entry.trim().replace(/\.$/, "").toLowerCase())
    .filter(Boolean);
  if (!hostnames.length || hostnames.some((entry) => !/^[a-z0-9.-]+$/.test(entry))) {
    throw new Error(`${name} must contain comma-separated hostnames.`);
  }
  return hostnames;
}

function isInsideRoot(rootDir, targetPath) {
  const relative = path.relative(path.resolve(rootDir), path.resolve(targetPath));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function isLoopbackHost(host) {
  return ["127.0.0.1", "::1", "localhost"].includes(nonEmpty(host).toLowerCase());
}

function validatedAbsolutePath(value, name) {
  const rawValue = nonEmpty(value);
  if (!rawValue) {
    return "";
  }
  if (!path.isAbsolute(rawValue)) {
    throw new Error(`${name} must be an absolute path.`);
  }
  return path.resolve(rawValue);
}

function loadServerEnvironment(options = {}) {
  const repoRoot = path.resolve(options.repoRoot || path.resolve(__dirname, ".."));
  const mode = normalizedRuntimeMode(process.env);
  if (mode === RUNTIME_MODES.PRODUCTION) {
    const envFile = validateEnvironmentFile({ filePath: process.env.SHEETIFYIMG_ENV_FILE });
    if (envFile) {
      loadEnvFile(envFile, {
        required: true,
        overrideKeys: options.localOverrideKeys || []
      });
    }
    if (!nonEmpty(process.env.SHEETIFYIMG_AI_MODE)) {
      process.env.SHEETIFYIMG_AI_MODE = "openai";
    }
    if (!nonEmpty(process.env.SHEETIFYIMG_IMAGE_PROVIDER)) {
      process.env.SHEETIFYIMG_IMAGE_PROVIDER = "openai";
    }
    if (!nonEmpty(process.env.SHEETIFYIMG_CODEX_IMAGE_ENABLED)) {
      process.env.SHEETIFYIMG_CODEX_IMAGE_ENABLED = "0";
    }
    return mode;
  }

  loadLocalEnv(repoRoot, {
    overrideKeys: options.localOverrideKeys || []
  });
  return mode;
}

function resolveServerConfig(options = {}) {
  const repoRoot = path.resolve(options.repoRoot || path.resolve(__dirname, ".."));
  const env = options.env || process.env;
  const runtimeMode = normalizedRuntimeMode(env);
  const production = runtimeMode === RUNTIME_MODES.PRODUCTION;
  const runtimeDir = nonEmpty(env.SHEETIFYIMG_RUNTIME_DIR)
    ? validatedAbsolutePath(env.SHEETIFYIMG_RUNTIME_DIR, "SHEETIFYIMG_RUNTIME_DIR")
    : "";

  if (production && !runtimeDir) {
    throw new Error("SHEETIFYIMG_RUNTIME_DIR is required in production mode.");
  }
  if (production && isInsideRoot(repoRoot, runtimeDir)) {
    throw new Error("SHEETIFYIMG_RUNTIME_DIR must be outside the release directory in production mode.");
  }

  const projectsDir = nonEmpty(env.PROJECTS_DIR)
    ? production
      ? validatedAbsolutePath(env.PROJECTS_DIR, "PROJECTS_DIR")
      : path.resolve(env.PROJECTS_DIR)
    : path.join(runtimeDir || repoRoot, "projects");
  const worksheetsDir = nonEmpty(env.WORKSHEETS_DIR)
    ? production
      ? validatedAbsolutePath(env.WORKSHEETS_DIR, "WORKSHEETS_DIR")
      : path.resolve(env.WORKSHEETS_DIR)
    : path.join(runtimeDir || repoRoot, "worksheets");
  if (production && (!isInsideRoot(runtimeDir, projectsDir) || !isInsideRoot(runtimeDir, worksheetsDir))) {
    throw new Error("PROJECTS_DIR and WORKSHEETS_DIR must stay inside SHEETIFYIMG_RUNTIME_DIR in production mode.");
  }

  const host = nonEmpty(env.SHEETIFYIMG_BIND_HOST || env.HOST) || "127.0.0.1";
  if (production && !isLoopbackHost(host)) {
    throw new Error("Production mode must bind to 127.0.0.1, ::1, or localhost.");
  }

  const publicUrl = nonEmpty(env.SHEETIFYIMG_PUBLIC_URL).replace(/\/+$/, "");
  if (production && publicUrl && !publicUrl.startsWith("https://")) {
    throw new Error("SHEETIFYIMG_PUBLIC_URL must use HTTPS in production mode.");
  }

  const ownerAuthEnabled = booleanValue(env.SHEETIFYIMG_OWNER_AUTH_ENABLED, false);
  const ownerAuthUsername = nonEmpty(env.SHEETIFYIMG_OWNER_AUTH_USERNAME) || "owner";
  const ownerAuthPasswordHash = nonEmpty(env.SHEETIFYIMG_OWNER_AUTH_PASSWORD_HASH);
  if (ownerAuthUsername.includes(":") || /[\u0000-\u001f\u007f]/.test(ownerAuthUsername)) {
    throw new Error("SHEETIFYIMG_OWNER_AUTH_USERNAME must not contain colons or control characters.");
  }
  if (ownerAuthUsername.length > 128) {
    throw new Error("SHEETIFYIMG_OWNER_AUTH_USERNAME must not exceed 128 characters.");
  }
  if (ownerAuthEnabled && !ownerAuthPasswordHash) {
    throw new Error("SHEETIFYIMG_OWNER_AUTH_PASSWORD_HASH is required when owner auth is enabled.");
  }
  if (ownerAuthPasswordHash) {
    parseOwnerPasswordHash(ownerAuthPasswordHash);
  }
  if (production && publicUrl && !ownerAuthEnabled) {
    throw new Error("Production with SHEETIFYIMG_PUBLIC_URL requires owner auth for the private admin surface.");
  }

  const stateDir = runtimeDir ? path.join(runtimeDir, "state") : path.join(repoRoot, ".sheetifyimg", "state");
  const betaAccessEnabled = booleanValue(env.SHEETIFYIMG_BETA_ACCESS_ENABLED, false);
  const betaAccessSecret = nonEmpty(env.SHEETIFYIMG_BETA_ACCESS_SECRET);
  const betaAdminPrivateOnly = booleanValue(env.SHEETIFYIMG_ADMIN_PRIVATE_ONLY, production);
  const inboundMailEnabled = booleanValue(env.SHEETIFYIMG_MAIL_INBOUND_WEBHOOK_ENABLED, false);
  const inboundMailAllowLoopback = booleanValue(env.SHEETIFYIMG_MAIL_INBOUND_ALLOW_LOOPBACK, false);
  const contactEmail = emailValue(env.SHEETIFYIMG_CONTACT_EMAIL, "sheetify@jujies.app", "SHEETIFYIMG_CONTACT_EMAIL");
  const firstWorksheetYoutubeUrl = nonEmpty(env.SHEETIFYIMG_TUTORIAL_FIRST_WORKSHEET_URL);
  const inboundMailAllowedHosts = hostnameList(
    env.SHEETIFYIMG_MAIL_INBOUND_ALLOWED_HOSTS,
    "mx1.forwardemail.net,mx2.forwardemail.net",
    "SHEETIFYIMG_MAIL_INBOUND_ALLOWED_HOSTS"
  );
  const resendApiKey = nonEmpty(env.RESEND_API_KEY);
  if (production && betaAccessEnabled && Buffer.byteLength(betaAccessSecret, "utf8") < 32) {
    throw new Error("SHEETIFYIMG_BETA_ACCESS_SECRET must contain at least 32 UTF-8 bytes in production.");
  }
  if (production && betaAccessEnabled && !publicUrl) {
    throw new Error("SHEETIFYIMG_PUBLIC_URL is required when Beta access is enabled in production.");
  }
  if (production && betaAccessEnabled && !betaAdminPrivateOnly) {
    throw new Error("SHEETIFYIMG_ADMIN_PRIVATE_ONLY must remain enabled for the production Beta.");
  }
  if (inboundMailEnabled && !betaAccessEnabled) {
    throw new Error("SHEETIFYIMG_MAIL_INBOUND_WEBHOOK_ENABLED requires Beta access.");
  }
  if (production && inboundMailAllowLoopback) {
    throw new Error("SHEETIFYIMG_MAIL_INBOUND_ALLOW_LOOPBACK is only permitted in development.");
  }

  const requireOpenAi = booleanValue(env.SHEETIFYIMG_REQUIRE_OPENAI, production);
  if (requireOpenAi && !nonEmpty(env.OPENAI_API_KEY)) {
    throw new Error("OPENAI_API_KEY is required by the production configuration.");
  }

  const httpsKeyPath = nonEmpty(env.SHEETIFYIMG_HTTPS_KEY)
    ? path.resolve(repoRoot, env.SHEETIFYIMG_HTTPS_KEY)
    : "";
  const httpsCertPath = nonEmpty(env.SHEETIFYIMG_HTTPS_CERT)
    ? path.resolve(repoRoot, env.SHEETIFYIMG_HTTPS_CERT)
    : "";
  if (Boolean(httpsKeyPath) !== Boolean(httpsCertPath)) {
    throw new Error("SHEETIFYIMG_HTTPS_KEY and SHEETIFYIMG_HTTPS_CERT must be configured together.");
  }

  return Object.freeze({
    repoRoot,
    runtimeMode,
    production,
    runtimeDir,
    stateDir,
    logsDir: runtimeDir ? path.join(runtimeDir, "logs") : path.join(repoRoot, ".sheetifyimg", "logs"),
    projectsDir,
    worksheetsDir,
    publicDir: path.join(repoRoot, "public"),
    host,
    port: portNumber(env.PORT, 4173),
    publicUrl,
    tutorials: Object.freeze({
      youtubeUrls: Object.freeze({
        "first-worksheet": firstWorksheetYoutubeUrl
      })
    }),
    ownerAuth: Object.freeze({
      enabled: ownerAuthEnabled,
      username: ownerAuthUsername,
      passwordHash: ownerAuthPasswordHash
    }),
    email: Object.freeze({
      configured: Boolean(resendApiKey),
      provider: resendApiKey ? "resend" : null,
      apiKey: resendApiKey,
      from: "SheetifyIMG <sheetify@jujies.app>",
      replyTo: "sheetify@jujies.app"
    }),
    betaAccess: Object.freeze({
      enabled: betaAccessEnabled,
      secret: betaAccessSecret || "sheetifyimg-development-beta-secret",
      stateFile: path.join(stateDir, "beta-access.json"),
      storageRoot: runtimeDir ? path.join(runtimeDir, "passes") : path.join(repoRoot, ".sheetifyimg", "passes"),
      sessionDays: positiveInteger(env.SHEETIFYIMG_BETA_SESSION_DAYS, 180, "SHEETIFYIMG_BETA_SESSION_DAYS"),
      pairingMinutes: positiveInteger(env.SHEETIFYIMG_BETA_PAIRING_MINUTES, 5, "SHEETIFYIMG_BETA_PAIRING_MINUTES"),
      recoveryMinutes: positiveInteger(env.SHEETIFYIMG_BETA_RECOVERY_MINUTES, 30, "SHEETIFYIMG_BETA_RECOVERY_MINUTES"),
      pageCap: positiveInteger(env.SHEETIFYIMG_BETA_MAX_PAGES_PER_DRAFT, 6, "SHEETIFYIMG_BETA_MAX_PAGES_PER_DRAFT"),
      perPassConcurrency: positiveInteger(env.SHEETIFYIMG_BETA_PASS_CONCURRENCY, 1, "SHEETIFYIMG_BETA_PASS_CONCURRENCY"),
      globalConcurrency: positiveInteger(env.SHEETIFYIMG_BETA_GLOBAL_CONCURRENCY, 2, "SHEETIFYIMG_BETA_GLOBAL_CONCURRENCY"),
      paidGenerationEnabled: booleanValue(env.SHEETIFYIMG_PAID_GENERATION_ENABLED, false),
      adminPrivateOnly: betaAdminPrivateOnly,
      contactEmail,
      inboundMailEnabled,
      inboundMailAllowedHosts: Object.freeze(inboundMailAllowedHosts),
      inboundMailAllowLoopback,
      inboundMailMaxBytes: positiveInteger(
        env.SHEETIFYIMG_MAIL_INBOUND_MAX_BYTES,
        25 * 1024 * 1024,
        "SHEETIFYIMG_MAIL_INBOUND_MAX_BYTES"
      ),
      mailConfigured: Boolean(resendApiKey)
    }),
    httpsKeyPath,
    httpsCertPath,
    httpsEnabled: Boolean(httpsKeyPath && httpsCertPath),
    maxJsonBodyBytes: positiveInteger(
      env.SHEETIFYIMG_MAX_JSON_BODY_BYTES,
      1024 * 1024,
      "SHEETIFYIMG_MAX_JSON_BODY_BYTES"
    ),
    maxUploadBytes: positiveInteger(
      env.SHEETIFYIMG_MAX_UPLOAD_BYTES,
      25 * 1024 * 1024,
      "SHEETIFYIMG_MAX_UPLOAD_BYTES"
    ),
    shutdownTimeoutMs: positiveInteger(
      env.SHEETIFYIMG_SHUTDOWN_TIMEOUT_MS,
      210000,
      "SHEETIFYIMG_SHUTDOWN_TIMEOUT_MS"
    ),
    exposeBillingStatus: booleanValue(env.SHEETIFYIMG_EXPOSE_BILLING_STATUS, !production),
    releaseCommit: nonEmpty(env.SHEETIFYIMG_RELEASE_COMMIT) || null,
    planningFlow: resolvePlanningFlow({ env }),
    requireOpenAi
  });
}

function safeServerConfig(config) {
  return {
    runtimeMode: config.runtimeMode,
    host: config.host,
    port: config.port,
    httpsEnabled: config.httpsEnabled,
    publicUrlConfigured: Boolean(config.publicUrl),
    ownerAuthEnabled: config.ownerAuth.enabled,
    outboundMailConfigured: config.email.configured,
    betaAccessEnabled: config.betaAccess.enabled,
    paidGenerationEnabled: config.betaAccess.paidGenerationEnabled,
    inboundMailEnabled: config.betaAccess.inboundMailEnabled,
    runtimeConfigured: Boolean(config.runtimeDir),
    billingStatusExposed: config.exposeBillingStatus,
    planningFlow: config.planningFlow,
    releaseCommit: config.releaseCommit
  };
}

function validateEnvironmentFile(options = {}) {
  const filePath = validatedAbsolutePath(options.filePath, "SHEETIFYIMG_ENV_FILE");
  if (!filePath) {
    return null;
  }
  const stat = fs.statSync(filePath);
  if (!stat.isFile()) {
    throw new Error("SHEETIFYIMG_ENV_FILE must reference a regular file.");
  }
  return filePath;
}

module.exports = {
  RUNTIME_MODES,
  isInsideRoot,
  isLoopbackHost,
  loadServerEnvironment,
  normalizedRuntimeMode,
  resolveServerConfig,
  safeServerConfig,
  validateEnvironmentFile
};
