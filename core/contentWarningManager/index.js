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
  nextArtifactVersion,
  readArtifactIndex,
  registerArtifact
} = require("../artifactManager");
const { appendEvent } = require("../eventLog");
const { appendHistoryEvent } = require("../historyManager");

const SEVERITIES = new Set(["low", "medium", "high", "error"]);

async function writeJson(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function normalizedSeverity(value) {
  const severity = String(value || "medium").toLowerCase();
  return SEVERITIES.has(severity) ? severity : "medium";
}

function normalizeWarnings(input = {}, options = {}) {
  const warnings = Array.isArray(input.warnings) ? input.warnings : [];
  return {
    schemaVersion: PRODUCTION_SCHEMA_VERSION,
    generatedAt: options.now || new Date().toISOString(),
    source: options.source || "manual",
    sourceProposalId: options.sourceProposalId || null,
    summary: String(input.summary || "").trim(),
    warnings: warnings.map((warning, index) => ({
      id: String(warning.id || `warning_${String(index + 1).padStart(3, "0")}`),
      severity: normalizedSeverity(warning.severity),
      target: String(warning.target || "content"),
      category: String(warning.category || "general"),
      message: String(warning.message || warning.recommendation || "Pruefhinweis").trim(),
      recommendation: String(warning.recommendation || "").trim(),
      status: warning.status === "ignored" || warning.status === "checked" ? warning.status : "open"
    })).filter((warning) => warning.message)
  };
}

async function createContentWarningsVersion(projectDir, data = {}, options = {}) {
  const now = options.now || new Date().toISOString();
  const index = await readArtifactIndex(projectDir);
  const version = options.version || nextArtifactVersion(index, ARTIFACT_TYPES.WARNINGS);
  const artifactId = artifactIdFor(ARTIFACT_TYPES.WARNINGS, version);
  const relativePath = `qc/content-warnings.${formatVersion(version)}.json`;
  const warningState = normalizeWarnings(data, {
    now,
    source: options.source || "ai_proposal",
    sourceProposalId: options.sourceProposalId || null
  });

  await writeJson(path.join(projectDir, relativePath), warningState);
  await writeJson(path.join(projectDir, "qc", "content-warnings.json"), warningState);
  await registerArtifact(projectDir, {
    id: artifactId,
    type: ARTIFACT_TYPES.WARNINGS,
    version,
    path: relativePath,
    status: ARTIFACT_STATUSES.CURRENT,
    step: "pruefung",
    createdAt: now,
    createdFrom: options.createdFrom || []
  }, { now });

  await appendEvent(projectDir, {
    type: EVENT_TYPES.QC_COMPLETED,
    createdAt: now,
    step: "pruefung",
    artifactId,
    payload: {
      type: ARTIFACT_TYPES.WARNINGS,
      warningCount: warningState.warnings.length,
      sourceProposalId: options.sourceProposalId || null
    }
  }, { now });
  await appendHistoryEvent(projectDir, {
    type: "content_warnings_created",
    createdAt: now,
    artifactId,
    version,
    warningCount: warningState.warnings.length,
    sourceProposalId: options.sourceProposalId || null
  });

  return {
    artifactId,
    path: relativePath,
    data: warningState
  };
}

module.exports = {
  createContentWarningsVersion,
  normalizeWarnings
};
