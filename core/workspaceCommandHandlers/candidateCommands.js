"use strict";

const { PROPOSAL_KINDS, adoptProposal, readActiveImageSpec } = require("../aiProposalManager");
const { getApprovalState } = require("../approvalManager");
const { startCandidateGenerationJob } = require("../candidateGenerationJobManager");
const { assertImageGenerationContract } = require("../imageGenerationContract");
const { createRun } = require("../runManager");
const {
  approveCurrentContent,
  assertProposalMatchesCurrentState,
  handlerOptions,
  readJson
} = require("./shared");
const { ensureImageSpecForCandidate } = require("./imagePrepCommands");

function createGenerationOptions(context) {
  return {
    repoRoot: context.repoRoot,
    projectsDir: context.projectsDir,
    projectDir: context.projectDir,
    now: context.now,
    usageAttribution: context.usageAttribution
  };
}

async function assertGenerationContractForPayload(context, payload = {}) {
  const approvalState = await getApprovalState(context.projectDir);
  const contentArtifact = approvalState.approvedContentMirror;
  if (!contentArtifact) {
    return null;
  }
  const briefArtifact = approvalState.effectiveLessonBrief
    || approvalState.approvedLessonBrief
    || approvalState.currentLessonBrief
    || null;
  const contentMirror = await readJson(`${context.projectDir}/${contentArtifact.path}`);
  const lessonBrief = briefArtifact ? await readJson(`${context.projectDir}/${briefArtifact.path}`) : {};
  const imageSpec = await readActiveImageSpec(context.projectDir, payload.imageSpecProposalId);
  return assertImageGenerationContract({
    contentMirror,
    lessonBrief,
    imageSpec,
    requestedPageCount: payload.pageCount || null
  });
}

async function startCandidateGeneration(context, payload) {
  await assertProposalMatchesCurrentState(context.projectDir, payload.imageSpecProposalId, PROPOSAL_KINDS.IMAGE_SPEC);
  await assertGenerationContractForPayload(context, payload);
  return startCandidateGenerationJob(context.projectId, {
    ...payload,
    now: context.now
  }, createGenerationOptions(context));
}

async function generateCandidateFromContentProposal(context) {
  const { projectId, projectDir, payload, now } = context;
  await assertProposalMatchesCurrentState(projectDir, payload.proposalId, PROPOSAL_KINDS.CONTENT_MIRROR);
  const adopted = await adoptProposal(projectId, PROPOSAL_KINDS.CONTENT_MIRROR, {
    payload,
    requireApproval: true,
    silent: true,
    now
  }, handlerOptions(context));
  const approvedContent = await approveCurrentContent(projectDir, handlerOptions(context));
  const candidatePayload = await ensureImageSpecForCandidate(context, payload);
  const candidateGeneration = await startCandidateGeneration(context, candidatePayload);
  return {
    adopted,
    approved: true,
    approvedContent,
    queued: true,
    candidateGeneration
  };
}

function createGenerationRun(context) {
  return createRun(context.projectDir, handlerOptions(context));
}

async function generateImageCandidate(context) {
  const approvalState = await getApprovalState(context.projectDir);
  if (!approvalState.canGenerate) {
    await approveCurrentContent(context.projectDir, handlerOptions(context));
  }
  const candidatePayload = await ensureImageSpecForCandidate(context, context.payload);
  const candidateGeneration = await startCandidateGeneration(context, candidatePayload);
  return {
    queued: true,
    candidateGeneration
  };
}

const candidateCommandHandlers = {
  generate_candidate_from_content_proposal: generateCandidateFromContentProposal,
  create_run: createGenerationRun,
  generate_image_candidate: generateImageCandidate
};

module.exports = {
  candidateCommandHandlers
};
