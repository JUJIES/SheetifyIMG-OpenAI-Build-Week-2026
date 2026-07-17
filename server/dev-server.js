"use strict";

const fs = require("node:fs");
const fsp = require("node:fs/promises");
const http = require("node:http");
const https = require("node:https");
const os = require("node:os");
const path = require("node:path");
const { createBetaAccessManager } = require("../core/betaAccessManager");
const { createBetaCard } = require("../core/betaCardManager");
const { createEmailService } = require("../core/emailService");
const { normalizeLocale } = require("../core/locale");
const { readChat, sendChatMessage } = require("../core/aiChatManager");
const { addInputUpload } = require("../core/inputManager");
const { transcribeProjectAudio } = require("../core/voiceInputManager");
const { buildBillingStatus } = require("../core/billingStatusManager");
const {
  buildLibraryTree,
  createLibraryFolder,
  deleteLibraryFolder,
  getLibraryItem,
  moveLibraryItem,
  removeProjectFromLibrary,
  updateLibraryFolder
} = require("../core/libraryManager");
const {
  createSingleWorksheetProject,
  deleteProject,
  listProjects,
  openProject,
  renameProject
} = require("../core/projectManager");
const { createQrSvg } = require("../core/qrCodeManager");
const { runWorkspaceCommand } = require("../core/workspaceCommandManager");
const { buildWorkspace } = require("../core/workspaceManager");
const {
  buildWorksheetTree,
  createWorksheetFolder,
  deleteWorksheet,
  deleteWorksheetFolder,
  deleteProjectWorksheets,
  depositCandidateAsWorksheet,
  getWorksheetItem,
  listProjectWorksheets,
  markWorksheetItemSeen,
  moveWorksheetItem,
  renameWorksheet,
  updateWorksheetFolder
} = require("../core/worksheetLibraryManager");
const {
  beginCandidateGenerationShutdown,
  markCandidateGenerationSeen,
  waitForActiveCandidateGenerationJobs
} = require("../core/candidateGenerationJobManager");
const {
  loadServerEnvironment,
  resolveServerConfig,
  safeServerConfig
} = require("./runtime-config");
const {
  checkRuntimeReadiness,
  prepareRuntime,
  writeRuntimeProbe
} = require("./runtime-health");
const { createOwnerAuthGate } = require("./owner-auth");
const {
  createForwardEmailWebhookVerifier,
  forwardedEmailRequest
} = require("./forward-email-webhook");

const repoRoot = path.resolve(__dirname, "..");
const AI_ENV_KEYS = [
  "OPENAI_API_KEY",
  "OPENAI_ADMIN_KEY",
  "OPENAI_BASE_URL",
  "SHEETIFYIMG_OPENAI_ADMIN_KEY",
  "SHEETIFYIMG_OPENAI_MONTHLY_BUDGET_USD",
  "SHEETIFYIMG_AI_MODE",
  "SHEETIFYIMG_PLANNING_FLOW",
  "SHEETIFYIMG_SEMANTIC_INTERPRETER",
  "SHEETIFYIMG_TEXT_MODEL",
  "SHEETIFYIMG_REASONING_MODEL",
  "SHEETIFYIMG_REASONING_EFFORT",
  "SHEETIFYIMG_OPENAI_TIMEOUT_MS",
  "SHEETIFYIMG_TRANSCRIPTION_MODEL",
  "SHEETIFYIMG_TRANSCRIPTION_LANGUAGE",
  "SHEETIFYIMG_TRANSCRIPTION_TIMEOUT_MS",
  "SHEETIFYIMG_CHAT_INTENT_INTERPRETER",
  "SHEETIFYIMG_IMAGE_MODEL",
  "SHEETIFYIMG_IMAGE_PROVIDER",
  "SHEETIFYIMG_IMAGE_PRESET",
  "SHEETIFYIMG_IMAGE_SIZE",
  "SHEETIFYIMG_IMAGE_QUALITY",
  "SHEETIFYIMG_IMAGE_OUTPUT_FORMAT",
  "SHEETIFYIMG_IMAGE_BACKGROUND",
  "SHEETIFYIMG_IMAGE_MODERATION",
  "SHEETIFYIMG_IMAGE_TIMEOUT_MS",
  "SHEETIFYIMG_MAX_IMAGE_CANDIDATES",
  "SHEETIFYIMG_CODEX_IMAGE_ENABLED",
  "SHEETIFYIMG_CODEX_BIN",
  "SHEETIFYIMG_CODEX_IMAGE_MODEL",
  "SHEETIFYIMG_CODEX_REASONING_EFFORT",
  "SHEETIFYIMG_CODEX_IMAGE_TIMEOUT_MS",
  "SHEETIFYIMG_CODEX_GENERATED_IMAGES_DIR"
];
loadServerEnvironment({ repoRoot, localOverrideKeys: AI_ENV_KEYS });
if (!process.env.SHEETIFYIMG_SEMANTIC_INTERPRETER) {
  process.env.SHEETIFYIMG_SEMANTIC_INTERPRETER = "on";
}
if (!process.env.SHEETIFYIMG_CHAT_INTENT_INTERPRETER) {
  process.env.SHEETIFYIMG_CHAT_INTENT_INTERPRETER = "on";
}

const serverConfig = resolveServerConfig({ repoRoot });
const ownerAuthGate = createOwnerAuthGate(serverConfig.ownerAuth);
const betaAccessManager = createBetaAccessManager(serverConfig.betaAccess);
const emailService = createEmailService({
  apiKey: serverConfig.email.apiKey,
  from: serverConfig.email.from,
  replyTo: serverConfig.email.replyTo,
  publicUrl: serverConfig.publicUrl
});
const verifyForwardEmailWebhook = createForwardEmailWebhookVerifier({
  allowedHosts: serverConfig.betaAccess.inboundMailAllowedHosts,
  allowLoopback: serverConfig.betaAccess.inboundMailAllowLoopback
});
const {
  projectsDir: defaultProjectsDir,
  worksheetsDir: defaultWorksheetsDir,
  publicDir,
  port: defaultPort,
  host: defaultHost,
  httpsKeyPath,
  httpsCertPath,
  httpsEnabled
} = serverConfig;

function normalizeBaseUrl(value) {
  return String(value || "").trim().replace(/\/+$/, "");
}

function hostToHttpUrl(host, port, scheme = httpsEnabled ? "https" : "http") {
  const trimmed = String(host || "").trim();
  if (!trimmed) {
    return null;
  }
  if (/^https?:\/\//i.test(trimmed)) {
    return normalizeBaseUrl(trimmed);
  }
  if (trimmed.startsWith("[")) {
    return `${scheme}://${trimmed}${trimmed.includes("]:") ? "" : `:${port}`}`;
  }
  if (trimmed.includes(":") && !trimmed.includes("]") && !/^\d+\.\d+\.\d+\.\d+(?::\d+)?$/.test(trimmed)) {
    return `${scheme}://[${trimmed}]:${port}`;
  }
  if (/[^\]]:\d+$/.test(trimmed)) {
    return `${scheme}://${trimmed}`;
  }
  return `${scheme}://${trimmed}:${port}`;
}

function localNetworkAddresses() {
  const addresses = [];
  for (const values of Object.values(os.networkInterfaces())) {
    for (const value of values || []) {
      if (value.family !== "IPv4" || value.internal || value.address.startsWith("169.254.")) {
        continue;
      }
      addresses.push(value.address);
    }
  }
  return [...new Set(addresses)];
}

function isWildcardHost(host) {
  return host === "0.0.0.0" || host === "::";
}

function serverUrls(host, port, scheme = httpsEnabled ? "https" : "http") {
  const urls = [];
  const addUrl = (label, url) => {
    if (!url || urls.some((entry) => entry.url === url)) {
      return;
    }
    urls.push({ label, url });
  };

  addUrl("Homebildschirm", normalizeBaseUrl(process.env.SHEETIFYIMG_PUBLIC_URL));
  addUrl("Homebildschirm", hostToHttpUrl(process.env.SHEETIFYIMG_PUBLIC_HOST, port, scheme));

  if (isWildcardHost(host)) {
    addUrl("Lokal", hostToHttpUrl("127.0.0.1", port, scheme));
    for (const address of localNetworkAddresses()) {
      addUrl("Netzwerk", hostToHttpUrl(address, port, scheme));
    }
    addUrl("Mac-Name", hostToHttpUrl(os.hostname(), port, scheme));
    return urls;
  }

  addUrl(host === "127.0.0.1" || host === "localhost" ? "Lokal" : "Netzwerk", hostToHttpUrl(host, port, scheme));
  return urls;
}

function securityHeaders() {
  return {
    "content-security-policy": "frame-ancestors 'none'; base-uri 'self'; object-src 'none'",
    "x-frame-options": "DENY",
    "x-content-type-options": "nosniff",
    "referrer-policy": "same-origin",
    "permissions-policy": "camera=(), geolocation=(), microphone=(self)"
  };
}

function sendJson(response, statusCode, value, headers = {}) {
  response.writeHead(statusCode, {
    ...securityHeaders(),
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    ...headers
  });
  response.end(`${JSON.stringify(value, null, 2)}\n`);
}

function requestError(statusCode, message) {
  return Object.assign(new Error(message), { statusCode });
}

function publicBetaErrorCode(request, error) {
  const pathname = routePath(request);
  const message = String(error?.message || "");
  if (error?.statusCode === 429) return "rate_limited";
  if (/Pass ist abgelaufen/.test(message)) return "pass_expired";
  if (/Pass ist derzeit nicht aktiv/.test(message)) return "pass_inactive";
  if (pathname === "/api/auth/login" && /Pass ist ungültig/.test(message)) return "pass_invalid";
  if (pathname === "/api/auth/pair" && /Kopplungscode ist ungültig oder abgelaufen/.test(message)) {
    return "pairing_invalid_or_expired";
  }
  if (pathname === "/api/auth/recover" && /Wiederherstellungslink ist ungültig oder abgelaufen/.test(message)) {
    return "recovery_invalid_or_expired";
  }
  if (pathname === "/api/pass/topup" && /Guthabenkarte ist ungültig, abgelaufen oder bereits eingelöst/.test(message)) {
    return "topup_invalid_or_redeemed";
  }
  if (/gültige E-Mail-Adresse/.test(message)) return "email_invalid";
  if (/Unbekannte Anfrageart/.test(message)) return "request_kind_invalid";
  if (/Gerätesitzung ist nicht mehr gültig/.test(message)) return "session_invalid";
  if (/Beta-Einwilligung/.test(message)) return "beta_consent_invalid";
  return null;
}

function declaredContentLength(request) {
  const value = Number(request.headers["content-length"]);
  return Number.isFinite(value) && value >= 0 ? value : null;
}

async function readBodyWithLimit(request, maxBytes, tooLargeMessage) {
  const declaredSize = declaredContentLength(request);
  if (declaredSize !== null && declaredSize > maxBytes) {
    throw requestError(413, tooLargeMessage);
  }
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > maxBytes) {
      throw requestError(413, tooLargeMessage);
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

async function readJsonBody(request) {
  const body = await readBodyWithLimit(
    request,
    serverConfig.maxJsonBodyBytes,
    "Die Anfrage ist zu groß."
  );
  if (body.length === 0) {
    return {};
  }
  const text = body.toString("utf8").trim();
  if (!text) {
    return {};
  }
  try {
    return JSON.parse(text);
  } catch {
    throw requestError(400, "Die Anfrage enthält ungültiges JSON.");
  }
}

async function readRawBody(request, options = {}) {
  const maxBytes = options.maxBytes || serverConfig.maxUploadBytes;
  const maxMegabytes = Math.max(1, Math.floor(maxBytes / (1024 * 1024)));
  return readBodyWithLimit(
    request,
    maxBytes,
    `Die Datei ist zu groß. Bitte maximal ${maxMegabytes} MB hochladen.`
  );
}

function multipartBoundary(contentType) {
  const match = String(contentType || "").match(/(?:^|;)\s*boundary=(?:"([^"]+)"|([^;]+))/i);
  const boundary = (match?.[1] || match?.[2] || "").trim();
  if (!boundary || boundary.length > 200 || /[\r\n]/.test(boundary)) {
    return null;
  }
  return boundary;
}

function parseHeaderParameters(value) {
  const params = {};
  const pattern = /;\s*([a-z0-9_-]+)=(?:"((?:\\.|[^"])*)"|([^;]*))/gi;
  let match;
  while ((match = pattern.exec(String(value || "")))) {
    const rawValue = match[2] ?? match[3] ?? "";
    params[match[1].toLowerCase()] = rawValue.replace(/\\"/g, "\"").trim();
  }
  return params;
}

function parsePartHeaders(value) {
  const headers = {};
  for (const line of String(value || "").split("\r\n")) {
    const separator = line.indexOf(":");
    if (separator <= 0) {
      continue;
    }
    const key = line.slice(0, separator).trim().toLowerCase();
    const headerValue = line.slice(separator + 1).trim();
    if (key) {
      headers[key] = headerValue;
    }
  }
  return headers;
}

function parseMultipartFile(request, body) {
  const form = parseMultipartForm(request, body);
  const file = form.files.find((entry) => entry.fieldName === "file") || form.files[0] || null;
  if (!file) {
    throw requestError(400, "Bitte eine Datei auswaehlen.");
  }
  return file;
}

function parseMultipartForm(request, body) {
  const contentType = request.headers["content-type"] || "";
  const boundary = multipartBoundary(contentType);
  if (!boundary) {
    throw requestError(400, "Upload konnte nicht gelesen werden.");
  }

  const delimiter = Buffer.from(`--${boundary}`, "utf8");
  const headerSeparator = Buffer.from("\r\n\r\n", "latin1");
  let offset = 0;
  const fields = {};
  const files = [];

  while (offset < body.length) {
    const delimiterStart = body.indexOf(delimiter, offset);
    if (delimiterStart < 0) {
      break;
    }

    let partStart = delimiterStart + delimiter.length;
    if (body[partStart] === 45 && body[partStart + 1] === 45) {
      break;
    }
    if (body[partStart] !== 13 || body[partStart + 1] !== 10) {
      offset = partStart;
      continue;
    }
    partStart += 2;

    const nextDelimiterStart = body.indexOf(delimiter, partStart);
    if (nextDelimiterStart < 0) {
      break;
    }

    let partEnd = nextDelimiterStart;
    if (body[partEnd - 2] === 13 && body[partEnd - 1] === 10) {
      partEnd -= 2;
    }

    const part = body.subarray(partStart, partEnd);
    const headerEnd = part.indexOf(headerSeparator);
    if (headerEnd < 0) {
      offset = nextDelimiterStart;
      continue;
    }

    const headers = parsePartHeaders(part.subarray(0, headerEnd).toString("latin1"));
    const disposition = headers["content-disposition"] || "";
    const dispositionParams = parseHeaderParameters(disposition);
    const fieldName = dispositionParams.name || "";
    if (!fieldName) {
      offset = nextDelimiterStart;
      continue;
    }
    const fileName = dispositionParams.filename || "";
    const value = part.subarray(headerEnd + headerSeparator.length);
    if (!fileName) {
      fields[fieldName] = value.toString("utf8");
      offset = nextDelimiterStart;
      continue;
    }

    files.push({
      fieldName,
      fileName,
      mimeType: headers["content-type"] || "application/octet-stream",
      buffer: value
    });
    offset = nextDelimiterStart;
  }

  return { fields, files };
}

function routePath(request) {
  const url = new URL(request.url, "http://localhost");
  return decodeURIComponent(url.pathname);
}

function rawPathname(request) {
  return String(request.url || "/").split("?")[0];
}

function contentTypeFor(filePath) {
  const extension = path.extname(filePath).toLowerCase();
  const types = {
    ".gif": "image/gif",
    ".html": "text/html; charset=utf-8",
    ".webmanifest": "application/manifest+json; charset=utf-8",
    ".jpeg": "image/jpeg",
    ".jpg": "image/jpeg",
    ".js": "text/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".pdf": "application/pdf",
    ".png": "image/png",
    ".svg": "image/svg+xml",
    ".css": "text/css; charset=utf-8",
    ".txt": "text/plain; charset=utf-8",
    ".webp": "image/webp"
  };
  return types[extension] || "application/octet-stream";
}

function isInsideRoot(rootDir, filePath) {
  const relative = path.relative(rootDir, filePath);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function fileServingRootFor(filePath, roots = [defaultProjectsDir, defaultWorksheetsDir]) {
  return roots.map((rootDir) => path.resolve(rootDir))
    .find((rootDir) => isInsideRoot(rootDir, filePath)) || null;
}

async function serveFileFromRoot({ rootDir, relativePath, response }) {
  const filePath = path.resolve(rootDir, relativePath);

  if (!isInsideRoot(rootDir, filePath)) {
    sendJson(response, 403, {
      error: "forbidden",
      message: "File path is outside the allowed directory."
    });
    return;
  }

  let stat;
  try {
    stat = await fsp.stat(filePath);
  } catch {
    sendJson(response, 404, {
      error: "not_found",
      message: "File does not exist."
    });
    return;
  }

  if (!stat.isFile()) {
    sendJson(response, 404, {
      error: "not_found",
      message: "Requested path is not a file."
    });
    return;
  }

  const [realRootDir, realFilePath] = await Promise.all([
    fsp.realpath(rootDir),
    fsp.realpath(filePath)
  ]);
  if (!isInsideRoot(realRootDir, realFilePath)) {
    sendJson(response, 403, {
      error: "forbidden",
      message: "File path is outside the allowed directory."
    });
    return;
  }

  response.writeHead(200, {
    ...securityHeaders(),
    "content-type": contentTypeFor(realFilePath),
    "content-length": stat.size,
    "cache-control": "no-store"
  });
  fs.createReadStream(realFilePath).pipe(response);
}

async function serveProjectFile(request, response, context = {}) {
  const projectsDir = context.projectsDir || defaultProjectsDir;
  const worksheetsDir = context.worksheetsDir || defaultWorksheetsDir;
  const requestRoot = context.repoRoot || repoRoot;
  const allowedRoots = [projectsDir, worksheetsDir];
  const relativePath = decodeURIComponent(rawPathname(request).replace(/^\/files\/?/, ""));
  const normalizedRelativePath = relativePath.replace(/^\/+/, "");
  if (normalizedRelativePath.startsWith("projects/")) {
    await serveFileFromRoot({
      rootDir: projectsDir,
      relativePath: normalizedRelativePath.slice("projects/".length),
      response
    });
    return;
  }
  if (normalizedRelativePath.startsWith("worksheets/")) {
    await serveFileFromRoot({
      rootDir: worksheetsDir,
      relativePath: normalizedRelativePath.slice("worksheets/".length),
      response
    });
    return;
  }
  const filePath = path.resolve(requestRoot, relativePath);
  const rootDir = fileServingRootFor(filePath, allowedRoots);
  if (!rootDir) {
    sendJson(response, 403, {
      error: "forbidden",
      message: "File path is outside the allowed asset directories."
    });
    return;
  }
  await serveFileFromRoot({
    rootDir,
    relativePath: path.relative(rootDir, filePath),
    response
  });
}

async function serveOpaqueFile(request, response, context = {}) {
  const pathname = routePath(request);
  const match = pathname.match(/^\/api\/files\/([A-Za-z0-9_-]+)$/);
  if (!match) {
    sendJson(response, 404, { error: "not_found", message: "Datei wurde nicht gefunden." });
    return;
  }
  let relativePath;
  try {
    relativePath = Buffer.from(match[1], "base64url").toString("utf8");
  } catch {
    relativePath = "";
  }
  if (!relativePath || !["projects/", "worksheets/"].some((prefix) => relativePath.startsWith(prefix))) {
    sendJson(response, 404, { error: "not_found", message: "Datei wurde nicht gefunden." });
    return;
  }
  const rootDir = relativePath.startsWith("projects/")
    ? context.projectsDir || defaultProjectsDir
    : context.worksheetsDir || defaultWorksheetsDir;
  const prefix = relativePath.startsWith("projects/") ? "projects/" : "worksheets/";
  await serveFileFromRoot({ rootDir, relativePath: relativePath.slice(prefix.length), response });
}

async function servePublicFile(request, response) {
  const pathname = routePath(request);
  const relativePath = pathname === "/" ? "index.html" : pathname.replace(/^\//, "");
  await serveFileFromRoot({ rootDir: publicDir, relativePath, response });
}

async function handleHealth(pathname, response) {
  if (pathname === "/health/live") {
    sendJson(response, 200, { status: "ok" });
    return true;
  }
  if (pathname === "/health/ready") {
    const readiness = await checkRuntimeReadiness(serverConfig);
    const ready = readiness.status === "ready";
    sendJson(response, ready ? 200 : 503, {
      status: ready ? "ready" : "not_ready",
      checks: readiness.checks
    });
    return true;
  }
  return false;
}

const SESSION_COOKIE = "sheetify_session";
const AUTH_ATTEMPT_WINDOW_MS = 10 * 60 * 1000;
const AUTH_ATTEMPT_LIMIT = 12;
const authAttemptWindows = new Map();

function parseCookies(request) {
  return String(request.headers.cookie || "").split(";").reduce((cookies, part) => {
    const separator = part.indexOf("=");
    if (separator <= 0) {
      return cookies;
    }
    const name = part.slice(0, separator).trim();
    const value = part.slice(separator + 1).trim();
    if (name) {
      cookies[name] = value;
    }
    return cookies;
  }, {});
}

function sessionCookie(token) {
  const secure = serverConfig.production || serverConfig.publicUrl.startsWith("https://");
  return [
    `${SESSION_COOKIE}=${token}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Strict",
    `Max-Age=${serverConfig.betaAccess.sessionDays * 24 * 60 * 60}`,
    ...(secure ? ["Secure"] : [])
  ].join("; ");
}

function clearSessionCookie() {
  const secure = serverConfig.production || serverConfig.publicUrl.startsWith("https://");
  return [
    `${SESSION_COOKIE}=`,
    "Path=/",
    "HttpOnly",
    "SameSite=Strict",
    "Max-Age=0",
    ...(secure ? ["Secure"] : [])
  ].join("; ");
}

function deviceNameFromRequest(request, explicitName = "") {
  const supplied = String(explicitName || "").trim();
  if (supplied) {
    return supplied.slice(0, 120);
  }
  const agent = String(request.headers["user-agent"] || "");
  if (/iphone/i.test(agent)) return "iPhone";
  if (/ipad/i.test(agent)) return "iPad";
  if (/android/i.test(agent)) return "Android-Gerät";
  if (/windows/i.test(agent)) return "Windows-PC";
  if (/macintosh|mac os/i.test(agent)) return "Mac";
  return "Browser-Gerät";
}

function requestOrigin(request) {
  if (serverConfig.publicUrl) {
    return serverConfig.publicUrl;
  }
  const forwardedProto = String(request.headers["x-forwarded-proto"] || "").split(",")[0].trim();
  const scheme = forwardedProto || (httpsEnabled ? "https" : "http");
  return `${scheme}://${request.headers.host || `${defaultHost}:${defaultPort}`}`;
}

function localizedEntryUrl(request, locale, kind, secret) {
  const language = normalizeLocale(locale);
  const entryUrl = `${requestOrigin(request)}/?lang=${encodeURIComponent(language)}`;
  // A shared pass invitation opens the entry page but never submits its secret.
  // Pairing, top-up and recovery remain explicit one-time link flows.
  if (kind === "pass") return entryUrl;
  return `${entryUrl}#${kind}=${encodeURIComponent(secret)}`;
}

function sendRedirect(response, location, statusCode = 302) {
  response.writeHead(statusCode, {
    ...securityHeaders(),
    location,
    "cache-control": "no-store"
  });
  response.end();
}

function sendAuthRequired(response) {
  sendJson(response, 401, {
    error: "authentication_required",
    message: "Bitte mit einem SheetifyIMG Pass verbinden."
  });
}

function sourceAddress(request) {
  const cloudflare = String(request.headers["cf-connecting-ip"] || "").trim();
  return cloudflare || String(request.socket?.remoteAddress || "").replace(/^::ffff:/, "");
}

async function readInboundMailBody(request, maxBytes) {
  const declaredSize = declaredContentLength(request);
  if (declaredSize !== null && declaredSize > maxBytes) {
    request.resume();
    return null;
  }
  const chunks = [];
  let size = 0;
  let tooLarge = false;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > maxBytes) {
      tooLarge = true;
      continue;
    }
    chunks.push(chunk);
  }
  return tooLarge ? null : Buffer.concat(chunks);
}

async function handleInboundMailWebhook(request, response) {
  const pathname = routePath(request);
  if (pathname !== "/api/mail/inbound") {
    return false;
  }
  if (request.method !== "POST" || !serverConfig.betaAccess.inboundMailEnabled) {
    sendJson(response, 404, { error: "not_found", message: "Route wurde nicht gefunden." });
    return true;
  }
  if (!await verifyForwardEmailWebhook(sourceAddress(request))) {
    throw requestError(403, "Mail-Webhook konnte nicht verifiziert werden.");
  }

  const body = await readInboundMailBody(request, serverConfig.betaAccess.inboundMailMaxBytes);
  if (!body) {
    sendJson(response, 200, { accepted: false, reason: "too_large" });
    return true;
  }
  let payload;
  try {
    payload = JSON.parse(body.toString("utf8"));
  } catch {
    sendJson(response, 200, { accepted: false, reason: "invalid_payload" });
    return true;
  }
  const inboxRequest = forwardedEmailRequest(payload);
  if (!inboxRequest) {
    sendJson(response, 200, { accepted: false, reason: "missing_sender" });
    return true;
  }
  const created = await betaAccessManager.createRequest(inboxRequest);
  sendJson(response, 200, { accepted: true, duplicate: created.duplicate });
  return true;
}

function isPrivateAdminAddress(address) {
  const value = String(address || "").toLowerCase();
  if (["127.0.0.1", "::1", "localhost"].includes(value)) {
    return true;
  }
  const ipv4 = value.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (ipv4) {
    const first = Number(ipv4[1]);
    const second = Number(ipv4[2]);
    return first === 100 && second >= 64 && second <= 127;
  }
  return value.startsWith("fd7a:115c:a1e0:");
}

function privateAdminAllowed(request) {
  return !serverConfig.betaAccess.adminPrivateOnly || isPrivateAdminAddress(sourceAddress(request));
}

function assertSameOriginMutation(request) {
  if (!["POST", "PATCH", "PUT", "DELETE"].includes(request.method)) {
    return;
  }
  if (String(request.headers["sec-fetch-site"] || "").toLowerCase() === "cross-site") {
    throw requestError(403, "Diese Anfrage muss direkt von SheetifyIMG kommen.");
  }
  const suppliedOrigin = String(request.headers.origin || "").trim();
  if (!suppliedOrigin) {
    return;
  }
  const forwardedProto = String(request.headers["x-forwarded-proto"] || "").split(",")[0].trim();
  const scheme = forwardedProto || (httpsEnabled ? "https" : "http");
  const requestHostOrigin = `${scheme}://${request.headers.host || `${defaultHost}:${defaultPort}`}`;
  const allowedOrigins = new Set([requestHostOrigin, serverConfig.publicUrl].filter(Boolean));
  if (!allowedOrigins.has(suppliedOrigin)) {
    throw requestError(403, "Diese Anfrage muss direkt von SheetifyIMG kommen.");
  }
}

function authAttemptKey(request, route) {
  return `${sourceAddress(request) || "unknown"}:${route}`;
}

function assertAuthAttemptAllowed(request, route) {
  const now = Date.now();
  const key = authAttemptKey(request, route);
  const recent = (authAttemptWindows.get(key) || []).filter((timestamp) => now - timestamp < AUTH_ATTEMPT_WINDOW_MS);
  if (recent.length >= AUTH_ATTEMPT_LIMIT) {
    throw requestError(429, "Zu viele Versuche. Bitte in einigen Minuten erneut probieren.");
  }
  recent.push(now);
  authAttemptWindows.set(key, recent);
  if (authAttemptWindows.size > 5000) {
    for (const [entryKey, timestamps] of authAttemptWindows) {
      if (!timestamps.some((timestamp) => now - timestamp < AUTH_ATTEMPT_WINDOW_MS)) {
        authAttemptWindows.delete(entryKey);
      }
    }
  }
}

function clearAuthAttempts(request, route) {
  authAttemptWindows.delete(authAttemptKey(request, route));
}

async function deliverEmail(task) {
  if (!emailService.configured) {
    return { status: "disabled" };
  }
  try {
    return await task();
  } catch (error) {
    console.error(`[SheetifyIMG] outbound email failed: ${String(error?.name || "Error")}`);
    return { status: "failed" };
  }
}

async function betaRequestContext(request) {
  const token = parseCookies(request)[SESSION_COOKIE] || "";
  const identity = await betaAccessManager.authenticateToken(token);
  if (!identity) {
    return null;
  }
  return {
    ...identity,
    repoRoot: identity.storage.rootDir,
    promptRoot: repoRoot,
    projectsDir: identity.storage.projectsDir,
    worksheetsDir: identity.storage.worksheetsDir,
    usageAttribution: {
      accessGrantId: `grant_${identity.passId.replace(/^pass_/, "")}`,
      sessionId: identity.sessionId
    },
    generationQuota: {
      reserve: (input) => betaAccessManager.reserveGeneration(identity.passId, input),
      settle: (reservationId, generatedPages) => betaAccessManager.settleGeneration(reservationId, generatedPages),
      refund: (reservationId, reason) => betaAccessManager.refundGeneration(reservationId, reason)
    }
  };
}

function assertProjectId(value) {
  const id = String(value || "");
  if (!/^[a-z0-9](?:[a-z0-9-]{0,78}[a-z0-9])?$/.test(id)) {
    throw requestError(400, "Ungültige Projekt-ID.");
  }
  return id;
}

function assertItemId(value, type) {
  const id = String(value || "");
  const prefix = `${type}:`;
  if (!id.startsWith(prefix) || !/^[a-zA-Z0-9_-]+$/.test(id.slice(prefix.length))) {
    throw requestError(400, "Ungültige Objekt-ID.");
  }
  return id;
}

function assertStorageSegment(value, label) {
  const id = String(value || "");
  if (id && !/^[a-zA-Z0-9_-]+$/.test(id)) {
    throw requestError(400, `Ungültige ${label}.`);
  }
  return id;
}

async function handleAuthApi(request, response) {
  const pathname = routePath(request);
  assertSameOriginMutation(request);
  const current = await betaRequestContext(request);
  if (request.method === "GET" && pathname === "/api/auth/session") {
    sendJson(response, 200, current
      ? { authenticated: true, pass: current.pass, session: current.session, appUrl: "/app" }
      : { authenticated: false, appUrl: "/app" });
    return true;
  }
  if (request.method === "POST" && pathname === "/api/auth/login") {
    assertAuthAttemptAllowed(request, "pass");
    const body = await readJsonBody(request);
    const login = await betaAccessManager.loginWithPass(
      body.code,
      deviceNameFromRequest(request, body.deviceName),
      { uiLocale: body.uiLocale }
    );
    clearAuthAttempts(request, "pass");
    sendJson(response, 200, { authenticated: true, pass: login.pass, session: login.session, appUrl: "/app" }, {
      "set-cookie": sessionCookie(login.token)
    });
    return true;
  }
  if (request.method === "POST" && pathname === "/api/auth/pair") {
    assertAuthAttemptAllowed(request, "pair");
    const body = await readJsonBody(request);
    const login = await betaAccessManager.redeemPairing(
      body.code,
      deviceNameFromRequest(request, body.deviceName),
      { uiLocale: body.uiLocale }
    );
    clearAuthAttempts(request, "pair");
    sendJson(response, 200, { authenticated: true, pass: login.pass, session: login.session, appUrl: "/app" }, {
      "set-cookie": sessionCookie(login.token)
    });
    return true;
  }
  if (request.method === "POST" && pathname === "/api/auth/logout") {
    await betaAccessManager.logout(current?.sessionId);
    sendJson(response, 200, { loggedOut: true }, { "set-cookie": clearSessionCookie() });
    return true;
  }
  if (request.method === "PATCH" && pathname === "/api/auth/session") {
    if (!current) {
      throw requestError(401, "Die aktuelle Gerätesitzung ist nicht mehr gültig.");
    }
    const body = await readJsonBody(request);
    const session = await betaAccessManager.updateSessionLocale(
      current.passId,
      current.sessionId,
      body.uiLocale
    );
    sendJson(response, 200, {
      authenticated: true,
      pass: current.pass,
      session,
      appUrl: "/app"
    });
    return true;
  }
  if (request.method === "POST" && pathname === "/api/auth/recovery") {
    assertAuthAttemptAllowed(request, "support");
    const body = await readJsonBody(request);
    const created = await betaAccessManager.createRequest({
      source: "app",
      kind: body.kind || "recovery",
      email: body.email,
      subject: body.subject,
      message: body.message,
      uiLocale: body.uiLocale
    });
    if (!created.duplicate) {
      await deliverEmail(() => emailService.sendSupportConfirmation({
        email: created.request.email,
        name: created.request.name,
        requestId: created.request.id,
        locale: created.request.uiLocale,
        idempotencyKey: `support-confirmation:${created.request.id}`
      }));
    }
    sendJson(response, 202, {
      accepted: true,
      contactEmail: serverConfig.betaAccess.contactEmail,
      message: "Danke. Deine Anfrage ist angekommen. Wenn eine Antwort nötig ist, melden wir uns per E-Mail."
    });
    return true;
  }
  if (request.method === "POST" && pathname === "/api/auth/recover") {
    assertAuthAttemptAllowed(request, "recover");
    const body = await readJsonBody(request);
    const login = await betaAccessManager.redeemRecovery(
      body.token,
      deviceNameFromRequest(request, body.deviceName),
      { uiLocale: body.uiLocale }
    );
    clearAuthAttempts(request, "recover");
    sendJson(response, 200, {
      authenticated: true,
      pass: login.pass,
      session: login.session,
      appUrl: "/app"
    }, { "set-cookie": sessionCookie(login.token) });
    return true;
  }
  return false;
}

async function handlePassApi(request, response, context) {
  assertSameOriginMutation(request);
  const pathname = routePath(request);
  if (request.method === "GET" && pathname === "/api/beta/experience") {
    sendJson(response, 200, {
      enabled: true,
      ...(await betaAccessManager.betaExperience(context.passId, context.sessionId))
    });
    return true;
  }
  if (request.method === "POST" && pathname === "/api/beta/consent") {
    sendJson(response, 200, {
      consent: await betaAccessManager.acceptConsent(
        context.passId,
        context.sessionId,
        await readJsonBody(request)
      )
    });
    return true;
  }
  if (request.method === "POST" && pathname === "/api/beta/feedback") {
    sendJson(response, 201, {
      feedback: await betaAccessManager.createFeedback(
        context.passId,
        context.sessionId,
        await readJsonBody(request)
      )
    });
    return true;
  }
  if (request.method === "GET" && pathname === "/api/pass") {
    sendJson(response, 200, await betaAccessManager.passSummary(context.passId, context.sessionId));
    return true;
  }
  if (request.method === "GET" && pathname === "/api/pass/credit-notice") {
    sendJson(response, 200, await betaAccessManager.creditNotice(context.passId, context.sessionId));
    return true;
  }
  if (request.method === "POST" && pathname === "/api/pass/credit-notice") {
    const body = await readJsonBody(request);
    sendJson(response, 200, await betaAccessManager.acknowledgeCreditNotice(
      context.passId,
      context.sessionId,
      body.grantIds
    ));
    return true;
  }
  if (request.method === "POST" && pathname === "/api/pass/pairings") {
    const pairing = await betaAccessManager.createPairing(context.passId, context.sessionId);
    const pairUrl = localizedEntryUrl(request, context.session?.uiLocale, "pair", pairing.code);
    sendJson(response, 201, {
      pairing: {
        ...pairing,
        url: pairUrl,
        qrSvg: await createQrSvg(pairUrl, { margin: 1, errorCorrectionLevel: "M" })
      }
    });
    return true;
  }
  const deviceMatch = pathname.match(/^\/api\/pass\/devices\/(session_[A-Za-z0-9-]+)$/);
  if (request.method === "DELETE" && deviceMatch) {
    await betaAccessManager.revokeDevice(context.passId, deviceMatch[1]);
    const currentRevoked = deviceMatch[1] === context.sessionId;
    sendJson(response, 200, { revoked: true, currentRevoked }, currentRevoked ? { "set-cookie": clearSessionCookie() } : {});
    return true;
  }
  if (request.method === "POST" && pathname === "/api/pass/topup") {
    const body = await readJsonBody(request);
    sendJson(response, 200, await betaAccessManager.redeemTopup(context.passId, body.code));
    return true;
  }
  return false;
}

async function passCardPayload(request, created) {
  const locale = normalizeLocale(created.pass.invitationLocale);
  const url = localizedEntryUrl(request, locale, "pass", created.code);
  const card = await createBetaCard({
    kind: "pass",
    code: created.code,
    locale,
    qrContent: url
  });
  const { png, ...publicCard } = card;
  return { response: { ...created, url, ...publicCard }, png };
}

async function handleAdminApi(request, response) {
  assertSameOriginMutation(request);
  const pathname = routePath(request);
  if (request.method === "GET" && pathname === "/api/admin/overview") {
    sendJson(response, 200, {
      passes: await betaAccessManager.listPasses(),
      requests: await betaAccessManager.listRequests(),
      feedback: await betaAccessManager.listFeedback(),
      beta: {
        enabled: serverConfig.betaAccess.enabled,
        paidGenerationEnabled: serverConfig.betaAccess.paidGenerationEnabled,
        mailConfigured: serverConfig.betaAccess.mailConfigured,
        inboundMailEnabled: serverConfig.betaAccess.inboundMailEnabled,
        contactEmail: serverConfig.betaAccess.contactEmail,
        recoveryMinutes: serverConfig.betaAccess.recoveryMinutes
      }
    });
    return true;
  }
  if (request.method === "POST" && pathname === "/api/admin/passes") {
    const body = await readJsonBody(request);
    const created = await betaAccessManager.createPass(body);
    const cardPayload = await passCardPayload(request, created);
    const payload = cardPayload.response;
    const emailDelivery = created.pass.recoveryEmail
      ? await deliverEmail(() => emailService.sendBetaInvitation({
        email: created.pass.recoveryEmail,
        name: body.name,
        passCode: created.code,
        locale: created.pass.invitationLocale,
        appUrl: payload.url,
        cardContentId: "sheetify-beta-pass",
        attachments: [{
          filename: `sheetify-beta-pass-${created.pass.id}.png`,
          content: cardPayload.png,
          contentType: "image/png",
          contentId: "sheetify-beta-pass"
        }],
        idempotencyKey: `beta-invitation:${created.pass.id}:${created.pass.updatedAt}`
      }))
      : { status: "skipped" };
    sendJson(response, 201, { ...payload, emailDelivery });
    return true;
  }
  const passMatch = pathname.match(/^\/api\/admin\/passes\/(pass_[A-Za-z0-9-]+)$/);
  if (request.method === "PATCH" && passMatch) {
    sendJson(response, 200, { pass: await betaAccessManager.updatePass(passMatch[1], await readJsonBody(request)) });
    return true;
  }
  if (request.method === "DELETE" && passMatch) {
    sendJson(response, 200, { deletedPass: await betaAccessManager.deletePass(passMatch[1]) });
    return true;
  }
  const rotateMatch = pathname.match(/^\/api\/admin\/passes\/(pass_[A-Za-z0-9-]+)\/rotate$/);
  if (request.method === "POST" && rotateMatch) {
    const body = await readJsonBody(request);
    const rotated = await betaAccessManager.rotatePass(rotateMatch[1], body);
    const cardPayload = await passCardPayload(request, rotated);
    const payload = cardPayload.response;
    const emailDelivery = rotated.pass.recoveryEmail
      ? await deliverEmail(() => emailService.sendBetaInvitation({
        email: rotated.pass.recoveryEmail,
        passCode: rotated.code,
        locale: rotated.pass.invitationLocale,
        appUrl: payload.url,
        cardContentId: "sheetify-beta-pass",
        attachments: [{
          filename: `sheetify-beta-pass-${rotated.pass.id}.png`,
          content: cardPayload.png,
          contentType: "image/png",
          contentId: "sheetify-beta-pass"
        }],
        idempotencyKey: `beta-invitation:${rotated.pass.id}:${rotated.pass.updatedAt}`
      }))
      : { status: "skipped" };
    sendJson(response, 200, { ...payload, emailDelivery });
    return true;
  }
  const grantMatch = pathname.match(/^\/api\/admin\/passes\/(pass_[A-Za-z0-9-]+)\/grant$/);
  if (request.method === "POST" && grantMatch) {
    const body = await readJsonBody(request);
    const pass = await betaAccessManager.grant(grantMatch[1], body.amount, body);
    const emailDelivery = pass.recoveryEmail
      ? await deliverEmail(() => emailService.sendCreditGranted({
        email: pass.recoveryEmail,
        amount: Number(body.amount),
        balance: pass.balance,
        locale: pass.invitationLocale,
        idempotencyKey: `credit-grant:${pass.id}:${pass.updatedAt}`
      }))
      : { status: "skipped" };
    sendJson(response, 200, { pass, emailDelivery });
    return true;
  }
  if (request.method === "POST" && pathname === "/api/admin/topup-cards") {
    const body = await readJsonBody(request);
    const created = await betaAccessManager.createTopupCard(body.amount, body);
    const locale = normalizeLocale(body.locale);
    const url = localizedEntryUrl(request, locale, "topup", created.code);
    const card = await createBetaCard({ kind: "topup", code: created.code, credits: created.card.credits, locale, qrContent: url });
    const { png, ...publicCard } = card;
    const email = String(body.email || "").trim();
    const emailDelivery = email
      ? await deliverEmail(() => emailService.sendTopupCard({
        email,
        name: body.name,
        amount: created.card.credits,
        topupCode: created.code,
        locale,
        appUrl: url,
        cardContentId: "sheetify-topup-card",
        attachments: [{
          filename: `sheetify-guthaben-${created.card.credits}-${created.card.id}.png`,
          content: png,
          contentType: "image/png",
          contentId: "sheetify-topup-card"
        }],
        idempotencyKey: `topup-card:${created.card.id}`
      }))
      : { status: "skipped" };
    sendJson(response, 201, { ...created, url, ...publicCard, emailDelivery });
    return true;
  }
  const requestMatch = pathname.match(/^\/api\/admin\/requests\/(request_[A-Za-z0-9-]+)$/);
  if (request.method === "PATCH" && requestMatch) {
    sendJson(response, 200, {
      request: await betaAccessManager.updateRequest(requestMatch[1], await readJsonBody(request))
    });
    return true;
  }
  const feedbackMatch = pathname.match(/^\/api\/admin\/feedback\/(feedback_[A-Za-z0-9-]+)$/);
  if (request.method === "PATCH" && feedbackMatch) {
    sendJson(response, 200, {
      feedback: await betaAccessManager.updateFeedback(feedbackMatch[1], await readJsonBody(request))
    });
    return true;
  }
  const recoveryMatch = pathname.match(/^\/api\/admin\/requests\/(request_[A-Za-z0-9-]+)\/recovery-link$/);
  if (request.method === "POST" && recoveryMatch) {
    const recovery = await betaAccessManager.createRecoveryChallenge(recoveryMatch[1]);
    const locale = normalizeLocale(recovery.request.uiLocale, recovery.request.pass?.invitationLocale);
    const url = localizedEntryUrl(request, locale, "recover", recovery.token);
    const emailDelivery = await deliverEmail(() => emailService.sendRecoveryLink({
      email: recovery.request.email,
      name: recovery.request.name,
      recoveryUrl: url,
      expiresAt: recovery.expiresAt,
      locale,
      idempotencyKey: `recovery-link:${recovery.request.id}:${Date.parse(recovery.expiresAt)}`
    }));
    sendJson(response, 201, {
      request: recovery.request,
      expiresAt: recovery.expiresAt,
      url,
      emailDelivery
    });
    return true;
  }
  return false;
}

async function handleApi(request, response, context = {}) {
  const pathname = routePath(request);
  if (!serverConfig.betaAccess.enabled && request.method === "GET" && pathname === "/api/beta/experience") {
    sendJson(response, 200, { enabled: false });
    return;
  }
  if (serverConfig.betaAccess.enabled && !context.passId) {
    sendAuthRequired(response);
    return;
  }
  const requestRepoRoot = context.repoRoot || repoRoot;
  const requestPromptRoot = context.promptRoot || repoRoot;
  const projectsDir = context.projectsDir || defaultProjectsDir;
  const worksheetsDir = context.worksheetsDir || defaultWorksheetsDir;
  const usageAttribution = context.usageAttribution || null;

  if (context.passId && await handlePassApi(request, response, context)) {
    return;
  }

  if (context.passId && ["POST", "PATCH", "PUT", "DELETE"].includes(request.method)) {
    const experience = await betaAccessManager.betaExperience(context.passId, context.sessionId);
    if (!experience.consent.accepted) {
      sendJson(response, 403, {
        error: "beta_consent_required",
        message: "Bitte zuerst der Beta-Auswertung zustimmen."
      });
      return;
    }
  }

  if (request.method === "GET" && pathname === "/api/library/tree") {
    const url = new URL(request.url, "http://localhost");
    sendJson(response, 200, {
      tree: await buildLibraryTree({
        repoRoot: requestRepoRoot,
        projectsDir,
        query: url.searchParams.get("q") || ""
      })
    });
    return;
  }

  if (request.method === "GET" && pathname === "/api/worksheets/tree") {
    const url = new URL(request.url, "http://localhost");
    sendJson(response, 200, {
      tree: await buildWorksheetTree({
        repoRoot: requestRepoRoot,
        worksheetsDir,
        query: url.searchParams.get("q") || ""
      })
    });
    return;
  }

  if (request.method === "GET" && pathname === "/api/billing/status") {
    if (!serverConfig.exposeBillingStatus) {
      sendJson(response, 404, {
        error: "not_found",
        message: "No route for GET /api/billing/status"
      });
      return;
    }
    const url = new URL(request.url, "http://localhost");
    sendJson(response, 200, {
      billing: await buildBillingStatus({
        cwd: repoRoot,
        repoRoot: requestRepoRoot,
        projectsDir,
        projectId: url.searchParams.get("projectId") || ""
      })
    });
    return;
  }

  if (request.method === "POST" && pathname === "/api/library/folders") {
    const body = await readJsonBody(request);
    sendJson(response, 201, {
      folder: await createLibraryFolder(body, { projectsDir })
    });
    return;
  }

  if (request.method === "POST" && pathname === "/api/worksheets/folders") {
    const body = await readJsonBody(request);
    sendJson(response, 201, {
      folder: await createWorksheetFolder(body, { worksheetsDir })
    });
    return;
  }

  if (request.method === "POST" && pathname === "/api/library/move") {
    const body = await readJsonBody(request);
    sendJson(response, 200, {
      result: await moveLibraryItem(body, { projectsDir })
    });
    return;
  }

  if (request.method === "POST" && pathname === "/api/worksheets/move") {
    const body = await readJsonBody(request);
    sendJson(response, 200, {
      result: await moveWorksheetItem(body, { worksheetsDir })
    });
    return;
  }

  if (request.method === "POST" && pathname === "/api/worksheets/deposit-candidate") {
    const body = await readJsonBody(request);
    assertProjectId(body.projectId);
    assertStorageSegment(body.runId, "Lauf-ID");
    assertStorageSegment(body.candidateId, "Entwurf-ID");
    sendJson(response, 200, await depositCandidateAsWorksheet(body, {
      repoRoot: requestRepoRoot,
      projectsDir,
      worksheetsDir,
      ownerPassId: context.passId || null
    }));
    return;
  }

  const libraryFolderMatch = pathname.match(/^\/api\/library\/folders\/(.+)$/);
  if (request.method === "PATCH" && libraryFolderMatch) {
    const body = await readJsonBody(request);
    sendJson(response, 200, {
      folder: await updateLibraryFolder(libraryFolderMatch[1], body, { projectsDir })
    });
    return;
  }

  const worksheetFolderMatch = pathname.match(/^\/api\/worksheets\/folders\/(.+)$/);
  if (request.method === "PATCH" && worksheetFolderMatch) {
    const body = await readJsonBody(request);
    sendJson(response, 200, {
      folder: await updateWorksheetFolder(worksheetFolderMatch[1], body, { worksheetsDir })
    });
    return;
  }

  if (request.method === "DELETE" && libraryFolderMatch) {
    sendJson(response, 200, {
      result: await deleteLibraryFolder(libraryFolderMatch[1], { projectsDir })
    });
    return;
  }

  if (request.method === "DELETE" && worksheetFolderMatch) {
    sendJson(response, 200, {
      result: await deleteWorksheetFolder(worksheetFolderMatch[1], { worksheetsDir })
    });
    return;
  }

  const libraryItemMatch = pathname.match(/^\/api\/library\/items\/(.+)$/);
  if (request.method === "GET" && libraryItemMatch) {
    assertItemId(libraryItemMatch[1], "project");
    sendJson(response, 200, {
      item: await getLibraryItem(libraryItemMatch[1], { repoRoot: requestRepoRoot, projectsDir })
    });
    return;
  }

  const worksheetItemSeenMatch = pathname.match(/^\/api\/worksheets\/items\/(.+)\/seen$/);
  if (request.method === "POST" && worksheetItemSeenMatch) {
    assertItemId(worksheetItemSeenMatch[1], "worksheet");
    sendJson(response, 200, {
      worksheet: await markWorksheetItemSeen(worksheetItemSeenMatch[1], { repoRoot: requestRepoRoot, worksheetsDir })
    });
    return;
  }

  const worksheetItemMatch = pathname.match(/^\/api\/worksheets\/items\/(.+)$/);
  if (request.method === "GET" && worksheetItemMatch) {
    assertItemId(worksheetItemMatch[1], "worksheet");
    sendJson(response, 200, {
      item: await getWorksheetItem(worksheetItemMatch[1], { repoRoot: requestRepoRoot, worksheetsDir })
    });
    return;
  }

  if (request.method === "PATCH" && worksheetItemMatch) {
    assertItemId(worksheetItemMatch[1], "worksheet");
    const body = await readJsonBody(request);
    sendJson(response, 200, {
      worksheet: await renameWorksheet(worksheetItemMatch[1], body.title, { worksheetsDir })
    });
    return;
  }

  if (request.method === "DELETE" && worksheetItemMatch) {
    assertItemId(worksheetItemMatch[1], "worksheet");
    sendJson(response, 200, {
      result: await deleteWorksheet(worksheetItemMatch[1], { worksheetsDir })
    });
    return;
  }

  if (request.method === "GET" && pathname === "/api/projects") {
    sendJson(response, 200, {
      projects: await listProjects({ projectsDir })
    });
    return;
  }

  const projectPreviewMatch = pathname.match(/^\/api\/projects\/([^/]+)\/preview$/);
  if (request.method === "GET" && projectPreviewMatch) {
    assertProjectId(projectPreviewMatch[1]);
    const item = await getLibraryItem(`project:${projectPreviewMatch[1]}`, { repoRoot: requestRepoRoot, projectsDir });
    sendJson(response, 200, {
      preview: item.preview
    });
    return;
  }

  const projectWorkspaceMatch = pathname.match(/^\/api\/projects\/([^/]+)\/workspace-entry$/);
  if (request.method === "GET" && projectWorkspaceMatch) {
    assertProjectId(projectWorkspaceMatch[1]);
    const project = await openProject(projectWorkspaceMatch[1], { projectsDir });
    sendJson(response, 200, {
      entry: project.workspaceEntry
    });
    return;
  }

  const projectWorksheetsMatch = pathname.match(/^\/api\/projects\/([^/]+)\/worksheets$/);
  if (request.method === "GET" && projectWorksheetsMatch) {
    assertProjectId(projectWorksheetsMatch[1]);
    sendJson(response, 200, {
      worksheets: await listProjectWorksheets(projectWorksheetsMatch[1], { repoRoot: requestRepoRoot, worksheetsDir })
    });
    return;
  }

  const workspaceChatMatch = pathname.match(/^\/api\/workspace\/([^/]+)\/chat$/);
  if (request.method === "GET" && workspaceChatMatch) {
    assertProjectId(workspaceChatMatch[1]);
    sendJson(response, 200, await readChat(workspaceChatMatch[1], {
      repoRoot: requestRepoRoot,
      projectsDir,
      worksheetsDir
    }));
    return;
  }

  if (request.method === "POST" && workspaceChatMatch) {
    assertProjectId(workspaceChatMatch[1]);
    const body = await readJsonBody(request);
    sendJson(response, 200, await sendChatMessage(workspaceChatMatch[1], body, {
      repoRoot: requestRepoRoot,
      promptRoot: requestPromptRoot,
      projectsDir,
      worksheetsDir,
      trustedPlanningFlowOverride: serverConfig.planningFlow,
      usageAttribution,
      generationQuota: context.generationQuota
    }));
    return;
  }

  const workspaceInputUploadMatch = pathname.match(/^\/api\/workspace\/([^/]+)\/input-upload$/);
  if (request.method === "POST" && workspaceInputUploadMatch) {
    assertProjectId(workspaceInputUploadMatch[1]);
    const rawBody = await readRawBody(request);
    const form = parseMultipartForm(request, rawBody);
    const file = form.files.find((entry) => entry.fieldName === "file") || form.files[0] || null;
    if (!file) {
      throw requestError(400, "Bitte eine Datei auswaehlen.");
    }
    const upload = await addInputUpload(workspaceInputUploadMatch[1], file, {
      repoRoot: requestRepoRoot,
      projectsDir,
      appendChatReceipt: form.fields.deferChatReceipt !== "true",
      usageAttribution
    });
    sendJson(response, 201, {
      upload,
      workspace: await buildWorkspace(workspaceInputUploadMatch[1], { repoRoot: requestRepoRoot, projectsDir, worksheetsDir })
    });
    return;
  }

  const workspaceVoiceTranscriptionMatch = pathname.match(/^\/api\/workspace\/([^/]+)\/voice-transcription$/);
  if (request.method === "POST" && workspaceVoiceTranscriptionMatch) {
    assertProjectId(workspaceVoiceTranscriptionMatch[1]);
    const rawBody = await readRawBody(request);
    const form = parseMultipartForm(request, rawBody);
    const audio = form.files.find((entry) => entry.fieldName === "audio")
      || form.files.find((entry) => entry.fieldName === "file")
      || form.files[0]
      || null;
    if (!audio) {
      throw requestError(400, "Bitte eine Audioaufnahme senden.");
    }
    const transcription = await transcribeProjectAudio(workspaceVoiceTranscriptionMatch[1], {
      ...audio,
      durationMs: form.fields.durationMs
    }, {
      repoRoot: requestRepoRoot,
      projectsDir,
      usageAttribution
    });
    sendJson(response, 201, {
      voice: transcription.voice,
      workspace: await buildWorkspace(workspaceVoiceTranscriptionMatch[1], { repoRoot: requestRepoRoot, projectsDir, worksheetsDir })
    });
    return;
  }

  const workspaceCommandsMatch = pathname.match(/^\/api\/workspace\/([^/]+)\/commands$/);
  if (request.method === "POST" && workspaceCommandsMatch) {
    assertProjectId(workspaceCommandsMatch[1]);
    const body = await readJsonBody(request);
    sendJson(response, 200, await runWorkspaceCommand(workspaceCommandsMatch[1], body, {
      repoRoot: requestRepoRoot,
      promptRoot: requestPromptRoot,
      projectsDir,
      worksheetsDir,
      trustedPlanningFlowOverride: serverConfig.planningFlow,
      traceCommand: true,
      usageAttribution,
      generationQuota: context.generationQuota
    }));
    return;
  }

  const workspaceCandidateSeenMatch = pathname.match(/^\/api\/workspace\/([^/]+)\/candidate-generation\/seen$/);
  if (request.method === "POST" && workspaceCandidateSeenMatch) {
    assertProjectId(workspaceCandidateSeenMatch[1]);
    const projectDir = path.join(projectsDir, workspaceCandidateSeenMatch[1]);
    sendJson(response, 200, {
      candidateGeneration: await markCandidateGenerationSeen(projectDir)
    });
    return;
  }

  const workspaceMatch = pathname.match(/^\/api\/workspace\/([^/]+)$/);
  if (request.method === "GET" && workspaceMatch) {
    assertProjectId(workspaceMatch[1]);
    sendJson(response, 200, {
      workspace: await buildWorkspace(workspaceMatch[1], { repoRoot: requestRepoRoot, projectsDir, worksheetsDir })
    });
    return;
  }

  const projectMatch = pathname.match(/^\/api\/projects\/([^/]+)$/);
  if (request.method === "GET" && projectMatch) {
    assertProjectId(projectMatch[1]);
    sendJson(response, 200, {
      project: await openProject(projectMatch[1], { projectsDir })
    });
    return;
  }

  if (request.method === "PATCH" && projectMatch) {
    assertProjectId(projectMatch[1]);
    const body = await readJsonBody(request);
    sendJson(response, 200, {
      project: await renameProject(projectMatch[1], body.title, { projectsDir })
    });
    return;
  }

  if (request.method === "DELETE" && projectMatch) {
    assertProjectId(projectMatch[1]);
    await openProject(projectMatch[1], { projectsDir });
    const deletedWorksheets = await deleteProjectWorksheets(projectMatch[1], { worksheetsDir });
    await deleteProject(projectMatch[1], { projectsDir });
    await removeProjectFromLibrary(projectMatch[1], { projectsDir });
    sendJson(response, 200, {
      deleted: true,
      projectId: projectMatch[1],
      deletedWorksheets
    });
    return;
  }

  if (request.method === "POST" && pathname === "/api/projects/single") {
    const body = await readJsonBody(request);
    sendJson(response, 201, {
      project: await createSingleWorksheetProject(body, { projectsDir, ownerPassId: context.passId || null })
    });
    return;
  }

  sendJson(response, 404, {
    error: "not_found",
    message: `No route for ${request.method} ${pathname}`
  });
}

function httpsServerOptions() {
  if (!httpsEnabled) {
    return null;
  }
  return {
    key: fs.readFileSync(httpsKeyPath),
    cert: fs.readFileSync(httpsCertPath)
  };
}

async function handleRequest(request, response) {
  try {
    const pathname = routePath(request);
    const rawPath = rawPathname(request);

    if (request.method === "GET" && await handleHealth(pathname, response)) {
      return;
    }

    if (await handleInboundMailWebhook(request, response)) {
      return;
    }

    if (!serverConfig.betaAccess.enabled) {
      if (!await ownerAuthGate.authorize(request, response)) {
        return;
      }

      if (request.method === "GET" && rawPath.startsWith("/files/")) {
        await serveProjectFile(request, response);
        return;
      }

      if (request.method === "GET" && pathname.startsWith("/api/files/")) {
        await serveOpaqueFile(request, response);
        return;
      }

      if (pathname.startsWith("/api/")) {
        await handleApi(request, response);
        return;
      }

      if (request.method !== "GET") {
        sendJson(response, 404, {
          error: "not_found",
          message: `No route for ${request.method} ${pathname}`
        });
        return;
      }

      await servePublicFile(request, response);
      return;
    }

    if (pathname.startsWith("/api/auth/")) {
      if (await handleAuthApi(request, response)) {
        return;
      }
      sendJson(response, 404, { error: "not_found", message: "Auth-Route wurde nicht gefunden." });
      return;
    }

    if (pathname === "/admin" || pathname === "/admin/" || pathname.startsWith("/api/admin/")) {
      if (!privateAdminAllowed(request)) {
        sendJson(response, 404, { error: "not_found", message: "Route wurde nicht gefunden." });
        return;
      }
      if (!await ownerAuthGate.authorize(request, response)) {
        return;
      }
      if (pathname.startsWith("/api/admin/")) {
        if (!await handleAdminApi(request, response)) {
          sendJson(response, 404, { error: "not_found", message: "Admin-Route wurde nicht gefunden." });
        }
        return;
      }
      await serveFileFromRoot({ rootDir: publicDir, relativePath: "admin.html", response });
      return;
    }

    if (request.method === "GET" && (pathname === "/" || pathname === "/index.html")) {
      await serveFileFromRoot({ rootDir: publicDir, relativePath: "pass.html", response });
      return;
    }

    const context = await betaRequestContext(request);

    if (request.method === "GET" && (pathname === "/app" || pathname === "/app/")) {
      if (!context) {
        sendRedirect(response, "/");
        return;
      }
      await serveFileFromRoot({ rootDir: publicDir, relativePath: "index.html", response });
      return;
    }

    if (request.method === "GET" && rawPath.startsWith("/files/")) {
      if (!context) {
        sendAuthRequired(response);
        return;
      }
      await serveProjectFile(request, response, context);
      return;
    }

    if (request.method === "GET" && pathname.startsWith("/api/files/")) {
      if (!context) {
        sendAuthRequired(response);
        return;
      }
      await serveOpaqueFile(request, response, context);
      return;
    }

    if (pathname.startsWith("/api/")) {
      if (!context) {
        sendAuthRequired(response);
        return;
      }
      await handleApi(request, response, context);
      return;
    }

    if (request.method !== "GET") {
      sendJson(response, 404, {
        error: "not_found",
        message: `No route for ${request.method} ${pathname}`
      });
      return;
    }

    await servePublicFile(request, response);
  } catch (error) {
    if (error.code === "ENOENT") {
      sendJson(response, 404, {
        error: "not_found",
        message: "Requested project or file does not exist."
      });
      return;
    }

    if (error.statusCode >= 400 && error.statusCode < 600) {
      sendJson(response, error.statusCode, {
        error: publicBetaErrorCode(request, error) || (error.statusCode === 413
          ? "payload_too_large"
          : error.statusCode === 429
            ? "rate_limited"
            : error.statusCode === 503
              ? "temporarily_unavailable"
              : "bad_request"),
        message: error.message
      });
      return;
    }

    if (serverConfig.production) {
      console.error(`[SheetifyIMG] request failed: ${String(error?.name || "Error")}`);
    }
    sendJson(response, 500, {
      error: "internal_error",
      message: serverConfig.production
        ? "Die Anfrage konnte intern nicht verarbeitet werden."
        : error.message
    });
  }
}

function createHttpServer() {
  return httpsEnabled
    ? https.createServer(httpsServerOptions(), handleRequest)
    : http.createServer(handleRequest);
}

function listen(server) {
  return new Promise((resolve, reject) => {
    const onError = (error) => {
      server.off("listening", onListening);
      reject(error);
    };
    const onListening = () => {
      server.off("error", onError);
      resolve();
    };
    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(defaultPort, defaultHost);
  });
}

function closeServer(server) {
  return new Promise((resolve) => {
    server.close((error) => resolve(error || null));
  });
}

function installSignalHandlers(server, options = {}) {
  let stopping = false;
  const exitProcess = options.exitProcess !== false;
  const signals = ["SIGINT", "SIGTERM"];

  const shutdown = async (signal) => {
    if (stopping) {
      return;
    }
    stopping = true;
    beginCandidateGenerationShutdown();
    console.log(`[SheetifyIMG] ${signal} received; stopping HTTP intake and waiting for active Entwurf jobs.`);

    let timeoutId;
    const timeout = new Promise((resolve) => {
      timeoutId = setTimeout(() => resolve({ timedOut: true }), serverConfig.shutdownTimeoutMs);
    });
    const finished = Promise.all([
      closeServer(server),
      waitForActiveCandidateGenerationJobs({ timeoutMs: serverConfig.shutdownTimeoutMs })
    ]).then(([closeError, jobs]) => ({ closeError, jobs, timedOut: false }));
    const result = await Promise.race([finished, timeout]);
    clearTimeout(timeoutId);

    if (result.timedOut) {
      server.closeAllConnections?.();
      console.error("[SheetifyIMG] graceful shutdown timed out; interrupted jobs will be reconciled after restart.");
      if (exitProcess) {
        process.exit(1);
      }
      return;
    }

    if (result.closeError) {
      console.error("[SheetifyIMG] HTTP server reported an error while closing.");
      process.exitCode = 1;
    }
    if (result.jobs?.timedOut) {
      console.error("[SheetifyIMG] Entwurf jobs exceeded the shutdown timeout.");
      process.exitCode = 1;
    }
    for (const registeredSignal of signals) {
      process.off(registeredSignal, handlers[registeredSignal]);
    }
    console.log("[SheetifyIMG] shutdown complete.");
  };

  const handlers = Object.fromEntries(signals.map((signal) => [
    signal,
    () => {
      shutdown(signal).catch((error) => {
        console.error(`[SheetifyIMG] shutdown failed: ${String(error?.message || error)}`);
        if (exitProcess) {
          process.exit(1);
        }
      });
    }
  ]));
  for (const signal of signals) {
    process.on(signal, handlers[signal]);
  }
  return shutdown;
}

async function startServer(options = {}) {
  await prepareRuntime(serverConfig);
  if (serverConfig.betaAccess.enabled) {
    await betaAccessManager.recoverReservations();
  }
  if (!(await writeRuntimeProbe(serverConfig))) {
    throw new Error("SheetifyIMG runtime is not writable.");
  }

  const server = createHttpServer();
  await listen(server);
  console.log(`SheetifyIMG ${httpsEnabled ? "HTTPS" : "HTTP"} server listening on ${defaultHost}:${defaultPort}`);
  console.log(`[SheetifyIMG] runtime ${JSON.stringify(safeServerConfig(serverConfig))}`);
  for (const entry of serverUrls(defaultHost, defaultPort)) {
    console.log(`  ${entry.label}: ${entry.url}`);
  }
  const shutdown = options.handleSignals === false
    ? null
    : installSignalHandlers(server, options);
  return {
    server,
    config: serverConfig,
    shutdown
  };
}

if (require.main === module) {
  startServer().catch((error) => {
    console.error(`[SheetifyIMG] start failed: ${String(error?.message || error)}`);
    process.exitCode = 1;
  });
}

module.exports = {
  startServer
};
