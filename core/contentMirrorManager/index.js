"use strict";

const fs = require("node:fs/promises");
const path = require("node:path");
const {
  ARTIFACT_STATUSES,
  ARTIFACT_TYPES,
  EVENT_TYPES,
  PRODUCTION_SCHEMA_VERSION
} = require("../contracts");
const {
  artifactIdFor,
  formatVersion,
  markArtifactsOutdated,
  nextArtifactVersion,
  readArtifactIndex,
  registerArtifact,
  setArtifactStatus
} = require("../artifactManager");
const { appendEvent, readEvents } = require("../eventLog");
const { appendHistoryEvent } = require("../historyManager");
const { normalizeContentSolutionAnchors } = require("../solutionAnchorManager");
const {
  contentReadinessForGeneration,
  contentReadinessMessage
} = require("../contentReadiness");

const DOWNSTREAM_TYPES = new Set([
  ARTIFACT_TYPES.IMAGESHEET_BRIEF,
  ARTIFACT_TYPES.RUN,
  ARTIFACT_TYPES.CANDIDATE,
  ARTIFACT_TYPES.PDF
]);

async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, "utf8"));
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

async function readProjectManifest(projectDir) {
  return readJson(path.join(projectDir, "project-manifest.json"));
}

function hasMeaningfulContent(content = {}) {
  const tasks = Array.isArray(content.tasks) ? content.tasks : [];
  const imageMaterials = Array.isArray(content.imageMaterials) ? content.imageMaterials : [];
  const readingTexts = Array.isArray(content.readingTexts) ? content.readingTexts : [];
  return tasks.some((task) => String(task.prompt || task.text || "").trim())
    || imageMaterials.some((material) => String(material.prompt || material.description || "").trim())
    || readingTexts.some((text) => String(text.body || "").trim());
}

async function writeProjectManifest(projectDir, manifest) {
  await writeJson(path.join(projectDir, "project-manifest.json"), manifest);
}

async function createContentMirrorVersion(projectDir, data = {}, options = {}) {
  const now = options.now || new Date().toISOString();
  const index = await readArtifactIndex(projectDir);
  const version = options.version || nextArtifactVersion(index, ARTIFACT_TYPES.CONTENT_MIRROR);
  const artifactId = artifactIdFor(ARTIFACT_TYPES.CONTENT_MIRROR, version);
  const fileName = `content-mirror.${formatVersion(version)}.json`;
  const relativePath = `content/${fileName}`;
  const normalizedData = normalizeContentSolutionAnchors(data);
  const lineage = {
    parentContentMirrorId: options.parentContentMirrorId || null,
    revisionKind: options.revisionKind || "full_snapshot",
    changeSummary: options.changeSummary || null,
    imageSpecStrategy: options.imageSpecStrategy || "regenerate"
  };
  const contentMirror = {
    ...normalizedData,
    schemaVersion: normalizedData.schemaVersion || PRODUCTION_SCHEMA_VERSION,
    artifactId,
    version,
    status: ARTIFACT_STATUSES.DRAFT,
    approval: {
      ...(normalizedData.approval || {}),
      status: ARTIFACT_STATUSES.DRAFT,
      approvedAt: null
    },
    createdAt: normalizedData.createdAt || now,
    updatedAt: now,
    lineage
  };

  await writeJson(path.join(projectDir, relativePath), contentMirror);
  await writeJson(path.join(projectDir, "content", "draft.content-mirror.json"), contentMirror);
  await registerArtifact(projectDir, {
    id: artifactId,
    type: ARTIFACT_TYPES.CONTENT_MIRROR,
    version,
    path: relativePath,
    status: ARTIFACT_STATUSES.DRAFT,
    step: "content",
    createdAt: now,
    createdFrom: options.createdFrom || [],
    lineage
  }, { now });

  const outdated = await markArtifactsOutdated(
    projectDir,
    (artifact) => DOWNSTREAM_TYPES.has(artifact.type),
    `${artifactId} created after downstream artifact`,
    { now }
  );

  const manifest = await readProjectManifest(projectDir);
  manifest.currentArtifacts = {
    ...(manifest.currentArtifacts || {}),
    contentMirrorId: artifactId
  };
  manifest.approval = {
    ...(manifest.approval || {}),
    contentMirror: "draft_only",
    canGenerate: false,
    reason: "Current content mirror is not approved."
  };
  manifest.updatedAt = now;
  await writeProjectManifest(projectDir, manifest);

  await appendEvent(projectDir, {
    type: EVENT_TYPES.ARTIFACT_CREATED,
    createdAt: now,
    step: "content",
    artifactId,
    payload: {
      type: ARTIFACT_TYPES.CONTENT_MIRROR,
      version,
      lineage,
      outdatedArtifacts: outdated.map((artifact) => artifact.id)
    }
  });
  await appendHistoryEvent(projectDir, {
    type: "content_mirror_version_created",
    createdAt: now,
    artifactId,
    version,
    lineage,
    outdatedArtifactCount: outdated.length
  });

  return { artifactId, path: relativePath, data: contentMirror, outdated };
}

async function approveContentMirrorVersion(projectDir, artifactId, options = {}) {
  const now = options.now || new Date().toISOString();
  const index = await readArtifactIndex(projectDir);
  const artifact = index.artifacts.find((entry) => entry.id === artifactId);
  if (!artifact || artifact.type !== ARTIFACT_TYPES.CONTENT_MIRROR) {
    throw new Error(`Content mirror artifact does not exist: ${artifactId}`);
  }

  const contentPath = path.join(projectDir, artifact.path);
  const content = await readJson(contentPath);
  if (!hasMeaningfulContent(content)) {
    throw new Error("Content mirror cannot be approved before tasks, reading text, or image material exist.");
  }
  const manifest = await readProjectManifest(projectDir);
  const briefArtifact = manifest.currentArtifacts?.lessonbriefId
    ? index.artifacts.find((entry) => entry.id === manifest.currentArtifacts.lessonbriefId)
    : null;
  const brief = briefArtifact
    ? await readJsonIfExists(path.join(projectDir, briefArtifact.path))
    : await readJsonIfExists(path.join(projectDir, "brief", "approved.lessonbrief.json")) || {};
  const events = await readEvents(projectDir);
  const readiness = contentReadinessForGeneration(content, { events, brief });
  if (!readiness.ready) {
    throw new Error(contentReadinessMessage(readiness));
  }
  const approvedContent = {
    ...content,
    status: ARTIFACT_STATUSES.APPROVED,
    approval: {
      ...(content.approval || {}),
      status: ARTIFACT_STATUSES.APPROVED,
      approvedAt: now
    },
    updatedAt: now
  };

  await writeJson(contentPath, approvedContent);
  await writeJson(path.join(projectDir, "content", "approved.content-mirror.json"), approvedContent);
  await setArtifactStatus(projectDir, artifactId, ARTIFACT_STATUSES.APPROVED, { now });

  manifest.currentArtifacts = {
    ...(manifest.currentArtifacts || {}),
    contentMirrorId: artifactId
  };
  manifest.approval = {
    ...(manifest.approval || {}),
    contentMirror: ARTIFACT_STATUSES.APPROVED,
    canGenerate: true,
    reason: null
  };
  manifest.updatedAt = now;
  await writeProjectManifest(projectDir, manifest);

  await appendEvent(projectDir, {
    type: EVENT_TYPES.ARTIFACT_APPROVED,
    createdAt: now,
    step: "freigabe",
    artifactId,
    payload: { type: ARTIFACT_TYPES.CONTENT_MIRROR }
  });
  await appendHistoryEvent(projectDir, {
    type: "content_mirror_approved",
    createdAt: now,
    artifactId
  });

  return approvedContent;
}

module.exports = {
  approveContentMirrorVersion,
  createContentMirrorVersion,
  hasMeaningfulContent
};
