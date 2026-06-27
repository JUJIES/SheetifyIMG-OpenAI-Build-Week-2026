"use strict";

const fs = require("node:fs");
const fsp = require("node:fs/promises");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const { readChat, sendChatMessage } = require("../core/aiChatManager");
const { addInputUpload } = require("../core/inputManager");
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
const { loadLocalEnv } = require("../core/localEnv");
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
const { markCandidateGenerationSeen } = require("../core/candidateGenerationJobManager");

const repoRoot = path.resolve(__dirname, "..");
const AI_ENV_KEYS = [
  "OPENAI_API_KEY",
  "OPENAI_ADMIN_KEY",
  "OPENAI_BASE_URL",
  "SHEETIFYIMG_OPENAI_ADMIN_KEY",
  "SHEETIFYIMG_OPENAI_MONTHLY_BUDGET_USD",
  "SHEETIFYIMG_AI_MODE",
  "SHEETIFYIMG_SEMANTIC_INTERPRETER",
  "SHEETIFYIMG_TEXT_MODEL",
  "SHEETIFYIMG_REASONING_MODEL",
  "SHEETIFYIMG_REASONING_EFFORT",
  "SHEETIFYIMG_OPENAI_TIMEOUT_MS",
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
loadLocalEnv(repoRoot, { overrideKeys: AI_ENV_KEYS });
if (!process.env.SHEETIFYIMG_SEMANTIC_INTERPRETER) {
  process.env.SHEETIFYIMG_SEMANTIC_INTERPRETER = "on";
}

const projectsDir = process.env.PROJECTS_DIR
  ? path.resolve(process.env.PROJECTS_DIR)
  : path.join(repoRoot, "projects");
const worksheetsDir = process.env.WORKSHEETS_DIR
  ? path.resolve(process.env.WORKSHEETS_DIR)
  : path.join(repoRoot, "worksheets");
const publicDir = path.join(repoRoot, "public");
const defaultPort = Number(process.env.PORT || 4173);
const defaultHost = process.env.SHEETIFYIMG_BIND_HOST || process.env.HOST || "127.0.0.1";

function normalizeBaseUrl(value) {
  return String(value || "").trim().replace(/\/+$/, "");
}

function hostToHttpUrl(host, port) {
  const trimmed = String(host || "").trim();
  if (!trimmed) {
    return null;
  }
  if (/^https?:\/\//i.test(trimmed)) {
    return normalizeBaseUrl(trimmed);
  }
  if (trimmed.startsWith("[")) {
    return `http://${trimmed}${trimmed.includes("]:") ? "" : `:${port}`}`;
  }
  if (trimmed.includes(":") && !trimmed.includes("]") && !/^\d+\.\d+\.\d+\.\d+(?::\d+)?$/.test(trimmed)) {
    return `http://[${trimmed}]:${port}`;
  }
  if (/[^\]]:\d+$/.test(trimmed)) {
    return `http://${trimmed}`;
  }
  return `http://${trimmed}:${port}`;
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

function shareUrlFromBase(baseUrl, currentUrl, projectId) {
  const base = parseHttpUrl(baseUrl);
  if (!base) {
    return null;
  }

  const current = parseHttpUrl(currentUrl);
  base.pathname = current?.pathname || "/";
  base.search = current?.search || "";
  base.hash = "";

  const cleanProjectId = String(projectId || "").trim();
  if (cleanProjectId) {
    base.searchParams.set("project", cleanProjectId);
  }
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
  const projectId = String(options.projectId || "").trim();
  const hostHeader = request.headers.host ? `http://${request.headers.host}` : null;
  const current = parseHttpUrl(currentUrl);
  const sourceUrl = current?.toString() || hostHeader || hostToHttpUrl(defaultHost, defaultPort);
  const sourceBase = current ? `${current.protocol}//${current.host}` : hostHeader;
  const entries = [];

  const addEntry = (label, baseUrl, kind) => {
    const url = shareUrlFromBase(baseUrl, sourceUrl, projectId);
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
  const preferredNetworkIndex = entries.findIndex((entry) => !entry.localOnly);
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

function serverUrls(host, port) {
  const urls = [];
  const addUrl = (label, url) => {
    if (!url || urls.some((entry) => entry.url === url)) {
      return;
    }
    urls.push({ label, url });
  };

  addUrl("Homebildschirm", normalizeBaseUrl(process.env.SHEETIFYIMG_PUBLIC_URL));
  addUrl("Homebildschirm", hostToHttpUrl(process.env.SHEETIFYIMG_PUBLIC_HOST, port));

  if (isWildcardHost(host)) {
    addUrl("Lokal", hostToHttpUrl("127.0.0.1", port));
    for (const address of localNetworkAddresses()) {
      addUrl("Netzwerk", hostToHttpUrl(address, port));
    }
    addUrl("Mac-Name", hostToHttpUrl(os.hostname(), port));
    return urls;
  }

  addUrl(host === "127.0.0.1" || host === "localhost" ? "Lokal" : "Netzwerk", hostToHttpUrl(host, port));
  return urls;
}

function sendJson(response, statusCode, value) {
  response.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store"
  });
  response.end(`${JSON.stringify(value, null, 2)}\n`);
}

function requestError(statusCode, message) {
  return Object.assign(new Error(message), { statusCode });
}

async function readJsonBody(request) {
  const chunks = [];
  for await (const chunk of request) {
    chunks.push(chunk);
  }
  if (chunks.length === 0) {
    return {};
  }
  const text = Buffer.concat(chunks).toString("utf8").trim();
  return text ? JSON.parse(text) : {};
}

async function readRawBody(request, options = {}) {
  const maxBytes = options.maxBytes || 25 * 1024 * 1024;
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > maxBytes) {
      throw requestError(413, "Die Datei ist zu gross. Bitte maximal 25 MB hochladen.");
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
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
  const contentType = request.headers["content-type"] || "";
  const boundary = multipartBoundary(contentType);
  if (!boundary) {
    throw requestError(400, "Upload konnte nicht gelesen werden.");
  }

  const delimiter = Buffer.from(`--${boundary}`, "utf8");
  const headerSeparator = Buffer.from("\r\n\r\n", "latin1");
  let offset = 0;

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
    const fileName = dispositionParams.filename || "";
    if (dispositionParams.name !== "file" || !fileName) {
      offset = nextDelimiterStart;
      continue;
    }

    return {
      fileName,
      mimeType: headers["content-type"] || "application/octet-stream",
      buffer: part.subarray(headerEnd + headerSeparator.length)
    };
  }

  throw requestError(400, "Bitte eine Datei auswaehlen.");
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
    "content-type": contentTypeFor(realFilePath),
    "content-length": stat.size,
    "cache-control": "no-store"
  });
  fs.createReadStream(realFilePath).pipe(response);
}

async function serveProjectFile(request, response) {
  const relativePath = decodeURIComponent(rawPathname(request).replace(/^\/files\/?/, ""));
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
      worksheetsDir
    }));
    return;
  }

  const workspaceInputUploadMatch = pathname.match(/^\/api\/workspace\/([^/]+)\/input-upload$/);
  if (request.method === "POST" && workspaceInputUploadMatch) {
    const rawBody = await readRawBody(request);
    const file = parseMultipartFile(request, rawBody);
    const upload = await addInputUpload(workspaceInputUploadMatch[1], file, {
      repoRoot,
      projectsDir
    });
    sendJson(response, 201, {
      upload,
      workspace: await buildWorkspace(workspaceInputUploadMatch[1], { repoRoot, projectsDir, worksheetsDir })
    });
    return;
  }

  const workspaceCommandsMatch = pathname.match(/^\/api\/workspace\/([^/]+)\/commands$/);
  if (request.method === "POST" && workspaceCommandsMatch) {
    const body = await readJsonBody(request);
    sendJson(response, 200, await runWorkspaceCommand(workspaceCommandsMatch[1], body, {
      repoRoot,
      projectsDir,
      worksheetsDir
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

const server = http.createServer(async (request, response) => {
  try {
    const pathname = routePath(request);
    const rawPath = rawPathname(request);

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

    sendJson(response, 500, {
      error: "internal_error",
      message: error.message
    });
  }
});

server.listen(defaultPort, defaultHost, () => {
  console.log(`SheetifyIMG server listening on ${defaultHost}:${defaultPort}`);
  for (const entry of serverUrls(defaultHost, defaultPort)) {
    console.log(`  ${entry.label}: ${entry.url}`);
  }
});
