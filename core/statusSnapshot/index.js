"use strict";

const fs = require("node:fs/promises");
const path = require("node:path");
const {
  PRODUCTION_SCHEMA_VERSION,
  EVENT_TYPES,
  PROJECT_TYPES
} = require("../contracts");
const { readEvents } = require("../eventLog");
const { getProjectStatus, projectTypeOf } = require("../projectStatus");

const STATUS_SNAPSHOT_FILE = "status-snapshot.json";

const STEP_LABELS = Object.freeze({
  auftrag: "Input",
  input: "Input",
  brief: "Arbeitsblatt-Konzept",
  content: "Arbeitsblatt-Konzept",
  pruefung: "Arbeitsblatt-Konzept",
  freigabe: "Arbeitsblatt-Konzept",
  kandidaten: "Kandidaten",
  auswahl: "Kandidaten",
  export: "Kandidaten"
});

const VISIBLE_STEPS = Object.freeze([
  "input",
  "concept",
  "candidates"
]);

const VISIBLE_STEP_LABELS = Object.freeze({
  input: "Input",
  concept: "Arbeitsblatt-Konzept",
  candidates: "Kandidaten"
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
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function initialStatusSnapshot({ now, projectType }) {
  const isSeries = projectType === PROJECT_TYPES.SERIES;
  return {
    schemaVersion: PRODUCTION_SCHEMA_VERSION,
    generatedAt: now || new Date().toISOString(),
    source: "initial_project_creation",
    libraryStatus: isSeries ? "Leere Reihe" : "Entwurf",
    currentStep: "input",
    isComplete: false,
    hasOutdatedExport: false,
    nextAction: {
      label: isSeries ? "Arbeitsblatt hinzufügen" : "Input ergänzen",
      action: isSeries ? "add_worksheet_to_series" : "add_input",
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
  if (status.status === "exported") {
    return "Kandidaten vorhanden";
  }
  if (status.status === "selected") {
    return "Kandidaten vorhanden";
  }
  if (status.status === "has_candidates") {
    return "Kandidaten vorhanden";
  }
  if (status.status === "ready_for_generation") {
    return "Bereit fuer Kandidaten";
  }
  if (status.status === "needs_approval") {
    return "Konzept pruefen";
  }
  if (status.status === "empty_series") {
    return "Leere Reihe";
  }
  if (status.status === "in_progress") {
    return "In Arbeit";
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

function nextActionForSteps(steps, status, isSeries) {
  if (status.candidateState === "rendered" || status.candidateState === "planned") {
    return {
      label: "Kandidaten pruefen",
      action: "open_candidates",
      targetStep: "candidates"
    };
  }
  if (isSeries) {
    return {
      label: "Arbeitsblatt hinzufügen",
      action: "add_worksheet_to_series",
      targetStep: "input"
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
      label: "Kandidat erzeugen",
      action: "generate_image_candidate",
      targetStep: "candidates"
    };
  }
  return {
    label: "Kandidat erzeugen",
    action: "generate_image_candidate",
    targetStep: "candidates"
  };
}

function currentStepFor(steps, status) {
  if (status.candidateState === "rendered" || status.candidateState === "planned") {
    return "candidates";
  }
  const firstOpen = steps.find((entry) => !entry.complete);
  return firstOpen?.id || "candidates";
}

async function derivedStatusSnapshot(projectDir, options = {}) {
  const manifest = await readJson(path.join(projectDir, "project-manifest.json"));
  const status = await getProjectStatus(projectDir);
  const projectType = projectTypeOf(manifest);
  const isSeries = projectType === PROJECT_TYPES.SERIES;
  const inputComplete = isSeries
    ? Number(status.worksheetCount || 0) > 0
    : await hasSourceInput(projectDir);
  const conceptComplete = isSeries
    ? Number(status.worksheetCount || 0) > 0
    : Boolean(status.hasEffectiveApprovedContent || status.hasEffectiveApprovedBrief);
  const candidateComplete = isSeries
    ? Number(status.worksheetCount || 0) > 0
    : status.candidateState === "rendered" || status.candidateState === "planned";
  const steps = [
    step("input", inputComplete ? "available" : "missing", inputComplete),
    step("concept", conceptComplete ? status.approvalState || "available" : "missing", conceptComplete),
    step("candidates", candidateComplete ? status.candidateState || "available" : "missing", candidateComplete)
  ];

  return {
    schemaVersion: PRODUCTION_SCHEMA_VERSION,
    generatedAt: options.now || new Date().toISOString(),
    source: options.source || "derived_project_status",
    libraryStatus: libraryStatusLabel(status),
    currentStep: currentStepFor(steps, status),
    isComplete: candidateComplete,
    hasOutdatedExport: false,
    nextAction: nextActionForSteps(steps, status, isSeries),
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
