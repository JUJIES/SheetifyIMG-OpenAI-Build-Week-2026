"use strict";

const fs = require("node:fs/promises");
const path = require("node:path");
const { PRODUCTION_SCHEMA_VERSION } = require("../contracts");
const { candidateDisplayLabelMap, listProjectCandidates } = require("../candidateDisplay");
const { readEvents } = require("../eventLog");
const { readJsonFileIfExists, writeJsonFile } = require("../jsonFile");
const { buildPagePlans, pageCountFromContent } = require("../pagePlanManager");
const { splitTaskPromptUnits } = require("../contentReadiness");

const DEFAULT_REPO_ROOT = path.resolve(__dirname, "..", "..");
const DEFAULT_WORKSHEETS_DIR = path.join(DEFAULT_REPO_ROOT, "worksheets");

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

async function listDirs(dirPath) {
  if (!(await pathExists(dirPath))) {
    return [];
  }
  const entries = await fs.readdir(dirPath, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right));
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

function candidateKey(runId = "", candidateId = "") {
  const normalizedRunId = String(runId || "").trim();
  const normalizedCandidateId = String(candidateId || "").trim();
  return normalizedRunId && normalizedCandidateId ? `${normalizedRunId}::${normalizedCandidateId}` : "";
}

async function worksheetManifests(worksheetsDir = DEFAULT_WORKSHEETS_DIR) {
  const itemsDir = path.join(worksheetsDir, "items");
  const manifests = [];
  for (const worksheetId of await listDirs(itemsDir)) {
    const manifest = await readJsonIfExists(path.join(itemsDir, worksheetId, "worksheet-manifest.json"));
    if (manifest?.worksheetId) {
      manifests.push({
        ...manifest,
        _manifestPath: path.join("items", worksheetId, "worksheet-manifest.json")
      });
    }
  }
  return manifests.sort((left, right) => {
    return String(left.createdAt || "").localeCompare(String(right.createdAt || ""))
      || String(left.worksheetId || "").localeCompare(String(right.worksheetId || ""));
  });
}

async function worksheetDepositsForProject(projectId, options = {}) {
  const worksheetsDir = options.worksheetsDir || DEFAULT_WORKSHEETS_DIR;
  const targetProjectId = String(projectId || "").trim();
  if (!targetProjectId) {
    return new Map();
  }
  const byCandidate = new Map();
  const manifests = await worksheetManifests(worksheetsDir);
  for (const manifest of manifests) {
    if (String(manifest.source?.projectId || "").trim() !== targetProjectId) {
      continue;
    }
    const sourceRunId = manifest.source?.runId || null;
    const sourceCandidateIds = new Set([
      manifest.source?.candidateId,
      ...(manifest.source?.candidateIds || []),
      ...(manifest.pages || []).map((page) => page.sourceCandidateId)
    ].filter(Boolean));
    for (const sourceCandidateId of sourceCandidateIds) {
      const key = candidateKey(sourceRunId, sourceCandidateId);
      if (!key) {
        continue;
      }
      if (!byCandidate.has(key)) {
        byCandidate.set(key, []);
      }
      byCandidate.get(key).push({
        worksheetId: manifest.worksheetId,
        title: manifest.title || null,
        kind: manifest.kind || null,
        status: manifest.status || null,
        pageCount: Number(manifest.pageCount || manifest.pages?.length || 0),
        createdAt: manifest.createdAt || null,
        manifestPath: manifest._manifestPath || null,
        pdfPath: manifest.pdf?.path ? path.join("items", manifest.worksheetId, manifest.pdf.path).split(path.sep).join("/") : null,
        pages: (manifest.pages || [])
          .filter((page) => !page.sourceCandidateId || page.sourceCandidateId === sourceCandidateId)
          .map((page) => ({
            page: page.page || null,
            sourcePage: page.sourcePage || null,
            role: page.role || null,
            sourcePath: page.sourcePath || null,
            path: page.path ? path.join("items", manifest.worksheetId, page.path).split(path.sep).join("/") : null
          }))
      });
    }
  }
  return byCandidate;
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

async function candidateSummary(runDir, candidate = {}, context = {}) {
  const qcPath = `qc/${candidate.id}.technical-qc.json`;
  const qc = await readJsonIfExists(path.join(runDir, qcPath));
  const key = candidateKey(candidate.runId || context.runId, candidate.id);
  const worksheetDeposits = context.worksheetDepositsByCandidate?.get(key) || [];
  return {
    id: candidate.id || null,
    displayLabel: context.displayLabels?.[`${candidate.runId || context.runId || ""}:${candidate.id || ""}`] || null,
    status: candidate.status || null,
    createdAt: candidate.createdAt || null,
    concept: candidate.concept || null,
    basedOnConceptId: candidate.basedOnConceptId || candidate.concept?.conceptId || null,
    basedOnConceptVersion: candidate.basedOnConceptVersion || candidate.concept?.conceptVersion || null,
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
    },
    worksheetDeposits
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

function requestedPageCount(imageSheetBrief = {}) {
  const brief = imageSheetBrief.lessonBrief || {};
  const content = imageSheetBrief.contentMirror || {};
  const explicit = Number(content.outputPreference?.pages || brief.outputPreference?.pages || 0);
  if (explicit) {
    return explicit;
  }
  return pageCountFromContent(content, null, brief);
}

function activeOutputPreference(content = {}, brief = {}) {
  return content.outputPreference || brief.outputPreference || null;
}

function sourceIntent(imageSheetBrief = {}) {
  const brief = imageSheetBrief.lessonBrief || {};
  const content = imageSheetBrief.contentMirror || {};
  const outputPreference = activeOutputPreference(content, brief);
  const pageCount = requestedPageCount(imageSheetBrief);
  const taskUnits = (content.tasks || []).reduce((total, task) => {
    return total + Math.max(1, splitTaskPromptUnits(task.prompt || task.text || "").length);
  }, 0);
  return {
    title: content.title || brief.topic || null,
    subject: brief.subject || null,
    targetGroup: brief.targetGroup || null,
    goal: brief.goal || null,
    requestedPages: pageCount || null,
    outputPreference,
    contentCounts: {
      readingTexts: Array.isArray(content.readingTexts) ? content.readingTexts.length : 0,
      tasks: Array.isArray(content.tasks) ? content.tasks.length : 0,
      visibleTaskUnits: taskUnits,
      imageMaterials: Array.isArray(content.imageMaterials) ? content.imageMaterials.length : 0
    },
    mustHave: [
      content.title ? `Title: ${content.title}` : null,
      pageCount ? `${pageCount} DIN-A4 page${pageCount === 1 ? "" : "s"}` : null,
      taskUnits ? `${taskUnits} visible task/prompt unit${taskUnits === 1 ? "" : "s"}` : null,
      Array.isArray(content.readingTexts) && content.readingTexts.length ? `${content.readingTexts.length} reading text${content.readingTexts.length === 1 ? "" : "s"}` : null,
      Array.isArray(content.imageMaterials) && content.imageMaterials.length ? `${content.imageMaterials.length} image material cue${content.imageMaterials.length === 1 ? "" : "s"}` : null,
      outputPreference?.layout ? `Layout: ${outputPreference.layout}` : null
    ].filter(Boolean),
    tasks: (content.tasks || []).map((task, index) => ({
      id: task.id || `task_${index + 1}`,
      visiblePromptUnits: Math.max(1, splitTaskPromptUnits(task.prompt || task.text || "").length),
      promptExcerpt: truncate(task.prompt || task.text || "", 360)
    }))
  };
}

function expectedPageContract(imageSheetBrief = {}) {
  const brief = imageSheetBrief.lessonBrief || {};
  const content = imageSheetBrief.contentMirror || {};
  const pageCount = requestedPageCount(imageSheetBrief);
  const plans = buildPagePlans(content, brief, pageCount || 1, null);
  const imageMaterialsById = new Map((content.imageMaterials || []).map((material) => [material.id, material]));
  return plans.map((plan) => ({
    page: plan.pageNumber || null,
    role: plan.role || null,
    title: plan.title || null,
    sourceTaskIds: plan.summary?.sourceTaskIds || (plan.tasks || []).map((task) => task.id).filter(Boolean),
    sourceTextIds: plan.summary?.sourceTextIds || (plan.readingTexts || []).map((text) => text.id).filter(Boolean),
    imageMaterialIds: plan.imageMaterialIds || [],
    expectedUnits: [
      ...(plan.readingTexts || []).map((text, index) => ({
        type: "reading_text",
        id: text.id || `reading_${index + 1}`,
        title: text.title || null,
        excerpt: truncate(text.body || "", 260)
      })),
      ...(plan.tasks || []).map((task, index) => ({
        type: "task",
        id: task.id || `task_${index + 1}`,
        visiblePromptUnits: Math.max(1, splitTaskPromptUnits(task.prompt || task.text || "").length),
        promptExcerpt: truncate(task.prompt || task.text || "", 300)
      })),
      ...(plan.imageMaterialIds || []).map((id) => {
        const material = imageMaterialsById.get(id) || {};
        return {
          type: "image_material",
          id,
          purpose: material.purpose || null,
          promptExcerpt: truncate(material.prompt || material.description || "", 220)
        };
      })
    ]
  }));
}

function conceptVersionFromId(value = "") {
  const match = String(value || "").match(/(?:content_mirror|concept)_v0*(\d+)/i);
  return match ? Number(match[1]) : null;
}

function conceptLineage(projectDir, report = {}) {
  const indexPath = path.join(projectDir, "artifact-index.json");
  return readJsonIfExists(indexPath).then((index) => {
    const concepts = (index?.artifacts || [])
      .filter((artifact) => artifact.type === "content_mirror")
      .map((artifact) => ({
        id: artifact.id || null,
        version: artifact.version || conceptVersionFromId(artifact.id),
        status: artifact.status || null,
        path: artifact.path || null,
        createdAt: artifact.createdAt || null,
        createdFrom: artifact.createdFrom || []
      }))
      .sort((left, right) => Number(left.version || 0) - Number(right.version || 0));
    const activeConceptId = report.run?.sourceArtifacts?.contentMirrorId || report.run?.concept?.contentMirrorId || null;
    return {
      activeConceptId,
      activeConceptVersion: report.run?.concept?.conceptVersion || conceptVersionFromId(activeConceptId),
      activationMode: "approved_content_mirror_for_run",
      concepts,
      previousVersions: concepts
        .filter((concept) => concept.id !== activeConceptId)
        .map((concept) => concept.version)
        .filter(Boolean)
    };
  });
}

function worksheetDepositStatus(candidate = {}) {
  const deposits = candidate.worksheetDeposits || [];
  if (!deposits.length) {
    return {
      status: "not_deposited",
      deposits: []
    };
  }
  return {
    status: "deposited",
    worksheetId: deposits[deposits.length - 1]?.worksheetId || null,
    deposits
  };
}

function evaluationReferenceImage(reference = {}) {
  return {
    id: reference.id || null,
    role: reference.role || "style_reference",
    path: reference.path || null,
    purpose: reference.purpose || null,
    sourceLabel: reference.sourceLabel || reference.label || null,
    targetPage: Number(reference.targetPage || reference.page || 0) || null,
    userDetails: reference.userDetails || reference.details || null,
    scope: reference.scope || null,
    sourceKind: reference.source?.kind || null,
    source: reference.source || null
  };
}

function formatReferenceMarkdown(reference = {}) {
  const targetPage = Number(reference.targetPage || reference.page || 0) || null;
  return [
    reference.role || "reference",
    reference.sourceLabel || reference.path || "unknown",
    targetPage ? `page ${targetPage}` : "all pages",
    reference.userDetails || reference.purpose || null
  ].filter(Boolean).join(" / ");
}

function evaluationCandidates(report = {}) {
  return (report.candidates || []).map((candidate) => ({
    displayLabel: candidate.displayLabel || candidate.id || "Entwurf",
    runId: report.run?.runId || null,
    candidateId: candidate.id || null,
    candidateKey: candidateKey(report.run?.runId, candidate.id),
    status: candidate.status || null,
    createdAt: candidate.createdAt || null,
    basedOnConceptId: candidate.basedOnConceptId || candidate.concept?.conceptId || null,
    basedOnConceptVersion: candidate.basedOnConceptVersion || candidate.concept?.conceptVersion || null,
    pageCount: (candidate.pages || []).length,
    generation: candidate.generation ? {
      provider: candidate.generation.provider || null,
      model: candidate.generation.model || null,
      imageSpecProposalId: candidate.generation.imageSpecProposalId || null,
      plannedPageCount: candidate.generation.plannedPageCount || null,
      generatedPageCount: candidate.generation.generatedPageCount || null,
      qualityPreset: candidate.generation.qualityPreset || null,
      referencePolicy: candidate.generation.referencePolicy ? {
        level: candidate.generation.referencePolicy.level || null,
        label: candidate.generation.referencePolicy.label || null,
        isSatisfied: candidate.generation.referencePolicy.isSatisfied ?? null,
        canProceedWithoutReference: candidate.generation.referencePolicy.canProceedWithoutReference ?? null
      } : null,
      referenceImages: (candidate.generation.referenceImages || []).map(evaluationReferenceImage)
    } : null,
    technicalQc: {
      status: candidate.qc?.status || "missing",
      errorCount: candidate.qc?.errorCount || 0,
      warningCount: candidate.qc?.warningCount || 0,
      path: candidate.qc?.path || null
    },
    pages: (candidate.pages || []).map((page) => ({
      page: page.page || null,
      role: page.role || null,
      path: page.path || null,
      exists: page.exists === true,
      assetPath: page.asset?.path || null,
      assetExists: page.asset?.exists === true,
      referenceImages: (page.asset?.metadata?.referenceImages || []).map(evaluationReferenceImage)
    })),
    worksheetDeposit: worksheetDepositStatus(candidate)
  }));
}

function bestCandidate(candidates = []) {
  const deposited = candidates
    .filter((candidate) => candidate.worksheetDeposit?.status === "deposited")
    .sort((left, right) => {
      const leftAt = left.worksheetDeposit.deposits?.at(-1)?.createdAt || "";
      const rightAt = right.worksheetDeposit.deposits?.at(-1)?.createdAt || "";
      return String(rightAt).localeCompare(String(leftAt));
    })[0];
  if (deposited) {
    return {
      displayLabel: deposited.displayLabel,
      runId: deposited.runId,
      candidateId: deposited.candidateId,
      basis: "latest_deposited"
    };
  }
  const latest = candidates[candidates.length - 1] || null;
  return latest ? {
    displayLabel: latest.displayLabel,
    runId: latest.runId,
    candidateId: latest.candidateId,
    basis: "latest_candidate"
  } : null;
}

function findingFromDiagnostic(kind, entry = {}) {
  const categoryByCode = {
    partial_candidate_generation: "page_contract",
    reference_policy_without_reference_images: "reference_policy",
    candidate_page_missing: "artifact_integrity",
    candidate_asset_metadata_missing: "artifact_integrity",
    technical_qc_missing: "technical_qc",
    technical_qc_error: "technical_qc",
    technical_qc_warning: "technical_qc"
  };
  return {
    category: categoryByCode[entry.code] || "run_diagnostics",
    severity: kind === "error" ? "high" : kind === "warning" ? "medium" : "info",
    code: entry.code || null,
    candidateId: entry.candidateId || null,
    page: entry.page || null,
    summary: entry.message || entry.code || "Run diagnostic"
  };
}

function evaluationFindings(report = {}, candidates = []) {
  const diagnostics = report.diagnostics || {};
  const findings = [
    ...(diagnostics.errors || []).map((entry) => findingFromDiagnostic("error", entry)),
    ...(diagnostics.warnings || []).map((entry) => findingFromDiagnostic("warning", entry))
  ];
  for (const candidate of candidates) {
    if (candidate.worksheetDeposit?.status !== "deposited") {
      findings.push({
        category: "archive_mapping",
        severity: "info",
        code: "worksheet_not_deposited",
        candidateId: candidate.candidateId,
        summary: `${candidate.displayLabel} is an Entwurf only; it has not been stored as an Arbeitsblatt snapshot.`
      });
    }
  }
  return findings;
}

async function buildRunEvaluation(projectDir, report = {}, imageSheetBrief = {}) {
  const lineage = await conceptLineage(projectDir, report);
  const candidates = evaluationCandidates(report);
  const findings = evaluationFindings(report, candidates);
  return {
    schemaVersion: PRODUCTION_SCHEMA_VERSION,
    reportKind: "run_evaluation_bundle",
    generatedAt: report.generatedAt,
    project: report.project,
    run: report.run,
    sourceIntent: sourceIntent(imageSheetBrief || {}),
    conceptLineage: lineage,
    expectedPageContract: expectedPageContract(imageSheetBrief || {}),
    candidates,
    bestCurrentCandidate: bestCandidate(candidates),
    knownFindings: findings,
    readOrder: [
      "analysis/run-evaluation.md",
      "analysis/run-evaluation.json",
      "analysis/run-summary.md",
      "analysis/run-debug.json",
      "brief.imagesheet.json",
      "run-manifest.json",
      "candidate PNGs"
    ]
  };
}

function formatCandidateRef(candidate = {}) {
  return `${candidate.displayLabel || candidate.candidateId || "Entwurf"} (${candidate.runId || "-"} / ${candidate.candidateId || "-"})`;
}

function renderExpectedPageContractMarkdown(contract = []) {
  if (!contract.length) {
    return "- none";
  }
  return contract.map((page) => {
    const units = (page.expectedUnits || []).map((unit) => {
      if (unit.type === "task") {
        return `task ${unit.id}: ${unit.visiblePromptUnits} prompt unit${unit.visiblePromptUnits === 1 ? "" : "s"}`;
      }
      if (unit.type === "reading_text") {
        return `reading ${unit.id}${unit.title ? ` (${unit.title})` : ""}`;
      }
      return `image ${unit.id}`;
    }).join(", ") || "no units";
    return `- page ${page.page} / ${page.role || "page"}: ${page.title || "untitled"}; ${units}`;
  }).join("\n");
}

function renderEvaluationMarkdown(evaluation = {}) {
  const intent = evaluation.sourceIntent || {};
  const candidates = (evaluation.candidates || []).map((candidate) => {
    const deposit = candidate.worksheetDeposit?.status === "deposited"
      ? `deposited as ${(candidate.worksheetDeposit.deposits || []).map((entry) => entry.worksheetId).join(", ")}`
      : "not deposited";
    return [
      `## ${formatCandidateRef(candidate)}`,
      `- concept: v${candidate.basedOnConceptVersion || "?"} / ${candidate.basedOnConceptId || "unknown"}`,
      `- pages: ${candidate.pageCount}; qc: ${candidate.technicalQc?.status || "missing"}`,
      `- references: ${(candidate.generation?.referenceImages || []).map(formatReferenceMarkdown).join("; ") || "none"}`,
      `- archive: ${deposit}`
    ].join("\n");
  }).join("\n\n");
  const findings = (evaluation.knownFindings || []).map((finding) => {
    return `- ${finding.severity || "info"} ${finding.category || "finding"}${finding.candidateId ? ` / ${finding.candidateId}` : ""}: ${finding.summary}`;
  });
  return [
    `# Run Evaluation: ${evaluation.project?.title || evaluation.project?.projectId || "Project"} / ${evaluation.run?.runId || "run"}`,
    "",
    `Generated: ${evaluation.generatedAt}`,
    "",
    "## Intended Outcome",
    `- title: ${intent.title || "unknown"}`,
    `- subject/target: ${[intent.subject, intent.targetGroup].filter(Boolean).join(" / ") || "unknown"}`,
    `- goal: ${intent.goal || "unknown"}`,
    `- pages: ${intent.requestedPages || "unknown"}`,
    `- must-have: ${(intent.mustHave || []).join("; ") || "unknown"}`,
    "",
    "## Concept Lineage",
    `- active: ${evaluation.conceptLineage?.activeConceptId || "unknown"} / v${evaluation.conceptLineage?.activeConceptVersion || "?"}`,
    `- activation: ${evaluation.conceptLineage?.activationMode || "unknown"}`,
    `- versions: ${(evaluation.conceptLineage?.concepts || []).map((concept) => `${concept.id}:${concept.status}`).join(", ") || "unknown"}`,
    "",
    "## Expected Page Contract",
    renderExpectedPageContractMarkdown(evaluation.expectedPageContract || []),
    "",
    "## Candidate Mapping",
    candidates || "- none",
    "",
    "## Best Current Candidate",
    evaluation.bestCurrentCandidate ? `- ${formatCandidateRef(evaluation.bestCurrentCandidate)} (${evaluation.bestCurrentCandidate.basis})` : "- none",
    "",
    "## Findings",
    findings.length ? findings.join("\n") : "- none",
    "",
    "## Codex Use",
    "Use this file for comparison across real runs. Use `run-debug.json` for raw paths and metadata, then inspect candidate PNGs for visual quality and text fidelity."
  ].join("\n");
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
  const projectCandidates = await listProjectCandidates(projectDir);
  const displayLabels = candidateDisplayLabelMap(projectCandidates);
  const worksheetDepositsByCandidate = await worksheetDepositsForProject(project.projectId || path.basename(projectDir), {
    worksheetsDir: options.worksheetsDir || DEFAULT_WORKSHEETS_DIR
  });
  const candidates = await Promise.all((manifest.candidates || []).map((candidate) => candidateSummary(runDir, candidate, {
    runId,
    displayLabels,
    worksheetDepositsByCandidate
  })));

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
      evaluationJson: "runs/" + runId + "/analysis/run-evaluation.json",
      evaluationMarkdown: "runs/" + runId + "/analysis/run-evaluation.md",
      history: "history/worksheet-history.jsonl",
      modelRuns: "history/model-runs.jsonl"
    },
    readOrder: [
      "analysis/run-evaluation.md",
      "analysis/run-evaluation.json",
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
  const evaluation = await buildRunEvaluation(projectDir, report, imageSheetBrief || {});

  const analysisDir = path.join(runDir, "analysis");
  await writeJson(path.join(analysisDir, "run-debug.json"), report);
  await writeText(path.join(analysisDir, "run-summary.md"), `${renderSummaryMarkdown(report)}\n`);
  await writeJson(path.join(analysisDir, "run-evaluation.json"), evaluation);
  await writeText(path.join(analysisDir, "run-evaluation.md"), `${renderEvaluationMarkdown(evaluation)}\n`);

  const nextManifest = {
    ...manifest,
    outputs: {
      ...(manifest.outputs || {}),
      analysis: {
        summary: "analysis/run-summary.md",
        debugJson: "analysis/run-debug.json",
        evaluationJson: "analysis/run-evaluation.json",
        evaluationMarkdown: "analysis/run-evaluation.md",
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
