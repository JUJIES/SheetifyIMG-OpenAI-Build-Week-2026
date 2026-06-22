"use strict";

const fs = require("node:fs");
const fsp = require("node:fs/promises");
const http = require("node:http");
const path = require("node:path");
const { readChat, sendChatMessage } = require("../core/aiChatManager");
const { addInputUpload } = require("../core/inputManager");
const {
  buildLibraryTree,
  createLibraryFolder,
  deleteLibraryFolder,
  getLibraryItem,
  moveLibraryItem,
  removeProjectFromLibrary,
  renameLibraryFolder
} = require("../core/libraryManager");
const { loadLocalEnv } = require("../core/localEnv");
const {
  createSeriesProject,
  createSingleWorksheetProject,
  deleteProject,
  listProjects,
  openProject,
  renameProject
} = require("../core/projectManager");
const { runWorkspaceCommand } = require("../core/workspaceCommandManager");
const { buildCopyContext, buildWorkspace } = require("../core/workspaceManager");

const repoRoot = path.resolve(__dirname, "..");
const AI_ENV_KEYS = [
  "OPENAI_API_KEY",
  "OPENAI_BASE_URL",
  "SHEETIFYIMG_AI_MODE",
  "SHEETIFYIMG_SEMANTIC_INTERPRETER",
  "SHEETIFYIMG_TEXT_MODEL",
  "SHEETIFYIMG_REASONING_MODEL",
  "SHEETIFYIMG_REASONING_EFFORT",
  "SHEETIFYIMG_OPENAI_TIMEOUT_MS",
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
const publicDir = path.join(repoRoot, "public");
const defaultPort = Number(process.env.PORT || 4173);
const defaultHost = process.env.HOST || "127.0.0.1";

function sendJson(response, statusCode, value) {
  response.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store"
  });
  response.end(`${JSON.stringify(value, null, 2)}\n`);
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
      throw new Error("Die Datei ist zu gross. Bitte maximal 25 MB hochladen.");
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

function parseMultipartFile(request, body) {
  const contentType = request.headers["content-type"] || "";
  const boundary = String(contentType).match(/boundary=(?:"([^"]+)"|([^;]+))/)?.[1]
    || String(contentType).match(/boundary=(?:"([^"]+)"|([^;]+))/)?.[2];
  if (!boundary) {
    throw new Error("Upload konnte nicht gelesen werden.");
  }

  const parts = body.toString("latin1").split(`--${boundary}`);
  for (const part of parts) {
    if (!part.includes("Content-Disposition")) {
      continue;
    }
    const [rawHeaders, ...bodyParts] = part.split("\r\n\r\n");
    if (!bodyParts.length) {
      continue;
    }
    const disposition = rawHeaders.match(/content-disposition:([^\r\n]+)/i)?.[1] || "";
    const name = disposition.match(/name="([^"]+)"/)?.[1] || "";
    const fileName = disposition.match(/filename="([^"]*)"/)?.[1] || "";
    if (name !== "file" || !fileName) {
      continue;
    }
    const mimeType = rawHeaders.match(/content-type:([^\r\n]+)/i)?.[1]?.trim() || "application/octet-stream";
    const rawFile = bodyParts.join("\r\n\r\n").replace(/\r\n$/, "");
    return {
      fileName,
      mimeType,
      buffer: Buffer.from(rawFile, "latin1")
    };
  }

  throw new Error("Bitte eine Datei auswaehlen.");
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

  response.writeHead(200, {
    "content-type": contentTypeFor(filePath),
    "content-length": stat.size,
    "cache-control": "no-store"
  });
  fs.createReadStream(filePath).pipe(response);
}

async function serveProjectFile(request, response) {
  const relativePath = decodeURIComponent(rawPathname(request).replace(/^\/files\/?/, ""));
  await serveFileFromRoot({ rootDir: repoRoot, relativePath, response });
}

async function servePublicFile(request, response) {
  const pathname = routePath(request);
  const relativePath = pathname === "/" ? "index.html" : pathname.replace(/^\//, "");
  await serveFileFromRoot({ rootDir: publicDir, relativePath, response });
}

async function handleApi(request, response) {
  const pathname = routePath(request);

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

  if (request.method === "POST" && pathname === "/api/library/folders") {
    const body = await readJsonBody(request);
    sendJson(response, 201, {
      folder: await createLibraryFolder(body, { projectsDir })
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

  const libraryFolderMatch = pathname.match(/^\/api\/library\/folders\/(.+)$/);
  if (request.method === "PATCH" && libraryFolderMatch) {
    const body = await readJsonBody(request);
    sendJson(response, 200, {
      folder: await renameLibraryFolder(libraryFolderMatch[1], body.label, { projectsDir })
    });
    return;
  }

  if (request.method === "DELETE" && libraryFolderMatch) {
    sendJson(response, 200, {
      result: await deleteLibraryFolder(libraryFolderMatch[1], { projectsDir })
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

  const workspaceCopyMatch = pathname.match(/^\/api\/workspace\/([^/]+)\/copy-context$/);
  if (request.method === "GET" && workspaceCopyMatch) {
    const url = new URL(request.url, "http://localhost");
    const worksheetIds = (url.searchParams.get("worksheets") || "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean);
    sendJson(response, 200, await buildCopyContext(workspaceCopyMatch[1], {
      repoRoot,
      projectsDir,
      worksheetIds
    }));
    return;
  }

  const workspaceChatMatch = pathname.match(/^\/api\/workspace\/([^/]+)\/chat$/);
  if (request.method === "GET" && workspaceChatMatch) {
    sendJson(response, 200, await readChat(workspaceChatMatch[1], {
      repoRoot,
      projectsDir
    }));
    return;
  }

  if (request.method === "POST" && workspaceChatMatch) {
    const body = await readJsonBody(request);
    sendJson(response, 200, await sendChatMessage(workspaceChatMatch[1], body, {
      repoRoot,
      projectsDir
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
      workspace: await buildWorkspace(workspaceInputUploadMatch[1], { repoRoot, projectsDir })
    });
    return;
  }

  const workspaceCommandsMatch = pathname.match(/^\/api\/workspace\/([^/]+)\/commands$/);
  if (request.method === "POST" && workspaceCommandsMatch) {
    const body = await readJsonBody(request);
    sendJson(response, 200, await runWorkspaceCommand(workspaceCommandsMatch[1], body, {
      repoRoot,
      projectsDir
    }));
    return;
  }

  const workspaceMatch = pathname.match(/^\/api\/workspace\/([^/]+)$/);
  if (request.method === "GET" && workspaceMatch) {
    sendJson(response, 200, {
      workspace: await buildWorkspace(workspaceMatch[1], { repoRoot, projectsDir })
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
    await deleteProject(projectMatch[1], { projectsDir });
    await removeProjectFromLibrary(projectMatch[1], { projectsDir });
    sendJson(response, 200, {
      deleted: true,
      projectId: projectMatch[1]
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

  if (request.method === "POST" && pathname === "/api/projects/series") {
    const body = await readJsonBody(request);
    sendJson(response, 201, {
      project: await createSeriesProject(body, { projectsDir })
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

    sendJson(response, 500, {
      error: "internal_error",
      message: error.message
    });
  }
});

server.listen(defaultPort, defaultHost, () => {
  const visibleHost = defaultHost === "0.0.0.0" ? "127.0.0.1" : defaultHost;
  console.log(`SheetifyIMG dev server listening on http://${visibleHost}:${defaultPort}`);
});
