"use strict";

const fs = require("node:fs/promises");
const path = require("node:path");
const {
  ARTIFACT_STATUSES,
  ARTIFACT_TYPES,
  EVENT_TYPES,
  PRODUCTION_SCHEMA_VERSION
} = require("../contracts");
const { appendEvent } = require("../eventLog");
const {
  artifactIdFor,
  nextArtifactVersion,
  readArtifactIndex,
  registerArtifact
} = require("../artifactManager");
const { openProject } = require("../projectManager");
const { narrateChatMoment } = require("../chatNarrationManager");

const DEFAULT_REPO_ROOT = path.resolve(__dirname, "..", "..");
const DEFAULT_PROJECTS_DIR = path.join(DEFAULT_REPO_ROOT, "projects");
const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

function safeFileName(fileName) {
  const baseName = path.basename(String(fileName || "material").trim() || "material");
  return baseName
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    || "material";
}

async function readJsonIfExists(filePath) {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

async function writeJson(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function updateProjectTimestamp(projectDir, now) {
  const manifestPath = path.join(projectDir, "project-manifest.json");
  const manifest = await readJsonIfExists(manifestPath);
  if (!manifest) {
    return;
  }
  await writeJson(manifestPath, {
    ...manifest,
    updatedAt: now
  });
}

async function addInputUpload(projectId, input = {}, options = {}) {
  const projectsDir = options.projectsDir || DEFAULT_PROJECTS_DIR;
  const projectDir = path.join(projectsDir, projectId);
  await openProject(projectId, { projectsDir });

  const fileName = safeFileName(input.fileName);
  const mimeType = String(input.mimeType || "application/octet-stream");
  const buffer = Buffer.isBuffer(input.buffer) ? input.buffer : Buffer.from(input.buffer || "");
  if (!buffer.length) {
    throw new Error("Die Datei ist leer.");
  }
  if (buffer.length > MAX_UPLOAD_BYTES) {
    throw new Error("Die Datei ist zu gross. Bitte maximal 25 MB hochladen.");
  }

  const now = options.now || new Date().toISOString();
  const index = await readArtifactIndex(projectDir);
  const version = nextArtifactVersion(index, ARTIFACT_TYPES.INPUT_BATCH);
  const artifactId = artifactIdFor(ARTIFACT_TYPES.INPUT_BATCH, version);
  const storedName = `${artifactId}-${fileName}`;
  const relativeUploadPath = path.posix.join("source", "uploads", storedName);
  const uploadPath = path.join(projectDir, "source", "uploads", storedName);

  await fs.mkdir(path.dirname(uploadPath), { recursive: true });
  await fs.writeFile(uploadPath, buffer);

  const manifestPath = path.join(projectDir, "source", "source-manifest.json");
  const previousManifest = await readJsonIfExists(manifestPath);
  const previousFiles = Array.isArray(previousManifest?.files) ? previousManifest.files : [];
  const fileEntry = {
    originalName: fileName,
    path: relativeUploadPath,
    mimeType,
    size: buffer.length,
    uploadedAt: now,
    artifactId
  };
  const files = [...previousFiles, fileEntry];
  const sourceManifest = {
    schemaVersion: PRODUCTION_SCHEMA_VERSION,
    updatedAt: now,
    files
  };

  await writeJson(manifestPath, sourceManifest);

  const artifact = await registerArtifact(projectDir, {
    id: artifactId,
    type: ARTIFACT_TYPES.INPUT_BATCH,
    version,
    path: "source/source-manifest.json",
    status: ARTIFACT_STATUSES.CURRENT,
    step: "input",
    createdAt: now,
    metadata: {
      fileName,
      mimeType,
      size: buffer.length,
      uploadPath: relativeUploadPath
    }
  }, { now });

  await appendEvent(projectDir, {
    type: EVENT_TYPES.INPUT_BATCH_CREATED,
    createdAt: now,
    step: "input",
    payload: {
      artifactId,
      fileName,
      mimeType,
      size: buffer.length
    }
  }, { now });
  const suggestedActions = [{
    command: "generate_lessonbrief_proposal",
    label: "Ja, Arbeitsblatt-Konzept vorschlagen",
    payload: {}
  }];
  const assistantMessage = await narrateChatMoment(projectDir, {
    kind: "input_received",
    fallback: `Ich habe "${fileName}" erhalten. Soll ich daraus ein Arbeitsblatt-Konzept vorschlagen?`,
    suggestedActions,
    workspace: {
      project: { projectId },
      recentMessages: []
    }
  }, {
    now,
    uiEvent: "input_received"
  });
  await appendEvent(projectDir, {
    type: EVENT_TYPES.ASSISTANT_MESSAGE,
    createdAt: now,
    step: "input",
    payload: {
      mode: "narration",
      message: assistantMessage,
      suggestedActions
    }
  }, { now });
  await updateProjectTimestamp(projectDir, now);

  return {
    artifact,
    sourceManifest,
    file: fileEntry
  };
}

module.exports = {
  addInputUpload,
  safeFileName
};
