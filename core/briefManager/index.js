"use strict";

const fs = require("node:fs/promises");
const path = require("node:path");
const {
  ARTIFACT_STATUSES,
  ARTIFACT_TYPES,
  EVENT_TYPES,
  PRODUCTION_SCHEMA_VERSION
} = require("../contracts");
const {
  artifactIdFor,
  formatVersion,
  nextArtifactVersion,
  readArtifactIndex,
  registerArtifact,
  setArtifactStatus
} = require("../artifactManager");
const { appendEvent } = require("../eventLog");
const { appendHistoryEvent } = require("../historyManager");

async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, "utf8"));
}

async function writeJson(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function readProjectManifest(projectDir) {
  return readJson(path.join(projectDir, "project-manifest.json"));
}

async function writeProjectManifest(projectDir, manifest) {
  await writeJson(path.join(projectDir, "project-manifest.json"), manifest);
}

async function createLessonBriefVersion(projectDir, data = {}, options = {}) {
  const now = options.now || new Date().toISOString();
  const index = await readArtifactIndex(projectDir);
  const version = options.version || nextArtifactVersion(index, ARTIFACT_TYPES.LESSON_BRIEF);
  const artifactId = artifactIdFor(ARTIFACT_TYPES.LESSON_BRIEF, version);
  const fileName = `lessonbrief.${formatVersion(version)}.json`;
  const relativePath = `brief/${fileName}`;
  const brief = {
    ...data,
    schemaVersion: data.schemaVersion || PRODUCTION_SCHEMA_VERSION,
    artifactId,
    version,
    status: ARTIFACT_STATUSES.DRAFT,
    createdAt: data.createdAt || now,
    updatedAt: now
  };

  await writeJson(path.join(projectDir, relativePath), brief);
  await writeJson(path.join(projectDir, "brief", "draft.lessonbrief.json"), brief);
  await registerArtifact(projectDir, {
    id: artifactId,
    type: ARTIFACT_TYPES.LESSON_BRIEF,
    version,
    path: relativePath,
    status: ARTIFACT_STATUSES.DRAFT,
    step: "brief",
    createdAt: now,
    createdFrom: options.createdFrom || []
  }, { now });

  const manifest = await readProjectManifest(projectDir);
  manifest.currentArtifacts = {
    ...(manifest.currentArtifacts || {}),
    lessonbriefId: artifactId
  };
  manifest.updatedAt = now;
  await writeProjectManifest(projectDir, manifest);

  await appendEvent(projectDir, {
    type: EVENT_TYPES.ARTIFACT_CREATED,
    createdAt: now,
    step: "brief",
    artifactId,
    payload: { type: ARTIFACT_TYPES.LESSON_BRIEF, version }
  });
  await appendHistoryEvent(projectDir, {
    type: "lessonbrief_version_created",
    createdAt: now,
    artifactId,
    version
  });

  return { artifactId, path: relativePath, data: brief };
}

async function approveLessonBriefVersion(projectDir, artifactId, options = {}) {
  const now = options.now || new Date().toISOString();
  const index = await readArtifactIndex(projectDir);
  const artifact = index.artifacts.find((entry) => entry.id === artifactId);
  if (!artifact || artifact.type !== ARTIFACT_TYPES.LESSON_BRIEF) {
    throw new Error(`Lesson brief artifact does not exist: ${artifactId}`);
  }

  const briefPath = path.join(projectDir, artifact.path);
  const brief = await readJson(briefPath);
  const approvedBrief = {
    ...brief,
    status: ARTIFACT_STATUSES.APPROVED,
    approval: {
      ...(brief.approval || {}),
      status: ARTIFACT_STATUSES.APPROVED,
      approvedAt: now
    },
    updatedAt: now
  };

  await writeJson(briefPath, approvedBrief);
  await writeJson(path.join(projectDir, "brief", "approved.lessonbrief.json"), approvedBrief);
  await setArtifactStatus(projectDir, artifactId, ARTIFACT_STATUSES.APPROVED, { now });

  const manifest = await readProjectManifest(projectDir);
  manifest.currentArtifacts = {
    ...(manifest.currentArtifacts || {}),
    lessonbriefId: artifactId
  };
  manifest.approval = {
    ...(manifest.approval || {}),
    lessonBrief: ARTIFACT_STATUSES.APPROVED
  };
  manifest.updatedAt = now;
  await writeProjectManifest(projectDir, manifest);

  await appendEvent(projectDir, {
    type: EVENT_TYPES.ARTIFACT_APPROVED,
    createdAt: now,
    step: "brief",
    artifactId,
    payload: { type: ARTIFACT_TYPES.LESSON_BRIEF }
  });
  await appendHistoryEvent(projectDir, {
    type: "lessonbrief_approved",
    createdAt: now,
    artifactId
  });

  return approvedBrief;
}

module.exports = {
  approveLessonBriefVersion,
  createLessonBriefVersion
};

