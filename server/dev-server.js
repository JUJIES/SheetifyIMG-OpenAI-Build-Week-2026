"use strict";

const fs = require("node:fs");
const fsp = require("node:fs/promises");
const http = require("node:http");
const https = require("node:https");
const os = require("node:os");
const path = require("node:path");
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
const {
  projectsDir,
  worksheetsDir,
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

function parseHttpUrl(value) {
  try {
    const url = new URL(String(value || ""));
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return null;
    }
    url.hash = "";
    return url;
  } catch {
    return null;
  }
}

function isLocalShareUrl(value) {
  const url = parseHttpUrl(value);
  const hostname = String(url?.hostname || "").toLowerCase();
  return hostname === "localhost"
    || hostname === "127.0.0.1"
    || hostname === "::1"
    || hostname.endsWith(".localhost");
}

function shareUrlFromBase(baseUrl, currentUrl) {
  const base = parseHttpUrl(baseUrl);
  if (!base) {
    return null;
  }

  const current = parseHttpUrl(currentUrl);
  base.pathname = current?.pathname || "/";
  base.search = "";
  base.hash = "";
  base.searchParams.set("view", "projects");
  return base.toString();
}

function shareTargetDetail(label, url) {
  if (label === "Netzwerk") {
    return "Handy / anderes Gerät";
  }
  if (label === "Homebildschirm") {
    return "Fester Link";
  }
  if (label === "Mac-Name") {
    return "Gerätename";
  }
  if (isLocalShareUrl(url)) {
    return "Dieses Gerät";
  }
  return "Aktuelle Adresse";
}

async function buildShareTargets(request, options = {}) {
  const currentUrl = String(options.currentUrl || "").trim();
  const hostHeader = request.headers.host ? `http://${request.headers.host}` : null;
  const current = parseHttpUrl(currentUrl);
  const sourceUrl = current?.toString() || hostHeader || hostToHttpUrl(defaultHost, defaultPort);
  const sourceBase = current ? `${current.protocol}//${current.host}` : hostHeader;
  const entries = [];

  const addEntry = (label, baseUrl, kind) => {
    const url = shareUrlFromBase(baseUrl, sourceUrl);
    if (!url || entries.some((entry) => entry.url === url)) {
      return;
    }
    entries.push({
      kind,
      label,
      url,
      detail: shareTargetDetail(label, url),
      localOnly: isLocalShareUrl(url)
    });
  };

  addEntry("Aktuell", sourceBase || sourceUrl, "current");
  for (const entry of serverUrls(defaultHost, defaultPort)) {
    addEntry(entry.label, entry.url, entry.label === "Netzwerk" || entry.label === "Homebildschirm" ? "network" : "local");
  }

  if (!entries.length) {
    addEntry("Aktuell", hostToHttpUrl(defaultHost, defaultPort), "current");
  }

  const currentIndex = entries.findIndex((entry) => entry.kind === "current");
  const sameServerNetworkIndex = entries.findIndex((entry) => entry.label === "Netzwerk" && !entry.localOnly);
  const preferredNetworkIndex = sameServerNetworkIndex >= 0
    ? sameServerNetworkIndex
    : entries.findIndex((entry) => !entry.localOnly);
  const preferredIndex = currentIndex >= 0 && !entries[currentIndex].localOnly
    ? currentIndex
    : preferredNetworkIndex >= 0 ? preferredNetworkIndex : Math.max(0, currentIndex);

  const targets = await Promise.all(entries.map(async (entry, index) => ({
    id: `share_target_${index + 1}`,
    ...entry,
    qrSvg: await createQrSvg(entry.url, {
      margin: 1,
      errorCorrectionLevel: "M",
      dark: "#101827",
      light: "#ffffff"
    })
  })));
  const primary = targets[preferredIndex] || targets[0];
  const localOnly = targets.every((target) => target.localOnly);

  return {
    primaryTargetId: primary?.id || null,
    status: localOnly ? "local_only" : "network_ready",
    statusLabel: localOnly ? "Nur lokal" : "Teilbar",
    message: localOnly
      ? "Nur auf diesem Gerät erreichbar. Für Handy im Netzwerkmodus starten."
      : "Im gleichen Netzwerk erreichbar.",
    targets
  };
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

const fileServingRoots = [
  projectsDir,
  worksheetsDir
].map((rootDir) => path.resolve(rootDir));

function fileServingRootFor(filePath) {
  return fileServingRoots.find((rootDir) => isInsideRoot(rootDir, filePath)) || null;
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

async function serveProjectFile(request, response) {
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
  const filePath = path.resolve(repoRoot, relativePath);
  const rootDir = fileServingRootFor(filePath);
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

async function handleApi(request, response) {
  const pathname = routePath(request);

  if (request.method === "GET" && pathname === "/api/share/targets") {
    const url = new URL(request.url, "http://localhost");
    sendJson(response, 200, {
      share: await buildShareTargets(request, {
        currentUrl: url.searchParams.get("currentUrl") || "",
        projectId: url.searchParams.get("projectId") || ""
      })
    });
    return;
  }

  if (request.method === "GET" && pathname === "/api/library/tree") {
    const url = new URL(request.url, "http://localhost");
    sendJson(response, 200, {
      tree: await buildLibraryTree({
        repoRoot,
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
        repoRoot,
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
        repoRoot,
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
    sendJson(response, 200, await depositCandidateAsWorksheet(body, {
      repoRoot,
      projectsDir,
      worksheetsDir
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
    sendJson(response, 200, {
      item: await getLibraryItem(libraryItemMatch[1], { repoRoot, projectsDir })
    });
    return;
  }

  const worksheetItemSeenMatch = pathname.match(/^\/api\/worksheets\/items\/(.+)\/seen$/);
  if (request.method === "POST" && worksheetItemSeenMatch) {
    sendJson(response, 200, {
      worksheet: await markWorksheetItemSeen(worksheetItemSeenMatch[1], { repoRoot, worksheetsDir })
    });
    return;
  }

  const worksheetItemMatch = pathname.match(/^\/api\/worksheets\/items\/(.+)$/);
  if (request.method === "GET" && worksheetItemMatch) {
    sendJson(response, 200, {
      item: await getWorksheetItem(worksheetItemMatch[1], { repoRoot, worksheetsDir })
    });
    return;
  }

  if (request.method === "PATCH" && worksheetItemMatch) {
    const body = await readJsonBody(request);
    sendJson(response, 200, {
      worksheet: await renameWorksheet(worksheetItemMatch[1], body.title, { worksheetsDir })
    });
    return;
  }

  if (request.method === "DELETE" && worksheetItemMatch) {
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
    const item = await getLibraryItem(`project:${projectPreviewMatch[1]}`, { repoRoot, projectsDir });
    sendJson(response, 200, {
      preview: item.preview
    });
    return;
  }

  const projectWorkspaceMatch = pathname.match(/^\/api\/projects\/([^/]+)\/workspace-entry$/);
  if (request.method === "GET" && projectWorkspaceMatch) {
    const project = await openProject(projectWorkspaceMatch[1], { projectsDir });
    sendJson(response, 200, {
      entry: project.workspaceEntry
    });
    return;
  }

  const projectWorksheetsMatch = pathname.match(/^\/api\/projects\/([^/]+)\/worksheets$/);
  if (request.method === "GET" && projectWorksheetsMatch) {
    sendJson(response, 200, {
      worksheets: await listProjectWorksheets(projectWorksheetsMatch[1], { repoRoot, worksheetsDir })
    });
    return;
  }

  const workspaceChatMatch = pathname.match(/^\/api\/workspace\/([^/]+)\/chat$/);
  if (request.method === "GET" && workspaceChatMatch) {
    sendJson(response, 200, await readChat(workspaceChatMatch[1], {
      repoRoot,
      projectsDir,
      worksheetsDir
    }));
    return;
  }

  if (request.method === "POST" && workspaceChatMatch) {
    const body = await readJsonBody(request);
    sendJson(response, 200, await sendChatMessage(workspaceChatMatch[1], body, {
      repoRoot,
      projectsDir,
      worksheetsDir,
      trustedPlanningFlowOverride: serverConfig.planningFlow
    }));
    return;
  }

  const workspaceInputUploadMatch = pathname.match(/^\/api\/workspace\/([^/]+)\/input-upload$/);
  if (request.method === "POST" && workspaceInputUploadMatch) {
    const rawBody = await readRawBody(request);
    const form = parseMultipartForm(request, rawBody);
    const file = form.files.find((entry) => entry.fieldName === "file") || form.files[0] || null;
    if (!file) {
      throw requestError(400, "Bitte eine Datei auswaehlen.");
    }
    const upload = await addInputUpload(workspaceInputUploadMatch[1], file, {
      repoRoot,
      projectsDir,
      appendChatReceipt: form.fields.deferChatReceipt !== "true"
    });
    sendJson(response, 201, {
      upload,
      workspace: await buildWorkspace(workspaceInputUploadMatch[1], { repoRoot, projectsDir, worksheetsDir })
    });
    return;
  }

  const workspaceVoiceTranscriptionMatch = pathname.match(/^\/api\/workspace\/([^/]+)\/voice-transcription$/);
  if (request.method === "POST" && workspaceVoiceTranscriptionMatch) {
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
      repoRoot,
      projectsDir
    });
    sendJson(response, 201, {
      voice: transcription.voice,
      workspace: await buildWorkspace(workspaceVoiceTranscriptionMatch[1], { repoRoot, projectsDir, worksheetsDir })
    });
    return;
  }

  const workspaceCommandsMatch = pathname.match(/^\/api\/workspace\/([^/]+)\/commands$/);
  if (request.method === "POST" && workspaceCommandsMatch) {
    const body = await readJsonBody(request);
    sendJson(response, 200, await runWorkspaceCommand(workspaceCommandsMatch[1], body, {
      repoRoot,
      projectsDir,
      worksheetsDir,
      trustedPlanningFlowOverride: serverConfig.planningFlow,
      traceCommand: true
    }));
    return;
  }

  const workspaceCandidateSeenMatch = pathname.match(/^\/api\/workspace\/([^/]+)\/candidate-generation\/seen$/);
  if (request.method === "POST" && workspaceCandidateSeenMatch) {
    const projectDir = path.join(projectsDir, workspaceCandidateSeenMatch[1]);
    sendJson(response, 200, {
      candidateGeneration: await markCandidateGenerationSeen(projectDir)
    });
    return;
  }

  const workspaceMatch = pathname.match(/^\/api\/workspace\/([^/]+)$/);
  if (request.method === "GET" && workspaceMatch) {
    sendJson(response, 200, {
      workspace: await buildWorkspace(workspaceMatch[1], { repoRoot, projectsDir, worksheetsDir })
    });
    return;
  }

  const projectMatch = pathname.match(/^\/api\/projects\/([^/]+)$/);
  if (request.method === "GET" && projectMatch) {
    sendJson(response, 200, {
      project: await openProject(projectMatch[1], { projectsDir })
    });
    return;
  }

  if (request.method === "PATCH" && projectMatch) {
    const body = await readJsonBody(request);
    sendJson(response, 200, {
      project: await renameProject(projectMatch[1], body.title, { projectsDir })
    });
    return;
  }

  if (request.method === "DELETE" && projectMatch) {
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
      project: await createSingleWorksheetProject(body, { projectsDir })
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

    if (request.method === "GET" && rawPath.startsWith("/files/")) {
      await serveProjectFile(request, response);
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
  } catch (error) {
    if (error.code === "ENOENT") {
      sendJson(response, 404, {
        error: "not_found",
        message: "Requested project or file does not exist."
      });
      return;
    }

    if (error.statusCode >= 400 && error.statusCode < 500) {
      sendJson(response, error.statusCode, {
        error: error.statusCode === 413 ? "payload_too_large" : "bad_request",
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
