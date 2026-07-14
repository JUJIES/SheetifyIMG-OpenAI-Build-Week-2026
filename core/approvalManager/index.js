"use strict";

const fs = require("node:fs/promises");
const path = require("node:path");
const {
  ARTIFACT_STATUSES,
  ARTIFACT_TYPES
} = require("../contracts");
const { findArtifact, listArtifacts, readArtifactIndex } = require("../artifactManager");

async function pathExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

function latestApprovedArtifact(index, type) {
  return listArtifacts(index, { type, status: ARTIFACT_STATUSES.APPROVED })
    .sort((left, right) => (Number(right.version) || 0) - (Number(left.version) || 0))[0] || null;
}

async function getApprovalState(projectDir) {
  const index = await readArtifactIndex(projectDir);
  const manifestPath = path.join(projectDir, "project-manifest.json");
  const manifest = (await pathExists(manifestPath))
    ? JSON.parse(await fs.readFile(manifestPath, "utf8"))
    : {};
  const currentLessonBrief = manifest.currentArtifacts?.lessonbriefId
    ? findArtifact(index, manifest.currentArtifacts.lessonbriefId)
    : null;
  const currentContentMirror = manifest.currentArtifacts?.contentMirrorId
    ? findArtifact(index, manifest.currentArtifacts.contentMirrorId)
    : null;
  const approvedLessonBrief = currentLessonBrief?.status === ARTIFACT_STATUSES.APPROVED
    ? currentLessonBrief
    : latestApprovedArtifact(index, ARTIFACT_TYPES.LESSON_BRIEF);
  const approvedContentMirror = currentContentMirror
    ? currentContentMirror.status === ARTIFACT_STATUSES.APPROVED ? currentContentMirror : null
    : latestApprovedArtifact(index, ARTIFACT_TYPES.CONTENT_MIRROR);
  const lessonBriefCoveredByContent = Boolean(approvedContentMirror && !approvedLessonBrief);
  const effectiveLessonBrief = approvedLessonBrief || (approvedContentMirror ? currentLessonBrief : null);
  const lessonBriefStatus = approvedLessonBrief
    ? ARTIFACT_STATUSES.APPROVED
    : lessonBriefCoveredByContent
      ? "covered_by_content"
      : currentLessonBrief?.status || "missing";
  const compatibilityApprovedContent = await pathExists(path.join(projectDir, "content", "approved.content-mirror.json"));
  const reason = approvedContentMirror
    ? null
    : currentContentMirror
      ? `Current content mirror is ${currentContentMirror.status}, not approved.`
      : "No explicitly approved content mirror artifact exists.";

  return {
    approvedLessonBrief,
    effectiveLessonBrief,
    approvedContentMirror,
    currentLessonBrief,
    currentContentMirror,
    lessonBriefCoveredByContent,
    lessonBriefStatus,
    compatibilityApprovedContent,
    canGenerate: Boolean(approvedContentMirror),
    reason
  };
}

async function assertCanGenerate(projectDir) {
  const state = await getApprovalState(projectDir);
  if (!state.canGenerate) {
    throw new Error(state.reason);
  }
  return state;
}

module.exports = {
  assertCanGenerate,
  getApprovalState
};
