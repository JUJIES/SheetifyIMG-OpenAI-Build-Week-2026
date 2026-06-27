"use strict";

const { PROPOSAL_KINDS, adoptProposal } = require("../aiProposalManager");
const { startCandidateGenerationJob } = require("../candidateGenerationJobManager");
const { createRun } = require("../runManager");
const {
  approveCurrentContent,
  assertProposalMatchesCurrentState,
  handlerOptions
} = require("./shared");
const { ensureImageSpecForCandidate } = require("./imagePrepCommands");

function createGenerationOptions(context) {
  return {
    repoRoot: context.repoRoot,
    projectsDir: context.projectsDir,
    projectDir: context.projectDir,
    now: context.now
  };
}

async function startCandidateGeneration(context, payload) {
  await assertProposalMatchesCurrentState(context.projectDir, payload.imageSpecProposalId, PROPOSAL_KINDS.IMAGE_SPEC);
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
