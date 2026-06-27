"use strict";

const fs = require("node:fs/promises");
const path = require("node:path");
const { PRODUCTION_SCHEMA_VERSION } = require("../contracts");
const { readEvents } = require("../eventLog");
const { readJsonFileIfExists, writeJsonFile } = require("../jsonFile");

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

async function readJsonIfExists(filePath) {
  return readJsonFileIfExists(filePath);
}

async function writeJson(filePath, value) {
  await writeJsonFile(filePath, value);
}

async function writeText(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, value, "utf8");
}

function rel(projectDir, filePath) {
  return path.relative(projectDir, filePath).split(path.sep).join("/");
}

function truncate(value, max = 280) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  return text.length > max ? `${text.slice(0, max - 1)}...` : text;
}

function pageAssetPath(page = {}) {
  if (!page.path) {
    return null;
  }
  return page.path.replace(/\.(png|jpe?g|webp)$/i, ".asset.json");
}

async function candidatePageSummary(runDir, page = {}) {
  const absolutePath = page.path ? path.join(runDir, page.path) : null;
  const assetPath = pageAssetPath(page);
  const asset = assetPath ? await readJsonIfExists(path.join(runDir, assetPath)) : null;
  return {
    page: page.page || null,
    role: page.role || null,
    path: page.path || null,
    exists: absolutePath ? await pathExists(absolutePath) : false,
    asset: assetPath ? {
      path: assetPath,
      exists: Boolean(asset),
      byteLength: asset?.byteLength || null,
      metadata: asset?.metadata ? {
        provider: asset.metadata.provider || null,
        model: asset.metadata.model || null,
        generationMode: asset.metadata.generationMode || null,
        qualityPreset: asset.metadata.qualityPreset || null,
        quality: asset.metadata.quality || null,
        requestedSize: asset.metadata.requestedSize || asset.metadata.size || null,
        durationMs: asset.metadata.durationMs || null,
        usage: asset.metadata.usage || null,
        referenceImages: asset.metadata.referenceImages || []
      } : null
    } : null,
    prompt: page.prompt ? {
      inline: true,
      excerpt: truncate(page.prompt, 600)
    } : null
  };
}

async function candidateSummary(runDir, candidate = {}) {
  const qcPath = `qc/${candidate.id}.technical-qc.json`;
  const qc = await readJsonIfExists(path.join(runDir, qcPath));
  return {
    id: candidate.id || null,
    status: candidate.status || null,
    createdAt: candidate.createdAt || null,
    concept: candidate.concept || null,
    generation: candidate.generation ? {
      provider: candidate.generation.provider || null,
      model: candidate.generation.model || null,
      generationMode: candidate.generation.generationMode || null,
      imageSpecProposalId: candidate.generation.imageSpecProposalId || null,
      plannedPageCount: candidate.generation.plannedPageCount || candidate.generation.pageCount || null,
      generatedPageCount: candidate.generation.generatedPageCount || (candidate.pages || []).length,
      generatedPages: candidate.generation.generatedPages || (candidate.pages || []).map((page) => page.page),
      qualityPreset: candidate.generation.qualityPreset || null,
      quality: candidate.generation.quality || null,
      variantInstruction: candidate.generation.variantInstruction || null,
      referencePolicy: candidate.generation.referencePolicy || null,
      referenceImages: candidate.generation.referenceImages || []
    } : null,
    notes: candidate.notes || [],
    pages: await Promise.all((candidate.pages || []).map((page) => candidatePageSummary(runDir, page))),
    qc: qc ? {
      path: qcPath,
      status: qc.status || null,
      errorCount: qc.errorCount || 0,
      warningCount: qc.warningCount || 0,
      contentFidelity: qc.contentFidelity || null
    } : {
      path: qcPath,
      status: "missing"
    }
  };
}

function collectDiagnostics(report) {
  const errors = [];
  const warnings = [];
  const notes = [];

  if (!report.candidates.length) {
    notes.push({ code: "no_candidates_yet", message: "Run exists, but no candidate has been registered yet." });
  }

  for (const candidate of report.candidates) {
    const planned = Number(candidate.generation?.plannedPageCount || 0);
    const generated = Number(candidate.generation?.generatedPageCount || candidate.pages.length || 0);
    if (planned && generated && generated < planned) {
      warnings.push({
        code: "partial_candidate_generation",
        candidateId: candidate.id,
        message: `Candidate generated ${generated} of ${planned} planned pages.`
      });
    }
    if (candidate.generation?.referencePolicy?.level && candidate.generation.referencePolicy.level !== "none") {
      const refs = candidate.generation.referenceImages || [];
      if (!refs.length) {
        warnings.push({
          code: "reference_policy_without_reference_images",
          candidateId: candidate.id,
          message: "Reference policy is active, but the candidate has no referenceImages recorded."
        });
      }
    }
    for (const page of candidate.pages || []) {
      if (!page.exists) {
        errors.push({
          code: "candidate_page_missing",
          candidateId: candidate.id,
          page: page.page,
          message: `Candidate page file is missing: ${page.path || "unknown"}`
        });
      }
      if (page.asset && !page.asset.exists) {
        warnings.push({
          code: "candidate_asset_metadata_missing",
          candidateId: candidate.id,
          page: page.page,
          message: `Asset metadata is missing: ${page.asset.path}`
        });
      }
    }
    if (candidate.qc?.status === "missing") {
      warnings.push({
        code: "technical_qc_missing",
        candidateId: candidate.id,
        message: "Technical QC report is not present yet."
      });
    } else if (candidate.qc?.status === "error") {
      errors.push({
        code: "technical_qc_error",
        candidateId: candidate.id,
        message: `Technical QC has ${candidate.qc.errorCount} errors.`
      });
    } else if (candidate.qc?.status === "warning") {
      warnings.push({
        code: "technical_qc_warning",
        candidateId: candidate.id,
        message: `Technical QC has ${candidate.qc.warningCount} warnings.`
      });
    }
  }

  if (report.candidates.length) {
    notes.push({
      code: "worksheet_deposit_pending",
      message: "Candidates are Entwuerfe. A worksheet PDF is created only after an explicit worksheet deposit."
    });
  }

  return {
    status: errors.length ? "error" : warnings.length ? "warning" : "ok",
    errors,
    warnings,
    notes
  };
}

function recentMessages(events = []) {
  return events
    .filter((event) => event.type === "user_message" || event.type === "assistant_message")
    .slice(-12)
    .map((event) => ({
      role: event.type === "assistant_message" ? "assistant" : "user",
      createdAt: event.createdAt || null,
      excerpt: truncate(event.payload?.message || event.payload?.content || "", 420),
      suggestedActions: (event.payload?.suggestedActions || []).map((action) => ({
        command: action.command || action.id || null,
        label: action.label || null
      }))
    }));
}

function sourceContentSummary(imageSheetBrief = {}) {
  const brief = imageSheetBrief.lessonBrief || {};
  const content = imageSheetBrief.contentMirror || {};
  return {
    title: content.title || brief.topic || null,
    subject: brief.subject || null,
    targetGroup: brief.targetGroup || null,
    goal: brief.goal || null,
    taskCount: Array.isArray(content.tasks) ? content.tasks.length : 0,
    readingTextCount: Array.isArray(content.readingTexts) ? content.readingTexts.length : 0,
    imageMaterialCount: Array.isArray(content.imageMaterials) ? content.imageMaterials.length : 0,
    tasks: (content.tasks || []).map((task, index) => ({
      id: task.id || `task_${index + 1}`,
      prompt: truncate(task.prompt || task.text || "", 260),
      expectedAnswer: task.expectedAnswer ? truncate(task.expectedAnswer, 260) : null
    })),
    imageMaterials: (content.imageMaterials || []).map((material, index) => ({
      id: material.id || `image_${index + 1}`,
      prompt: truncate(material.prompt || material.description || "", 320),
      purpose: material.purpose || null
    }))
  };
}

function markdownList(items, fallback = "- none") {
  return items.length ? items.map((item) => `- ${item}`).join("\n") : fallback;
}

function renderSummaryMarkdown(report) {
  const diagnostics = report.diagnostics;
  const candidates = report.candidates.map((candidate) => {
    const refs = (candidate.generation?.referenceImages || []).map((ref) => `${ref.role || "reference"}:${ref.path}`).join(", ") || "none";
    const pages = (candidate.pages || []).map((page) => `page ${page.page}: ${page.path}`).join("; ") || "none";
    return [
      `## ${candidate.id}`,
      `- status: ${candidate.status || "unknown"}`,
      `- generation: ${candidate.generation?.provider || "unknown"} / ${candidate.generation?.model || "unknown"} / ${candidate.generation?.generationMode || "unknown"}`,
      `- imageSpec: ${candidate.generation?.imageSpecProposalId || "unknown"}`,
      `- references: ${refs}`,
      `- pages: ${pages}`,
      `- qc: ${candidate.qc?.status || "missing"} (${candidate.qc?.path || "no path"})`
    ].join("\n");
  }).join("\n\n");

  return [
    `# Run Summary: ${report.run.runId}`,
    "",
    `Generated: ${report.generatedAt}`,
    `Project: ${report.project.title || report.project.projectId}`,
    `Status: ${report.run.status || "unknown"} / diagnostics: ${diagnostics.status}`,
    "",
    "## Fast Read Order",
    markdownList(report.readOrder),
    "",
    "## Source Concept",
    `- title: ${report.sourceContent.title || "unknown"}`,
    `- subject/target: ${[report.sourceContent.subject, report.sourceContent.targetGroup].filter(Boolean).join(" / ") || "unknown"}`,
    `- goal: ${report.sourceContent.goal || "unknown"}`,
    `- tasks: ${report.sourceContent.taskCount}, texts: ${report.sourceContent.readingTextCount}, image materials: ${report.sourceContent.imageMaterialCount}`,
    "",
    "## Workflow State",
    `- Entwuerfe: ${report.candidates.length}`,
    "- Arbeitsblatt-Ablage: separate worksheet snapshot after explicit deposit",
    "",
    "## Diagnostics",
    markdownList([
      ...diagnostics.errors.map((entry) => `ERROR ${entry.code}: ${entry.message}`),
      ...diagnostics.warnings.map((entry) => `WARN ${entry.code}: ${entry.message}`),
      ...diagnostics.notes.map((entry) => `NOTE ${entry.code}: ${entry.message}`)
    ]),
    "",
    "## Candidates",
    candidates || "- none",
    "",
    "## Codex Debug Hint",
    "Start with this file, then open `analysis/run-debug.json` for structured paths. For visual quality, inspect candidate PNGs and compare them against approved visible text in `brief.imagesheet.json`."
  ].join("\n");
}

async function updateRunAnalysisReport(projectDir, runId, options = {}) {
  const now = options.now || new Date().toISOString();
  const project = await readJson(path.join(projectDir, "project-manifest.json"));
  const runDir = path.join(projectDir, "runs", runId);
  const manifestPath = path.join(runDir, "run-manifest.json");
  const manifest = await readJson(manifestPath);
  const imageSheetBrief = await readJsonIfExists(path.join(runDir, "brief.imagesheet.json"));
  const events = await readEvents(projectDir);
  const candidates = await Promise.all((manifest.candidates || []).map((candidate) => candidateSummary(runDir, candidate)));

  const report = {
    schemaVersion: PRODUCTION_SCHEMA_VERSION,
    reportKind: "run_debug_report",
    generatedAt: now,
    project: {
      projectId: project.projectId || path.basename(projectDir),
      title: project.title || null,
      subject: project.subject || null,
      topic: project.topic || null,
      targetGroup: project.manifest?.targetGroup || project.targetGroup || null
    },
    run: {
      runId,
      status: manifest.status || null,
      createdAt: manifest.createdAt || null,
      updatedAt: manifest.updatedAt || null,
      pipeline: manifest.pipeline || null,
      sourceArtifacts: manifest.sourceArtifacts || {},
      concept: manifest.concept || null
    },
    paths: {
      runDir: rel(projectDir, runDir),
      manifest: rel(projectDir, manifestPath),
      imageSheetBrief: "runs/" + runId + "/brief.imagesheet.json",
      summary: "runs/" + runId + "/analysis/run-summary.md",
      debugJson: "runs/" + runId + "/analysis/run-debug.json",
      history: "history/worksheet-history.jsonl",
      modelRuns: "history/model-runs.jsonl"
    },
    readOrder: [
      "analysis/run-summary.md",
      "analysis/run-debug.json",
      "brief.imagesheet.json",
      "run-manifest.json",
      "qc/*.technical-qc.json",
      "codex-jobs/*/prompt.md",
      "candidates/*.asset.json"
    ],
    sourceContent: sourceContentSummary(imageSheetBrief || {}),
    candidates,
    recentConversation: recentMessages(events),
    llmInspectionChecklist: [
      "Does each candidate follow the approved visible worksheet text from brief.imagesheet.json?",
      "Are referenceImages present when referencePolicy is required or recommended?",
      "Do prompts contain unintended visible text, solutions, helper arguments, or environment labels?",
      "Do candidate images have the planned page count and usable visual quality?",
      "If the teacher wants to keep this result, should this Entwurf be deposited as an Arbeitsblatt snapshot?"
    ]
  };
  report.diagnostics = collectDiagnostics(report);

  const analysisDir = path.join(runDir, "analysis");
  await writeJson(path.join(analysisDir, "run-debug.json"), report);
  await writeText(path.join(analysisDir, "run-summary.md"), `${renderSummaryMarkdown(report)}\n`);

  const nextManifest = {
    ...manifest,
    outputs: {
      ...(manifest.outputs || {}),
      analysis: {
        summary: "analysis/run-summary.md",
        debugJson: "analysis/run-debug.json",
        updatedAt: now
      }
    }
  };
  await writeJson(manifestPath, nextManifest);
  return report;
}

module.exports = {
  updateRunAnalysisReport
};
