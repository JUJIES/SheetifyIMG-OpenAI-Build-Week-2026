"use strict";

const fs = require("node:fs/promises");
const path = require("node:path");
const { normalizeModelRequestShape } = require("../modelRequestMetrics");
const { normalizeUsageAttribution } = require("../usageAttributionManager");
const {
  estimateOpenAiImageCost,
  estimateOpenAiTextCost,
  estimateOpenAiTranscriptionCost
} = require("../imageCostManager");

const REPORT_SCHEMA_VERSION = "sheetifyimg.usage-cost-report.v1";

function nonEmpty(value) {
  return String(value || "").trim();
}

function money(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.round(number * 1_000_000) / 1_000_000 : null;
}

function ratio(numerator, denominator) {
  if (!denominator) {
    return 0;
  }
  return Math.round((numerator / denominator) * 10_000) / 10_000;
}

function numberOrZero(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : 0;
}

function usageBreakdown(entry = {}, costEstimate = null) {
  const usage = entry.usage && typeof entry.usage === "object" ? entry.usage : {};
  const inputDetails = usage.input_tokens_details || usage.inputTokensDetails || {};
  const outputDetails = usage.output_tokens_details || usage.outputTokensDetails || {};
  const costTokens = costEstimate?.tokens || {};
  const inputTokens = numberOrZero(usage.input_tokens)
    || numberOrZero(usage.inputTokens)
    || numberOrZero(costTokens.inputTokens);
  const outputTokens = numberOrZero(usage.output_tokens)
    || numberOrZero(usage.outputTokens)
    || numberOrZero(costTokens.outputTokens);
  return {
    inputTokens,
    outputTokens,
    totalTokens: numberOrZero(usage.total_tokens)
      || numberOrZero(usage.totalTokens)
      || numberOrZero(costTokens.totalTokens)
      || inputTokens + outputTokens,
    reasoningTokens: numberOrZero(outputDetails.reasoning_tokens)
      || numberOrZero(outputDetails.reasoningTokens)
      || numberOrZero(costTokens.outputReasoningTokens),
    cachedInputTokens: numberOrZero(inputDetails.cached_tokens)
      || numberOrZero(inputDetails.cachedTokens)
      || numberOrZero(costTokens.cachedInputTokens),
    cacheWriteTokens: numberOrZero(inputDetails.cache_write_tokens)
      || numberOrZero(inputDetails.cacheWriteTokens)
      || numberOrZero(costTokens.cacheWriteTokens)
  };
}

async function readJsonIfExists(filePath) {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

async function readJsonlIfExists(filePath) {
  try {
    const lines = (await fs.readFile(filePath, "utf8")).split(/\r?\n/);
    const entries = [];
    let malformedLineCount = 0;
    for (const line of lines) {
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

function candidateKey(projectId, runId, candidateId) {
  if (!projectId || !runId || !candidateId) {
    return null;
  }
  return `${projectId}:${runId}:${candidateId}`;
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

function activityFromModelRun(projectId, entry = {}, index = 0) {
  const attribution = normalizeUsageAttribution(entry.attribution) || {};
  const metadata = entry.metadata && typeof entry.metadata === "object" ? entry.metadata : {};
  const provider = nonEmpty(entry.provider) || "openai";
  const status = nonEmpty(entry.status) || "unknown";
  const fallbackCostEstimate = entry.source === "image_generation"
    ? estimateOpenAiImageCost({
        usage: entry.usage,
        model: entry.model,
        size: metadata.size,
        quality: metadata.quality,
        imageCount: 1
      })
    : entry.source === "voice_input"
      ? estimateOpenAiTranscriptionCost({
          usage: entry.usage,
          model: entry.model,
          durationMs: metadata.audioDurationMs
        })
      : estimateOpenAiTextCost({ usage: entry.usage, model: entry.model });
  const costEstimate = entry.costEstimate || fallbackCostEstimate;
  const estimatedCostUsd = money(costEstimate?.estimatedCostUsd ?? costEstimate?.totalUsd);
  const successful = status === "success";
  const allowanceUsage = successful && provider === "codex_cli";
  const priced = successful && !allowanceUsage && estimatedCostUsd !== null;
  const capturedApiUsage = entry.usage
    && typeof entry.usage === "object"
    && Object.keys(entry.usage).length > 0;
  const costBasis = priced
    ? nonEmpty(costEstimate?.estimationBasis)
      || (capturedApiUsage || costEstimate?.usageAvailable === true ? "api_usage_tokens" : "legacy_estimate")
    : null;
  const runId = attribution.runId || nonEmpty(metadata.runId) || null;
  const candidateId = attribution.candidateId || nonEmpty(metadata.candidateId) || null;
  const pageNumber = attribution.pageNumber || Number(metadata.pageNumber || 0) || null;
  const tokens = usageBreakdown(entry, costEstimate);
  const requestShape = normalizeModelRequestShape(entry.requestShape);
  return {
    id: `${projectId}:model_run:${index + 1}`,
    createdAt: entry.createdAt || null,
    projectId,
    operationId: attribution.operationId || null,
    operationKind: attribution.operationKind || null,
    accessGrantId: attribution.accessGrantId || null,
    sessionId: attribution.sessionId || null,
    commandId: attribution.commandId || null,
    jobId: attribution.jobId || null,
    runId,
    candidateId,
    candidateKey: candidateKey(projectId, runId, candidateId),
    pageNumber,
    status,
    source: nonEmpty(entry.source) || "unknown",
    purpose: nonEmpty(entry.purpose) || null,
    route: nonEmpty(entry.route) || null,
    provider,
    model: nonEmpty(entry.model) || null,
    reasoningEffort: nonEmpty(entry.reasoningEffort) || null,
    estimatedCostUsd: priced ? estimatedCostUsd : null,
    costBasis,
    pricingSource: nonEmpty(costEstimate?.pricingSource) || null,
    pricingSourceDate: nonEmpty(costEstimate?.pricingSourceDate) || null,
    pricingStatus: !successful
      ? "failed"
      : allowanceUsage
        ? "allowance"
        : priced
          ? "priced"
          : "unpriced",
    usageCaptured: Boolean(capturedApiUsage),
    inputTokens: tokens.inputTokens || null,
    outputTokens: tokens.outputTokens || null,
    reasoningTokens: tokens.reasoningTokens || null,
    cachedInputTokens: tokens.cachedInputTokens || null,
    cacheWriteTokens: tokens.cacheWriteTokens || null,
    totalTokens: tokens.totalTokens || null,
    requestShape,
    durationMs: Number(entry.durationMs || 0) || null
  };
}

async function projectDrafts(projectsDir, projectId) {
  const runIds = await listDirectories(path.join(projectsDir, projectId, "runs"));
  const drafts = [];
  for (const runDirName of runIds) {
    const manifest = await readJsonIfExists(path.join(projectsDir, projectId, "runs", runDirName, "run-manifest.json"));
    const runId = manifest?.runId || runDirName;
    for (const candidate of manifest?.candidates || []) {
      const pages = Array.isArray(candidate.pages) ? candidate.pages : [];
      const generatedPageCount = pages.filter((page) => page?.path).length;
      drafts.push({
        key: candidateKey(projectId, runId, candidate.id),
        projectId,
        runId,
        candidateId: candidate.id || null,
        createdAt: candidate.createdAt || manifest?.createdAt || null,
        status: candidate.status || "unknown",
        pageCount: pages.length,
        generatedPageCount,
        chargeable: generatedPageCount > 0 && candidate.status !== "technical_failed",
        provider: candidate.generation?.provider || null,
        model: candidate.generation?.model || null
      });
    }
  }
  return drafts.filter((draft) => draft.key);
}

function emptyAggregate(id, label = id) {
  return {
    id,
    label,
    modelRunCount: 0,
    successfulRunCount: 0,
    failedRunCount: 0,
    pricedRunCount: 0,
    unpricedRunCount: 0,
    codexAllowanceCallCount: 0,
    apiUsagePricedRunCount: 0,
    fallbackPricedRunCount: 0,
    knownCostUsd: 0,
    inputTokens: 0,
    outputTokens: 0,
    reasoningTokens: 0,
    cachedInputTokens: 0,
    cacheWriteTokens: 0,
    totalTokens: 0,
    measuredRequestCount: 0,
    totalMeasuredRequestChars: 0,
    instructionChars: 0,
    inputTextChars: 0,
    responseSchemaChars: 0,
    toolDefinitionChars: 0,
    inputMessageCount: 0,
    inputTextItemCount: 0,
    inputImageItemCount: 0,
    inputFileItemCount: 0,
    inputAudioItemCount: 0,
    draftCount: 0,
    chargeableDraftCount: 0,
    pageCount: 0,
    candidateKeys: new Set()
  };
}

function addActivity(aggregate, activity) {
  aggregate.modelRunCount += 1;
  aggregate.successfulRunCount += activity.status === "success" ? 1 : 0;
  aggregate.failedRunCount += activity.status === "success" ? 0 : 1;
  aggregate.pricedRunCount += activity.pricingStatus === "priced" ? 1 : 0;
  aggregate.unpricedRunCount += activity.pricingStatus === "unpriced" ? 1 : 0;
  aggregate.codexAllowanceCallCount += activity.pricingStatus === "allowance" ? 1 : 0;
  aggregate.apiUsagePricedRunCount += activity.costBasis === "api_usage_tokens" ? 1 : 0;
  aggregate.fallbackPricedRunCount += activity.pricingStatus === "priced"
    && activity.costBasis !== "api_usage_tokens" ? 1 : 0;
  aggregate.knownCostUsd += Number(activity.estimatedCostUsd || 0);
  aggregate.inputTokens += Number(activity.inputTokens || 0);
  aggregate.outputTokens += Number(activity.outputTokens || 0);
  aggregate.reasoningTokens += Number(activity.reasoningTokens || 0);
  aggregate.cachedInputTokens += Number(activity.cachedInputTokens || 0);
  aggregate.cacheWriteTokens += Number(activity.cacheWriteTokens || 0);
  aggregate.totalTokens += Number(activity.totalTokens || 0);
  if (activity.requestShape) {
    aggregate.measuredRequestCount += 1;
    aggregate.totalMeasuredRequestChars += Number(activity.requestShape.totalMeasuredChars || 0);
    aggregate.instructionChars += Number(activity.requestShape.instructionsChars || 0);
    aggregate.inputTextChars += Number(activity.requestShape.inputTextChars || 0);
    aggregate.responseSchemaChars += Number(activity.requestShape.schemaChars || 0);
    aggregate.toolDefinitionChars += Number(activity.requestShape.toolDefinitionChars || 0);
    aggregate.inputMessageCount += Number(activity.requestShape.inputMessageCount || 0);
    aggregate.inputTextItemCount += Number(activity.requestShape.inputTextItemCount || 0);
    aggregate.inputImageItemCount += Number(activity.requestShape.inputImageItemCount || 0);
    aggregate.inputFileItemCount += Number(activity.requestShape.inputFileItemCount || 0);
    aggregate.inputAudioItemCount += Number(activity.requestShape.inputAudioItemCount || 0);
  }
  if (activity.candidateKey) {
    aggregate.candidateKeys.add(activity.candidateKey);
  }
}

function addDraft(aggregate, draft) {
  aggregate.draftCount += 1;
  aggregate.chargeableDraftCount += draft.chargeable ? 1 : 0;
  aggregate.pageCount += Number(draft.generatedPageCount || draft.pageCount || 0);
}

function publicAggregate(aggregate, options = {}) {
  const knownCostUsd = money(aggregate.knownCostUsd) || 0;
  return {
    id: aggregate.id,
    label: aggregate.label,
    modelRunCount: aggregate.modelRunCount,
    successfulRunCount: aggregate.successfulRunCount,
    failedRunCount: aggregate.failedRunCount,
    pricedRunCount: aggregate.pricedRunCount,
    unpricedRunCount: aggregate.unpricedRunCount,
    codexAllowanceCallCount: aggregate.codexAllowanceCallCount,
    apiUsagePricedRunCount: aggregate.apiUsagePricedRunCount,
    fallbackPricedRunCount: aggregate.fallbackPricedRunCount,
    knownCostUsd,
    inputTokens: aggregate.inputTokens || 0,
    outputTokens: aggregate.outputTokens || 0,
    reasoningTokens: aggregate.reasoningTokens || 0,
    cachedInputTokens: aggregate.cachedInputTokens || 0,
    cacheWriteTokens: aggregate.cacheWriteTokens || 0,
    totalTokens: aggregate.totalTokens || 0,
    cacheReadRate: ratio(aggregate.cachedInputTokens, aggregate.inputTokens),
    cacheWriteRate: ratio(aggregate.cacheWriteTokens, aggregate.inputTokens),
    measuredRequestCount: aggregate.measuredRequestCount,
    totalMeasuredRequestChars: aggregate.totalMeasuredRequestChars,
    instructionChars: aggregate.instructionChars,
    inputTextChars: aggregate.inputTextChars,
    responseSchemaChars: aggregate.responseSchemaChars,
    toolDefinitionChars: aggregate.toolDefinitionChars,
    inputMessageCount: aggregate.inputMessageCount,
    inputTextItemCount: aggregate.inputTextItemCount,
    inputImageItemCount: aggregate.inputImageItemCount,
    inputFileItemCount: aggregate.inputFileItemCount,
    inputAudioItemCount: aggregate.inputAudioItemCount,
    draftCount: aggregate.draftCount,
    chargeableDraftCount: aggregate.chargeableDraftCount,
    pageCount: aggregate.pageCount,
    knownCostPerChargeableDraftUsd: aggregate.chargeableDraftCount
      ? money(knownCostUsd / aggregate.chargeableDraftCount)
      : null,
    ...(options.includeCandidateKeys ? { candidateKeys: [...aggregate.candidateKeys].sort() } : {})
  };
}

function groupActivities(activities, keyFor, labelFor = keyFor) {
  const groups = new Map();
  for (const activity of activities) {
    const id = keyFor(activity) || "unattributed";
    const aggregate = groups.get(id) || emptyAggregate(id, labelFor(activity) || id);
    addActivity(aggregate, activity);
    groups.set(id, aggregate);
  }
  return groups;
}

function draftOwners(activities) {
  const owners = new Map();
  for (const activity of activities) {
    if (!activity.candidateKey) {
      continue;
    }
    const owner = owners.get(activity.candidateKey) || {
      accessGrantIds: new Set(),
      operationIds: new Set()
    };
    if (activity.accessGrantId) {
      owner.accessGrantIds.add(activity.accessGrantId);
    }
    if (activity.operationId) {
      owner.operationIds.add(activity.operationId);
    }
    owners.set(activity.candidateKey, owner);
  }
  return owners;
}

function singleValue(values) {
  return values?.size === 1 ? [...values][0] : null;
}

function sortAggregates(values, options = {}) {
  return [...values]
    .map((aggregate) => publicAggregate(aggregate, options))
    .sort((left, right) => right.knownCostUsd - left.knownCostUsd || left.id.localeCompare(right.id));
}

async function buildUsageCostReport(options = {}) {
  const projectsDir = options.projectsDir;
  if (!projectsDir) {
    throw new Error("projectsDir is required.");
  }
  const filters = {
    projectId: nonEmpty(options.projectId) || null,
    accessGrantId: nonEmpty(options.accessGrantId) || null,
    from: nonEmpty(options.from) || null,
    to: nonEmpty(options.to) || null
  };
  const allProjectIds = filters.projectId ? [filters.projectId] : await listDirectories(projectsDir);
  const activities = [];
  const drafts = [];
  let malformedLineCount = 0;

  for (const projectId of allProjectIds) {
    const modelRuns = await readJsonlIfExists(path.join(projectsDir, projectId, "history", "model-runs.jsonl"));
    malformedLineCount += modelRuns.malformedLineCount;
    activities.push(...modelRuns.entries.map((entry, index) => activityFromModelRun(projectId, entry, index)));
    drafts.push(...await projectDrafts(projectsDir, projectId));
  }

  const datedActivities = activities.filter((activity) => inDateRange(activity.createdAt, filters));
  const filteredActivities = filters.accessGrantId
    ? datedActivities.filter((activity) => activity.accessGrantId === filters.accessGrantId)
    : datedActivities;
  const owners = draftOwners(datedActivities);
  const filteredDrafts = drafts.filter((draft) => {
    if (!inDateRange(draft.createdAt, filters)) {
      return false;
    }
    if (!filters.accessGrantId) {
      return true;
    }
    return singleValue(owners.get(draft.key)?.accessGrantIds) === filters.accessGrantId;
  });

  const byProject = groupActivities(filteredActivities, (activity) => activity.projectId);
  const byGrant = groupActivities(filteredActivities, (activity) => activity.accessGrantId);
  const byOperationKind = groupActivities(filteredActivities, (activity) => activity.operationKind || "legacy_unattributed");
  const bySource = groupActivities(filteredActivities, (activity) => activity.source);
  const byPurpose = groupActivities(
    filteredActivities,
    (activity) => `${activity.source}:${activity.purpose || "unspecified"}`,
    (activity) => activity.purpose || "unspecified"
  );
  const byProvider = groupActivities(filteredActivities, (activity) => activity.provider);
  const byModel = groupActivities(
    filteredActivities,
    (activity) => `${activity.provider}:${activity.model || "unknown"}`,
    (activity) => activity.model || "unknown"
  );
  const byModelProfile = groupActivities(
    filteredActivities,
    (activity) => `${activity.provider}:${activity.model || "unknown"}:${activity.reasoningEffort || "unspecified"}`,
    (activity) => `${activity.model || "unknown"} · ${activity.reasoningEffort || "unspecified"}`
  );
  const byCostBasis = groupActivities(
    filteredActivities,
    (activity) => activity.costBasis || activity.pricingStatus
  );
  const byOperation = groupActivities(
    filteredActivities,
    (activity) => activity.operationId || `legacy_${activity.id}`,
    (activity) => activity.operationKind || "legacy_unattributed"
  );

  for (const draft of filteredDrafts) {
    const projectAggregate = byProject.get(draft.projectId) || emptyAggregate(draft.projectId);
    addDraft(projectAggregate, draft);
    byProject.set(draft.projectId, projectAggregate);

    const owner = owners.get(draft.key);
    const grantId = singleValue(owner?.accessGrantIds) || "unattributed";
    const grantAggregate = byGrant.get(grantId) || emptyAggregate(grantId);
    addDraft(grantAggregate, draft);
    byGrant.set(grantId, grantAggregate);

    const operationId = singleValue(owner?.operationIds);
    if (operationId && byOperation.has(operationId)) {
      addDraft(byOperation.get(operationId), draft);
    }
  }

  const total = emptyAggregate("total", "Total");
  filteredActivities.forEach((activity) => addActivity(total, activity));
  filteredDrafts.forEach((draft) => addDraft(total, draft));
  const totals = publicAggregate(total);
  const generationOperations = [...byOperation.values()].filter((operation) => operation.draftCount > 0);
  const generationKnownCostUsd = generationOperations.reduce((sum, operation) => sum + operation.knownCostUsd, 0);
  const generationDraftCount = generationOperations.reduce((sum, operation) => sum + operation.chargeableDraftCount, 0);
  const successful = filteredActivities.filter((activity) => activity.status === "success");
  const requestShapeEligible = successful.filter((activity) => activity.provider === "openai"
    && !["image_generation", "voice_input"].includes(activity.source));
  const requestShapeCaptured = requestShapeEligible.filter((activity) => activity.requestShape);
  const usageCaptured = successful.filter((activity) => activity.usageCaptured);
  const operationAttributed = successful.filter((activity) => activity.operationId).length;
  const grantAttributed = successful.filter((activity) => activity.accessGrantId).length;
  const ownerAttributedDrafts = filteredDrafts.filter((draft) => singleValue(owners.get(draft.key)?.accessGrantIds)).length;

  return {
    schemaVersion: REPORT_SCHEMA_VERSION,
    generatedAt: options.now || new Date().toISOString(),
    filters,
    totals,
    coverage: {
      malformedLineCount,
      successfulModelRunCount: successful.length,
      operationAttributedModelRunCount: operationAttributed,
      operationAttributionRate: ratio(operationAttributed, successful.length),
      accessGrantAttributedModelRunCount: grantAttributed,
      accessGrantAttributionRate: ratio(grantAttributed, successful.length),
      pricedModelRunCount: totals.pricedRunCount,
      unpricedModelRunCount: totals.unpricedRunCount,
      pricingCoverageRate: ratio(totals.pricedRunCount, totals.pricedRunCount + totals.unpricedRunCount),
      apiUsagePricedModelRunCount: totals.apiUsagePricedRunCount,
      fallbackPricedModelRunCount: totals.fallbackPricedRunCount,
      apiUsagePricingRate: ratio(totals.apiUsagePricedRunCount, totals.pricedRunCount),
      usageCapturedModelRunCount: usageCaptured.length,
      usageCaptureRate: ratio(usageCaptured.length, successful.length),
      requestShapeEligibleModelRunCount: requestShapeEligible.length,
      requestShapeCapturedModelRunCount: requestShapeCaptured.length,
      requestShapeCoverageRate: ratio(requestShapeCaptured.length, requestShapeEligible.length),
      accessGrantAttributedDraftCount: ownerAttributedDrafts,
      accessGrantDraftAttributionRate: ratio(ownerAttributedDrafts, filteredDrafts.length)
    },
    unitEconomics: {
      chargeableDraftCount: totals.chargeableDraftCount,
      generatedPageCount: totals.pageCount,
      blendedKnownCostPerChargeableDraftUsd: totals.knownCostPerChargeableDraftUsd,
      generationOperationDraftCount: generationDraftCount,
      generationOperationKnownCostUsd: money(generationKnownCostUsd) || 0,
      generationOperationKnownCostPerDraftUsd: generationDraftCount
        ? money(generationKnownCostUsd / generationDraftCount)
        : null,
      note: "Blended cost divides all known API cost by completed Entwürfe; generation-operation cost includes only calls sharing the Entwurf operationId."
    },
    byAccessGrant: sortAggregates(byGrant.values()),
    byProject: sortAggregates(byProject.values()),
    byOperationKind: sortAggregates(byOperationKind.values()),
    bySource: sortAggregates(bySource.values()),
    byPurpose: sortAggregates(byPurpose.values()),
    byProvider: sortAggregates(byProvider.values()),
    byModel: sortAggregates(byModel.values()),
    byModelProfile: sortAggregates(byModelProfile.values()),
    byCostBasis: sortAggregates(byCostBasis.values()),
    operations: sortAggregates(byOperation.values(), { includeCandidateKeys: true }),
    ...(options.includeModelRuns ? { modelRuns: filteredActivities } : {}),
    drafts: filteredDrafts.map((draft) => {
      const owner = owners.get(draft.key);
      return {
        ...draft,
        accessGrantId: singleValue(owner?.accessGrantIds),
        operationId: singleValue(owner?.operationIds),
        attributionAmbiguous: Boolean(
          (owner?.accessGrantIds?.size || 0) > 1
          || (owner?.operationIds?.size || 0) > 1
        )
      };
    })
  };
}

module.exports = {
  REPORT_SCHEMA_VERSION,
  buildUsageCostReport
};
