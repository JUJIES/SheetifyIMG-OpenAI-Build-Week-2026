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
  findArtifact,
  readArtifactIndex,
  registerArtifact,
  updateArtifact
} = require("../artifactManager");
const { appendEvent } = require("../eventLog");
const { appendHistoryEvent } = require("../historyManager");
const {
  conceptLabel,
  createdFromWithConcept,
  normalizeConceptReference
} = require("../conceptReference");
const { narrateChatMoment } = require("../chatNarrationManager");
const { updateRunAnalysisReport } = require("../runAnalysisManager");

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

function toPosix(value) {
  return String(value).split(path.sep).join("/");
}

function rel(from, to) {
  return toPosix(path.relative(from, to));
}

function pageKey(page) {
  return `page_${Number(page) || 0}`;
}

function findCandidate(manifest, candidateId) {
  return (manifest.candidates || []).find((candidate) => candidate.id === candidateId) || null;
}

function candidateArtifactIdFor(runId, candidateId) {
  return candidateId ? `${runId}_${candidateId}` : null;
}

function selectedPagesFromManifest(manifest) {
  const selectedPages = manifest.selectedPages || {};
  return Object.entries(selectedPages)
    .filter(([, selectedPath]) => typeof selectedPath === "string" && selectedPath.trim())
    .map(([key, selectedPath]) => ({
      page: Number(String(key).match(/(\d+)/)?.[1] || 0),
      selectedPath,
      sourcePath: null,
      role: null
    }));
}

function selectedPagesFromCandidate(candidate) {
  return (candidate?.pages || []).map((page) => ({
    page: page.page,
    role: page.role,
    sourceCandidateId: candidate.id,
    sourcePath: page.path,
    selectedPath: `selected/page_${page.page}.selected${path.extname(page.path) || ".png"}`
  }));
}

function normalizeSelectionPages(selection, manifest, candidate) {
  if (Array.isArray(selection?.pages) && selection.pages.length > 0) {
    return selection.pages.map((page) => ({
      page: page.page,
      role: page.role || candidate?.pages?.find((candidatePage) => candidatePage.page === page.page)?.role || null,
      selectedPath: page.selectedPath,
      sourcePath: page.sourcePath || candidate?.pages?.find((candidatePage) => candidatePage.page === page.page)?.path || null,
      sourceCandidateId: page.sourceCandidateId || page.candidateId || candidate?.id || null
    }));
  }

  const manifestPages = selectedPagesFromManifest(manifest);
  if (manifestPages.length > 0) {
    return manifestPages.map((page) => ({
      ...page,
      role: candidate?.pages?.find((candidatePage) => candidatePage.page === page.page)?.role || page.role,
      sourcePath: candidate?.pages?.find((candidatePage) => candidatePage.page === page.page)?.path || page.sourcePath
    }));
  }

  return [];
}

function pagesForSelection(candidate, requestedPages) {
  if (!candidate) {
    throw new Error("Candidate is required.");
  }

  const candidatePages = Array.isArray(candidate.pages) ? candidate.pages : [];
  if (candidatePages.length === 0) {
    throw new Error(`Candidate has no pages: ${candidate.id}`);
  }

  if (!Array.isArray(requestedPages) || requestedPages.length === 0) {
    return selectedPagesFromCandidate(candidate);
  }

  const byPage = new Map(candidatePages.map((page) => [Number(page.page), page]));
  return requestedPages.map((entry) => {
    const pageOverride = entry && typeof entry === "object" ? entry : null;
    const pageNumber = typeof entry === "number" ? entry : Number(pageOverride?.page);
    const candidatePage = byPage.get(pageNumber);
    if (!candidatePage) {
      throw new Error(`Candidate page does not exist: ${pageNumber}`);
    }

    const sourcePath = pageOverride?.sourcePath
      ? pageOverride.sourcePath
      : candidatePage.path;
    return {
      page: candidatePage.page,
      role: pageOverride?.role || candidatePage.role || null,
      sourceCandidateId: pageOverride?.candidateId || pageOverride?.sourceCandidateId || candidate.id,
      sourcePath,
      selectedPath: pageOverride?.selectedPath
        || `selected/page_${candidatePage.page}.selected${path.extname(sourcePath) || ".png"}`
    };
  });
}

function pagesForMixedSelection(manifest, defaultCandidate, requestedPages) {
  if (!Array.isArray(requestedPages) || requestedPages.length === 0) {
    return pagesForSelection(defaultCandidate, requestedPages);
  }

  return requestedPages.map((entry) => {
    const pageOverride = entry && typeof entry === "object" ? entry : {};
    const pageNumber = typeof entry === "number" ? entry : Number(pageOverride.page);
    const sourceCandidateId = pageOverride.candidateId || pageOverride.sourceCandidateId || defaultCandidate?.id;
    const sourceCandidate = findCandidate(manifest, sourceCandidateId);
    if (!sourceCandidate) {
      throw new Error(`Candidate does not exist in run manifest: ${sourceCandidateId}`);
    }
    const candidatePage = (sourceCandidate.pages || []).find((page) => Number(page.page) === pageNumber);
    if (!candidatePage) {
      throw new Error(`Candidate page does not exist: ${sourceCandidateId} page ${pageNumber}`);
    }
    const sourcePath = pageOverride.sourcePath || candidatePage.path;
    return {
      page: candidatePage.page,
      role: pageOverride.role || candidatePage.role || null,
      sourceCandidateId: sourceCandidate.id,
      sourcePath,
      selectedPath: pageOverride.selectedPath || `selected/page_${candidatePage.page}.selected${path.extname(sourcePath) || ".png"}`
    };
  });
}

function mergeSelectionPages(currentPages = [], replacementPages = []) {
  const byPage = new Map();
  for (const page of currentPages) {
    byPage.set(Number(page.page), page);
  }
  for (const page of replacementPages) {
    byPage.set(Number(page.page), page);
  }
  return [...byPage.values()].sort((left, right) => Number(left.page) - Number(right.page));
}

function sourceCandidateIdsForPages(pages = [], fallback = null) {
  return [...new Set(pages.map((page) => page.sourceCandidateId || fallback).filter(Boolean))];
}

async function copySelectedPages({ runDir, pages, errors }) {
  const copiedPages = [];

  for (const page of pages) {
    if (!page.sourcePath) {
      errors.push({
        code: "selected_page_source_missing",
        message: `Selected page ${pageKey(page.page)} has no sourcePath.`
      });
      continue;
    }
    if (!page.selectedPath) {
      errors.push({
        code: "selected_page_target_missing",
        message: `Selected page ${pageKey(page.page)} has no selectedPath.`
      });
      continue;
    }

    const sourcePath = path.join(runDir, page.sourcePath);
    const targetPath = path.join(runDir, page.selectedPath);
    if (!(await pathExists(sourcePath))) {
      errors.push({
        code: "selected_page_source_not_found",
        message: `Selected source does not exist: ${page.sourcePath}`
      });
      continue;
    }

    await fs.mkdir(path.dirname(targetPath), { recursive: true });
    await fs.copyFile(sourcePath, targetPath);
    copiedPages.push({
      page: page.page,
      role: page.role,
      selectedPath: page.selectedPath,
      sourcePath: page.sourcePath,
      sourceCandidateId: page.sourceCandidateId || null
    });
  }

  return copiedPages;
}

async function appendHistory(projectDir, event) {
  const historyPath = path.join(projectDir, "history", "worksheet-history.jsonl");
  await fs.mkdir(path.dirname(historyPath), { recursive: true });
  await fs.appendFile(historyPath, `${JSON.stringify(event)}\n`, "utf8");
}

async function upsertSelectionArtifact(projectDir, artifact, options) {
  const index = await readArtifactIndex(projectDir);
  if (findArtifact(index, artifact.id)) {
    return updateArtifact(projectDir, artifact.id, {
      path: artifact.path,
      status: artifact.status,
      step: artifact.step,
      createdFrom: artifact.createdFrom
    }, options);
  }
  return registerArtifact(projectDir, artifact, options);
}

async function selectCandidate({ projectDir, runId, candidateId, pages, merge = false, now = new Date().toISOString() }) {
  const runDir = path.join(projectDir, "runs", runId);
  const manifestPath = path.join(runDir, "run-manifest.json");
  const selectionPath = path.join(runDir, "selected", "selection.json");
  const manifest = await readJson(manifestPath);
  const previousSelection = (await pathExists(selectionPath)) ? await readJson(selectionPath) : null;
  const candidate = findCandidate(manifest, candidateId);
  if (!candidate) {
    throw new Error(`Candidate does not exist in run manifest: ${candidateId}`);
  }

  const requestedSelectionPages = pagesForMixedSelection(manifest, candidate, pages);
  const previousPages = merge
    ? normalizeSelectionPages(previousSelection, manifest, findCandidate(manifest, previousSelection?.selectedCandidate) || candidate)
    : [];
  const selectionPages = mergeSelectionPages(previousPages, requestedSelectionPages);
  const errors = [];
  const copiedPages = await copySelectedPages({ runDir, pages: selectionPages, errors });
  if (errors.length > 0 || copiedPages.length !== selectionPages.length) {
    const messages = errors.map((error) => error.message).join("; ");
    throw new Error(`Selection could not be copied cleanly: ${messages}`);
  }

  const artifactId = `selection_${runId}`;
  const sourceCandidateIds = sourceCandidateIdsForPages(copiedPages, candidateId);
  const isMixedSelection = sourceCandidateIds.length > 1;
  const selectedCandidateId = isMixedSelection ? "mixed" : sourceCandidateIds[0] || candidateId;
  const candidateArtifactId = isMixedSelection
    ? sourceCandidateIds.map((id) => candidateArtifactIdFor(runId, id)).join("+")
    : candidateArtifactIdFor(runId, selectedCandidateId);
  const concept = normalizeConceptReference(candidate.concept || manifest.concept || {}, manifest.sourceArtifacts || {});
  const selection = {
    schemaVersion: PRODUCTION_SCHEMA_VERSION,
    artifactId,
    runId,
    selectedAt: now,
    selectedCandidate: selectedCandidateId,
    sourceCandidateIds,
    basedOnCandidateId: candidateArtifactId,
    basedOnConceptId: concept.conceptId,
    basedOnConceptVersion: concept.conceptVersion,
    concept,
    pages: copiedPages,
    status: ARTIFACT_STATUSES.SELECTED,
    errors: [],
    warnings: []
  };

  await writeJson(selectionPath, selection);

  const nextManifest = {
    ...manifest,
    status: "selected",
    selectedCandidate: selectedCandidateId,
    selectedCandidateConcept: concept,
    selectedPages: Object.fromEntries(copiedPages.map((page) => [pageKey(page.page), page.selectedPath])),
    outputs: {
      ...(manifest.outputs || {}),
      selection: "selected/selection.json"
    },
    updatedAt: now
  };
  await writeJson(manifestPath, nextManifest);

  await upsertSelectionArtifact(projectDir, {
    id: artifactId,
    type: ARTIFACT_TYPES.SELECTION,
    path: `runs/${runId}/selected/selection.json`,
    status: ARTIFACT_STATUSES.SELECTED,
    step: "auswahl",
    createdAt: now,
    createdFrom: createdFromWithConcept(sourceCandidateIds.map((id) => candidateArtifactIdFor(runId, id)), concept)
  }, { now });

  await appendEvent(projectDir, {
    type: EVENT_TYPES.CANDIDATE_SELECTED,
    createdAt: now,
    step: "auswahl",
    runId,
    artifactId,
    payload: {
      candidateId: selectedCandidateId,
      sourceCandidateIds,
      pageCount: copiedPages.length,
      concept,
      basedOnCandidateId: candidateArtifactId,
      basedOnConceptId: concept.conceptId,
      basedOnConceptVersion: concept.conceptVersion
    }
  });
  const suggestedActions = [
    {
      command: "prepare_export",
      label: "PDF ohne Lösungsblatt",
      payload: { runId }
    },
    {
      command: "prepare_export",
      label: "PDF mit Lösungsblatt",
      payload: { runId, includeSolutionSheet: true }
    }
  ];
  const selectionLabel = isMixedSelection
    ? `Die Auswahl ist jetzt aus ${sourceCandidateIds.length} Kandidaten zusammengesetzt`
    : `Kandidat ${selectedCandidateId} ist jetzt die Auswahl`;
  const assistantMessage = await narrateChatMoment(projectDir, {
    kind: "candidate_selected",
    fallback: `${selectionLabel}. Grundlage: ${conceptLabel(concept)}. Soll ich daraus ein PDF erstellen - ohne oder mit Lösungsblatt?`,
    selection: {
      runId,
      candidateId: selectedCandidateId,
      sourceCandidateIds,
      pageCount: copiedPages.length,
      conceptLabel: conceptLabel(concept)
    },
    suggestedActions
  }, {
    now,
    uiEvent: "candidate_selected"
  });
  await appendEvent(projectDir, {
    type: EVENT_TYPES.ASSISTANT_MESSAGE,
    createdAt: now,
    step: "auswahl",
    payload: {
      message: assistantMessage,
      mode: "narration",
      suggestedActions
    }
  });
  await appendHistoryEvent(projectDir, {
    type: "candidate_selected",
    createdAt: now,
    runId,
    candidateId: selectedCandidateId,
    sourceCandidateIds,
    pageCount: copiedPages.length,
    concept,
    basedOnCandidateId: candidateArtifactId,
    basedOnConceptId: concept.conceptId,
    basedOnConceptVersion: concept.conceptVersion
  });
  await updateRunAnalysisReport(projectDir, runId, { now });

  return selection;
}

async function rebuildSelectionForRun({ projectDir, runDir, now = new Date().toISOString() }) {
  const manifestPath = path.join(runDir, "run-manifest.json");
  const selectionPath = path.join(runDir, "selected", "selection.json");
  const runRelativePath = rel(projectDir, runDir);
  const errors = [];
  const warnings = [];

  if (!(await pathExists(manifestPath))) {
    return {
      run: runRelativePath,
      status: "error",
      errors: [{ code: "run_manifest_missing", message: "run-manifest.json is missing." }],
      warnings,
      copiedPages: []
    };
  }

  const manifest = await readJson(manifestPath);
  const selection = (await pathExists(selectionPath)) ? await readJson(selectionPath) : null;
  const selectedCandidate = selection?.selectedCandidate || manifest.selectedCandidate || null;

  if (!selectedCandidate) {
    warnings.push({
      code: "no_selected_candidate",
      message: "No selected candidate is set."
    });
    const nextSelection = {
      selectedAt: selection?.selectedAt || null,
      selectedCandidate: null,
      pages: [],
      rebuiltAt: now,
      status: "not_selected",
      errors: [],
      warnings
    };
    await writeJson(selectionPath, nextSelection);
    return {
      run: runRelativePath,
      status: "not_selected",
      errors,
      warnings,
      copiedPages: []
    };
  }

  const candidate = selectedCandidate === "mixed" ? null : findCandidate(manifest, selectedCandidate);
  if (!candidate && selectedCandidate !== "mixed") {
    errors.push({
      code: "selected_candidate_not_found",
      message: `Selected candidate does not exist in run manifest: ${selectedCandidate}`
    });
  }

  const pages = normalizeSelectionPages(selection, manifest, candidate);
  if (pages.length === 0) {
    errors.push({
      code: "selected_candidate_without_pages",
      message: "Selected candidate exists, but no selected pages are defined."
    });
  }

  const copiedPages = (candidate || selectedCandidate === "mixed") ? await copySelectedPages({ runDir, pages, errors }) : [];
  const status = errors.length > 0 ? "error" : "rebuilt";
  const concept = normalizeConceptReference(selection?.concept || candidate?.concept || manifest.concept || {}, manifest.sourceArtifacts || {});
  const sourceCandidateIds = selection?.sourceCandidateIds || sourceCandidateIdsForPages(copiedPages, selectedCandidate === "mixed" ? null : selectedCandidate);
  const candidateArtifactId = selection?.basedOnCandidateId || (
    selectedCandidate === "mixed"
      ? sourceCandidateIds.map((id) => candidateArtifactIdFor(manifest.runId || path.basename(runDir), id)).join("+")
      : selectedCandidate ? `${manifest.runId || path.basename(runDir)}_${selectedCandidate}` : null
  );

  const nextSelection = {
    selectedAt: selection?.selectedAt || now,
    selectedCandidate,
    sourceCandidateIds,
    basedOnCandidateId: candidateArtifactId,
    basedOnConceptId: concept.conceptId,
    basedOnConceptVersion: concept.conceptVersion,
    concept,
    pages: copiedPages,
    rebuiltAt: now,
    status,
    errors,
    warnings
  };
  await writeJson(selectionPath, nextSelection);

  const nextManifest = {
    ...manifest,
    selectedCandidate,
    selectedCandidateConcept: concept,
    selectedPages: Object.fromEntries(copiedPages.map((page) => [pageKey(page.page), page.selectedPath]))
  };
  await writeJson(manifestPath, nextManifest);

  await appendHistory(projectDir, {
    type: "selection_rebuilt",
    createdAt: now,
    run: runRelativePath,
    selectedCandidate,
    status,
    copiedPageCount: copiedPages.length,
    errorCount: errors.length,
    warningCount: warnings.length
  });

  return {
    run: runRelativePath,
    status,
    selectedCandidate,
    errors,
    warnings,
    copiedPages
  };
}

async function listRunDirs(projectDir) {
  const runsDir = path.join(projectDir, "runs");
  if (!(await pathExists(runsDir))) {
    return [];
  }

  const entries = await fs.readdir(runsDir, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(runsDir, entry.name))
    .sort();
}

async function rebuildSelectionsForProject({ projectDir, now = new Date().toISOString() }) {
  const runDirs = await listRunDirs(projectDir);
  const runs = [];

  for (const runDir of runDirs) {
    runs.push(await rebuildSelectionForRun({ projectDir, runDir, now }));
  }

  return {
    project: path.basename(projectDir),
    runCount: runDirs.length,
    runs
  };
}

module.exports = {
  rebuildSelectionForRun,
  rebuildSelectionsForProject,
  selectCandidate
};
