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
const { createUsageAttribution } = require("../usageAttributionManager");

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

function suggestedActionFromCommand(command = {}) {
  if (!command?.id && !command?.command) {
    return null;
  }
  return {
    command: command.id || command.command,
    label: command.label || command.decisionLabel || command.id || command.command,
    payload: command.defaultPayload || command.payload || {},
    requiresConfirmation: command.requiresConfirmation === true,
    confirmationKind: command.confirmationKind || null,
    reason: command.reason || null
  };
}

async function uploadSuggestedActions(projectId, fileEntry = {}, options = {}) {
  const isImageUpload = String(fileEntry.mimeType || "").startsWith("image/");
  if (isImageUpload) {
    const { buildWorkspace } = require("../workspaceManager");
    const workspace = await buildWorkspace(projectId, {
      repoRoot: options.repoRoot || DEFAULT_REPO_ROOT,
      projectsDir: options.projectsDir || DEFAULT_PROJECTS_DIR,
      worksheetsDir: options.worksheetsDir
    });
    const referenceCommand = (workspace.commands || []).find((command) => command.id === "prepare_reference_asset" && command.enabled);
    const referenceAction = suggestedActionFromCommand(referenceCommand);
    if (referenceAction) {
      return {
        kind: "input_reference_ready",
        fallback: `Ich habe "${fileEntry.originalName}" erhalten. Ich kann das Bild als Referenz fuer den naechsten Entwurf nutzen.`,
        actions: [referenceAction]
      };
    }
  }
  return {
    kind: "input_received",
    fallback: `Ich habe "${fileEntry.originalName}" erhalten. Soll ich daraus ein Arbeitsblatt-Konzept vorschlagen?`,
    actions: [{
      command: "generate_lessonbrief_proposal",
      label: "Ja, Arbeitsblatt-Konzept vorschlagen",
      payload: { completeConcept: true }
    }]
  };
}

function inputUploadAttachment(fileEntry = {}) {
  const originalName = fileEntry.originalName || path.basename(fileEntry.path || "");
  const mimeType = fileEntry.mimeType || "application/octet-stream";
  const size = Number(fileEntry.size || 0) || 0;
  return {
    id: fileEntry.artifactId || fileEntry.path || originalName,
    kind: "input_upload",
    label: originalName || "Datei",
    originalName,
    mimeType,
    size,
    path: fileEntry.path,
    artifactId: fileEntry.artifactId || null,
    source: {
      kind: "input_upload",
      artifactId: fileEntry.artifactId || null,
      path: fileEntry.path,
      originalName,
      mimeType,
      size
    }
  };
}

async function addInputUpload(projectId, input = {}, options = {}) {
  const projectsDir = options.projectsDir || DEFAULT_PROJECTS_DIR;
  const projectDir = path.join(projectsDir, projectId);
  const appendChatReceipt = options.appendChatReceipt !== false;
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
  const usageAttribution = createUsageAttribution(options.usageAttribution, {
    projectId,
    operationKind: "input_upload"
  });
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
  if (appendChatReceipt) {
    await appendEvent(projectDir, {
      type: EVENT_TYPES.USER_MESSAGE,
      createdAt: now,
      step: "input",
      payload: {
        mode: "upload",
        message: "",
        uiEvent: "input_upload",
        operationId: usageAttribution.operationId,
        attachments: [inputUploadAttachment(fileEntry)]
      }
    }, { now });
    const uploadResponse = await uploadSuggestedActions(projectId, fileEntry, options);
    const suggestedActions = uploadResponse.actions;
    const assistantMessage = await narrateChatMoment(projectDir, {
      kind: uploadResponse.kind,
      fallback: uploadResponse.fallback,
      suggestedActions,
      workspace: {
        project: { projectId },
        recentMessages: []
      }
    }, {
      now,
      uiEvent: "input_received",
      usageAttribution
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
  }
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
