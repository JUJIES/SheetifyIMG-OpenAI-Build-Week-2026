"use strict";

const fs = require("node:fs/promises");
const path = require("node:path");
const {
  ARTIFACT_TYPES,
  PRODUCTION_SCHEMA_VERSION,
  PROJECT_TYPES,
  SOURCE_TYPES
} = require("../contracts");
const { readArtifactIndex } = require("../artifactManager");
const { projectIdentityFromManifest } = require("../legacy");

async function pathExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function readJsonIfExists(filePath) {
  if (!(await pathExists(filePath))) {
    return null;
  }
  return JSON.parse(await fs.readFile(filePath, "utf8"));
}

async function requireFile(projectDir, relativePath, errors) {
  if (!(await pathExists(path.join(projectDir, relativePath)))) {
    errors.push({
      code: "required_file_missing",
      message: `Required file is missing: ${relativePath}`
    });
  }
}

async function requireIndexedArtifactFiles(projectDir, errors) {
  const index = await readArtifactIndex(projectDir);
  for (const artifact of index.artifacts || []) {
    if (![ARTIFACT_TYPES.LESSON_BRIEF, ARTIFACT_TYPES.CONTENT_MIRROR].includes(artifact.type)) {
      continue;
    }
    if (artifact.path) {
      await requireFile(projectDir, artifact.path, errors);
    }
  }
}

async function inspectProjectContract(projectDir) {
  const errors = [];
  const warnings = [];
  const manifest = await readJsonIfExists(path.join(projectDir, "project-manifest.json"));

  if (!manifest) {
    return {
      projectDir,
      projectId: path.basename(projectDir),
      projectType: "unknown",
      sourceType: "unknown",
      isLegacy: false,
      isProductionV2: false,
      errors: [{
        code: "project_manifest_missing",
        message: "project-manifest.json is missing."
      }],
      warnings
    };
  }

  const identity = projectIdentityFromManifest(manifest);
  const isProductionV2 = manifest.schemaVersion === PRODUCTION_SCHEMA_VERSION
    && identity.sourceType === SOURCE_TYPES.PRODUCTION
    && !identity.isLegacy;

  if (!isProductionV2) {
    warnings.push({
      code: "not_production_v2",
      message: "Project is not a production v0.2 project."
    });
  }

  if (isProductionV2) {
    await requireFile(projectDir, "artifact-index.json", errors);
    await requireFile(projectDir, "status-snapshot.json", errors);
    await requireFile(projectDir, "chat-events.jsonl", errors);

    if (identity.projectType === PROJECT_TYPES.SINGLE_WORKSHEET) {
      await requireIndexedArtifactFiles(projectDir, errors);
    } else {
      errors.push({
        code: "unsupported_production_project_type",
        message: `Unsupported production project type: ${identity.projectType}`
      });
    }
  }

  return {
    projectDir,
    projectId: manifest.projectId || path.basename(projectDir),
    projectType: identity.projectType,
    sourceType: identity.sourceType,
    isLegacy: identity.isLegacy,
    isProductionV2,
    errors,
    warnings
  };
}

async function assertProductionProject(projectDir) {
  const inspection = await inspectProjectContract(projectDir);
  if (!inspection.isProductionV2 || inspection.errors.length > 0) {
    const messages = [
      ...inspection.errors.map((error) => error.message),
      ...inspection.warnings.map((warning) => warning.message)
    ];
    throw new Error(`Invalid production project: ${messages.join("; ")}`);
  }
  return inspection;
}

module.exports = {
  assertProductionProject,
  inspectProjectContract
};
