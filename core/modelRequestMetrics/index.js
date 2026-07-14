"use strict";

const REQUEST_SHAPE_SCHEMA_VERSION = "sheetifyimg.model-request-shape.v1";
const NUMERIC_FIELDS = Object.freeze([
  "instructionsChars",
  "inputTextChars",
  "schemaChars",
  "toolDefinitionChars",
  "totalMeasuredChars",
  "inputMessageCount",
  "inputTextItemCount",
  "inputImageItemCount",
  "inputFileItemCount",
  "inputAudioItemCount",
  "toolCount",
  "maxOutputTokens"
]);
const BOOLEAN_FIELDS = Object.freeze([
  "structuredOutput",
  "responseStored"
]);
const MAX_CONTEXT_SECTIONS = 32;
const MAX_SECTION_NAME_LENGTH = 80;

function nonNegativeInteger(value) {
  const number = Number(value);
  return Number.isInteger(number) && number >= 0 ? number : 0;
}

function jsonChars(value) {
  if (value === undefined) {
    return 0;
  }
  try {
    return JSON.stringify(value).length;
  } catch {
    return 0;
  }
}

function sectionName(value) {
  const name = String(value || "").trim();
  if (!name || name.length > MAX_SECTION_NAME_LENGTH || !/^[a-zA-Z][a-zA-Z0-9_.-]*$/.test(name)) {
    return null;
  }
  return name;
}

function measureContextSections(value = null) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const sections = {};
  for (const [rawName, sectionValue] of Object.entries(value).slice(0, MAX_CONTEXT_SECTIONS)) {
    const name = sectionName(rawName);
    if (!name) {
      continue;
    }
    sections[name] = jsonChars(sectionValue);
  }
  return Object.keys(sections).length ? sections : null;
}

function emptyInputMetrics() {
  return {
    inputTextChars: 0,
    inputMessageCount: 0,
    inputTextItemCount: 0,
    inputImageItemCount: 0,
    inputFileItemCount: 0,
    inputAudioItemCount: 0
  };
}

function addText(metrics, value) {
  if (typeof value !== "string") {
    return;
  }
  metrics.inputTextChars += value.length;
  metrics.inputTextItemCount += 1;
}

function measureContentItem(metrics, item) {
  if (typeof item === "string") {
    addText(metrics, item);
    return;
  }
  if (!item || typeof item !== "object") {
    return;
  }
  const type = String(item.type || "").trim();
  if (["input_text", "text", "output_text"].includes(type)) {
    addText(metrics, item.text);
    return;
  }
  if (["input_image", "image", "image_url"].includes(type)) {
    metrics.inputImageItemCount += 1;
    return;
  }
  if (["input_file", "file"].includes(type)) {
    metrics.inputFileItemCount += 1;
    return;
  }
  if (["input_audio", "audio"].includes(type)) {
    metrics.inputAudioItemCount += 1;
    return;
  }
  if (typeof item.content === "string") {
    addText(metrics, item.content);
  }
}

function measureInput(input) {
  const metrics = emptyInputMetrics();
  if (typeof input === "string") {
    addText(metrics, input);
    return metrics;
  }
  if (!Array.isArray(input)) {
    return metrics;
  }
  for (const item of input) {
    if (typeof item === "string") {
      addText(metrics, item);
      continue;
    }
    if (!item || typeof item !== "object") {
      continue;
    }
    if (item.role) {
      metrics.inputMessageCount += 1;
    }
    if (typeof item.content === "string") {
      addText(metrics, item.content);
      continue;
    }
    if (Array.isArray(item.content)) {
      item.content.forEach((contentItem) => measureContentItem(metrics, contentItem));
      continue;
    }
    measureContentItem(metrics, item);
  }
  return metrics;
}

function normalizeContextSections(value = null) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const sections = {};
  for (const [rawName, rawChars] of Object.entries(value).slice(0, MAX_CONTEXT_SECTIONS)) {
    const name = sectionName(rawName);
    if (!name) {
      continue;
    }
    sections[name] = nonNegativeInteger(rawChars);
  }
  return Object.keys(sections).length ? sections : null;
}

function normalizeModelRequestShape(value = null) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const normalized = {
    schemaVersion: REQUEST_SHAPE_SCHEMA_VERSION
  };
  for (const field of NUMERIC_FIELDS) {
    normalized[field] = nonNegativeInteger(value[field]);
  }
  for (const field of BOOLEAN_FIELDS) {
    normalized[field] = value[field] === true;
  }
  const contextSections = normalizeContextSections(value.contextSections);
  if (contextSections) {
    normalized.contextSections = contextSections;
  }
  return normalized;
}

function measureModelRequest(body = {}, options = {}) {
  const input = measureInput(body.input);
  const instructionsChars = typeof body.instructions === "string"
    ? body.instructions.length
    : jsonChars(body.instructions);
  const schemaChars = jsonChars(body.text?.format?.schema);
  const toolDefinitionChars = jsonChars(body.tools);
  return normalizeModelRequestShape({
    instructionsChars,
    ...input,
    schemaChars,
    toolDefinitionChars,
    totalMeasuredChars: instructionsChars + input.inputTextChars + schemaChars + toolDefinitionChars,
    toolCount: Array.isArray(body.tools) ? body.tools.length : 0,
    maxOutputTokens: body.max_output_tokens,
    structuredOutput: Boolean(body.text?.format?.schema),
    responseStored: body.store === true,
    contextSections: measureContextSections(options.contextSections)
  });
}

module.exports = {
  REQUEST_SHAPE_SCHEMA_VERSION,
  measureContextSections,
  measureModelRequest,
  normalizeModelRequestShape
};
