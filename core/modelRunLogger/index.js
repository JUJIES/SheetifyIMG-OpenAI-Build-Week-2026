"use strict";

const fs = require("node:fs/promises");
const path = require("node:path");
const {
  createUsageAttribution,
  normalizeUsageAttribution
} = require("../usageAttributionManager");
const { normalizeModelRequestShape } = require("../modelRequestMetrics");

const PUBLIC_METADATA_FIELDS = new Set([
  "generationMode",
  "referenceImageCount",
  "runId",
  "candidateId",
  "pageNumber",
  "size",
  "quality",
  "qualityPreset",
  "openAiImageStreaming",
  "contentChangePolicy",
  "changeScope",
  "codexJobPath",
  "voiceId",
  "audioBytes",
  "audioMimeType",
  "audioDurationMs"
]);
const VALID_REASONING_EFFORTS = new Set(["none", "low", "medium", "high", "xhigh", "max"]);

function normalizedReasoningEffort(value) {
  const effort = String(value || "").trim().toLowerCase();
  return VALID_REASONING_EFFORTS.has(effort) ? effort : null;
}

function publicMetadata(value = null) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const metadata = Object.fromEntries(Object.entries(value)
    .filter(([key, entry]) => PUBLIC_METADATA_FIELDS.has(key)
      && (entry === null || ["string", "number", "boolean"].includes(typeof entry))));
  return Object.keys(metadata).length ? metadata : null;
}

function sanitizeErrorMessage(error) {
  const message = String(error?.message || error || "")
    .replace(/\bsk-[^\s,)]+/gi, "[redacted]");
  if (/incorrect api key|invalid_api_key/i.test(message)) {
    return "OpenAI API key was rejected (invalid_api_key).";
  }
  return message.slice(0, 700);
}

function publicEntry(entry = {}, now) {
  return {
    createdAt: entry.createdAt || now,
    status: entry.status || "unknown",
    source: entry.source || null,
    purpose: entry.purpose || null,
    route: entry.route || null,
    promptVersion: entry.promptVersion || "v1",
    promptNames: entry.promptNames || [],
    model: entry.model || null,
    reasoningEffort: normalizedReasoningEffort(entry.reasoningEffort),
    provider: entry.provider || "openai",
    responseId: entry.responseId || null,
    proposalId: entry.proposalId || null,
    toolCallCount: Number(entry.toolCallCount) || 0,
    durationMs: Number(entry.durationMs) || null,
    uiEvent: entry.uiEvent || null,
    usage: entry.usage && typeof entry.usage === "object" ? entry.usage : null,
    costEstimate: entry.costEstimate && typeof entry.costEstimate === "object" ? entry.costEstimate : null,
    requestShape: normalizeModelRequestShape(entry.requestShape),
    attribution: normalizeUsageAttribution(entry.attribution),
    metadata: publicMetadata(entry.metadata),
    error: entry.error ? sanitizeErrorMessage(entry.error) : null
  };
}

async function logModelRun(projectDir, entry = {}, options = {}) {
  const now = options.now || new Date().toISOString();
  const filePath = path.join(projectDir, "history", "model-runs.jsonl");
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const attribution = createUsageAttribution(entry.attribution, {
    projectId: path.basename(projectDir),
    operationKind: entry.source || "model_call"
  });
  const nextEntry = publicEntry({ ...entry, attribution }, now);
  await fs.appendFile(filePath, `${JSON.stringify(nextEntry)}\n`, "utf8");
  return nextEntry;
}

module.exports = {
  logModelRun,
  sanitizeErrorMessage
};
