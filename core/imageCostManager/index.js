"use strict";

const USD_PER_MILLION = 1_000_000;

const OPENAI_TEXT_PRICING = {
  "gpt-5.6-sol": {
    id: "gpt-5.6-sol",
    label: "GPT-5.6 Sol",
    currency: "usd",
    source: "openai_api_pricing",
    sourceDate: "2026-07-13",
    contextTier: "short_context",
    ratesPerMillionTokens: {
      input: 5,
      cachedInput: 0.5,
      cacheWrite: 6.25,
      output: 30
    }
  },
  "gpt-5.6-terra": {
    id: "gpt-5.6-terra",
    label: "GPT-5.6 Terra",
    currency: "usd",
    source: "openai_api_pricing",
    sourceDate: "2026-07-13",
    contextTier: "short_context",
    ratesPerMillionTokens: {
      input: 2.5,
      cachedInput: 0.25,
      cacheWrite: 3.125,
      output: 15
    }
  },
  "gpt-5.6-luna": {
    id: "gpt-5.6-luna",
    label: "GPT-5.6 Luna",
    currency: "usd",
    source: "openai_api_pricing",
    sourceDate: "2026-07-13",
    contextTier: "short_context",
    ratesPerMillionTokens: {
      input: 1,
      cachedInput: 0.1,
      cacheWrite: 1.25,
      output: 6
    }
  },
  "gpt-5.5": {
    id: "gpt-5.5",
    label: "GPT-5.5",
    currency: "usd",
    source: "openai_api_pricing",
    sourceDate: "2026-06-23",
    contextTier: "short_context",
    ratesPerMillionTokens: {
      input: 5,
      cachedInput: 0.5,
      output: 30
    }
  },
  "gpt-5.4": {
    id: "gpt-5.4",
    label: "GPT-5.4",
    currency: "usd",
    source: "openai_api_pricing",
    sourceDate: "2026-06-23",
    contextTier: "short_context",
    ratesPerMillionTokens: {
      input: 2.5,
      cachedInput: 0.25,
      output: 15
    }
  },
  "gpt-5.4-mini": {
    id: "gpt-5.4-mini",
    label: "GPT-5.4 mini",
    currency: "usd",
    source: "openai_api_pricing",
    sourceDate: "2026-06-23",
    contextTier: "short_context",
    ratesPerMillionTokens: {
      input: 0.75,
      cachedInput: 0.075,
      output: 4.5
    }
  },
  "gpt-5.4-nano": {
    id: "gpt-5.4-nano",
    label: "GPT-5.4 nano",
    currency: "usd",
    source: "openai_api_pricing",
    sourceDate: "2026-06-23",
    contextTier: "short_context",
    ratesPerMillionTokens: {
      input: 0.2,
      cachedInput: 0.02,
      output: 1.25
    }
  },
  "chat-latest": {
    id: "chat-latest",
    label: "ChatGPT chat-latest",
    currency: "usd",
    source: "openai_api_pricing",
    sourceDate: "2026-06-23",
    contextTier: "standard",
    ratesPerMillionTokens: {
      input: 5,
      cachedInput: 0.5,
      output: 30
    }
  },
  "gpt-5.3-codex": {
    id: "gpt-5.3-codex",
    label: "GPT-5.3 Codex",
    currency: "usd",
    source: "openai_api_pricing",
    sourceDate: "2026-06-23",
    contextTier: "standard",
    ratesPerMillionTokens: {
      input: 1.75,
      cachedInput: 0.175,
      output: 14
    }
  }
};

const OPENAI_IMAGE_PRICING = {
  "gpt-image-2": {
    id: "gpt-image-2",
    label: "GPT-Image-2",
    currency: "usd",
    source: "openai_api_pricing",
    sourceDate: "2026-06-23",
    ratesPerMillionTokens: {
      textInput: 5,
      textCachedInput: 1.25,
      imageInput: 8,
      imageCachedInput: 2,
      imageOutput: 30
    }
  }
};

const OPENAI_TRANSCRIPTION_PRICING = {
  "gpt-4o-transcribe": {
    id: "gpt-4o-transcribe",
    label: "GPT-4o Transcribe",
    currency: "usd",
    source: "openai_api_pricing",
    sourceDate: "2026-07-13",
    ratesPerMillionTokens: {
      input: 2.5,
      output: 10
    },
    estimatedRatePerMinute: 0.006
  },
  "gpt-4o-mini-transcribe": {
    id: "gpt-4o-mini-transcribe",
    label: "GPT-4o mini Transcribe",
    currency: "usd",
    source: "openai_api_pricing",
    sourceDate: "2026-07-13",
    ratesPerMillionTokens: {
      input: 1.25,
      output: 5
    },
    estimatedRatePerMinute: 0.003
  }
};

const OPENAI_IMAGE_OUTPUT_ESTIMATES = {
  "gpt-image-2": {
    model: "gpt-image-2",
    source: "openai_image_generation_guide",
    sourceDate: "2026-06-23",
    currency: "usd",
    note: "Output-only estimate for common GPT Image 2 sizes. Text and image input tokens are billed separately.",
    sizes: {
      "1024x1024": {
        label: "1024 x 1024",
        low: 0.006,
        medium: 0.053,
        high: 0.211
      },
      "1024x1536": {
        label: "1024 x 1536",
        low: 0.005,
        medium: 0.041,
        high: 0.165
      },
      "1536x1024": {
        label: "1536 x 1024",
        low: 0.005,
        medium: 0.041,
        high: 0.165
      }
    }
  }
};

function numberOrZero(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : 0;
}

function roundMoney(value) {
  return Math.round(numberOrZero(value) * 1_000_000) / 1_000_000;
}

function pricingForModel(model) {
  const normalized = String(model || "").trim().toLowerCase();
  if (normalized === "gpt-image-2" || normalized === "gpt-image-2-2026-04-21") {
    return OPENAI_IMAGE_PRICING["gpt-image-2"];
  }
  return null;
}

function pricingForTextModel(model) {
  const normalized = String(model || "").trim().toLowerCase();
  const modelIds = Object.keys(OPENAI_TEXT_PRICING)
    .sort((left, right) => right.length - left.length);
  for (const modelId of modelIds) {
    if (normalized === modelId || normalized.startsWith(`${modelId}-`)) {
      return OPENAI_TEXT_PRICING[modelId];
    }
  }
  return null;
}

function pricingForTranscriptionModel(model) {
  const normalized = String(model || "").trim().toLowerCase();
  const modelIds = Object.keys(OPENAI_TRANSCRIPTION_PRICING)
    .sort((left, right) => right.length - left.length);
  for (const modelId of modelIds) {
    if (normalized === modelId || normalized.startsWith(`${modelId}-`)) {
      return OPENAI_TRANSCRIPTION_PRICING[modelId];
    }
  }
  return null;
}

function normalizedQuality(value) {
  const quality = String(value || "").trim().toLowerCase();
  return ["low", "medium", "high"].includes(quality) ? quality : "medium";
}

function parseImageSize(value) {
  const match = String(value || "").trim().toLowerCase().match(/^(\d{2,5})x(\d{2,5})$/);
  if (!match) {
    return null;
  }
  const width = Number(match[1]);
  const height = Number(match[2]);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return null;
  }
  return { width, height, id: `${width}x${height}` };
}

function nearestEstimateSize(size, estimates) {
  const parsed = parseImageSize(size);
  const entries = Object.entries(estimates?.sizes || {});
  if (!parsed || !entries.length) {
    return entries[0] || null;
  }
  const exact = entries.find(([sizeId]) => sizeId === parsed.id);
  if (exact) {
    return exact;
  }
  const targetAspect = parsed.width / parsed.height;
  const targetArea = parsed.width * parsed.height;
  return entries
    .map(([sizeId, estimate]) => {
      const candidate = parseImageSize(sizeId);
      if (!candidate) {
        return { sizeId, estimate, score: Number.POSITIVE_INFINITY };
      }
      const aspect = candidate.width / candidate.height;
      const area = candidate.width * candidate.height;
      const aspectScore = Math.abs(Math.log(targetAspect / aspect));
      const areaScore = Math.abs(Math.log(targetArea / area));
      return { sizeId, estimate, score: aspectScore + areaScore * 0.15 };
    })
    .sort((left, right) => left.score - right.score)
    .map(({ sizeId, estimate }) => [sizeId, estimate])[0] || null;
}

function estimateOpenAiImagePresetCost({ model, size, quality } = {}) {
  const pricing = pricingForModel(model);
  const estimates = pricing ? OPENAI_IMAGE_OUTPUT_ESTIMATES[pricing.id] : null;
  const nearest = nearestEstimateSize(size, estimates);
  if (!pricing || !estimates || !nearest) {
    return {
      provider: "openai",
      model: model || null,
      size: size || null,
      quality: normalizedQuality(quality),
      estimatedCostAvailable: false,
      reason: "No local output estimate for this image model."
    };
  }
  const [estimateSize, values] = nearest;
  const requestedSize = parseImageSize(size);
  const outputCostUsd = numberOrZero(values[normalizedQuality(quality)]);
  const outputTokens = Math.round((outputCostUsd / pricing.ratesPerMillionTokens.imageOutput) * USD_PER_MILLION);
  return {
    provider: "openai",
    model: pricing.id,
    requestedSize: size || null,
    estimateSize,
    estimateSizeLabel: values.label || estimateSize,
    estimateIsExactSize: Boolean(requestedSize && requestedSize.id === estimateSize),
    quality: normalizedQuality(quality),
    currency: estimates.currency,
    estimatedCostAvailable: true,
    estimatedOutputCostUsd: roundMoney(outputCostUsd),
    estimatedOutputTokens: outputTokens,
    pricingSource: estimates.source,
    pricingSourceDate: estimates.sourceDate,
    note: estimates.note
  };
}

function tokenBreakdownFromUsage(usage = {}) {
  const inputDetails = usage.input_tokens_details || {};
  const outputDetails = usage.output_tokens_details || {};
  const inputTokens = numberOrZero(usage.input_tokens);
  const outputTokens = numberOrZero(usage.output_tokens);
  const totalTokens = numberOrZero(usage.total_tokens) || inputTokens + outputTokens;

  const inputImageTokens = numberOrZero(inputDetails.image_tokens);
  const inputTextTokens = numberOrZero(inputDetails.text_tokens)
    || Math.max(0, inputTokens - inputImageTokens);
  const cachedInputTokens = numberOrZero(usage.input_cached_tokens)
    || numberOrZero(usage.cached_input_tokens)
    || numberOrZero(inputDetails.cached_tokens);
  const cachedImageTokens = numberOrZero(inputDetails.cached_image_tokens);
  const cachedTextTokens = numberOrZero(inputDetails.cached_text_tokens)
    || Math.max(0, cachedInputTokens - cachedImageTokens);
  const uncachedTextInputTokens = Math.max(0, inputTextTokens - cachedTextTokens);
  const uncachedImageInputTokens = Math.max(0, inputImageTokens - cachedImageTokens);
  const outputImageTokens = numberOrZero(outputDetails.image_tokens)
    || outputTokens;
  const outputTextTokens = numberOrZero(outputDetails.text_tokens);

  return {
    inputTokens,
    outputTokens,
    totalTokens,
    inputTextTokens,
    inputImageTokens,
    cachedTextTokens,
    cachedImageTokens,
    uncachedTextInputTokens,
    uncachedImageInputTokens,
    outputImageTokens,
    outputTextTokens
  };
}

function textTokenBreakdownFromUsage(usage = {}) {
  const inputDetails = usage.input_tokens_details || {};
  const outputDetails = usage.output_tokens_details || {};
  const inputTokens = numberOrZero(usage.input_tokens);
  const outputTokens = numberOrZero(usage.output_tokens);
  const totalTokens = numberOrZero(usage.total_tokens) || inputTokens + outputTokens;
  const cachedInputTokens = numberOrZero(usage.input_cached_tokens)
    || numberOrZero(usage.cached_input_tokens)
    || numberOrZero(inputDetails.cached_tokens);
  const cacheWriteTokens = numberOrZero(inputDetails.cache_write_tokens)
    || numberOrZero(usage.cache_write_tokens);
  const uncachedInputTokens = Math.max(0, inputTokens - cachedInputTokens - cacheWriteTokens);

  return {
    inputTokens,
    outputTokens,
    totalTokens,
    cachedInputTokens,
    cacheWriteTokens,
    uncachedInputTokens,
    outputReasoningTokens: numberOrZero(outputDetails.reasoning_tokens)
  };
}

function costForTokens(tokens, ratePerMillion) {
  return (numberOrZero(tokens) / USD_PER_MILLION) * numberOrZero(ratePerMillion);
}

function estimateOpenAiTextCost({ usage, model } = {}) {
  if (!usage || typeof usage !== "object") {
    return null;
  }
  const pricing = pricingForTextModel(model);
  const tokens = textTokenBreakdownFromUsage(usage);
  if (!pricing) {
    return {
      provider: "openai",
      model: model || null,
      usageAvailable: true,
      estimatedCostAvailable: false,
      reason: "No local pricing rule for this text model.",
      tokens
    };
  }

  const rates = pricing.ratesPerMillionTokens;
  const components = [
    {
      id: "input",
      label: "Input",
      tokens: tokens.uncachedInputTokens,
      ratePerMillion: rates.input,
      costUsd: costForTokens(tokens.uncachedInputTokens, rates.input)
    },
    {
      id: "cached_input",
      label: "Cached input",
      tokens: tokens.cachedInputTokens,
      ratePerMillion: rates.cachedInput,
      costUsd: costForTokens(tokens.cachedInputTokens, rates.cachedInput)
    },
    {
      id: "cache_write",
      label: "Cache write",
      tokens: tokens.cacheWriteTokens,
      ratePerMillion: rates.cacheWrite,
      costUsd: costForTokens(tokens.cacheWriteTokens, rates.cacheWrite)
    },
    {
      id: "output",
      label: "Output",
      tokens: tokens.outputTokens,
      ratePerMillion: rates.output,
      costUsd: costForTokens(tokens.outputTokens, rates.output)
    }
  ].filter((component) => component.tokens > 0);
  const estimatedCostUsd = components.reduce((sum, component) => sum + component.costUsd, 0);

  return {
    provider: "openai",
    model: model || null,
    pricingModel: pricing.id,
    pricingSource: pricing.source,
    pricingSourceDate: pricing.sourceDate,
    contextTier: pricing.contextTier,
    currency: pricing.currency,
    usageAvailable: true,
    estimatedCostAvailable: true,
    estimationBasis: "api_usage_tokens",
    estimatedCostUsd: roundMoney(estimatedCostUsd),
    tokens,
    components: components.map((component) => ({
      ...component,
      costUsd: roundMoney(component.costUsd)
    }))
  };
}

function estimateOpenAiTranscriptionCost({ usage, model, durationMs } = {}) {
  const pricing = pricingForTranscriptionModel(model);
  const inputTokens = numberOrZero(usage?.input_tokens);
  const outputTokens = numberOrZero(usage?.output_tokens);
  const totalTokens = numberOrZero(usage?.total_tokens) || inputTokens + outputTokens;
  const durationMinutes = numberOrZero(durationMs) / 60_000;
  if (!pricing) {
    return {
      provider: "openai",
      model: model || null,
      usageAvailable: Boolean(totalTokens || durationMinutes),
      estimatedCostAvailable: false,
      reason: "No local pricing rule for this transcription model.",
      tokens: totalTokens ? { inputTokens, outputTokens, totalTokens } : null,
      durationMs: numberOrZero(durationMs) || null
    };
  }

  if (totalTokens) {
    const components = [
      {
        id: "input",
        label: "Transcription input",
        tokens: inputTokens,
        ratePerMillion: pricing.ratesPerMillionTokens.input,
        costUsd: costForTokens(inputTokens, pricing.ratesPerMillionTokens.input)
      },
      {
        id: "output",
        label: "Transcription output",
        tokens: outputTokens,
        ratePerMillion: pricing.ratesPerMillionTokens.output,
        costUsd: costForTokens(outputTokens, pricing.ratesPerMillionTokens.output)
      }
    ].filter((component) => component.tokens > 0);
    return {
      provider: "openai",
      model: model || null,
      pricingModel: pricing.id,
      pricingSource: pricing.source,
      pricingSourceDate: pricing.sourceDate,
      currency: pricing.currency,
      usageAvailable: true,
      estimatedCostAvailable: true,
      estimationBasis: "api_usage_tokens",
      estimatedCostUsd: roundMoney(components.reduce((sum, component) => sum + component.costUsd, 0)),
      tokens: { inputTokens, outputTokens, totalTokens },
      durationMs: numberOrZero(durationMs) || null,
      components: components.map((component) => ({
        ...component,
        costUsd: roundMoney(component.costUsd)
      }))
    };
  }

  if (durationMinutes) {
    return {
      provider: "openai",
      model: model || null,
      pricingModel: pricing.id,
      pricingSource: pricing.source,
      pricingSourceDate: pricing.sourceDate,
      currency: pricing.currency,
      usageAvailable: false,
      estimatedCostAvailable: true,
      estimationBasis: "recorded_duration",
      estimatedCostUsd: roundMoney(durationMinutes * pricing.estimatedRatePerMinute),
      durationMs: numberOrZero(durationMs),
      estimatedRatePerMinute: pricing.estimatedRatePerMinute
    };
  }

  return null;
}

function estimateOpenAiImageCost({ usage, model, size, quality, imageCount = 1 } = {}) {
  if (!usage || typeof usage !== "object") {
    return null;
  }
  const pricing = pricingForModel(model);
  if (!pricing) {
    return {
      provider: "openai",
      model: model || null,
      imageCount: numberOrZero(imageCount) || 1,
      size: size || null,
      quality: quality || null,
      usageAvailable: true,
      estimatedCostAvailable: false,
      reason: "No local pricing rule for this image model.",
      tokens: tokenBreakdownFromUsage(usage)
    };
  }

  const tokens = tokenBreakdownFromUsage(usage);
  const rates = pricing.ratesPerMillionTokens;
  const components = [
    {
      id: "text_input",
      label: "Text input",
      tokens: tokens.uncachedTextInputTokens,
      ratePerMillion: rates.textInput,
      costUsd: costForTokens(tokens.uncachedTextInputTokens, rates.textInput)
    },
    {
      id: "text_cached_input",
      label: "Cached text input",
      tokens: tokens.cachedTextTokens,
      ratePerMillion: rates.textCachedInput,
      costUsd: costForTokens(tokens.cachedTextTokens, rates.textCachedInput)
    },
    {
      id: "image_input",
      label: "Image input",
      tokens: tokens.uncachedImageInputTokens,
      ratePerMillion: rates.imageInput,
      costUsd: costForTokens(tokens.uncachedImageInputTokens, rates.imageInput)
    },
    {
      id: "image_cached_input",
      label: "Cached image input",
      tokens: tokens.cachedImageTokens,
      ratePerMillion: rates.imageCachedInput,
      costUsd: costForTokens(tokens.cachedImageTokens, rates.imageCachedInput)
    },
    {
      id: "image_output",
      label: "Image output",
      tokens: tokens.outputImageTokens,
      ratePerMillion: rates.imageOutput,
      costUsd: costForTokens(tokens.outputImageTokens, rates.imageOutput)
    }
  ].filter((component) => component.tokens > 0);

  const estimatedCostUsd = components.reduce((sum, component) => sum + component.costUsd, 0);

  return {
    provider: "openai",
    model: model || null,
    pricingModel: pricing.id,
    pricingSource: pricing.source,
    pricingSourceDate: pricing.sourceDate,
    currency: pricing.currency,
    imageCount: numberOrZero(imageCount) || 1,
    size: size || null,
    quality: quality || null,
    usageAvailable: true,
    estimatedCostAvailable: true,
    estimationBasis: "api_usage_tokens",
    estimatedCostUsd: roundMoney(estimatedCostUsd),
    tokens,
    components: components.map((component) => ({
      ...component,
      costUsd: roundMoney(component.costUsd)
    }))
  };
}

module.exports = {
  OPENAI_TEXT_PRICING,
  OPENAI_IMAGE_OUTPUT_ESTIMATES,
  OPENAI_IMAGE_PRICING,
  OPENAI_TRANSCRIPTION_PRICING,
  estimateOpenAiImagePresetCost,
  estimateOpenAiImageCost,
  estimateOpenAiTextCost,
  estimateOpenAiTranscriptionCost,
  pricingForModel,
  pricingForTextModel,
  pricingForTranscriptionModel,
  textTokenBreakdownFromUsage,
  tokenBreakdownFromUsage
};
