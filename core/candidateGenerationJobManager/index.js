"use strict";

const path = require("node:path");
const { PRODUCTION_SCHEMA_VERSION } = require("../contracts");
const { readJsonFileIfExists, writeJsonFile } = require("../jsonFile");
const {
  createUsageAttribution,
  extendUsageAttribution
} = require("../usageAttributionManager");

const DEFAULT_REPO_ROOT = path.resolve(__dirname, "..", "..");
const DEFAULT_PROJECTS_DIR = path.join(DEFAULT_REPO_ROOT, "projects");
const CANDIDATE_GENERATION_STATE_FILE = "candidate-generation-state.json";
const activeJobs = new Map();
let shuttingDown = false;

async function readJsonIfExists(filePath) {
  return readJsonFileIfExists(filePath);
}

async function writeJson(filePath, value) {
  await writeJsonFile(filePath, value);
}

function statePath(projectDir) {
  return path.join(projectDir, CANDIDATE_GENERATION_STATE_FILE);
}

function emptyState(now = new Date().toISOString()) {
  return {
    schemaVersion: PRODUCTION_SCHEMA_VERSION,
    updatedAt: now,
    activeJob: null,
    latestCompletion: null,
    latestFailure: null
  };
}

function candidatePageCount(input = {}) {
  if (Number(input.pageNumber || input.page)) {
    return 1;
  }
  return Math.max(1, Number(input.pageCount) || 1);
}

function runningJobLabel(pageCount) {
  return pageCount > 1 ? "Mehrseitiger Entwurf wird erstellt" : "Entwurf wird erstellt";
}

function runningJobMessage(pageCount) {
  return pageCount > 1
    ? `Der mehrseitige Entwurf mit ${pageCount} Seiten wird im Hintergrund gerendert.`
    : "Der Entwurf wird im Hintergrund gerendert.";
}

function buildActiveJob(input = {}, now = new Date().toISOString()) {
  const pageCount = candidatePageCount(input);
  const pageNumber = Number(input.pageNumber || input.page || 0) || null;
  return {
    jobId: `candidate_generation_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
    commandId: "generate_image_candidate",
    status: "running",
    ownerPid: process.pid,
    startedAt: now,
    updatedAt: now,
    pageCount,
    pageNumber,
    imageProvider: input.imageProvider || input.provider || null,
    label: runningJobLabel(pageCount),
    message: runningJobMessage(pageCount)
  };
}

function publicState(raw = {}) {
  const activeJob = raw.activeJob && raw.activeJob.status === "running"
    ? {
      jobId: raw.activeJob.jobId || null,
      commandId: raw.activeJob.commandId || "generate_image_candidate",
      startedAt: raw.activeJob.startedAt || null,
      updatedAt: raw.activeJob.updatedAt || null,
      pageCount: Number(raw.activeJob.pageCount || 0) || 0,
      pageNumber: Number(raw.activeJob.pageNumber || 0) || null,
      imageProvider: raw.activeJob.imageProvider || null,
      label: raw.activeJob.label || runningJobLabel(Number(raw.activeJob.pageCount || 0) || 1),
      message: raw.activeJob.message || runningJobMessage(Number(raw.activeJob.pageCount || 0) || 1)
    }
    : null;
  const latestCompletion = raw.latestCompletion
    ? {
      jobId: raw.latestCompletion.jobId || null,
      commandId: raw.latestCompletion.commandId || "generate_image_candidate",
      completedAt: raw.latestCompletion.completedAt || null,
      updatedAt: raw.latestCompletion.updatedAt || null,
      runId: raw.latestCompletion.runId || null,
      candidateId: raw.latestCompletion.candidateId || null,
      pageCount: Number(raw.latestCompletion.pageCount || 0) || 0,
      imageProvider: raw.latestCompletion.imageProvider || null,
      seenAt: raw.latestCompletion.seenAt || null
    }
    : null;
  const latestFailure = raw.latestFailure
    ? {
      jobId: raw.latestFailure.jobId || null,
      commandId: raw.latestFailure.commandId || "generate_image_candidate",
      completedAt: raw.latestFailure.completedAt || null,
      updatedAt: raw.latestFailure.updatedAt || null,
      pageCount: Number(raw.latestFailure.pageCount || 0) || 0,
      imageProvider: raw.latestFailure.imageProvider || null,
      message: raw.latestFailure.message || "Die Bildgenerierung konnte nicht abgeschlossen werden."
    }
    : null;

  return {
    isRunning: Boolean(activeJob),
    activeJob,
    latestCompletion,
    latestFailure,
    hasUnreadCompletion: Boolean(latestCompletion && !latestCompletion.seenAt)
  };
}

function interruptionFailure(activeJob = {}, now = new Date().toISOString()) {
  return {
    jobId: activeJob.jobId || null,
    commandId: activeJob.commandId || "generate_image_candidate",
    status: "failed",
    completedAt: now,
    updatedAt: now,
    pageCount: Number(activeJob.pageCount || 0) || 0,
    imageProvider: activeJob.imageProvider || null,
    message: "Die laufende Bildgenerierung wurde beim Neustart von SheetifyIMG unterbrochen. Bitte starte sie erneut."
  };
}

function processIsAlive(pid) {
  const numericPid = Number(pid || 0);
  if (!numericPid) {
    return false;
  }
  try {
    process.kill(numericPid, 0);
    return true;
  } catch {
    return false;
  }
}

async function readRawState(projectDir, options = {}) {
  const now = options.now || new Date().toISOString();
  const existing = await readJsonIfExists(statePath(projectDir));
  const state = {
    ...emptyState(now),
    ...(existing || {})
  };
  let changed = false;

  if (state.activeJob?.status === "running") {
    const active = activeJobs.get(projectDir);
    const ownerAlive = processIsAlive(state.activeJob.ownerPid);
    if (!active && ownerAlive) {
      return state;
    }
    if (!active || active.jobId !== state.activeJob.jobId) {
      state.latestFailure = interruptionFailure(state.activeJob, now);
      state.activeJob = null;
      changed = true;
    }
  }

  if (changed) {
    state.updatedAt = now;
    await writeJson(statePath(projectDir), state);
  }

  return state;
}

async function writeRawState(projectDir, state, options = {}) {
  const now = options.now || new Date().toISOString();
  const nextState = {
    ...emptyState(now),
    ...(state || {}),
    updatedAt: now
  };
  await writeJson(statePath(projectDir), nextState);
  return nextState;
}

async function readCandidateGenerationState(projectDir, options = {}) {
  const state = await readRawState(projectDir, options);
  return publicState(state);
}

async function markCandidateGenerationSeen(projectDir, options = {}) {
  const now = options.now || new Date().toISOString();
  const state = await readRawState(projectDir, { now });
  if (state.latestCompletion && !state.latestCompletion.seenAt) {
    state.latestCompletion = {
      ...state.latestCompletion,
      seenAt: now,
      updatedAt: now
    };
    await writeRawState(projectDir, state, { now });
  }
  return publicState(state);
}

async function startCandidateGenerationJob(projectId, input = {}, options = {}) {
  if (shuttingDown) {
    throw new Error("SheetifyIMG wird gerade beendet. Bitte starte den Entwurf nach dem Neustart erneut.");
  }
  const projectsDir = options.projectsDir || DEFAULT_PROJECTS_DIR;
  const projectDir = options.projectDir || path.join(projectsDir, projectId);
  const now = options.now || new Date().toISOString();
  const state = await readRawState(projectDir, { now });
  if (state.activeJob?.status === "running") {
    throw new Error(
      candidatePageCount(input) > 1
        ? "Für dieses Projekt läuft bereits einen mehrseitigen Entwurf im Hintergrund."
        : "Für dieses Projekt läuft bereits ein Entwurf im Hintergrund."
    );
  }

  const activeJob = buildActiveJob(input, now);
  const usageAttribution = extendUsageAttribution(
    createUsageAttribution(options.usageAttribution, {
      projectId,
      operationKind: "candidate_generation",
      commandId: "generate_image_candidate"
    }),
    { jobId: activeJob.jobId }
  );
  const nextState = {
    ...state,
    activeJob
  };
  await writeRawState(projectDir, nextState, { now });
  activeJobs.set(projectDir, {
    jobId: activeJob.jobId,
    promise: null
  });
  const refreshSnapshot = options.refreshStatusSnapshot || require("../statusSnapshot").refreshStatusSnapshot;
  await refreshSnapshot(projectDir, {
    now,
    source: "candidate_generation_started"
  });

  const executeJob = options.executeJob || require("../imageGenerationManager").generateImageCandidate;
  const task = (async () => {
    try {
      const result = await executeJob(projectDir, {
        ...input,
        now
      }, {
        ...options,
        now,
        usageAttribution
      });
      const completedAt = new Date().toISOString();
      const currentState = await readRawState(projectDir, { now: completedAt });
      currentState.activeJob = null;
      currentState.latestCompletion = {
        jobId: activeJob.jobId,
        commandId: activeJob.commandId,
        status: "completed",
        completedAt,
        updatedAt: completedAt,
        runId: result?.runId || null,
        candidateId: result?.candidate?.id || null,
        pageCount: activeJob.pageCount,
        imageProvider: activeJob.imageProvider || null,
        seenAt: null
      };
      await writeRawState(projectDir, currentState, { now: completedAt });
      await refreshSnapshot(projectDir, {
        now: completedAt,
        source: "candidate_generation_completed"
      });
    } catch (error) {
      const completedAt = new Date().toISOString();
      const currentState = await readRawState(projectDir, { now: completedAt });
      currentState.activeJob = null;
      currentState.latestFailure = {
        jobId: activeJob.jobId,
        commandId: activeJob.commandId,
        status: "failed",
        completedAt,
        updatedAt: completedAt,
        pageCount: activeJob.pageCount,
        imageProvider: activeJob.imageProvider || null,
        message: String(error?.message || error || "Die Bildgenerierung konnte nicht abgeschlossen werden.")
          .trim()
          .slice(0, 500)
      };
      await writeRawState(projectDir, currentState, { now: completedAt });
      await refreshSnapshot(projectDir, {
        now: completedAt,
        source: "candidate_generation_failed"
      });
    } finally {
      activeJobs.delete(projectDir);
    }
  })();

  activeJobs.set(projectDir, {
    jobId: activeJob.jobId,
    promise: task
  });
  task.catch(() => {});

  return publicState(nextState);
}

function beginCandidateGenerationShutdown() {
  shuttingDown = true;
}

function activeCandidateGenerationJobCount() {
  return activeJobs.size;
}

async function waitForActiveCandidateGenerationJobs(options = {}) {
  const timeoutMs = Math.max(1, Number(options.timeoutMs) || 210000);
  const pending = [...activeJobs.values()]
    .map((entry) => entry?.promise)
    .filter(Boolean);
  if (!pending.length) {
    return {
      completed: true,
      timedOut: false,
      pendingCount: 0
    };
  }

  let timeoutId;
  const timeout = new Promise((resolve) => {
    timeoutId = setTimeout(() => resolve("timeout"), timeoutMs);
  });
  const result = await Promise.race([
    Promise.allSettled(pending).then(() => "completed"),
    timeout
  ]);
  clearTimeout(timeoutId);
  return {
    completed: result === "completed",
    timedOut: result === "timeout",
    pendingCount: activeJobs.size
  };
}

function resetCandidateGenerationShutdownForTests() {
  shuttingDown = false;
}

module.exports = {
  CANDIDATE_GENERATION_STATE_FILE,
  activeCandidateGenerationJobCount,
  beginCandidateGenerationShutdown,
  markCandidateGenerationSeen,
  readCandidateGenerationState,
  resetCandidateGenerationShutdownForTests,
  startCandidateGenerationJob,
  waitForActiveCandidateGenerationJobs
};
