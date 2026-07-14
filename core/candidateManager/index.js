"use strict";

const fs = require("node:fs/promises");
const path = require("node:path");
const {
  ARTIFACT_STATUSES,
  ARTIFACT_TYPES,
  EVENT_TYPES
} = require("../contracts");
const { appendEvent } = require("../eventLog");
const { appendHistoryEvent } = require("../historyManager");
const { registerArtifact } = require("../artifactManager");
const { candidateDisplayLabelForProject } = require("../candidateDisplay");
const {
  createdFromWithConcept,
  normalizeConceptReference
} = require("../conceptReference");
const { presentWorkflowEvent } = require("../chatEventPresenter");
const { updateRunAnalysisReport } = require("../runAnalysisManager");
const { writeJsonFile } = require("../jsonFile");

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
  await writeJsonFile(filePath, value);
}

function normalizePages(pages = []) {
  return pages.map((page, index) => ({
    page: page.page ?? index + 1,
    role: page.role || "page",
    path: page.path,
    assetId: page.assetId || null,
    prompt: page.prompt || null,
    format: page.format || null,
    width: page.width || null,
    height: page.height || null
  }));
}

async function registerCandidate(projectDir, runId, candidate, options = {}) {
  const now = options.now || new Date().toISOString();
  const runDir = path.join(projectDir, "runs", runId);
  const manifestPath = path.join(runDir, "run-manifest.json");
  const manifest = await readJson(manifestPath);
  const candidateId = candidate.id;
  if (!candidateId) {
    throw new Error("Candidate id is required.");
  }
  if ((manifest.candidates || []).some((entry) => entry.id === candidateId)) {
    throw new Error(`Candidate already exists: ${candidateId}`);
  }

  const pages = normalizePages(candidate.pages || []);
  if (pages.length === 0) {
    throw new Error("Candidate pages are required.");
  }

  const status = candidate.status || "pending_generation";
  if (status !== "pending_generation") {
    for (const page of pages) {
      if (!page.path || !(await pathExists(path.join(runDir, page.path)))) {
        throw new Error(`Candidate page file is missing: ${page.path}`);
      }
    }
  }

  const concept = normalizeConceptReference(candidate.concept || manifest.concept || {}, manifest.sourceArtifacts || {});
  const nextCandidate = {
    id: candidateId,
    status,
    pages,
    sourceArtifacts: candidate.sourceArtifacts || manifest.sourceArtifacts || {},
    concept,
    basedOnConceptId: concept.conceptId,
    basedOnConceptVersion: concept.conceptVersion,
    notes: Array.isArray(candidate.notes) ? candidate.notes : [],
    generation: candidate.generation || null,
    createdAt: now
  };

  manifest.candidates = [...(manifest.candidates || []), nextCandidate];
  manifest.status = "has_candidates";
  manifest.updatedAt = now;
  await writeJson(manifestPath, manifest);

  const artifactId = `${runId}_${candidateId}`;
  await registerArtifact(projectDir, {
    id: artifactId,
    type: ARTIFACT_TYPES.CANDIDATE,
    path: `runs/${runId}/run-manifest.json`,
    status: status === "pending_generation" ? ARTIFACT_STATUSES.DRAFT : ARTIFACT_STATUSES.CURRENT,
    step: "entwuerfe",
    createdAt: now,
    createdFrom: createdFromWithConcept([runId], concept),
    thumbnailPath: pages[0]?.path ? `runs/${runId}/${pages[0].path}` : null
  }, { now });

  const displayLabel = await candidateDisplayLabelForProject(projectDir, runId, candidateId);
  const visibleMessage = presentWorkflowEvent({
    kind: "candidate_created",
    candidate: {
      id: candidateId,
      displayLabel,
      pageCount: pages.length
    }
  });

  await appendEvent(projectDir, {
    type: EVENT_TYPES.CANDIDATE_CREATED,
    createdAt: now,
    step: "entwuerfe",
    runId,
    artifactId,
    payload: {
      candidateId,
      pageCount: pages.length,
      status,
      concept,
      basedOnConceptId: concept.conceptId,
      basedOnConceptVersion: concept.conceptVersion,
      displayLabel,
      message: visibleMessage || candidate.chatMessage || null
    }
  });
  await appendHistoryEvent(projectDir, {
    type: "candidate_registered",
    createdAt: now,
    runId,
    candidateId,
    pageCount: pages.length,
    status,
    concept,
    basedOnConceptId: concept.conceptId,
    basedOnConceptVersion: concept.conceptVersion,
    displayLabel
  });
  await updateRunAnalysisReport(projectDir, runId, { now });

  return nextCandidate;
}

module.exports = {
  registerCandidate
};
