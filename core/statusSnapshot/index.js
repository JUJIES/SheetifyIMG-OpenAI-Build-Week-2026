"use strict";

const fs = require("node:fs/promises");
const path = require("node:path");
const {
  PRODUCTION_SCHEMA_VERSION,
  EVENT_TYPES
} = require("../contracts");
const { readEvents } = require("../eventLog");
const { getProjectStatus } = require("../projectStatus");
const { writeJsonFile } = require("../jsonFile");

const STATUS_SNAPSHOT_FILE = "status-snapshot.json";

const STEP_LABELS = Object.freeze({
  auftrag: "Input",
  input: "Input",
  brief: "Arbeitsblatt-Konzept",
  content: "Arbeitsblatt-Konzept",
  pruefung: "Arbeitsblatt-Konzept",
  freigabe: "Arbeitsblatt-Konzept",
  entwuerfe: "Entwürfe",
  kandidaten: "Entwürfe",
  auswahl: "Entwürfe",
  export: "Entwürfe"
});

const VISIBLE_STEPS = Object.freeze([
  "input",
  "concept",
  "candidates"
]);

const VISIBLE_STEP_LABELS = Object.freeze({
  input: "Input",
  concept: "Arbeitsblatt-Konzept",
  candidates: "Entwürfe"
});

async function pathExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, "utf8"));
}

async function writeJson(filePath, value) {
  await writeJsonFile(filePath, value);
}

function initialStatusSnapshot({ now }) {
  return {
    schemaVersion: PRODUCTION_SCHEMA_VERSION,
    generatedAt: now || new Date().toISOString(),
    source: "initial_project_creation",
    libraryStatus: "Entwurf",
    currentStep: "input",
    isComplete: false,
    hasOutdatedExport: false,
    nextAction: {
      label: "Input ergänzen",
      action: "add_input",
      targetStep: "input"
    },
    steps: VISIBLE_STEPS.map((id) => ({
      id,
      label: VISIBLE_STEP_LABELS[id] || id,
      state: id === "input" ? "current" : "todo",
      complete: false
    }))
  };
}

async function hasSourceInput(projectDir) {
  const sourceDir = path.join(projectDir, "source");
  if (await pathExists(sourceDir)) {
    const entries = await fs.readdir(sourceDir).catch(() => []);
    if (entries.length > 0) {
      return true;
    }
  }
  const events = await readEvents(projectDir);
  return events.some((event) => {
    return event.type === EVENT_TYPES.USER_MESSAGE && String(event.payload?.message || "").trim();
  });
}

function libraryStatusLabel(status = {}) {
  if (status.errors > 0) {
    return "Fehler";
  }
  if (status.candidateGeneration?.isRunning) {
    return "Entwurf wird erstellt";
  }
  if (status.status === "exported") {
    return "Entwürfe vorhanden";
  }
  if (status.status === "selected") {
    return "Entwürfe vorhanden";
  }
  if (status.status === "has_candidates") {
    return "Entwürfe vorhanden";
  }
  if (status.status === "ready_for_generation") {
    return "Bereit fuer Entwürfe";
  }
  if (status.status === "needs_approval") {
    return "Konzept pruefen";
  }
  return "Entwurf";
}

function step(id, state, complete) {
  return {
    id,
    label: VISIBLE_STEP_LABELS[id] || id,
    state,
    complete: Boolean(complete)
  };
}

function nextActionForSteps(steps, status) {
  if (status.candidateGeneration?.isRunning) {
    return {
      label: "Entwurf wird erstellt",
      action: "wait_for_candidate_generation",
      targetStep: "candidates"
    };
  }
  if (status.candidateState === "rendered" || status.candidateState === "planned") {
    return {
      label: "Entwürfe pruefen",
      action: "open_candidates",
      targetStep: "candidates"
    };
  }
  const firstOpen = steps.find((entry) => !entry.complete);
  if (!firstOpen || firstOpen.id === "input") {
    return {
      label: "Input ergänzen",
      action: "add_input",
      targetStep: "input"
    };
  }
  if (firstOpen.id === "concept") {
    return {
      label: "Arbeitsblatt-Konzept prüfen",
      action: "approve_concept",
      targetStep: "concept"
    };
  }
  if (firstOpen.id === "candidates") {
    return {
      label: "Entwurf erstellen",
      action: "generate_image_candidate",
      targetStep: "candidates"
    };
  }
  return {
    label: "Entwurf erstellen",
    action: "generate_image_candidate",
    targetStep: "candidates"
  };
}

function currentStepFor(steps, status) {
  if (status.candidateGeneration?.isRunning) {
    return "candidates";
  }
  if (status.candidateState === "rendered" || status.candidateState === "planned") {
    return "candidates";
  }
  const firstOpen = steps.find((entry) => !entry.complete);
  return firstOpen?.id || "candidates";
}

async function derivedStatusSnapshot(projectDir, options = {}) {
  const status = await getProjectStatus(projectDir);
  const inputComplete = await hasSourceInput(projectDir);
  const conceptComplete = Boolean(status.hasEffectiveApprovedContent || status.hasEffectiveApprovedBrief);
  const candidateRunning = Boolean(status.candidateGeneration?.isRunning);
  const candidateComplete = status.candidateState === "rendered" || status.candidateState === "planned";
  const steps = [
    step("input", inputComplete ? "available" : "missing", inputComplete),
    step("concept", conceptComplete ? status.approvalState || "available" : "missing", conceptComplete),
    step("candidates", candidateRunning ? "generating" : candidateComplete ? status.candidateState || "available" : "missing", candidateComplete)
  ];

  return {
    schemaVersion: PRODUCTION_SCHEMA_VERSION,
    generatedAt: options.now || new Date().toISOString(),
    source: options.source || "derived_project_status",
    libraryStatus: libraryStatusLabel(status),
    currentStep: currentStepFor(steps, status),
    isComplete: candidateComplete,
    hasOutdatedExport: false,
    nextAction: nextActionForSteps(steps, status),
    steps
  };
}

async function refreshStatusSnapshot(projectDir, options = {}) {
  const snapshot = await derivedStatusSnapshot(projectDir, options);
  await writeStatusSnapshot(projectDir, snapshot);
  return snapshot;
}

async function readStatusSnapshot(projectDir) {
  const filePath = path.join(projectDir, STATUS_SNAPSHOT_FILE);
  if (!(await pathExists(filePath))) {
    return null;
  }
  return readJson(filePath);
}

async function writeStatusSnapshot(projectDir, snapshot) {
  await writeJson(path.join(projectDir, STATUS_SNAPSHOT_FILE), snapshot);
}

module.exports = {
  STATUS_SNAPSHOT_FILE,
  STEP_LABELS,
  VISIBLE_STEP_LABELS,
  derivedStatusSnapshot,
  initialStatusSnapshot,
  readStatusSnapshot,
  refreshStatusSnapshot,
  writeStatusSnapshot
};
