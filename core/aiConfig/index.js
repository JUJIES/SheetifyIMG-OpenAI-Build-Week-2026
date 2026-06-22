"use strict";

const DEFAULT_BASE_URL = "https://api.openai.com/v1";
const DEFAULT_TEXT_MODEL = "gpt-5.4-mini";
const DEFAULT_REASONING_MODEL = "gpt-5.5";
const DEFAULT_IMAGE_MODEL = "gpt-image-2";
const DEFAULT_CODEX_IMAGE_MODEL = "gpt-5.4";
const DEFAULT_TIMEOUT_MS = 120000;
const DEFAULT_IMAGE_TIMEOUT_MS = 180000;
const DEFAULT_CODEX_IMAGE_TIMEOUT_MS = 300000;
const DEFAULT_REASONING_EFFORT = "low";
const DEFAULT_CODEX_REASONING_EFFORT = "low";
const DEFAULT_IMAGE_SIZE = "1120x1584";
const DEFAULT_IMAGE_OUTPUT_FORMAT = "png";
const DEFAULT_IMAGE_PRESET = "standard";
const IMAGE_QUALITY_PRESETS = {
  sparsam: {
    id: "sparsam",
    label: "Sparsam",
    quality: "low",
    description: "Schnelle Vorschau zum Pruefen von Richtung und Layout."
  },
  standard: {
    id: "standard",
    label: "Standard",
    quality: "medium",
    description: "Normaler SheetifyIMG-Kandidatenlauf fuer Arbeitsblaetter mit Text."
  },
  druckqualitaet: {
    id: "druckqualitaet",
    label: "Druckqualitaet",
    quality: "high",
    description: "Bewusster Qualitaetslauf fuer sehr dichte oder finale Blaetter."
  }
};
const DEFAULT_IMAGE_QUALITY = IMAGE_QUALITY_PRESETS[DEFAULT_IMAGE_PRESET].quality;

function nonEmpty(value) {
  return String(value || "").trim();
}

function normalizedMode(value) {
  const mode = nonEmpty(value || "openai").toLowerCase();
  return mode === "openai" ? "openai" : "openai";
}

function normalizedImageProvider(value) {
  const provider = nonEmpty(value || "openai").toLowerCase().replace(/[-\s]+/g, "_");
  if (["codex", "codex_cli", "codex_usage", "chatgpt", "chatgpt_codex"].includes(provider)) {
    return "codex_cli";
  }
  return "openai";
}

function codexImageEnabled(env = process.env) {
  const value = nonEmpty(env.SHEETIFYIMG_CODEX_IMAGE_ENABLED).toLowerCase();
  return !["0", "false", "off", "no"].includes(value);
}

function numberFromEnv(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function normalizedImagePreset(value) {
  const preset = nonEmpty(value).toLowerCase().replace(/\u00e4/g, "ae");
  const aliases = {
    low: "sparsam",
    draft: "sparsam",
    preview: "sparsam",
    vorschau: "sparsam",
    sparsam: "sparsam",
    medium: "standard",
    normal: "standard",
    review: "standard",
    standard: "standard",
    high: "druckqualitaet",
    print: "druckqualitaet",
    final: "druckqualitaet",
    druck: "druckqualitaet",
    druckqualitaet: "druckqualitaet"
  };
  return aliases[preset] || null;
}

function normalizedImageQuality(value) {
  const quality = nonEmpty(value).toLowerCase();
  return ["low", "medium", "high"].includes(quality) ? quality : null;
}

function presetForQuality(quality) {
  return Object.values(IMAGE_QUALITY_PRESETS).find((preset) => preset.quality === quality) || null;
}

function imageQualityConfig(env = process.env, overrides = {}) {
  const requestedPresetValue = overrides.imageQualityPreset || overrides.imagePreset;
  const requestedPreset = normalizedImagePreset(requestedPresetValue || env.SHEETIFYIMG_IMAGE_PRESET)
    || DEFAULT_IMAGE_PRESET;
  const qualityOverride = normalizedImageQuality(overrides.imageQuality)
    || (requestedPresetValue ? null : normalizedImageQuality(env.SHEETIFYIMG_IMAGE_QUALITY));
  const preset = qualityOverride
    ? presetForQuality(qualityOverride) || IMAGE_QUALITY_PRESETS[requestedPreset]
    : IMAGE_QUALITY_PRESETS[requestedPreset];
  const quality = qualityOverride || preset.quality || DEFAULT_IMAGE_QUALITY;

  return {
    imageQualityPreset: preset.id,
    imageQualityLabel: preset.label,
    imageQualityDescription: preset.description,
    imageQuality: quality
  };
}

function getAiRuntimeStatus(env = process.env) {
  const configuredMode = normalizedMode(env.SHEETIFYIMG_AI_MODE);
  const apiKeyConfigured = Boolean(nonEmpty(env.OPENAI_API_KEY));
  const openAiReady = configuredMode === "openai" && apiKeyConfigured;
  const mode = "openai";
  const status = openAiReady
    ? "ready"
    : "missing_key";

  return {
    provider: "openai",
    configuredMode,
    mode,
    status,
    apiKeyConfigured,
    textModel: nonEmpty(env.SHEETIFYIMG_TEXT_MODEL) || DEFAULT_TEXT_MODEL,
    reasoningModel: nonEmpty(env.SHEETIFYIMG_REASONING_MODEL) || DEFAULT_REASONING_MODEL,
    imageModel: nonEmpty(env.SHEETIFYIMG_IMAGE_MODEL) || DEFAULT_IMAGE_MODEL,
    reasoningEffort: nonEmpty(env.SHEETIFYIMG_REASONING_EFFORT) || DEFAULT_REASONING_EFFORT,
    fallbackReason: status === "missing_key"
      ? "OPENAI_API_KEY is missing."
      : null
  };
}

function getOpenAiRequestConfig(env = process.env) {
  return {
    ...getAiRuntimeStatus(env),
    apiKey: nonEmpty(env.OPENAI_API_KEY),
    baseUrl: nonEmpty(env.OPENAI_BASE_URL) || DEFAULT_BASE_URL,
    timeoutMs: numberFromEnv(env.SHEETIFYIMG_OPENAI_TIMEOUT_MS, DEFAULT_TIMEOUT_MS)
  };
}

function getImageRuntimeStatus(env = process.env, overrides = {}) {
  const imageProvider = normalizedImageProvider(
    overrides.imageProvider
    || env.SHEETIFYIMG_IMAGE_PROVIDER
    || env.SHEETIFYIMG_IMAGE_MODE
    || env.SHEETIFYIMG_AI_MODE
  );
  const configuredMode = imageProvider;
  const apiKeyConfigured = Boolean(nonEmpty(env.OPENAI_API_KEY));
  const canUseOpenAi = apiKeyConfigured;
  const canUseCodex = codexImageEnabled(env);
  const mode = imageProvider;
  const status = imageProvider === "codex_cli"
    ? canUseCodex ? "ready" : "missing_codex"
    : apiKeyConfigured ? "ready" : "missing_key";
  const qualityConfig = imageQualityConfig(env, overrides);

  return {
    provider: imageProvider,
    configuredMode,
    mode,
    status,
    apiKeyConfigured,
    canUseOpenAi,
    canUseCodex,
    imageProviders: [
      {
        id: "codex_cli",
        label: "Codex Usage",
        enabled: canUseCodex,
        description: "Nutzt den lokalen Codex-Login und erzeugt Bilder über Codex."
      },
      {
        id: "openai",
        label: "OpenAI API",
        enabled: canUseOpenAi,
        description: "Nutzt den OpenAI API-Key und kann API-Kosten verursachen."
      }
    ],
    imageModel: nonEmpty(env.SHEETIFYIMG_IMAGE_MODEL) || DEFAULT_IMAGE_MODEL,
    imageSize: nonEmpty(env.SHEETIFYIMG_IMAGE_SIZE) || DEFAULT_IMAGE_SIZE,
    ...qualityConfig,
    imageOutputFormat: nonEmpty(env.SHEETIFYIMG_IMAGE_OUTPUT_FORMAT) || DEFAULT_IMAGE_OUTPUT_FORMAT,
    imageBackground: nonEmpty(env.SHEETIFYIMG_IMAGE_BACKGROUND) || "opaque",
    imageModeration: nonEmpty(env.SHEETIFYIMG_IMAGE_MODERATION) || "auto",
    maxCandidateCount: numberFromEnv(env.SHEETIFYIMG_MAX_IMAGE_CANDIDATES, 1),
    codexBin: nonEmpty(env.SHEETIFYIMG_CODEX_BIN) || nonEmpty(env.CODEX_CLI_PATH) || "codex",
    codexModel: nonEmpty(env.SHEETIFYIMG_CODEX_IMAGE_MODEL) || DEFAULT_CODEX_IMAGE_MODEL,
    codexReasoningEffort: nonEmpty(env.SHEETIFYIMG_CODEX_REASONING_EFFORT) || DEFAULT_CODEX_REASONING_EFFORT,
    codexTimeoutMs: numberFromEnv(env.SHEETIFYIMG_CODEX_IMAGE_TIMEOUT_MS, DEFAULT_CODEX_IMAGE_TIMEOUT_MS),
    codexGeneratedImagesDir: nonEmpty(env.SHEETIFYIMG_CODEX_GENERATED_IMAGES_DIR),
    fallbackReason: status === "missing_key"
      ? "OPENAI_API_KEY is missing."
      : status === "missing_codex"
        ? "Codex image generation is disabled."
        : null
  };
}

function getImageRequestConfig(env = process.env, overrides = {}) {
  return {
    ...getImageRuntimeStatus(env, overrides),
    apiKey: nonEmpty(env.OPENAI_API_KEY),
    baseUrl: nonEmpty(env.OPENAI_BASE_URL) || DEFAULT_BASE_URL,
    timeoutMs: numberFromEnv(env.SHEETIFYIMG_IMAGE_TIMEOUT_MS, DEFAULT_IMAGE_TIMEOUT_MS)
  };
}

module.exports = {
  IMAGE_QUALITY_PRESETS,
  getAiRuntimeStatus,
  getImageRequestConfig,
  getImageRuntimeStatus,
  getOpenAiRequestConfig,
  normalizedImageProvider
};
