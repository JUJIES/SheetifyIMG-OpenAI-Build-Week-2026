"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const path = require("node:path");
const {
  ARTIFACT_STATUSES,
  ARTIFACT_TYPES,
  EVENT_TYPES,
  PRODUCTION_SCHEMA_VERSION
} = require("../contracts");
const { assertCanGenerate } = require("../approvalManager");
const { appendEvent, readEvents } = require("../eventLog");
const { appendHistoryEvent } = require("../historyManager");
const { registerArtifact } = require("../artifactManager");
const { conceptReferenceFromSourceArtifacts } = require("../conceptReference");
const {
  contentReadinessForGeneration,
  contentReadinessMessage
} = require("../contentReadiness");
const { writeJsonFile } = require("../jsonFile");
const { updateRunAnalysisReport } = require("../runAnalysisManager");

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

async function listDirs(dirPath) {
  if (!(await pathExists(dirPath))) {
    return [];
  }
  const entries = await fs.readdir(dirPath, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

function sha256(value) {
  return crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

async function nextRunId(projectDir) {
  const runNames = await listDirs(path.join(projectDir, "runs"));
  const numbers = runNames
    .map((name) => Number(String(name).match(/^run_(\d+)$/)?.[1] || 0))
    .filter(Boolean);
  return `run_${String(Math.max(0, ...numbers) + 1).padStart(3, "0")}`;
}

async function readProjectManifest(projectDir) {
  return readJson(path.join(projectDir, "project-manifest.json"));
}

async function writeProjectManifest(projectDir, manifest) {
  await writeJson(path.join(projectDir, "project-manifest.json"), manifest);
}

async function writeImageSheetBrief({ projectDir, runDir, approvalState, now }) {
  const lessonBriefArtifact = approvalState.effectiveLessonBrief
    || approvalState.approvedLessonBrief
    || approvalState.currentLessonBrief
    || null;
  const lessonBrief = lessonBriefArtifact
    ? await readJson(path.join(projectDir, lessonBriefArtifact.path))
    : null;
  const contentMirror = await readJson(path.join(projectDir, approvalState.approvedContentMirror.path));
  const sourceArtifacts = {
    lessonbriefId: lessonBriefArtifact?.id || null,
    contentMirrorId: approvalState.approvedContentMirror.id
  };
  const concept = conceptReferenceFromSourceArtifacts(sourceArtifacts);
  const imageSheetBrief = {
    schemaVersion: PRODUCTION_SCHEMA_VERSION,
    createdAt: now,
    sourceArtifacts,
    concept,
    sourceHashes: {
      lessonBrief: lessonBrief ? sha256(lessonBrief) : null,
      contentMirror: sha256(contentMirror)
    },
    lessonBrief,
    contentMirror
  };

  await writeJson(path.join(runDir, "brief.imagesheet.json"), imageSheetBrief);
  return imageSheetBrief;
}

async function createRun(projectDir, options = {}) {
  const now = options.now || new Date().toISOString();
  const approvalState = await assertCanGenerate(projectDir);
  const projectManifest = await readProjectManifest(projectDir);
  const approvedContent = await readJson(path.join(projectDir, approvalState.approvedContentMirror.path));
  const lessonBriefArtifact = approvalState.effectiveLessonBrief
    || approvalState.approvedLessonBrief
    || approvalState.currentLessonBrief
    || null;
  const approvedBrief = lessonBriefArtifact
    ? await readJson(path.join(projectDir, lessonBriefArtifact.path))
    : {};
  const events = await readEvents(projectDir);
  const readiness = contentReadinessForGeneration(approvedContent, { events, brief: approvedBrief });
  if (!readiness.ready) {
    throw new Error(contentReadinessMessage(readiness));
  }
  const runId = options.runId || await nextRunId(projectDir);
  const runDir = path.join(projectDir, "runs", runId);

  if (await pathExists(runDir)) {
    throw new Error(`Run already exists: ${runId}`);
  }

  await fs.mkdir(path.join(runDir, "candidates"), { recursive: true });
  await fs.mkdir(path.join(runDir, "review"), { recursive: true });
  await fs.mkdir(path.join(runDir, "qc"), { recursive: true });

  await writeImageSheetBrief({ projectDir, runDir, approvalState, now });
  const sourceArtifacts = {
    lessonbriefId: lessonBriefArtifact?.id || null,
    contentMirrorId: approvalState.approvedContentMirror.id
  };
  const concept = conceptReferenceFromSourceArtifacts(sourceArtifacts);

  const manifest = {
    schemaVersion: PRODUCTION_SCHEMA_VERSION,
    runId,
    projectId: projectManifest.projectId,
    pipeline: "image_first",
    status: "created",
    createdAt: now,
    sourceArtifacts,
    concept,
    brief: "brief.imagesheet.json",
    candidates: [],
    outputs: {
      reviewGallery: null
    }
  };

  await writeJson(path.join(runDir, "run-manifest.json"), manifest);
  await registerArtifact(projectDir, {
    id: runId,
    type: ARTIFACT_TYPES.RUN,
    path: `runs/${runId}/run-manifest.json`,
    status: ARTIFACT_STATUSES.CURRENT,
    step: "entwuerfe",
    createdAt: now,
    createdFrom: Object.values(manifest.sourceArtifacts).filter(Boolean)
  }, { now });

  projectManifest.currentArtifacts = {
    ...(projectManifest.currentArtifacts || {}),
    runId
  };
  projectManifest.updatedAt = now;
  await writeProjectManifest(projectDir, projectManifest);

  await appendEvent(projectDir, {
    type: EVENT_TYPES.RUN_STARTED,
    createdAt: now,
    step: "entwuerfe",
    runId,
    artifactId: runId,
    payload: {
      sourceArtifacts: manifest.sourceArtifacts,
      concept
    }
  });
  await appendHistoryEvent(projectDir, {
    type: "run_created",
    createdAt: now,
    runId,
    sourceArtifacts: manifest.sourceArtifacts,
    concept
  });
  await updateRunAnalysisReport(projectDir, runId, { now });

  return { runId, runDir, manifest };
}

module.exports = {
  createRun,
  nextRunId
};
