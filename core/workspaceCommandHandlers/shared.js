"use strict";

const fs = require("node:fs/promises");
const path = require("node:path");
const { ARTIFACT_STATUSES, ARTIFACT_TYPES } = require("../contracts");
const {
  findArtifact,
  listArtifacts,
  readArtifactIndex
} = require("../artifactManager");
const { approveLessonBriefVersion } = require("../briefManager");
const { approveContentMirrorVersion } = require("../contentMirrorManager");
const { PROPOSAL_KINDS } = require("../aiProposalManager");
const { readJsonFile } = require("../jsonFile");

async function pathExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function readJson(filePath) {
  return readJsonFile(filePath);
}

function handlerOptions(context) {
  return {
    repoRoot: context.repoRoot,
    projectsDir: context.projectsDir,
    now: context.now
  };
}

function worksheetOptions(context) {
  return {
    ...handlerOptions(context),
    ...(context.worksheetsDir ? { worksheetsDir: context.worksheetsDir } : {})
  };
}

async function readProposalById(projectDir, proposalId) {
  if (!proposalId) {
    return null;
  }
  const proposalsDir = path.join(projectDir, "proposals");
  if (!(await pathExists(proposalsDir))) {
    return null;
  }
  const files = await fs.readdir(proposalsDir);
  const fileName = files.find((entry) => entry.startsWith(`${proposalId}.`) && entry.endsWith(".json"));
  return fileName ? readJson(path.join(proposalsDir, fileName)) : null;
}

async function currentOrLatestArtifact(projectDir, fieldName, type, preferredStatus = null) {
  const manifest = await readJson(path.join(projectDir, "project-manifest.json"));
  const index = await readArtifactIndex(projectDir);
  const currentId = manifest.currentArtifacts?.[fieldName] || null;
  const current = currentId ? findArtifact(index, currentId) : null;
  if (current && (!preferredStatus || current.status === preferredStatus)) {
    return current;
  }
  const matches = listArtifacts(index, {
    type,
    ...(preferredStatus ? { status: preferredStatus } : {})
  }).sort((left, right) => (Number(right.version) || 0) - (Number(left.version) || 0));
  return matches[0] || current || null;
}

async function approveCurrentBrief(projectDir, options = {}) {
  const artifact = await currentOrLatestArtifact(
    projectDir,
    "lessonbriefId",
    ARTIFACT_TYPES.LESSON_BRIEF,
    ARTIFACT_STATUSES.DRAFT
  );
  if (!artifact) {
    throw new Error("No draft lesson brief exists.");
  }
  return approveLessonBriefVersion(projectDir, artifact.id, options);
}

async function approveCurrentContent(projectDir, options = {}) {
  const artifact = await currentOrLatestArtifact(
    projectDir,
    "contentMirrorId",
    ARTIFACT_TYPES.CONTENT_MIRROR,
    ARTIFACT_STATUSES.DRAFT
  );
  if (!artifact) {
    throw new Error("No draft content mirror exists.");
  }
  return approveContentMirrorVersion(projectDir, artifact.id, options);
}

async function assertProposalMatchesCurrentState(projectDir, proposalId, kind) {
  const proposal = await readProposalById(projectDir, proposalId);
  if (!proposal) {
    return;
  }
  const manifest = await readJson(path.join(projectDir, "project-manifest.json"));
  if (proposal.kind !== kind) {
    throw new Error(`Proposal ${proposalId} is ${proposal.kind}, not ${kind}.`);
  }
  if (kind === PROPOSAL_KINDS.CONTENT_MIRROR) {
    const sourceBriefId = proposal.source?.currentLessonBriefId || null;
    const currentBriefId = manifest.currentArtifacts?.lessonbriefId || null;
    if (sourceBriefId && currentBriefId && sourceBriefId !== currentBriefId) {
      throw new Error("Dieser Konzeptvorschlag gehört zu einem älteren Planungsstand. Bitte den aktuellen Vorschlag verwenden.");
    }
  }
  if (kind === PROPOSAL_KINDS.IMAGE_SPEC) {
    const sourceContentId = proposal.source?.currentContentMirrorId || null;
    const currentContentId = manifest.currentArtifacts?.contentMirrorId || null;
    if (sourceContentId && currentContentId && sourceContentId !== currentContentId) {
      throw new Error("Diese Entwurfsvorbereitung gehört zu einem älteren Konzeptstand. Bitte aus dem aktuellen Konzept neu vorbereiten.");
    }
  }
}

module.exports = {
  approveCurrentBrief,
  approveCurrentContent,
  assertProposalMatchesCurrentState,
  currentOrLatestArtifact,
  handlerOptions,
  readJson,
  worksheetOptions
};
