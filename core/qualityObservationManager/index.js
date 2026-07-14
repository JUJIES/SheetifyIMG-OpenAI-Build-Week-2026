"use strict";

const fs = require("node:fs/promises");
const path = require("node:path");
const { buildUsageCostReport } = require("../usageCostAnalysisManager");

const REPORT_SCHEMA_VERSION = "sheetifyimg.quality-observation-report.v1";

function nonEmpty(value) {
  return String(value || "").trim();
}

function money(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.round(number * 1_000_000) / 1_000_000 : 0;
}

function ratio(numerator, denominator) {
  if (!denominator) {
    return 0;
  }
  return Math.round((numerator / denominator) * 10_000) / 10_000;
}

function inDateRange(createdAt, filters = {}) {
  const value = Date.parse(createdAt || "");
  if (filters.from && (!Number.isFinite(value) || value < Date.parse(filters.from))) {
    return false;
  }
  if (filters.to && (!Number.isFinite(value) || value > Date.parse(filters.to))) {
    return false;
  }
  return true;
}

async function listDirectories(dirPath) {
  try {
    const entries = await fs.readdir(dirPath, { withFileTypes: true });
    return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
  } catch (error) {
    if (error.code === "ENOENT") {
      return [];
    }
    throw error;
  }
}

async function readJsonlIfExists(filePath) {
  try {
    const entries = [];
    let malformedLineCount = 0;
    for (const line of (await fs.readFile(filePath, "utf8")).split(/\r?\n/)) {
      if (!line.trim()) {
        continue;
      }
      try {
        entries.push(JSON.parse(line));
      } catch {
        malformedLineCount += 1;
      }
    }
    return { entries, malformedLineCount };
  } catch (error) {
    if (error.code === "ENOENT") {
      return { entries: [], malformedLineCount: 0 };
    }
    throw error;
  }
}

function increment(map, id) {
  const key = nonEmpty(id) || "unspecified";
  map.set(key, (map.get(key) || 0) + 1);
}

function publicCounts(map) {
  return [...map.entries()]
    .map(([id, count]) => ({ id, count }))
    .sort((left, right) => right.count - left.count || left.id.localeCompare(right.id));
}

function actionCommands(trace = {}) {
  return (trace.result?.suggestedActions || [])
    .map((action) => action.command || action.id || null)
    .filter(Boolean);
}

function resolutionCommand(trace = {}) {
  return trace.resolution?.command
    || trace.resolution?.suggestedActions?.[0]?.command
    || null;
}

function stateDelta(trace = {}) {
  const before = trace.workspaceBefore || {};
  const after = trace.workspaceAfter || {};
  return {
    conceptCount: Number(after.conceptCount || 0) - Number(before.conceptCount || 0),
    candidateCount: Number(after.candidateCount || 0) - Number(before.candidateCount || 0),
    conceptChanged: (after.currentConceptId || null) !== (before.currentConceptId || null),
    proposalChanged: (after.latestProposalId || null) !== (before.latestProposalId || null)
  };
}

function modelSequence(modelRuns = []) {
  return [...modelRuns]
    .sort((left, right) => String(left.createdAt || "").localeCompare(String(right.createdAt || "")) || left.id.localeCompare(right.id))
    .map((activity) => ({
      source: activity.source,
      purpose: activity.purpose,
      status: activity.status,
      provider: activity.provider,
      model: activity.model,
      reasoningEffort: activity.reasoningEffort,
      inputTokens: activity.inputTokens || 0,
      outputTokens: activity.outputTokens || 0,
      reasoningTokens: activity.reasoningTokens || 0,
      cachedInputTokens: activity.cachedInputTokens || 0,
      cacheWriteTokens: activity.cacheWriteTokens || 0,
      totalTokens: activity.totalTokens || 0,
      estimatedCostUsd: activity.estimatedCostUsd,
      durationMs: activity.durationMs || 0,
      measuredRequestChars: activity.requestShape?.totalMeasuredChars || 0
    }));
}

function modelSummary(modelRuns = []) {
  const sequence = modelSequence(modelRuns);
  return {
    modelCallCount: sequence.length,
    successfulModelCallCount: sequence.filter((entry) => entry.status === "success").length,
    failedModelCallCount: sequence.filter((entry) => entry.status !== "success").length,
    inputTokens: sequence.reduce((sum, entry) => sum + entry.inputTokens, 0),
    outputTokens: sequence.reduce((sum, entry) => sum + entry.outputTokens, 0),
    reasoningTokens: sequence.reduce((sum, entry) => sum + entry.reasoningTokens, 0),
    cachedInputTokens: sequence.reduce((sum, entry) => sum + entry.cachedInputTokens, 0),
    cacheWriteTokens: sequence.reduce((sum, entry) => sum + entry.cacheWriteTokens, 0),
    totalTokens: sequence.reduce((sum, entry) => sum + entry.totalTokens, 0),
    knownCostUsd: money(sequence.reduce((sum, entry) => sum + Number(entry.estimatedCostUsd || 0), 0)),
    durationMs: sequence.reduce((sum, entry) => sum + entry.durationMs, 0),
    measuredRequestChars: sequence.reduce((sum, entry) => sum + entry.measuredRequestChars, 0),
    sequence
  };
}

function observationFromTrace(projectId, trace = {}, modelRuns = []) {
  const finalIntent = trace.routing?.finalIntent || {};
  const assistantMessage = String(trace.result?.visibleAssistantMessage || "");
  return {
    projectId,
    createdAt: trace.createdAt || null,
    operationId: trace.operationId || null,
    uiEvent: trace.uiEvent || null,
    routing: {
      finalIntent: finalIntent.intent || "none",
      confidence: finalIntent.confidence || null,
      targetKind: finalIntent.target?.kind || null,
      ambiguityLevel: finalIntent.ambiguity?.level || null,
      semanticSource: trace.routing?.semanticSource || null,
      finalSource: trace.routing?.finalSource || null,
      guardApplied: trace.routing?.guardApplied === true,
      guardCategory: trace.routing?.guardCategory || null
    },
    resolution: {
      kind: trace.resolution?.kind || "none",
      command: resolutionCommand(trace)
    },
    result: {
      mode: trace.result?.mode || null,
      visibleEffect: trace.result?.visibleEffect || "unknown",
      assistantMessageChars: assistantMessage.length,
      suggestedActionCommands: actionCommands(trace)
    },
    stateDelta: stateDelta(trace),
    models: modelSummary(modelRuns)
  };
}

async function buildQualityObservationReport(options = {}) {
  const projectsDir = options.projectsDir;
  if (!projectsDir) {
    throw new Error("projectsDir is required.");
  }
  const filters = {
    projectId: nonEmpty(options.projectId) || null,
    from: nonEmpty(options.from) || null,
    to: nonEmpty(options.to) || null
  };
  const usageReport = await buildUsageCostReport({
    projectsDir,
    projectId: filters.projectId,
    from: filters.from,
    to: filters.to,
    includeModelRuns: true,
    now: options.now
  });
  const modelRunsByOperation = new Map();
  for (const modelRun of usageReport.modelRuns || []) {
    if (!modelRun.operationId) {
      continue;
    }
    const key = `${modelRun.projectId}:${modelRun.operationId}`;
    if (!modelRunsByOperation.has(key)) {
      modelRunsByOperation.set(key, []);
    }
    modelRunsByOperation.get(key).push(modelRun);
  }

  const projectIds = filters.projectId ? [filters.projectId] : await listDirectories(projectsDir);
  const observations = [];
  let malformedTraceLineCount = 0;
  for (const projectId of projectIds) {
    const traces = await readJsonlIfExists(path.join(projectsDir, projectId, "history", "chat-routing-traces.jsonl"));
    malformedTraceLineCount += traces.malformedLineCount;
    for (const trace of traces.entries.filter((entry) => inDateRange(entry.createdAt, filters))) {
      const key = trace.operationId ? `${projectId}:${trace.operationId}` : null;
      observations.push(observationFromTrace(projectId, trace, key ? modelRunsByOperation.get(key) || [] : []));
    }
  }

  observations.sort((left, right) => String(left.createdAt || "").localeCompare(String(right.createdAt || ""))
    || left.projectId.localeCompare(right.projectId));
  const byIntent = new Map();
  const byVisibleEffect = new Map();
  const byResolution = new Map();
  observations.forEach((observation) => {
    increment(byIntent, observation.routing.finalIntent);
    increment(byVisibleEffect, observation.result.visibleEffect);
    increment(byResolution, observation.resolution.kind);
  });
  const operationAttributed = observations.filter((observation) => observation.operationId);
  const modelLinked = observations.filter((observation) => observation.models.modelCallCount > 0);
  const requestMeasured = observations.filter((observation) => observation.models.measuredRequestChars > 0);

  return {
    schemaVersion: REPORT_SCHEMA_VERSION,
    generatedAt: options.now || new Date().toISOString(),
    filters,
    judgmentBoundary: "This report exposes observable routing, state and usage facts. It does not automatically judge semantic answer quality or visual usefulness.",
    coverage: {
      malformedTraceLineCount,
      traceCount: observations.length,
      operationAttributedTraceCount: operationAttributed.length,
      operationAttributionRate: ratio(operationAttributed.length, observations.length),
      modelLinkedTraceCount: modelLinked.length,
      modelLinkRate: ratio(modelLinked.length, observations.length),
      requestShapeMeasuredTraceCount: requestMeasured.length,
      requestShapeMeasuredTraceRate: ratio(requestMeasured.length, observations.length)
    },
    signals: {
      guardAppliedCount: observations.filter((observation) => observation.routing.guardApplied).length,
      highAmbiguityCount: observations.filter((observation) => observation.routing.ambiguityLevel === "high").length,
      commandErrorCount: observations.filter((observation) => observation.result.visibleEffect === "command_error").length,
      paidOfferCount: observations.filter((observation) => observation.result.visibleEffect === "paid_candidate_offer").length,
      chatOnlyCount: observations.filter((observation) => observation.result.visibleEffect === "chat_only").length
    },
    byIntent: publicCounts(byIntent),
    byVisibleEffect: publicCounts(byVisibleEffect),
    byResolutionKind: publicCounts(byResolution),
    observations
  };
}

module.exports = {
  REPORT_SCHEMA_VERSION,
  buildQualityObservationReport
};
