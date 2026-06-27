"use strict";

const path = require("node:path");
const { ARTIFACT_STATUSES, ARTIFACT_TYPES, EVENT_TYPES } = require("../contracts");
const { listArtifacts, readArtifactIndex } = require("../artifactManager");
const { approveContentMirrorVersion } = require("../contentMirrorManager");
const { appendEvent } = require("../eventLog");
const { appendHistoryEvent } = require("../historyManager");
const { readJsonFile, writeJsonFile } = require("../jsonFile");

async function readJson(filePath) {
  return readJsonFile(filePath);
}

async function writeJson(filePath, value) {
  await writeJsonFile(filePath, value);
}

async function contentMirrorArtifactForPayload(projectDir, payload = {}) {
  const index = await readArtifactIndex(projectDir);
  const requestedId = payload.contentMirrorId || payload.conceptId || null;
  const requestedVersion = Number(payload.conceptVersion || payload.version || 0) || null;
  const matches = listArtifacts(index, { type: ARTIFACT_TYPES.CONTENT_MIRROR });
  const artifact = matches.find((entry) => {
    return (requestedId && entry.id === requestedId)
      || (requestedVersion && Number(entry.version || 0) === requestedVersion);
  });
  if (!artifact) {
    throw new Error("Konzeptversion nicht gefunden.");
  }
  return artifact;
}

async function activateContentMirrorVersion(projectDir, payload = {}, options = {}) {
  const now = options.now || new Date().toISOString();
  const artifact = await contentMirrorArtifactForPayload(projectDir, payload);
  if (artifact.status === ARTIFACT_STATUSES.DRAFT && payload.approve === true) {
    const approved = await approveContentMirrorVersion(projectDir, artifact.id, options);
    return {
      contentMirrorId: artifact.id,
      conceptVersion: artifact.version || approved.version || null,
      status: ARTIFACT_STATUSES.APPROVED,
      approved: true,
      data: approved
    };
  }
  if (![ARTIFACT_STATUSES.APPROVED, ARTIFACT_STATUSES.DRAFT].includes(artifact.status)) {
    throw new Error("Diese Konzeptversion kann nicht als Arbeitsstand übernommen werden.");
  }

  const manifestPath = path.join(projectDir, "project-manifest.json");
  const manifest = await readJson(manifestPath);
  const previousContentMirrorId = manifest.currentArtifacts?.contentMirrorId || null;
  const content = await readJson(path.join(projectDir, artifact.path));
  manifest.currentArtifacts = {
    ...(manifest.currentArtifacts || {}),
    contentMirrorId: artifact.id
  };
  manifest.approval = {
    ...(manifest.approval || {}),
    contentMirror: artifact.status,
    canGenerate: artifact.status === ARTIFACT_STATUSES.APPROVED,
    reason: artifact.status === ARTIFACT_STATUSES.APPROVED ? null : "Current content mirror is not approved."
  };
  manifest.updatedAt = now;
  await writeJson(manifestPath, manifest);

  if (artifact.status === ARTIFACT_STATUSES.APPROVED) {
    await writeJson(path.join(projectDir, "content", "approved.content-mirror.json"), {
      ...content,
      status: ARTIFACT_STATUSES.APPROVED,
      approval: {
        ...(content.approval || {}),
        status: ARTIFACT_STATUSES.APPROVED
      }
    });
  } else {
    await writeJson(path.join(projectDir, "content", "draft.content-mirror.json"), {
      ...content,
      status: ARTIFACT_STATUSES.DRAFT,
      approval: {
        ...(content.approval || {}),
        status: ARTIFACT_STATUSES.DRAFT,
        approvedAt: null
      }
    });
  }

  await appendEvent(projectDir, {
    type: EVENT_TYPES.ARTIFACT_UPDATED,
    createdAt: now,
    step: artifact.status === ARTIFACT_STATUSES.APPROVED ? "freigabe" : "content",
    artifactId: artifact.id,
    payload: {
      type: ARTIFACT_TYPES.CONTENT_MIRROR,
      action: "activated_content_mirror_version",
      previousContentMirrorId,
      status: artifact.status,
      version: artifact.version || null
    }
  }, { now });
  await appendHistoryEvent(projectDir, {
    type: "content_mirror_version_activated",
    createdAt: now,
    artifactId: artifact.id,
    version: artifact.version || null,
    status: artifact.status,
    previousContentMirrorId
  }, { now });

  return {
    contentMirrorId: artifact.id,
    conceptVersion: artifact.version || content.version || null,
    status: artifact.status,
    approved: artifact.status === ARTIFACT_STATUSES.APPROVED,
    data: content
  };
}

module.exports = {
  activateContentMirrorVersion
};
