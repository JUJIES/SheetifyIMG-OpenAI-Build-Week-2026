"use strict";

const fs = require("node:fs/promises");
const path = require("node:path");

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
    provider: entry.provider || "openai",
    responseId: entry.responseId || null,
    proposalId: entry.proposalId || null,
    toolCallCount: Number(entry.toolCallCount) || 0,
    durationMs: Number(entry.durationMs) || null,
    uiEvent: entry.uiEvent || null,
    error: entry.error ? sanitizeErrorMessage(entry.error) : null
  };
}

async function logModelRun(projectDir, entry = {}, options = {}) {
  const now = options.now || new Date().toISOString();
  const filePath = path.join(projectDir, "history", "model-runs.jsonl");
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const nextEntry = publicEntry(entry, now);
  await fs.appendFile(filePath, `${JSON.stringify(nextEntry)}\n`, "utf8");
  return nextEntry;
}

module.exports = {
  logModelRun,
  sanitizeErrorMessage
};
