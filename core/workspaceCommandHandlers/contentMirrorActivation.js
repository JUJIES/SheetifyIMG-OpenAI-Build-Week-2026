"use strict";

const path = require("node:path");
const { ARTIFACT_STATUSES, ARTIFACT_TYPES, EVENT_TYPES } = require("../contracts");
const { listArtifacts, readArtifactIndex } = require("../artifactManager");
const { approveLessonBriefVersion } = require("../briefManager");
const {
  approveContentMirrorVersion,
  assertContentMirrorReadyForApproval
} = require("../contentMirrorManager");
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

function pairedLessonBriefArtifact(index, contentArtifact) {
  const contentSources = new Set(contentArtifact.createdFrom || []);
  if (!contentSources.size) {
    return null;
  }
  const matches = listArtifacts(index, { type: ARTIFACT_TYPES.LESSON_BRIEF })
    .filter((brief) => (brief.createdFrom || []).some((sourceId) => contentSources.has(sourceId)));
  if (matches.length > 1) {
    throw new Error("Die Konzeptversion ist mit mehreren internen Planungsständen verknüpft.");
  }
  return matches[0] || null;
}

function draftApprovalStatus(status) {
  return status === ARTIFACT_STATUSES.APPROVED
    ? ARTIFACT_STATUSES.APPROVED
    : "draft_only";
}

function aliasData(data, status) {
  if (status === ARTIFACT_STATUSES.APPROVED) {
    return {
      ...data,
      status,
      approval: {
        ...(data.approval || {}),
        status
      }
    };
  }
  return {
    ...data,
    status: ARTIFACT_STATUSES.DRAFT,
    approval: data.approval ? {
      ...data.approval,
      status: ARTIFACT_STATUSES.DRAFT,
      approvedAt: null
    } : undefined
  };
}

async function writeLessonBriefAlias(projectDir, artifact, data) {
  const fileName = artifact.status === ARTIFACT_STATUSES.APPROVED
    ? "approved.lessonbrief.json"
    : "draft.lessonbrief.json";
  await writeJson(path.join(projectDir, "brief", fileName), aliasData(data, artifact.status));
}

async function writeContentMirrorAlias(projectDir, artifact, data) {
  const fileName = artifact.status === ARTIFACT_STATUSES.APPROVED
    ? "approved.content-mirror.json"
    : "draft.content-mirror.json";
  await writeJson(path.join(projectDir, "content", fileName), aliasData(data, artifact.status));
}

async function activateContentMirrorVersion(projectDir, payload = {}, options = {}) {
  const now = options.now || new Date().toISOString();
  let artifact = await contentMirrorArtifactForPayload(projectDir, payload);
  if (![ARTIFACT_STATUSES.APPROVED, ARTIFACT_STATUSES.DRAFT].includes(artifact.status)) {
    throw new Error("Diese Konzeptversion kann nicht als Arbeitsstand genutzt werden.");
  }

  let index = await readArtifactIndex(projectDir);
  let pairedBrief = pairedLessonBriefArtifact(index, artifact);
  if (
    pairedBrief
    && ![ARTIFACT_STATUSES.APPROVED, ARTIFACT_STATUSES.DRAFT].includes(pairedBrief.status)
  ) {
    throw new Error("Der zugehörige interne Planungsstand kann nicht aktiviert werden.");
  }
  if (
    pairedBrief?.status === ARTIFACT_STATUSES.DRAFT
    && artifact.status === ARTIFACT_STATUSES.APPROVED
    && payload.approve !== true
  ) {
    throw new Error("Der zugehörige interne Planungsstand muss zusammen mit dieser Konzeptversion freigegeben werden.");
  }
  const manifestPath = path.join(projectDir, "project-manifest.json");
  let manifest = await readJson(manifestPath);
  const previousContentMirrorId = manifest.currentArtifacts?.contentMirrorId || null;
  const previousLessonBriefId = manifest.currentArtifacts?.lessonbriefId || null;
  let content = await readJson(path.join(projectDir, artifact.path));
  let pairedBriefData = pairedBrief
    ? await readJson(path.join(projectDir, pairedBrief.path))
    : null;

  if (artifact.status === ARTIFACT_STATUSES.DRAFT && payload.approve === true) {
    await assertContentMirrorReadyForApproval(projectDir, content, {
      index,
      manifest,
      ...(pairedBriefData ? { brief: pairedBriefData } : {})
    });
  }

  if (pairedBrief?.status === ARTIFACT_STATUSES.DRAFT && payload.approve === true) {
    pairedBriefData = await approveLessonBriefVersion(projectDir, pairedBrief.id, options);
    pairedBrief = {
      ...pairedBrief,
      status: ARTIFACT_STATUSES.APPROVED
    };
    manifest = await readJson(manifestPath);
  }

  manifest.currentArtifacts = {
    ...(manifest.currentArtifacts || {}),
    contentMirrorId: artifact.id,
    ...(pairedBrief ? { lessonbriefId: pairedBrief.id } : {})
  };
  const pairedBriefApproved = !pairedBrief || pairedBrief.status === ARTIFACT_STATUSES.APPROVED;
  const contentApproved = artifact.status === ARTIFACT_STATUSES.APPROVED;
  manifest.approval = {
    ...(manifest.approval || {}),
    ...(pairedBrief ? { lessonBrief: draftApprovalStatus(pairedBrief.status) } : {}),
    contentMirror: pairedBrief ? draftApprovalStatus(artifact.status) : artifact.status,
    canGenerate: contentApproved && pairedBriefApproved,
    reason: contentApproved && pairedBriefApproved
      ? null
      : !contentApproved
        ? "Current content mirror is not approved."
        : "The lesson brief paired with the current content mirror is not approved."
  };
  manifest.updatedAt = now;
  await writeJson(manifestPath, manifest);

  if (pairedBrief) {
    await writeLessonBriefAlias(projectDir, pairedBrief, pairedBriefData);
  }

  if (artifact.status === ARTIFACT_STATUSES.DRAFT && payload.approve === true) {
    content = await approveContentMirrorVersion(projectDir, artifact.id, options);
    artifact = {
      ...artifact,
      status: ARTIFACT_STATUSES.APPROVED
    };
  } else {
    await writeContentMirrorAlias(projectDir, artifact, content);
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
      previousLessonBriefId,
      pairedLessonBriefId: pairedBrief?.id || null,
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
    previousContentMirrorId,
    previousLessonBriefId,
    pairedLessonBriefId: pairedBrief?.id || null
  }, { now });

  return {
    contentMirrorId: artifact.id,
    lessonBriefId: pairedBrief?.id || null,
    conceptVersion: artifact.version || content.version || null,
    status: artifact.status,
    approved: artifact.status === ARTIFACT_STATUSES.APPROVED,
    data: content
  };
}

module.exports = {
  activateContentMirrorVersion
};
