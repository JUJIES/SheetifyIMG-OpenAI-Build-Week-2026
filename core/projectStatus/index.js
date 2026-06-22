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
    const selection = await readJsonIfExists(path.join(runDir, "selected", "selection.json"));
    const candidates = Array.isArray(manifest?.candidates) ? manifest.candidates : [];
    const selectedPages = Array.isArray(selection?.pages) ? selection.pages : [];
    const candidateArtifacts = await summarizeCandidateArtifacts(runDir, candidates);
    const selectionArtifacts = await summarizeSelectionArtifacts(runDir, selectedPages);
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
      selectedCandidate: selection?.selectedCandidate || manifest?.selectedCandidate || null,
      selectedPageCount: selectionArtifacts.selectedPageCount,
      selectedPagePlanCount: selectionArtifacts.selectedPagePlanCount,
      missingSelectedPageCount: selectionArtifacts.missingSelectedPageCount,
      selectionStatus: selection?.status || null,
      hasErrors: Array.isArray(selection?.errors) && selection.errors.length > 0,
      hasPlannedCandidates: candidates.length > 0,
      hasRenderedCandidates: candidateArtifacts.some((candidate) => candidate.hasRenderedPages),
      hasSelectionArtifacts: selectionArtifacts.hasSelectionArtifacts
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

async function hasExports(projectDir) {
  const exportFiles = await listFiles(path.join(projectDir, "export"));
  if (exportFiles.some((filePath) => /\.pdf$/i.test(filePath))) {
    return true;
  }
  const exportDirs = await listDirs(path.join(projectDir, "export"));
  for (const exportDir of exportDirs) {
    const files = await listFiles(exportDir);
    if (files.some((filePath) => /\.pdf$/i.test(filePath))) {
      return true;
    }
  }
  return false;
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

async function summarizeSelectionArtifacts(runDir, selectedPages) {
  let existingPageCount = 0;

  for (const page of selectedPages) {
    if (!page.selectedPath) {
      continue;
    }
    const filePath = path.join(runDir, page.selectedPath);
    if (await pathExists(filePath)) {
      existingPageCount += 1;
    }
  }

  return {
    selectedPagePlanCount: selectedPages.length,
    selectedPageCount: existingPageCount,
    missingSelectedPageCount: Math.max(0, selectedPages.length - existingPageCount),
    hasSelectionArtifacts: existingPageCount > 0
  };
}

async function statusForSingleWorksheet(projectDir, manifest) {
  const identity = projectIdentityFromManifest(manifest);
  const manifestCounts = countManifestWarnings(manifest);
  const contentCounts = await countContentWarnings(projectDir);
  const errors = manifestCounts.errors + contentCounts.errors;
  const warnings = manifestCounts.warnings + contentCounts.warnings;
  const runs = await readRunStates(projectDir);
  const latestRun = runs[runs.length - 1] || null;
  const approvalGate = await getApprovalState(projectDir);
  const approvedContent = await hasApprovedContent(projectDir);
  const draftContent = await hasDraftContent(projectDir);
  const approvedBrief = await hasApprovedBrief(projectDir);
  const draftBrief = await hasDraftBrief(projectDir);
  const exported = await hasExports(projectDir);
  const hasRenderedCandidates = runs.some((run) => run.hasRenderedCandidates);
  const hasPlannedCandidates = runs.some((run) => run.hasPlannedCandidates);
  const hasSelectionArtifacts = runs.some((run) => run.hasSelectionArtifacts && !run.hasErrors);
  const hasDownstreamArtifacts = exported || hasSelectionArtifacts || hasRenderedCandidates;
  const currentContentApproved = identity.isLegacy ? approvedContent : approvalGate.canGenerate;
  const effectiveBriefApproved = approvedBrief || (identity.isLegacy && draftBrief && hasDownstreamArtifacts);
  const effectiveContentApproved = currentContentApproved || (identity.isLegacy && draftContent && hasDownstreamArtifacts);
  const briefApprovalSource = approvedBrief ? "explicit" : effectiveBriefApproved ? "inferred_from_artifacts" : "none";
  const contentApprovalSource = currentContentApproved ? "explicit" : effectiveContentApproved ? "inferred_from_artifacts" : "none";

  let status = "draft";
  if (errors > 0) {
    status = "error";
  } else if (exported) {
    status = "exported";
  } else if (hasSelectionArtifacts) {
    status = "selected";
  } else if (hasRenderedCandidates || hasPlannedCandidates) {
    status = "has_candidates";
  } else if (currentContentApproved) {
    status = "ready_for_generation";
  } else if (draftContent) {
    status = "needs_approval";
  }

  const previewState = exported
    ? "export_available"
    : hasSelectionArtifacts
      ? "selection_available"
      : hasRenderedCandidates
        ? "candidate_preview_available"
        : hasPlannedCandidates
          ? "candidate_generation_pending"
          : "no_preview";
  const productStage = exported
    ? "export"
    : hasSelectionArtifacts || hasRenderedCandidates || hasPlannedCandidates
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
    hasExport: exported,
    candidateState: hasRenderedCandidates ? "rendered" : hasPlannedCandidates ? "planned" : "none",
    selectionState: hasSelectionArtifacts ? "rendered" : latestRun?.selectedCandidate ? "planned" : "none",
    previewState,
    approvalState: effectiveContentApproved ? "approved" : draftContent ? "draft" : "missing",
    workflow: {
      brief: effectiveBriefApproved ? "approved" : draftBrief ? "draft" : "missing",
      content: effectiveContentApproved ? "approved" : draftContent ? "draft" : "missing",
      candidates: hasRenderedCandidates ? "rendered" : hasPlannedCandidates ? "planned" : "missing",
      selection: hasSelectionArtifacts ? "rendered" : latestRun?.selectedCandidate ? "planned" : "missing",
      export: exported ? "rendered" : "missing"
    }
  };
}

async function statusForSeries(projectDir, manifest = {}) {
  const identity = projectIdentityFromManifest(manifest);
  const seriesManifest = await readJsonIfExists(path.join(projectDir, "series-manifest.json"));
  const worksheetDirs = await listDirs(path.join(projectDir, "worksheets"));
  const worksheetCount = Array.isArray(seriesManifest?.worksheets) ? seriesManifest.worksheets.length : worksheetDirs.length;
  const exported = await hasExports(projectDir);

  let status = "empty_series";
  if (exported) {
    status = "exported";
  } else if (worksheetCount > 0) {
    status = "in_progress";
  }
  const productStage = exported
    ? "export"
    : worksheetCount > 0
      ? "drafts"
      : "input";

  return {
    status,
    productStage,
    errors: 0,
    warnings: 0,
    sourceType: identity.sourceType,
    isLegacy: identity.isLegacy,
    worksheetCount,
    hasExport: exported
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
  if (projectType === "series") {
    return statusForSeries(projectDir, manifest);
  }
  if (projectType === "bundle") {
    const identity = projectIdentityFromManifest(manifest);
    const exported = await hasExports(projectDir);
    return {
      status: exported ? "exported" : "draft",
      productStage: exported ? "export" : "input",
      errors: 0,
      warnings: 0,
      sourceType: identity.sourceType,
      isLegacy: identity.isLegacy,
      hasExport: exported
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
