"use strict";

const fs = require("node:fs/promises");
const path = require("node:path");
const {
  ARTIFACT_STATUSES,
  ARTIFACT_TYPES
} = require("../contracts");
const {
  listArtifacts,
  readArtifactIndex
} = require("../artifactManager");
const { getApprovalState } = require("../approvalManager");
const {
  projectIdentityFromManifest,
  projectTypeFromManifest
} = require("../legacy");
const { readCandidateGenerationState } = require("../candidateGenerationJobManager");
const { readJsonFileIfExists } = require("../jsonFile");

async function pathExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function readJsonIfExists(filePath) {
  return readJsonFileIfExists(filePath);
}

async function listDirs(dirPath) {
  if (!(await pathExists(dirPath))) {
    return [];
  }
  const entries = await fs.readdir(dirPath, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(dirPath, entry.name))
    .sort();
}

async function listFiles(dirPath) {
  if (!(await pathExists(dirPath))) {
    return [];
  }
  const entries = await fs.readdir(dirPath, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile())
    .map((entry) => path.join(dirPath, entry.name))
    .sort();
}

const projectTypeOf = projectTypeFromManifest;

function countManifestWarnings(manifest = {}) {
  const warnings = Array.isArray(manifest.normalizationWarnings) ? manifest.normalizationWarnings : [];
  return {
    errors: warnings.filter((warning) => warning.severity === "error").length,
    warnings: warnings.filter((warning) => warning.severity !== "error").length
  };
}

async function countContentWarnings(projectDir) {
  const warningsFile = path.join(projectDir, "qc", "content-warnings.json");
  const warningState = await readJsonIfExists(warningsFile);
  const warnings = Array.isArray(warningState?.warnings) ? warningState.warnings : [];
  return {
    errors: warnings.filter((warning) => warning.severity === "error").length,
    warnings: warnings.filter((warning) => warning.severity !== "error").length
  };
}

async function readRunStates(projectDir) {
  const runDirs = await listDirs(path.join(projectDir, "runs"));
  const runs = [];

  for (const runDir of runDirs) {
    const manifest = await readJsonIfExists(path.join(runDir, "run-manifest.json"));
    const candidates = Array.isArray(manifest?.candidates) ? manifest.candidates : [];
    const candidateArtifacts = await summarizeCandidateArtifacts(runDir, candidates);
    const promptFiles = await listFiles(path.join(runDir, "prompts"));
    const plannedCandidatePageCount = candidateArtifacts.reduce((sum, candidate) => sum + candidate.pageCount, 0);
    const renderedCandidatePageCount = candidateArtifacts.reduce((sum, candidate) => sum + candidate.renderedPageCount, 0);

    runs.push({
      runId: manifest?.runId || path.basename(runDir),
      candidateCount: candidates.length,
      plannedCandidateCount: candidates.length,
      renderedCandidateCount: candidateArtifacts.filter((candidate) => candidate.hasRenderedPages).length,
      fullyRenderedCandidateCount: candidateArtifacts.filter((candidate) => candidate.isFullyRendered).length,
      missingCandidateCount: candidateArtifacts.filter((candidate) => candidate.missingPageCount > 0).length,
      plannedCandidatePageCount,
      renderedCandidatePageCount,
      missingCandidatePageCount: Math.max(0, plannedCandidatePageCount - renderedCandidatePageCount),
      promptCount: promptFiles.length,
      selectedCandidate: null,
      selectedPageCount: 0,
      selectedPagePlanCount: 0,
      missingSelectedPageCount: 0,
      selectionStatus: null,
      hasErrors: false,
      hasPlannedCandidates: candidates.length > 0,
      hasRenderedCandidates: candidateArtifacts.some((candidate) => candidate.hasRenderedPages),
      hasSelectionArtifacts: false
    });
  }

  return runs;
}

async function hasApprovedArtifact(projectDir, artifactType, compatibilityPath) {
  const index = await readArtifactIndex(projectDir);
  const approvedArtifacts = listArtifacts(index, {
    type: artifactType,
    status: ARTIFACT_STATUSES.APPROVED
  });
  return approvedArtifacts.length > 0 || pathExists(path.join(projectDir, compatibilityPath));
}

async function hasApprovedContent(projectDir) {
  return hasApprovedArtifact(
    projectDir,
    ARTIFACT_TYPES.CONTENT_MIRROR,
    path.join("content", "approved.content-mirror.json")
  );
}

async function hasDraftContent(projectDir) {
  return pathExists(path.join(projectDir, "content", "draft.content-mirror.json"));
}

async function hasApprovedBrief(projectDir) {
  return hasApprovedArtifact(
    projectDir,
    ARTIFACT_TYPES.LESSON_BRIEF,
    path.join("brief", "approved.lessonbrief.json")
  );
}

async function hasDraftBrief(projectDir) {
  return pathExists(path.join(projectDir, "brief", "draft.lessonbrief.json"));
}

async function summarizeCandidateArtifacts(runDir, candidates) {
  const candidateStates = [];

  for (const candidate of candidates) {
    let pageCount = 0;
    let renderedPageCount = 0;

    for (const page of candidate.pages || []) {
      pageCount += 1;
      const filePath = path.join(runDir, page.path);
      if (await pathExists(filePath)) {
        renderedPageCount += 1;
      }
    }

    candidateStates.push({
      id: candidate.id,
      pageCount,
      renderedPageCount,
      missingPageCount: Math.max(0, pageCount - renderedPageCount),
      hasRenderedPages: renderedPageCount > 0,
      isFullyRendered: pageCount > 0 && renderedPageCount === pageCount
    });
  }

  return candidateStates;
}

async function statusForSingleWorksheet(projectDir, manifest) {
  const identity = projectIdentityFromManifest(manifest);
  const manifestCounts = countManifestWarnings(manifest);
  const contentCounts = await countContentWarnings(projectDir);
  const errors = manifestCounts.errors + contentCounts.errors;
  const warnings = manifestCounts.warnings + contentCounts.warnings;
  const runs = await readRunStates(projectDir);
  const latestRun = runs[runs.length - 1] || null;
  const candidateGeneration = await readCandidateGenerationState(projectDir);
  const approvalGate = await getApprovalState(projectDir);
  const approvedContent = await hasApprovedContent(projectDir);
  const draftContent = await hasDraftContent(projectDir);
  const approvedBrief = await hasApprovedBrief(projectDir);
  const draftBrief = await hasDraftBrief(projectDir);
  const hasRenderedCandidates = runs.some((run) => run.hasRenderedCandidates);
  const hasPlannedCandidates = runs.some((run) => run.hasPlannedCandidates);
  const hasCandidateGenerationRunning = Boolean(candidateGeneration.isRunning);
  const hasDownstreamArtifacts = hasRenderedCandidates || hasCandidateGenerationRunning;
  const currentContentApproved = identity.isLegacy ? approvedContent : approvalGate.canGenerate;
  const effectiveBriefApproved = approvedBrief || (identity.isLegacy && draftBrief && hasDownstreamArtifacts);
  const effectiveContentApproved = currentContentApproved || (identity.isLegacy && draftContent && hasDownstreamArtifacts);
  const briefApprovalSource = approvedBrief ? "explicit" : effectiveBriefApproved ? "inferred_from_artifacts" : "none";
  const contentApprovalSource = currentContentApproved ? "explicit" : effectiveContentApproved ? "inferred_from_artifacts" : "none";

  let status = "draft";
  if (errors > 0) {
    status = "error";
  } else if (hasRenderedCandidates || hasPlannedCandidates || hasCandidateGenerationRunning) {
    status = "has_candidates";
  } else if (currentContentApproved) {
    status = "ready_for_generation";
  } else if (draftContent) {
    status = "needs_approval";
  }

  const previewState = hasRenderedCandidates
    ? "candidate_preview_available"
    : hasCandidateGenerationRunning || hasPlannedCandidates
      ? "candidate_generation_pending"
      : "no_preview";
  const productStage = hasRenderedCandidates || hasPlannedCandidates || hasCandidateGenerationRunning
      ? "drafts"
      : draftContent || approvedContent || draftBrief || approvedBrief
        ? "concept"
        : "input";

  return {
    status,
    productStage,
    errors,
    warnings,
    sourceType: identity.sourceType,
    isLegacy: identity.isLegacy,
    runCount: runs.length,
    runs,
    latestRun,
    canGenerate: currentContentApproved && errors === 0,
    canGenerateSource: currentContentApproved
      ? "explicit_approval"
      : approvedContent
        ? "blocked_without_current_content_approval"
        : "blocked_without_explicit_approval",
    hasApprovedBrief: approvedBrief,
    hasDraftBrief: draftBrief,
    hasApprovedContent: approvedContent,
    hasDraftContent: draftContent,
    hasEffectiveApprovedBrief: effectiveBriefApproved,
    hasEffectiveApprovedContent: effectiveContentApproved,
    briefApprovalSource,
    contentApprovalSource,
    hasExport: false,
    candidateState: hasRenderedCandidates ? "rendered" : hasCandidateGenerationRunning ? "generating" : hasPlannedCandidates ? "planned" : "none",
    selectionState: "none",
    previewState,
    approvalState: effectiveContentApproved ? "approved" : draftContent ? "draft" : "missing",
    candidateGeneration,
    hasUnreadCandidateCompletion: Boolean(candidateGeneration.hasUnreadCompletion),
    workflow: {
      brief: effectiveBriefApproved ? "approved" : draftBrief ? "draft" : "missing",
      content: effectiveContentApproved ? "approved" : draftContent ? "draft" : "missing",
      candidates: hasRenderedCandidates ? "rendered" : hasCandidateGenerationRunning ? "generating" : hasPlannedCandidates ? "planned" : "missing",
      selection: "missing",
      export: "missing"
    }
  };
}

async function getProjectStatus(projectDir) {
  const manifest = await readJsonIfExists(path.join(projectDir, "project-manifest.json"));
  if (!manifest) {
    return {
      status: "error",
      errors: 1,
      warnings: 0,
      message: "project-manifest.json is missing"
    };
  }

  const projectType = projectTypeOf(manifest);
  if (projectType === "single_worksheet") {
    return statusForSingleWorksheet(projectDir, manifest);
  }
  if (projectType === "bundle") {
    const identity = projectIdentityFromManifest(manifest);
    return {
      status: "draft",
      productStage: "input",
      errors: 0,
      warnings: 0,
      sourceType: identity.sourceType,
      isLegacy: identity.isLegacy,
      hasExport: false
    };
  }

  return {
    status: "error",
    errors: 1,
    warnings: 0,
    message: `Unsupported project type: ${projectType}`
  };
}

module.exports = {
  getProjectStatus,
  projectTypeOf
};
