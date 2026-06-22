"use strict";

const {
  LEGACY_PROJECT_TYPES,
  PROJECT_TYPES,
  SOURCE_TYPES
} = require("../contracts");

function projectTypeFromManifest(manifest = {}) {
  if (manifest.projectType) {
    return manifest.projectType;
  }
  if (manifest.kind === "worksheet") {
    return PROJECT_TYPES.SINGLE_WORKSHEET;
  }
  if (manifest.kind === "bundle") {
    return LEGACY_PROJECT_TYPES.BUNDLE;
  }
  return LEGACY_PROJECT_TYPES.UNKNOWN;
}

function sourceTypeFromManifest(manifest = {}) {
  if (manifest.sourceType) {
    return manifest.sourceType;
  }
  if (manifest.source?.kind === "fixture_normalization") {
    return SOURCE_TYPES.LEGACY_FIXTURE;
  }
  if (manifest.status === "normalized_from_fixture") {
    return SOURCE_TYPES.LEGACY_FIXTURE;
  }
  if (manifest.kind === "worksheet" || manifest.kind === "bundle") {
    return SOURCE_TYPES.LEGACY_FIXTURE;
  }
  return SOURCE_TYPES.PRODUCTION;
}

function isLegacyProjectManifest(manifest = {}) {
  return sourceTypeFromManifest(manifest) === SOURCE_TYPES.LEGACY_FIXTURE
    || Boolean(manifest.kind)
    || Boolean(manifest.normalizationWarnings);
}

function projectIdentityFromManifest(manifest = {}) {
  const projectType = projectTypeFromManifest(manifest);
  const sourceType = sourceTypeFromManifest(manifest);
  return {
    schemaVersion: manifest.schemaVersion ?? 0,
    projectType,
    sourceType,
    isLegacy: isLegacyProjectManifest(manifest),
    usesLegacyKind: Boolean(manifest.kind)
  };
}

module.exports = {
  isLegacyProjectManifest,
  projectIdentityFromManifest,
  projectTypeFromManifest,
  sourceTypeFromManifest
};

