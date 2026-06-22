"use strict";

const fs = require("node:fs/promises");
const path = require("node:path");
const { EVENT_TYPES } = require("../contracts");

const EVENT_LOG_FILE = "chat-events.jsonl";
const VALID_EVENT_TYPES = new Set(Object.values(EVENT_TYPES));

async function pathExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

function eventLogPath(projectDir) {
  return path.join(projectDir, EVENT_LOG_FILE);
}

function parseJsonl(text) {
  return String(text || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

async function readEvents(projectDir) {
  const filePath = eventLogPath(projectDir);
  if (!(await pathExists(filePath))) {
    return [];
  }
  return parseJsonl(await fs.readFile(filePath, "utf8"));
}

function nextEventId(events) {
  return `evt_${String(events.length + 1).padStart(3, "0")}`;
}

function assertEventContract(event = {}) {
  if (!event.type) {
    throw new Error("Event type is required.");
  }
  if (!VALID_EVENT_TYPES.has(event.type)) {
    throw new Error(`Unsupported event type: ${event.type}`);
  }
  if (!event.createdAt) {
    throw new Error("Event createdAt is required.");
  }
  return event;
}

async function appendEvent(projectDir, event, options = {}) {
  const events = await readEvents(projectDir);
  const nextEvent = assertEventContract({
    ...event,
    id: event.id || nextEventId(events),
    createdAt: event.createdAt || options.now || new Date().toISOString()
  });

  await fs.mkdir(path.dirname(eventLogPath(projectDir)), { recursive: true });
  await fs.appendFile(eventLogPath(projectDir), `${JSON.stringify(nextEvent)}\n`, "utf8");
  return nextEvent;
}

function projectCreatedEvent({ now, projectId, projectType, title }) {
  return {
    type: EVENT_TYPES.PROJECT_CREATED,
    createdAt: now,
    step: "auftrag",
    payload: {
      projectId,
      projectType,
      title
    }
  };
}

module.exports = {
  EVENT_LOG_FILE,
  appendEvent,
  assertEventContract,
  eventLogPath,
  projectCreatedEvent,
  readEvents
};

