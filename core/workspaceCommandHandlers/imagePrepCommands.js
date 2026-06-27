"use strict";

const { PROPOSAL_KINDS, adoptProposal, generateProposal } = require("../aiProposalManager");
const { prepareReferenceAsset, prepareWebReferenceAsset } = require("../referenceAssetManager");
const {
  assertProposalMatchesCurrentState,
  handlerOptions
} = require("./shared");

async function ensureImageSpecForCandidate(context, payload = context.payload) {
  const { projectId, input, now } = context;
  if (payload.imageSpecProposalId) {
    return payload;
  }
  const proposal = await generateProposal(projectId, PROPOSAL_KINDS.IMAGE_SPEC, {
    ...payload,
    message: payload.message || input.message || "Leite die interne ImageSpec aus dem freigegebenen Arbeitsblatt-Konzept ab.",
    uiEvent: payload.uiEvent || input.uiEvent || "generate_image",
    canvasFocus: payload.canvasFocus || input.canvasFocus || null,
    silent: true,
    now
  }, handlerOptions(context));
  await adoptProposal(projectId, PROPOSAL_KINDS.IMAGE_SPEC, {
    payload: {
      proposalId: proposal.proposal.proposalId
    },
    silent: true,
    now
  }, handlerOptions(context));
  return {
    ...payload,
    imageSpecProposalId: proposal.proposal.proposalId
  };
}

function prepareImageSpec(context) {
  const { projectId, payload, input, now } = context;
  return generateProposal(projectId, PROPOSAL_KINDS.IMAGE_SPEC, {
    ...payload,
    message: payload.message || input.message,
    uiEvent: payload.uiEvent || input.uiEvent || "generate_image",
    canvasFocus: payload.canvasFocus || input.canvasFocus || null,
    now
  }, handlerOptions(context));
}

async function adoptImageSpec(context) {
  await assertProposalMatchesCurrentState(context.projectDir, context.payload.proposalId, PROPOSAL_KINDS.IMAGE_SPEC);
  return adoptProposal(context.projectId, PROPOSAL_KINDS.IMAGE_SPEC, {
    payload: context.payload,
    now: context.now
  }, handlerOptions(context));
}

function prepareProjectReferenceAsset(context) {
  return prepareReferenceAsset(context.projectDir, {
    ...context.payload,
    now: context.now
  }, handlerOptions(context));
}

function prepareProjectWebReferenceAsset(context) {
  return prepareWebReferenceAsset(context.projectDir, {
    ...context.payload,
    now: context.now
  }, handlerOptions(context));
}

const imagePrepCommandHandlers = {
  prepare_image_spec: prepareImageSpec,
  adopt_image_spec: adoptImageSpec,
  prepare_reference_asset: prepareProjectReferenceAsset,
  prepare_web_reference_asset: prepareProjectWebReferenceAsset
};

module.exports = {
  ensureImageSpecForCandidate,
  imagePrepCommandHandlers
};
