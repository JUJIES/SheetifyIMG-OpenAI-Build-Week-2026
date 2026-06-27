"use strict";

const fs = require("node:fs/promises");
const path = require("node:path");

async function historyFileName(projectDir, override) {
  if (override) {
    return override;
  }
  return "worksheet-history.jsonl";
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
