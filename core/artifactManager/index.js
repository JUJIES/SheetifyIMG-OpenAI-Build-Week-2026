"use strict";

const fs = require("node:fs/promises");
const path = require("node:path");
const {
  ARTIFACT_STATUSES,
  ARTIFACT_TYPES,
  PRODUCTION_SCHEMA_VERSION
} = require("../contracts");

const ARTIFACT_INDEX_FILE = "artifact-index.json";

async function pathExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, "utf8"));
}

async function writeJson(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function createArtifactIndex({ now, artifacts = [] } = {}) {
  return {
    schemaVersion: PRODUCTION_SCHEMA_VERSION,
    updatedAt: now || new Date().toISOString(),
    artifacts
  };
}

function createEmptyArtifactIndex(now) {
  return createArtifactIndex({ now, artifacts: [] });
}

function createInitialWorksheetArtifacts(now) {
  return [
    {
      id: "lessonbrief_v001",
      type: ARTIFACT_TYPES.LESSON_BRIEF,
      version: 1,
      path: "brief/lessonbrief.v001.json",
      status: ARTIFACT_STATUSES.DRAFT,
      step: "brief",
      createdAt: now
    },
    {
      id: "content_mirror_v001",
      type: ARTIFACT_TYPES.CONTENT_MIRROR,
      version: 1,
      path: "content/content-mirror.v001.json",
      status: ARTIFACT_STATUSES.DRAFT,
      step: "content",
      createdAt: now,
      createdFrom: ["lessonbrief_v001"]
    }
  ];
}

function createInitialWorksheetArtifactIndex(now) {
  return createArtifactIndex({
    now,
    artifacts: createInitialWorksheetArtifacts(now)
  });
}

function artifactPrefix(type) {
  const prefixes = {
    [ARTIFACT_TYPES.LESSON_BRIEF]: "lessonbrief",
    [ARTIFACT_TYPES.CONTENT_MIRROR]: "content_mirror",
    [ARTIFACT_TYPES.WARNINGS]: "warnings",
    [ARTIFACT_TYPES.IMAGESHEET_BRIEF]: "imagesheet_brief",
    [ARTIFACT_TYPES.RUN]: "run",
    [ARTIFACT_TYPES.CANDIDATE]: "candidate",
    [ARTIFACT_TYPES.SELECTION]: "selection",
    [ARTIFACT_TYPES.EXPORT]: "export",
    [ARTIFACT_TYPES.PDF]: "pdf",
    [ARTIFACT_TYPES.SCREENSHOT]: "screenshot",
    [ARTIFACT_TYPES.INPUT_BATCH]: "input_batch"
  };
  return prefixes[type] || String(type || "artifact");
}

function formatVersion(version) {
  return `v${String(Number(version) || 1).padStart(3, "0")}`;
}

function artifactIdFor(type, version) {
  return `${artifactPrefix(type)}_${formatVersion(version)}`;
}

function nextArtifactVersion(index, type) {
  const versions = (index.artifacts || [])
    .filter((artifact) => artifact.type === type)
    .map((artifact) => Number(artifact.version) || 0);
  return Math.max(0, ...versions) + 1;
}

function assertArtifactContract(artifact = {}) {
  const missing = ["id", "type", "path", "status", "createdAt"]
    .filter((field) => !artifact[field]);
  if (missing.length > 0) {
    throw new Error(`Artifact is missing required fields: ${missing.join(", ")}`);
  }
  return artifact;
}

async function readArtifactIndex(projectDir) {
  const indexPath = path.join(projectDir, ARTIFACT_INDEX_FILE);
  if (!(await pathExists(indexPath))) {
    return createEmptyArtifactIndex(new Date().toISOString());
  }
  const index = await readJson(indexPath);
  return {
    schemaVersion: index.schemaVersion ?? PRODUCTION_SCHEMA_VERSION,
    updatedAt: index.updatedAt || null,
    artifacts: Array.isArray(index.artifacts) ? index.artifacts : []
  };
}

async function writeArtifactIndex(projectDir, index) {
  await writeJson(path.join(projectDir, ARTIFACT_INDEX_FILE), {
    schemaVersion: index.schemaVersion ?? PRODUCTION_SCHEMA_VERSION,
    updatedAt: index.updatedAt || new Date().toISOString(),
    artifacts: Array.isArray(index.artifacts) ? index.artifacts : []
  });
}

async function registerArtifact(projectDir, artifact, options = {}) {
  const now = options.now || new Date().toISOString();
  const nextArtifact = assertArtifactContract({
    ...artifact,
    createdAt: artifact.createdAt || now
  });
  const index = await readArtifactIndex(projectDir);

  if (index.artifacts.some((entry) => entry.id === nextArtifact.id)) {
    throw new Error(`Artifact already exists: ${nextArtifact.id}`);
  }

  index.artifacts.push(nextArtifact);
  index.updatedAt = now;
  await writeArtifactIndex(projectDir, index);
  return nextArtifact;
}

async function updateArtifact(projectDir, artifactId, patch, options = {}) {
  const now = options.now || new Date().toISOString();
  const index = await readArtifactIndex(projectDir);
  const artifact = findArtifact(index, artifactId);

  if (!artifact) {
    throw new Error(`Artifact does not exist: ${artifactId}`);
  }

  Object.assign(artifact, patch, { updatedAt: now });
  index.updatedAt = now;
  await writeArtifactIndex(projectDir, index);
  return artifact;
}

async function setArtifactStatus(projectDir, artifactId, status, options = {}) {
  return updateArtifact(projectDir, artifactId, {
    status,
    outdatedBecause: options.outdatedBecause
  }, options);
}

async function markArtifactsOutdated(projectDir, predicate, reason, options = {}) {
  const now = options.now || new Date().toISOString();
  const index = await readArtifactIndex(projectDir);
  const changed = [];

  for (const artifact of index.artifacts || []) {
    if (!predicate(artifact)) {
      continue;
    }
    if (artifact.status === ARTIFACT_STATUSES.OUTDATED) {
      continue;
    }
    artifact.status = ARTIFACT_STATUSES.OUTDATED;
    artifact.updatedAt = now;
    artifact.outdatedBecause = reason;
    changed.push(artifact);
  }

  if (changed.length > 0) {
    index.updatedAt = now;
    await writeArtifactIndex(projectDir, index);
  }

  return changed;
}

function findArtifact(index, artifactId) {
  return (index.artifacts || []).find((artifact) => artifact.id === artifactId) || null;
}

function listArtifacts(index, filter = {}) {
  return (index.artifacts || []).filter((artifact) => {
    if (filter.type && artifact.type !== filter.type) {
      return false;
    }
    if (filter.status && artifact.status !== filter.status) {
      return false;
    }
    if (filter.step && artifact.step !== filter.step) {
      return false;
    }
    return true;
  });
}

function currentArtifact(index, type) {
  const artifacts = listArtifacts(index, { type });
  return artifacts.find((artifact) => artifact.status === ARTIFACT_STATUSES.CURRENT)
    || artifacts.find((artifact) => artifact.status === ARTIFACT_STATUSES.APPROVED)
    || artifacts.find((artifact) => artifact.status === ARTIFACT_STATUSES.DRAFT)
    || null;
}

module.exports = {
  ARTIFACT_INDEX_FILE,
  artifactIdFor,
  artifactPrefix,
  assertArtifactContract,
  createArtifactIndex,
  createEmptyArtifactIndex,
  createInitialWorksheetArtifactIndex,
  createInitialWorksheetArtifacts,
  currentArtifact,
  formatVersion,
  findArtifact,
  listArtifacts,
  markArtifactsOutdated,
  nextArtifactVersion,
  readArtifactIndex,
  registerArtifact,
  setArtifactStatus,
  updateArtifact,
  writeArtifactIndex
};
