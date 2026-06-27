"use strict";

const fs = require("node:fs/promises");
const path = require("node:path");
const { EVENT_TYPES, PRODUCTION_SCHEMA_VERSION } = require("../contracts");
const { appendEvent } = require("../eventLog");
const { appendHistoryEvent } = require("../historyManager");
const { updateRunAnalysisReport } = require("../runAnalysisManager");
const { readJsonFileIfExists, writeJsonFile } = require("../jsonFile");

const A4_PORTRAIT_RATIO = 210 / 297;
const DEFAULT_ASPECT_RATIO_TOLERANCE = 0.005;

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

async function readJsonIfExists(filePath) {
  return readJsonFileIfExists(filePath);
}

function pngDimensions(buffer) {
  if (buffer.length < 24 || buffer.toString("ascii", 1, 4) !== "PNG") {
    return null;
  }
  return {
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20),
    format: "png"
  };
}

function jpegDimensions(buffer) {
  if (buffer.length < 4 || buffer[0] !== 0xff || buffer[1] !== 0xd8) {
    return null;
  }
  let offset = 2;
  while (offset < buffer.length) {
    if (buffer[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    const marker = buffer[offset + 1];
    const length = buffer.readUInt16BE(offset + 2);
    if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
      return {
        width: buffer.readUInt16BE(offset + 7),
        height: buffer.readUInt16BE(offset + 5),
        format: "jpeg"
      };
    }
    offset += 2 + length;
  }
  return { width: null, height: null, format: "jpeg" };
}

function svgDimensions(text) {
  if (!String(text).trim().startsWith("<svg")) {
    return null;
  }
  const width = Number(String(text).match(/\bwidth=["']?(\d+)/)?.[1] || 0) || null;
  const height = Number(String(text).match(/\bheight=["']?(\d+)/)?.[1] || 0) || null;
  return { width, height, format: "svg" };
}

function webpDimensions(buffer) {
  if (buffer.length < 30 || buffer.toString("ascii", 0, 4) !== "RIFF" || buffer.toString("ascii", 8, 12) !== "WEBP") {
    return null;
  }
  if (buffer.toString("ascii", 12, 16) === "VP8X") {
    return {
      width: 1 + buffer.readUIntLE(24, 3),
      height: 1 + buffer.readUIntLE(27, 3),
      format: "webp"
    };
  }
  return { width: null, height: null, format: "webp" };
}

function imageDimensions(buffer, filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".svg") {
    return svgDimensions(buffer.toString("utf8"));
  }
  return pngDimensions(buffer) || jpegDimensions(buffer) || webpDimensions(buffer) || null;
}

async function inspectImageFile(filePath) {
  const buffer = await fs.readFile(filePath);
  const dimensions = imageDimensions(buffer, filePath);
  return {
    byteLength: buffer.length,
    format: dimensions?.format || path.extname(filePath).replace(".", "").toLowerCase() || "unknown",
    width: dimensions?.width || null,
    height: dimensions?.height || null
  };
}

function parseImageSize(value) {
  const match = String(value || "").trim().match(/^(\d+)x(\d+)$/i);
  if (!match) {
    return null;
  }
  const width = Number(match[1]);
  const height = Number(match[2]);
  return width > 0 && height > 0 ? { width, height, ratio: width / height, label: `${width}x${height}` } : null;
}

function formatContractFromCandidate(candidate = {}, options = {}) {
  const requestedSize = candidate.generation?.size || candidate.generation?.requestedSize || null;
  const parsedSize = parseImageSize(requestedSize);
  const expectedRatio = parsedSize?.ratio || A4_PORTRAIT_RATIO;
  const tolerance = Number(options.aspectRatioTolerance) > 0
    ? Number(options.aspectRatioTolerance)
    : DEFAULT_ASPECT_RATIO_TOLERANCE;
  return {
    kind: "a4_portrait",
    requestedSize,
    expectedWidth: parsedSize?.width || null,
    expectedHeight: parsedSize?.height || null,
    expectedRatio,
    tolerance,
    provider: candidate.generation?.provider || null
  };
}

function pageFormatMessages(info, contract) {
  if (!info?.width || !info?.height || !contract) {
    return { errors: [], warnings: [] };
  }
  const errors = [];
  const warnings = [];
  const actualRatio = info.width / info.height;
  const ratioDelta = Math.abs(actualRatio - contract.expectedRatio) / contract.expectedRatio;
  if (ratioDelta > contract.tolerance) {
    errors.push({
      code: "worksheet_page_aspect_ratio_mismatch",
      message: `Arbeitsblattseite hat kein stabiles A4-Hochformat: ${info.width}x${info.height}, erwartet ${contract.requestedSize || "A4-Hochformat"}.`
    });
  }
  const exactSizeExpected = contract.provider === "openai" && contract.expectedWidth && contract.expectedHeight;
  if (exactSizeExpected && (info.width !== contract.expectedWidth || info.height !== contract.expectedHeight)) {
    errors.push({
      code: "worksheet_page_size_mismatch",
      message: `OpenAI-Bildausgabe entspricht nicht der angefragten Seitengröße: ${info.width}x${info.height}, erwartet ${contract.expectedWidth}x${contract.expectedHeight}.`
    });
  } else if (
    contract.expectedWidth
    && contract.expectedHeight
    && (info.width !== contract.expectedWidth || info.height !== contract.expectedHeight)
  ) {
    warnings.push({
      code: "worksheet_page_size_differs_from_request",
      message: `Bildgröße weicht von der angefragten Seitengröße ab: ${info.width}x${info.height}, angefragt ${contract.expectedWidth}x${contract.expectedHeight}.`
    });
  }
  return { errors, warnings };
}

function pageResult({ page, info, error, formatContract }) {
  const errors = [];
  const warnings = [];
  if (error) {
    errors.push(error);
  }
  if (info && info.byteLength < 1024) {
    warnings.push({
      code: "image_file_small",
      message: "Bilddatei ist sehr klein und sollte geprueft werden."
    });
  }
  if (info && (!info.width || !info.height)) {
    warnings.push({
      code: "image_dimensions_unknown",
      message: "Bildabmessungen konnten nicht sicher gelesen werden."
    });
  }
  const formatMessages = pageFormatMessages(info, formatContract);
  errors.push(...formatMessages.errors);
  warnings.push(...formatMessages.warnings);
  return {
    page: page.page,
    role: page.role,
    path: page.path,
    ...info,
    formatContract,
    aspectRatio: info?.width && info?.height ? Number((info.width / info.height).toFixed(6)) : null,
    errors,
    warnings
  };
}

function textContractFromBrief(imageSheetBrief = {}, candidate = {}) {
  const content = imageSheetBrief.contentMirror || {};
  const generation = candidate.generation || {};
  const contentChangePolicy = generation.contentChangePolicy || "preserve_approved_text";
  const changeScope = generation.changeScope || "candidate_from_concept";
  const textLocked = contentChangePolicy === "preserve_approved_text";
  const texts = [];
  if (content.title) {
    texts.push({ role: "title", text: content.title });
  }
  for (const entry of content.readingTexts || []) {
    if (entry.title && String(entry.title).trim().toLowerCase() !== "material") {
      texts.push({ role: "material_heading", text: entry.title });
    }
    if (entry.body) {
      texts.push({ role: "material_text", text: entry.body });
    }
  }
  for (const [index, task] of (content.tasks || []).entries()) {
    const prompt = task.prompt || task.text || "";
    if (prompt) {
      texts.push({ role: "task", label: String(index + 1), text: prompt });
    }
  }
  return {
    policy: contentChangePolicy,
    changeScope,
    status: textLocked ? "locked_pending_visual_review" : "not_checked",
    locked: textLocked,
    expectedTextCount: texts.length,
    expectedTexts: texts,
    note: textLocked
      ? "Der Entwurfslauf durfte keinen freigegebenen Haupttext ändern. Technischer QC speichert den Textvertrag; ein echter Abweichungsnachweis braucht OCR oder visuellen GPT-Check."
      : "Texttreue braucht OCR oder einen visuellen GPT-Check nach der Bildgenerierung."
  };
}

async function runCandidateTechnicalQc(projectDir, runId, candidateId, options = {}) {
  const now = options.now || new Date().toISOString();
  const runDir = path.join(projectDir, "runs", runId);
  const manifest = await readJson(path.join(runDir, "run-manifest.json"));
  const imageSheetBrief = await readJsonIfExists(path.join(runDir, "brief.imagesheet.json"));
  const candidate = (manifest.candidates || []).find((entry) => entry.id === candidateId);
  if (!candidate) {
    throw new Error(`Candidate does not exist: ${candidateId}`);
  }
  const formatContract = formatContractFromCandidate(candidate, options);

  const pages = [];
  for (const page of candidate.pages || []) {
    const filePath = path.join(runDir, page.path || "");
    if (!page.path || !(await pathExists(filePath))) {
      pages.push(pageResult({
        page,
        formatContract,
        error: {
          code: "candidate_page_missing",
          message: `Entwurfsseite fehlt: ${page.path || "unbekannt"}`
        }
      }));
      continue;
    }
    pages.push(pageResult({
      page,
      info: await inspectImageFile(filePath),
      formatContract
    }));
  }

  const errorCount = pages.reduce((sum, page) => sum + page.errors.length, 0);
  const warningCount = pages.reduce((sum, page) => sum + page.warnings.length, 0);
  const report = {
    schemaVersion: PRODUCTION_SCHEMA_VERSION,
    runId,
    candidateId,
    checkedAt: now,
    status: errorCount > 0 ? "error" : warningCount > 0 ? "warning" : "passed",
    errorCount,
    warningCount,
    formatContract,
    contentFidelity: textContractFromBrief(imageSheetBrief || {}, candidate),
    pages
  };

  const relativePath = `qc/${candidateId}.technical-qc.json`;
  await writeJson(path.join(runDir, relativePath), report);
  await appendEvent(projectDir, {
    type: EVENT_TYPES.QC_COMPLETED,
    createdAt: now,
    step: "entwuerfe",
    runId,
    payload: {
      candidateId,
      status: report.status,
      errorCount,
      warningCount,
      path: `runs/${runId}/${relativePath}`
    }
  }, { now });
  await appendHistoryEvent(projectDir, {
    type: "candidate_technical_qc_completed",
    createdAt: now,
    runId,
    candidateId,
    status: report.status,
    errorCount,
    warningCount
  });
  await updateRunAnalysisReport(projectDir, runId, { now });

  return report;
}

module.exports = {
  inspectImageFile,
  runCandidateTechnicalQc
};
