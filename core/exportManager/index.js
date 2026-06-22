"use strict";

const fs = require("node:fs/promises");
const path = require("node:path");
const {
  ARTIFACT_STATUSES,
  ARTIFACT_TYPES,
  EVENT_TYPES,
  PRODUCTION_SCHEMA_VERSION
} = require("../contracts");
const { appendEvent } = require("../eventLog");
const { appendHistoryEvent } = require("../historyManager");
const { registerArtifact } = require("../artifactManager");
const { assertCanGenerate } = require("../approvalManager");
const {
  conceptLabel,
  createdFromWithConcept,
  normalizeConceptReference
} = require("../conceptReference");
const { renderImagesToPdf } = require("../pdfRenderer");
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

async function listDirs(dirPath) {
  if (!(await pathExists(dirPath))) {
    return [];
  }
  const entries = await fs.readdir(dirPath, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

function safeFileName(value) {
  return String(value || "arbeitsblatt")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    || "arbeitsblatt";
}

function solutionPageFromContent(content = {}) {
  const tasks = Array.isArray(content.tasks) ? content.tasks : [];
  const answers = tasks
    .filter((task) => String(task.expectedAnswer || task.solution || "").trim())
    .map((task, index) => {
      const text = task.expectedAnswer || task.solution;
      return {
        label: `Aufgabe ${index + 1}`,
        text,
        normalizedText: String(text).replace(/^task_\d+:\s*/i, "").trim().toLowerCase()
      };
    });
  const answerTexts = new Set(answers.map((answer) => answer.normalizedText));
  const notes = (Array.isArray(content.solutionNotes) ? content.solutionNotes : [])
    .map((note) => String(note || "").trim())
    .filter(Boolean)
    .map((note) => note.replace(/^task_\d+:\s*/i, "").trim())
    .filter((note) => !answerTexts.has(note.toLowerCase()))
    .map((note) => ({ text: note }));
  if (!answers.length && !notes.length) {
    return null;
  }
  return {
    kind: "text",
    title: "Lösungsteil",
    sections: [
      answers.length ? {
        title: "Erwartete Antworten",
        items: answers.map(({ normalizedText, ...answer }) => answer)
      } : null,
      notes.length ? { title: "Hinweise", items: notes } : null
    ].filter(Boolean)
  };
}

async function nextExportId(projectDir, runId) {
  const baseId = `export_${runId}`;
  const existing = new Set(await listDirs(path.join(projectDir, "export")));
  if (!existing.has(baseId)) {
    return baseId;
  }
  let index = 2;
  while (existing.has(`${baseId}_${String(index).padStart(3, "0")}`)) {
    index += 1;
  }
  return `${baseId}_${String(index).padStart(3, "0")}`;
}

async function prepareWorksheetExport(projectDir, runId, options = {}) {
  const now = options.now || new Date().toISOString();
  await assertCanGenerate(projectDir);
  const project = await readJson(path.join(projectDir, "project-manifest.json"));
  const runDir = path.join(projectDir, "runs", runId);
  const runManifest = await readJson(path.join(runDir, "run-manifest.json"));
  const selectionPath = path.join(runDir, "selected", "selection.json");
  if (!(await pathExists(selectionPath))) {
    throw new Error(`Selection does not exist for run: ${runId}`);
  }

  const selection = await readJson(selectionPath);
  const pages = Array.isArray(selection.pages) ? selection.pages : [];
  if (pages.length === 0) {
    throw new Error("Selection has no pages to export.");
  }

  const selectedCandidateId = selection.selectedCandidate || runManifest.selectedCandidate || null;
  const selectedCandidate = (runManifest.candidates || []).find((candidate) => candidate.id === selectedCandidateId) || null;
  const candidateArtifactId = selection.basedOnCandidateId
    || (selectedCandidateId ? `${runId}_${selectedCandidateId}` : null);
  const concept = normalizeConceptReference(
    selection.concept || selectedCandidate?.concept || runManifest.concept || {},
    runManifest.sourceArtifacts || {}
  );
  const exportId = options.exportId || await nextExportId(projectDir, runId);
  const exportDir = path.join(projectDir, "export", exportId);
  const exportedPages = [];

  for (const page of pages) {
    const sourcePath = path.join(runDir, page.selectedPath);
    if (!(await pathExists(sourcePath))) {
      throw new Error(`Selected page file is missing: ${page.selectedPath}`);
    }
    const targetPath = path.join("pages", path.basename(page.selectedPath));
    await fs.mkdir(path.join(exportDir, "pages"), { recursive: true });
    await fs.copyFile(sourcePath, path.join(exportDir, targetPath));
    exportedPages.push({
      page: page.page,
      role: page.role,
      sourceCandidateId: page.sourceCandidateId || null,
      sourcePath: `runs/${runId}/${page.selectedPath}`,
      exportPath: `export/${exportId}/${targetPath}`,
      filePath: path.join(exportDir, targetPath)
    });
  }

  const includeSolutionSheet = options.includeSolutionSheet === true;
  const approvedContent = includeSolutionSheet
    ? await readJson(path.join(projectDir, "content", "approved.content-mirror.json"))
    : null;
  const solutionPage = approvedContent ? solutionPageFromContent(approvedContent) : null;
  const pdfPages = [
    ...exportedPages.map((page) => ({
      path: page.filePath,
      role: page.role
    })),
    ...(solutionPage ? [solutionPage] : [])
  ];

  const pdfFileName = `${safeFileName(project.title || "arbeitsblatt")}.pdf`;
  const pdfRelativePath = `export/${exportId}/${pdfFileName}`;
  const pdfResult = await renderImagesToPdf({
    pages: pdfPages,
    outputPath: path.join(projectDir, pdfRelativePath),
    title: project.title || "Arbeitsblatt Export"
  });
  const manifestPages = exportedPages.map(({ filePath, ...page }) => page);
  if (solutionPage) {
    manifestPages.push({
      page: manifestPages.length + 1,
      role: "solution",
      sourcePath: "content/approved.content-mirror.json",
      exportPath: pdfRelativePath
    });
  }

  const exportManifest = {
    schemaVersion: PRODUCTION_SCHEMA_VERSION,
    exportId,
    runId,
    status: "pdf_ready",
    createdAt: now,
    selectedCandidate: selectedCandidateId,
    basedOnCandidateId: candidateArtifactId,
    basedOnConceptId: concept.conceptId,
    basedOnConceptVersion: concept.conceptVersion,
    concept,
    pages: manifestPages,
    solutionSheet: {
      requested: includeSolutionSheet,
      included: Boolean(solutionPage)
    },
    pdf: {
      path: pdfRelativePath,
      pageCount: pdfResult.pageCount,
      size: pdfResult.size
    }
  };

  await writeJson(path.join(exportDir, "export-manifest.json"), exportManifest);

  const artifactId = exportId;
  await registerArtifact(projectDir, {
    id: artifactId,
    type: ARTIFACT_TYPES.EXPORT,
    path: `export/${exportId}/export-manifest.json`,
    status: ARTIFACT_STATUSES.EXPORTED,
    step: "export",
    createdAt: now,
    createdFrom: createdFromWithConcept([selection.artifactId || `selection_${runId}`, candidateArtifactId], concept)
  }, { now });
  await registerArtifact(projectDir, {
    id: `${exportId}_pdf`,
    type: ARTIFACT_TYPES.PDF,
    path: pdfRelativePath,
    status: ARTIFACT_STATUSES.EXPORTED,
    step: "export",
    createdAt: now,
    createdFrom: createdFromWithConcept([artifactId], concept)
  }, { now });

  await appendEvent(projectDir, {
    type: EVENT_TYPES.EXPORT_CREATED,
    createdAt: now,
    step: "export",
    runId,
    artifactId,
    payload: {
      exportId,
      pageCount: pdfResult.pageCount,
      pdfPath: pdfRelativePath,
      status: exportManifest.status,
      selectedCandidate: selectedCandidateId,
      basedOnCandidateId: candidateArtifactId,
      basedOnConceptId: concept.conceptId,
      basedOnConceptVersion: concept.conceptVersion,
      concept
    }
  });
  const assistantMessage = await narrateChatMoment(projectDir, {
    kind: "export_created",
    fallback: `PDF ist fertig. Grundlage: ${selectedCandidateId || "Auswahl"} - ${conceptLabel(concept)}.`,
    export: {
      exportId,
      pageCount: pdfResult.pageCount,
      selectedCandidateId,
      conceptLabel: conceptLabel(concept),
      includeSolutionSheet: options.includeSolutionSheet === true
    }
  }, {
    now,
    uiEvent: "export_created"
  });
  await appendEvent(projectDir, {
    type: EVENT_TYPES.ASSISTANT_MESSAGE,
    createdAt: now,
    step: "export",
    payload: {
      message: assistantMessage,
      mode: "narration",
      suggestedActions: []
    }
  });
  await appendHistoryEvent(projectDir, {
    type: "pdf_export_created",
    createdAt: now,
    runId,
    exportId,
    pageCount: manifestPages.length,
    pdfPath: pdfRelativePath,
    selectedCandidate: selectedCandidateId,
    basedOnCandidateId: candidateArtifactId,
    basedOnConceptId: concept.conceptId,
    basedOnConceptVersion: concept.conceptVersion,
    concept
  });
  await updateRunAnalysisReport(projectDir, runId, { now });

  return exportManifest;
}

module.exports = {
  prepareWorksheetExport
};
