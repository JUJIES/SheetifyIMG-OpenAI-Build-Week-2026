"use strict";

const fs = require("node:fs/promises");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { getImageRuntimeStatus } = require("../aiConfig");
const {
  estimateOpenAiImageCost,
  estimateOpenAiImagePresetCost,
  estimateOpenAiTextCost
} = require("../imageCostManager");

function nonEmpty(value) {
  return String(value || "").trim();
}

function numberOrNull(value) {
  if (value === undefined || value === null || value === "") {
    return null;
  }
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function unixSeconds(date) {
  return Math.floor(date.getTime() / 1000);
}

function startOfMonth(date = new Date()) {
  return new Date(date.getFullYear(), date.getMonth(), 1, 0, 0, 0, 0);
}

function appendQuery(url, key, value) {
  if (value === undefined || value === null || value === "") {
    return;
  }
  if (Array.isArray(value)) {
    for (const entry of value) {
      appendQuery(url, key, entry);
    }
    return;
  }
  url.searchParams.append(key, String(value));
}

async function readJsonSafe(response) {
  const text = await response.text();
  if (!text) {
    return null;
  }
  try {
    return JSON.parse(text);
  } catch {
    return { message: text.slice(0, 500) };
  }
}

async function readJsonIfExists(filePath) {
  try {
    const text = await fs.readFile(filePath, "utf8");
    return JSON.parse(text);
  } catch (error) {
    if (error.code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

async function readJsonlIfExists(filePath) {
  try {
    const text = await fs.readFile(filePath, "utf8");
    return text.split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        try {
          return JSON.parse(line);
        } catch {
          return null;
        }
      })
      .filter(Boolean);
  } catch (error) {
    if (error.code === "ENOENT") {
      return [];
    }
    throw error;
  }
}

async function listDirs(dirPath) {
  try {
    const entries = await fs.readdir(dirPath, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => path.join(dirPath, entry.name))
      .sort();
  } catch (error) {
    if (error.code === "ENOENT") {
      return [];
    }
    throw error;
  }
}

function moneyOrNull(value) {
  const number = numberOrNull(value);
  return number === null ? null : Math.round(number * 1_000_000) / 1_000_000;
}

function costEstimateAmount(costEstimate = {}) {
  if (!costEstimate || typeof costEstimate !== "object") {
    return null;
  }
  return moneyOrNull(costEstimate.estimatedCostUsd);
}

function tokenTotal(costEstimate = {}, usage = {}) {
  const estimate = costEstimate && typeof costEstimate === "object" ? costEstimate : {};
  const usageEntry = usage && typeof usage === "object" ? usage : {};
  return Number(estimate.tokens?.totalTokens || 0)
    || Number(usageEntry.total_tokens || usageEntry.totalTokens || 0)
    || (Number(usageEntry.input_tokens || 0) + Number(usageEntry.output_tokens || 0))
    || null;
}

function sourceLabel(entry = {}) {
  const labels = {
    chat: "Chat",
    proposal: "Konzeptvorschlag",
    chat_narration: "Chat-Begleittext",
    semantic_interpreter: "Input-Verstehen",
    voice_input: "Spracheingabe",
    image_generation: "Bildgenerierung"
  };
  return labels[entry.source] || entry.source || entry.purpose || "OpenAI";
}

function textActivityFromModelRun(entry = {}) {
  if (entry.status !== "success" || entry.provider === "codex_cli" || entry.source === "image_generation") {
    return null;
  }
  const usage = entry.usage || null;
  const costEstimate = entry.costEstimate || estimateOpenAiTextCost({
    usage,
    model: entry.model
  });
  const amount = costEstimateAmount(costEstimate);
  if (amount === null) {
    return null;
  }
  return {
    id: `${entry.createdAt || ""}:${entry.source || "model"}:${entry.responseId || ""}`,
    kind: "llm",
    label: sourceLabel(entry),
    createdAt: entry.createdAt || null,
    provider: entry.provider || "openai",
    model: entry.model || null,
    route: entry.route || null,
    purpose: entry.purpose || null,
    estimatedCostUsd: amount,
    totalTokens: tokenTotal(costEstimate, usage),
    costEstimate
  };
}

function imageActivityFromModelRun(entry = {}) {
  if (entry.status !== "success" || entry.provider === "codex_cli" || entry.source !== "image_generation") {
    return null;
  }
  const usage = entry.usage || null;
  const metadata = entry.metadata || {};
  const costEstimate = entry.costEstimate || estimateOpenAiImageCost({
    usage,
    model: entry.model,
    size: metadata.size,
    quality: metadata.quality,
    imageCount: 1
  });
  const amount = costEstimateAmount(costEstimate);
  if (amount === null) {
    return null;
  }
  return {
    id: `${entry.createdAt || ""}:image:${metadata.candidateId || ""}:${metadata.pageNumber || ""}`,
    kind: "image_generation",
    label: metadata.candidateId
      ? `Bild ${metadata.candidateId}${metadata.pageNumber ? `, Seite ${metadata.pageNumber}` : ""}`
      : "Bildgenerierung",
    createdAt: entry.createdAt || null,
    provider: "openai",
    model: entry.model || null,
    route: entry.route || null,
    purpose: entry.purpose || null,
    runId: metadata.runId || null,
    candidateId: metadata.candidateId || null,
    pageNumber: metadata.pageNumber || null,
    estimatedCostUsd: amount,
    totalTokens: tokenTotal(costEstimate, usage),
    costEstimate
  };
}

async function imageActivitiesFromRun(runDir) {
  const manifest = await readJsonIfExists(path.join(runDir, "run-manifest.json"));
  const runId = manifest?.runId || path.basename(runDir);
  const activities = [];
  for (const candidate of manifest?.candidates || []) {
    if ((candidate.generation?.provider || "openai") === "codex_cli") {
      continue;
    }
    let totalCost = 0;
    let totalTokens = 0;
    let pricedPageCount = 0;
    let pageCount = 0;
    let firstCostEstimate = null;
    for (const pageEntry of candidate.pages || []) {
      pageCount += 1;
      if (!pageEntry.path) {
        continue;
      }
      const assetPath = path.join(runDir, pageEntry.path.replace(/\.[^.]+$/, ".asset.json"));
      const asset = await readJsonIfExists(assetPath);
      const metadata = asset?.metadata || {};
      const usage = metadata.usage || null;
      const costEstimate = metadata.costEstimate || estimateOpenAiImageCost({
        usage,
        model: metadata.model || candidate.generation?.model,
        size: metadata.size || candidate.generation?.size,
        quality: metadata.quality || candidate.generation?.quality,
        imageCount: 1
      });
      const amount = costEstimateAmount(costEstimate);
      if (amount !== null) {
        totalCost += amount;
        pricedPageCount += 1;
        firstCostEstimate ||= costEstimate;
      }
      totalTokens += Number(tokenTotal(costEstimate, usage) || 0);
    }
    if (pricedPageCount > 0) {
      activities.push({
        id: `${runId}:${candidate.id}`,
        kind: "image_generation",
        label: pageCount > 1 ? `Entwurf ${candidate.id} (${pageCount} Seiten)` : `Entwurf ${candidate.id}`,
        createdAt: candidate.createdAt || manifest.createdAt || null,
        provider: "openai",
        model: candidate.generation?.model || firstCostEstimate?.model || null,
        runId,
        candidateId: candidate.id,
        pageCount,
        pricedPageCount,
        estimatedCostUsd: moneyOrNull(totalCost),
        totalTokens: totalTokens || null,
        costEstimate: firstCostEstimate
      });
    }
  }
  return activities;
}

async function projectBillingActivity(options = {}) {
  const projectId = nonEmpty(options.projectId);
  const projectsDir = options.projectsDir;
  if (!projectId || !projectsDir) {
    return null;
  }
  const projectDir = path.join(projectsDir, projectId);
  const modelRuns = await readJsonlIfExists(path.join(projectDir, "history", "model-runs.jsonl"));
  const modelActivities = modelRuns
    .map((entry) => textActivityFromModelRun(entry) || imageActivityFromModelRun(entry))
    .filter(Boolean);
  const runDirs = await listDirs(path.join(projectDir, "runs"));
  const candidateActivityGroups = await Promise.all(runDirs.map(imageActivitiesFromRun));
  const candidateActivities = candidateActivityGroups.flat();
  const imageCandidateIds = new Set(candidateActivities.map((entry) => `${entry.runId}:${entry.candidateId}`));
  const deDuplicatedModelActivities = modelActivities.filter((entry) => {
    if (entry.kind !== "image_generation") {
      return true;
    }
    return !entry.candidateId || !entry.runId || !imageCandidateIds.has(`${entry.runId}:${entry.candidateId}`);
  });
  const activities = [...candidateActivities, ...deDuplicatedModelActivities]
    .sort((left, right) => String(right.createdAt || "").localeCompare(String(left.createdAt || "")));
  const totals = activities.reduce((acc, activity) => {
    const amount = Number(activity.estimatedCostUsd || 0);
    acc.knownCostUsd += amount;
    if (activity.kind === "image_generation") {
      acc.imageCostUsd += amount;
      acc.imageRuns += 1;
    } else {
      acc.llmCostUsd += amount;
      acc.llmRuns += 1;
    }
    return acc;
  }, {
    knownCostUsd: 0,
    imageCostUsd: 0,
    llmCostUsd: 0,
    imageRuns: 0,
    llmRuns: 0
  });
  const unpricedModelRunCount = modelRuns.filter((entry) => {
    return entry.status === "success"
      && entry.provider !== "codex_cli"
      && !entry.usage
      && !entry.costEstimate;
  }).length;
  return {
    projectId,
    recentCosts: activities.slice(0, 6),
    recentThreeCosts: activities.slice(0, 3),
    totals: {
      knownCostUsd: moneyOrNull(totals.knownCostUsd) || 0,
      imageCostUsd: moneyOrNull(totals.imageCostUsd) || 0,
      llmCostUsd: moneyOrNull(totals.llmCostUsd) || 0,
      imageRuns: totals.imageRuns,
      llmRuns: totals.llmRuns
    },
    unpricedModelRunCount
  };
}

async function fetchOpenAiAdminJson(pathname, query, config) {
  const baseUrl = nonEmpty(config.baseUrl) || "https://api.openai.com/v1";
  const url = new URL(`${baseUrl.replace(/\/$/, "")}${pathname}`);
  for (const [key, value] of Object.entries(query || {})) {
    appendQuery(url, key, value);
  }

  const response = await fetch(url, {
    headers: {
      authorization: `Bearer ${config.adminKey}`,
      "content-type": "application/json"
    }
  });
  const payload = await readJsonSafe(response);
  if (!response.ok) {
    const message = payload?.error?.message || payload?.message || `OpenAI admin request failed with status ${response.status}.`;
    throw new Error(message);
  }
  return payload;
}

function amountValue(result = {}) {
  return numberOrNull(result.amount?.value) || 0;
}

function aggregateCosts(payload = {}) {
  let totalUsd = 0;
  let imageUsd = 0;
  const lineItems = [];
  for (const bucket of payload.data || []) {
    for (const result of bucket.results || []) {
      const value = amountValue(result);
      totalUsd += value;
      const lineItem = String(result.line_item || "").trim();
      if (lineItem) {
        lineItems.push({
          lineItem,
          amountUsd: value,
          quantity: numberOrNull(result.quantity)
        });
      }
      if (/image|gpt-image/i.test(lineItem)) {
        imageUsd += value;
      }
    }
  }
  return {
    totalUsd,
    imageUsd: lineItems.length ? imageUsd : null,
    lineItems
  };
}

function aggregateImageUsage(payload = {}) {
  let images = 0;
  let requests = 0;
  for (const bucket of payload.data || []) {
    for (const result of bucket.results || []) {
      images += Number(result.images) || 0;
      requests += Number(result.num_model_requests) || 0;
    }
  }
  return { images, requests };
}

async function openAiBillingStatus(env = process.env, options = {}) {
  const now = options.now ? new Date(options.now) : new Date();
  const periodStart = startOfMonth(now);
  const periodEnd = now;
  const imageRuntime = getImageRuntimeStatus(env, { imageProvider: "openai" });
  const apiKeyConfigured = Boolean(nonEmpty(env.OPENAI_API_KEY));
  const adminKey = nonEmpty(env.OPENAI_ADMIN_KEY) || nonEmpty(env.SHEETIFYIMG_OPENAI_ADMIN_KEY);
  const budgetUsd = numberOrNull(env.SHEETIFYIMG_OPENAI_MONTHLY_BUDGET_USD || env.OPENAI_MONTHLY_BUDGET_USD);
  const requestEstimate = estimateOpenAiImagePresetCost({
    model: imageRuntime.imageModel,
    size: imageRuntime.imageSize,
    quality: imageRuntime.imageQuality
  });

  const status = {
    provider: "openai",
    apiKeyConfigured,
    adminConfigured: Boolean(adminKey),
    imageModel: imageRuntime.imageModel,
    imageSize: imageRuntime.imageSize,
    imageQuality: imageRuntime.imageQuality,
    imageQualityPreset: imageRuntime.imageQualityPreset,
    imageQualityLabel: imageRuntime.imageQualityLabel,
    requestEstimate,
    budgetUsd,
    periodStart: periodStart.toISOString(),
    periodEnd: periodEnd.toISOString(),
    costsAvailable: false,
    imageUsageAvailable: false
  };

  if (!adminKey) {
    return {
      ...status,
      message: apiKeyConfigured
        ? "OpenAI API ist konfiguriert. Monatskosten brauchen einen OPENAI_ADMIN_KEY."
        : "OPENAI_API_KEY ist nicht konfiguriert."
    };
  }

  const config = {
    adminKey,
    baseUrl: nonEmpty(env.OPENAI_BASE_URL) || "https://api.openai.com/v1"
  };
  const query = {
    start_time: unixSeconds(periodStart),
    end_time: unixSeconds(periodEnd),
    bucket_width: "1d",
    limit: 31
  };

  try {
    let costPayload;
    try {
      costPayload = await fetchOpenAiAdminJson("/organization/costs", {
        ...query,
        group_by: "line_item"
      }, config);
    } catch {
      costPayload = await fetchOpenAiAdminJson("/organization/costs", query, config);
    }
    const costs = aggregateCosts(costPayload);
    status.costsAvailable = true;
    status.monthCostUsd = Math.round(costs.totalUsd * 1_000_000) / 1_000_000;
    status.monthImageCostUsd = costs.imageUsd === null ? null : Math.round(costs.imageUsd * 1_000_000) / 1_000_000;
    status.remainingBudgetUsd = budgetUsd === null ? null : Math.round((budgetUsd - status.monthCostUsd) * 1_000_000) / 1_000_000;
    status.lineItems = costs.lineItems.slice(0, 12);
  } catch (error) {
    status.costsError = String(error.message || error).slice(0, 500);
  }

  try {
    const usagePayload = await fetchOpenAiAdminJson("/organization/usage/images", query, config);
    const usage = aggregateImageUsage(usagePayload);
    status.imageUsageAvailable = true;
    status.monthImageCount = usage.images;
    status.monthImageRequests = usage.requests;
  } catch (error) {
    status.imageUsageError = String(error.message || error).slice(0, 500);
  }

  return status;
}

function jsonLineParser(onMessage) {
  let buffer = "";
  return (chunk) => {
    buffer += chunk.toString("utf8");
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() || "";
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) {
        continue;
      }
      try {
        onMessage(JSON.parse(trimmed));
      } catch {
        // Ignore non-JSON diagnostics. The app-server writes structured messages on stdout.
      }
    }
  };
}

function runCodexAppServerRequests(requests, config = {}) {
  return new Promise((resolve, reject) => {
    const codexBin = config.codexBin || "codex";
    const child = spawn(codexBin, ["app-server", "--stdio"], {
      cwd: config.cwd,
      stdio: ["pipe", "pipe", "pipe"]
    });
    const pending = new Set(requests.map((request) => request.id));
    const results = {};
    let initialized = false;
    let settled = false;
    let stderr = "";

    const finish = (error) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      child.kill("SIGTERM");
      if (error) {
        reject(error);
        return;
      }
      resolve(results);
    };

    const send = (message) => {
      child.stdin.write(`${JSON.stringify(message)}\n`);
    };

    const timer = setTimeout(() => {
      finish(new Error("Codex usage status timed out."));
    }, config.timeoutMs || 7000);

    child.on("error", finish);
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString("utf8");
    });
    child.stdout.on("data", jsonLineParser((message) => {
      if (message.id === 0) {
        if (message.error) {
          finish(new Error(message.error.message || "Codex app-server initialization failed."));
          return;
        }
        initialized = true;
        for (const request of requests) {
          send(request);
        }
        return;
      }
      if (!initialized || !pending.has(message.id)) {
        return;
      }
      pending.delete(message.id);
      results[message.id] = message.error
        ? { error: message.error.message || "Codex app-server request failed." }
        : message.result;
      if (pending.size === 0) {
        finish();
      }
    }));
    child.on("close", () => {
      if (!settled && pending.size > 0) {
        finish(new Error(stderr.trim().slice(0, 500) || "Codex app-server closed before returning usage status."));
      }
    });

    send({
      method: "initialize",
      id: 0,
      params: {
        clientInfo: {
          name: "SheetifyIMG",
          version: "dev"
        },
        capabilities: {}
      }
    });
  });
}

function normalizeWindow(window = {}) {
  const usedPercent = numberOrNull(window.usedPercent);
  const windowDurationMins = numberOrNull(window.windowDurationMins);
  const resetsAt = numberOrNull(window.resetsAt);
  return {
    usedPercent,
    remainingPercent: usedPercent === null ? null : Math.max(0, 100 - usedPercent),
    windowDurationMins,
    resetsAt: resetsAt ? new Date(resetsAt * 1000).toISOString() : null
  };
}

function normalizeRateLimit(limit = {}) {
  if (!limit || typeof limit !== "object") {
    return null;
  }
  return {
    limitId: limit.limitId || null,
    limitName: limit.limitName || null,
    planType: limit.planType || null,
    primary: limit.primary ? normalizeWindow(limit.primary) : null,
    secondary: limit.secondary ? normalizeWindow(limit.secondary) : null,
    credits: limit.credits ? {
      hasCredits: Boolean(limit.credits.hasCredits),
      unlimited: Boolean(limit.credits.unlimited),
      balance: limit.credits.balance ?? null
    } : null,
    rateLimitReachedType: limit.rateLimitReachedType || null
  };
}

async function codexBillingStatus(env = process.env, options = {}) {
  const imageRuntime = getImageRuntimeStatus(env);
  const status = {
    provider: "codex_cli",
    enabled: imageRuntime.canUseCodex,
    available: false
  };
  if (!imageRuntime.canUseCodex) {
    return {
      ...status,
      message: "Codex Usage ist in diesem Setup deaktiviert."
    };
  }

  try {
    const results = await runCodexAppServerRequests([
      { method: "account/rateLimits/read", id: 1 },
      { method: "account/usage/read", id: 2 }
    ], {
      codexBin: imageRuntime.codexBin,
      cwd: options.cwd,
      timeoutMs: options.timeoutMs || 7000
    });
    const rateLimitsResult = results[1] || {};
    const usageResult = results[2] || {};
    if (rateLimitsResult.error) {
      throw new Error(rateLimitsResult.error);
    }
    const mainLimit = normalizeRateLimit(rateLimitsResult.rateLimits);
    return {
      ...status,
      available: true,
      rateLimits: mainLimit,
      rateLimitsByLimitId: Object.fromEntries(Object.entries(rateLimitsResult.rateLimitsByLimitId || {})
        .map(([key, value]) => [key, normalizeRateLimit(value)])
        .filter(([, value]) => value)),
      rateLimitResetCredits: rateLimitsResult.rateLimitResetCredits || null,
      usageSummary: usageResult.error ? null : usageResult.summary || null
    };
  } catch (error) {
    return {
      ...status,
      error: String(error.message || error).slice(0, 500),
      message: "Codex Usage-Status konnte nicht abgerufen werden."
    };
  }
}

async function buildBillingStatus(options = {}) {
  const env = options.env || process.env;
  const [openai, codex, project] = await Promise.all([
    openAiBillingStatus(env, options),
    codexBillingStatus(env, options),
    projectBillingActivity(options)
  ]);
  return {
    generatedAt: new Date().toISOString(),
    openai,
    codex,
    project
  };
}

module.exports = {
  buildBillingStatus,
  codexBillingStatus,
  openAiBillingStatus,
  projectBillingActivity,
  runCodexAppServerRequests
};
