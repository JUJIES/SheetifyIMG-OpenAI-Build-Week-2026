"use strict";

const fs = require("node:fs/promises");
const path = require("node:path");
const { PROJECT_TYPES } = require("../contracts");
const { projectTypeFromManifest } = require("../legacy");

async function pathExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function readJsonIfExists(filePath) {
  if (!(await pathExists(filePath))) {
    return null;
  }
  return JSON.parse(await fs.readFile(filePath, "utf8"));
}

async function historyFileName(projectDir, override) {
  if (override) {
    return override;
  }
  const manifest = await readJsonIfExists(path.join(projectDir, "project-manifest.json"));
  return projectTypeFromManifest(manifest) === PROJECT_TYPES.SERIES
    ? "series-history.jsonl"
    : "worksheet-history.jsonl";
}

async function appendHistoryEvent(projectDir, event, options = {}) {
  const fileName = await historyFileName(projectDir, options.fileName);
  const historyPath = path.join(projectDir, "history", fileName);
  const nextEvent = {
    ...event,
    createdAt: event.createdAt || options.now || new Date().toISOString()
  };

  await fs.mkdir(path.dirname(historyPath), { recursive: true });
  await fs.appendFile(historyPath, `${JSON.stringify(nextEvent)}\n`, "utf8");
  return nextEvent;
}

module.exports = {
  appendHistoryEvent
};

