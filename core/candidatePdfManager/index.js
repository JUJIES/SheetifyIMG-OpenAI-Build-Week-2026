"use strict";

// Legacy/internal cache helper. Normal candidate generation stores image files
// only; worksheet PDFs are created through worksheetLibraryManager when the
// user explicitly uses "Arbeitsblatt ablegen".
const fs = require("node:fs/promises");
const path = require("node:path");
const {
  ARTIFACT_STATUSES,
  ARTIFACT_TYPES
} = require("../contracts");
const {
  findArtifact,
  readArtifactIndex,
  registerArtifact,
  updateArtifact
} = require("../artifactManager");
const { appendHistoryEvent } = require("../historyManager");
const {
  createdFromWithConcept,
  normalizeConceptReference
} = require("../conceptReference");
const {
  DEFAULT_PRINT_SAFE_MARGIN_MM,
  normalizePrintSafeMarginMm,
  renderImagesToPdf
} = require("../pdfRenderer");
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

function safeFileName(value) {
  return String(value || "candidate")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    || "candidate";
}

function candidatePdfPath(candidateId) {
  return `candidates/${safeFileName(candidateId)}.pdf`;
}

async function updateCandidatePdfState(projectDir, runId, candidateId, pdf, options = {}) {
  const now = options.now || new Date().toISOString();
  const manifestPath = path.join(projectDir, "runs", runId, "run-manifest.json");
  const manifest = await readJson(manifestPath);
  let updatedCandidate = null;
  manifest.candidates = (manifest.candidates || []).map((candidate) => {
    if (candidate.id !== candidateId) {
      return candidate;
    }
    updatedCandidate = {
      ...candidate,
      pdf
    };
    return updatedCandidate;
  });
  if (!updatedCandidate) {
    throw new Error(`Candidate does not exist in run manifest: ${candidateId}`);
  }
  manifest.outputs = {
    ...(manifest.outputs || {}),
    candidatePdfs: {
      ...(manifest.outputs?.candidatePdfs || {}),
      [candidateId]: pdf.path || null
    }
  };
  manifest.updatedAt = now;
  await writeJson(manifestPath, manifest);
  return updatedCandidate;
}

async function upsertPdfArtifact(projectDir, artifact, options = {}) {
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

async function createCandidatePdf(projectDir, runId, candidateId, options = {}) {
  const now = options.now || new Date().toISOString();
  const printSafeMarginMm = normalizePrintSafeMarginMm(
    options.printSafeMarginMm ?? DEFAULT_PRINT_SAFE_MARGIN_MM
  );
  const runDir = path.join(projectDir, "runs", runId);
  const project = await readJson(path.join(projectDir, "project-manifest.json"));
  const manifest = await readJson(path.join(runDir, "run-manifest.json"));
  const candidate = (manifest.candidates || []).find((entry) => entry.id === candidateId) || null;
  if (!candidate) {
    throw new Error(`Candidate does not exist in run manifest: ${candidateId}`);
  }

  const sourcePages = [];
  for (const page of candidate.pages || []) {
    const filePath = page.path ? path.join(runDir, page.path) : null;
    if (filePath && await pathExists(filePath)) {
      sourcePages.push({
        page: page.page,
        role: page.role,
        path: filePath,
        sourcePath: page.path
      });
    }
  }
  if (!sourcePages.length) {
    throw new Error(`Candidate has no rendered pages: ${candidateId}`);
  }

  const pdfRelativePath = candidatePdfPath(candidateId);
  const pdfResult = await renderImagesToPdf({
    pages: sourcePages.map((page) => ({
      path: page.path,
      role: page.role
    })),
    outputPath: path.join(runDir, pdfRelativePath),
    title: `${project.title || "SheetifyIMG"} - ${candidateId}`,
    printSafeMarginMm
  });
  const concept = normalizeConceptReference(candidate.concept || manifest.concept || {}, manifest.sourceArtifacts || {});
  const pdf = {
    status: "pdf_ready",
    path: pdfRelativePath,
    createdAt: now,
    pageCount: pdfResult.pageCount,
    size: pdfResult.size,
    printSafeMarginMm,
    sourcePages: sourcePages.map(({ path: _absolutePath, ...page }) => page)
  };

  await updateCandidatePdfState(projectDir, runId, candidateId, pdf, { now });
  await upsertPdfArtifact(projectDir, {
    id: `${runId}_${candidateId}_pdf`,
    type: ARTIFACT_TYPES.PDF,
    path: `runs/${runId}/${pdfRelativePath}`,
    status: ARTIFACT_STATUSES.CURRENT,
    step: "entwuerfe",
    createdAt: now,
    createdFrom: createdFromWithConcept([`${runId}_${candidateId}`], concept)
  }, { now });
  await appendHistoryEvent(projectDir, {
    type: "candidate_pdf_created",
    createdAt: now,
    runId,
    candidateId,
    pageCount: pdf.pageCount,
    pdfPath: `runs/${runId}/${pdfRelativePath}`,
    basedOnConceptId: concept.conceptId,
    basedOnConceptVersion: concept.conceptVersion,
    concept
  });

  return pdf;
}

async function recordCandidatePdfError(projectDir, runId, candidateId, error, options = {}) {
  const now = options.now || new Date().toISOString();
  const pdf = {
    status: "error",
    path: candidatePdfPath(candidateId),
    createdAt: now,
    error: error?.message || String(error || "PDF could not be created.")
  };
  return updateCandidatePdfState(projectDir, runId, candidateId, pdf, { now });
}

module.exports = {
  createCandidatePdf,
  recordCandidatePdfError
};
