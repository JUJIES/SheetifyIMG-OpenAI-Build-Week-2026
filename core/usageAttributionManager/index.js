"use strict";

const { randomUUID } = require("node:crypto");

const IDENTIFIER_LIMITS = Object.freeze({
  operationId: 180,
  operationKind: 80,
  accessGrantId: 180,
  sessionId: 180,
  projectId: 180,
  commandId: 160,
  jobId: 180,
  runId: 180,
  candidateId: 180
});

function identifier(field, value, maxLength) {
  const text = String(value || "").trim();
  if (!text || text.length > maxLength || !/^[a-zA-Z0-9][a-zA-Z0-9_.:-]*$/.test(text)) {
    return null;
  }
  if (field === "operationId" && !text.startsWith("op_")) {
    return null;
  }
  if (field === "accessGrantId" && !/^(?:grant|access_grant)_/.test(text)) {
    return null;
  }
  if (field === "sessionId" && !text.startsWith("session_")) {
    return null;
  }
  return text;
}

function positiveInteger(value) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : null;
}

function normalizeUsageAttribution(value = {}) {
  if (!value || typeof value !== "object") {
    return null;
  }
  const attribution = {};
  for (const [field, maxLength] of Object.entries(IDENTIFIER_LIMITS)) {
    const normalized = identifier(field, value[field], maxLength);
    if (normalized) {
      attribution[field] = normalized;
    }
  }
  const pageNumber = positiveInteger(value.pageNumber || value.page);
  if (pageNumber) {
    attribution.pageNumber = pageNumber;
  }
  return Object.keys(attribution).length ? attribution : null;
}

function createUsageAttribution(value = {}, defaults = {}) {
  const attribution = normalizeUsageAttribution({
    ...defaults,
    ...value
  }) || {};
  if (!attribution.operationId) {
    attribution.operationId = `op_${randomUUID()}`;
  }
  return attribution;
}

function extendUsageAttribution(value = {}, dimensions = {}) {
  const normalized = normalizeUsageAttribution({
    ...(value || {}),
    ...(dimensions || {})
  });
  return normalized || null;
}

module.exports = {
  createUsageAttribution,
  extendUsageAttribution,
  normalizeUsageAttribution
};
