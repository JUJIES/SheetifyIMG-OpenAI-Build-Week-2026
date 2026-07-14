"use strict";

const path = require("node:path");

const {
  PROPOSAL_KINDS,
  adoptProposal,
  generateProposal,
  readActiveImageSpec,
  readActiveImageSpecForContent
} = require("../aiProposalManager");
const { prepareReferenceAsset, prepareWebReferenceAsset } = require("../referenceAssetManager");
const {
  assertProposalMatchesCurrentState,
  handlerOptions,
  readJson
} = require("./shared");

function payloadWithPlannedPageCount(payload = {}, imageSpec = null) {
  const spec = imageSpec?.data || imageSpec || {};
  const pageCount = Number(spec.pageCount || 0);
  if (!pageCount || payload.pageCount) {
    return payload;
  }
  return {
    ...payload,
    pageCount
  };
}

async function ensureImageSpecForCandidate(context, payload = context.payload) {
  const { projectId, input, now } = context;
  if (payload.imageSpecProposalId) {
    const imageSpec = await readActiveImageSpec(context.projectDir, payload.imageSpecProposalId);
    return payloadWithPlannedPageCount(payload, imageSpec);
  }
  const manifest = await readJson(path.join(context.projectDir, "project-manifest.json"));
  const currentContentMirrorId = manifest.currentArtifacts?.contentMirrorId || null;
  const compatibleImageSpec = await readActiveImageSpecForContent(
    context.projectDir,
    currentContentMirrorId
  );
  if (compatibleImageSpec?.proposalId) {
    return payloadWithPlannedPageCount({
      ...payload,
      imageSpecProposalId: compatibleImageSpec.proposalId
    }, compatibleImageSpec);
  }
  const proposal = await generateProposal(projectId, PROPOSAL_KINDS.IMAGE_SPEC, {
    ...payload,
    message: payload.message || input.message || "Leite die interne Bildplanung aus dem Arbeitsblatt-Konzept ab.",
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
    ...payloadWithPlannedPageCount(payload, proposal.proposal),
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

async function payloadWithImageSpec(context) {
  const payload = context.payload || {};
  if (payload.proposalId) {
    return payload;
  }
  const ensured = await ensureImageSpecForCandidate(context, payload);
  return {
    ...ensured,
    proposalId: ensured.imageSpecProposalId
  };
}

async function adoptPreparedImageSpecIfNeeded(context, result) {
  if (!result?.proposalId || result.proposalStatus === "adopted") {
    return result;
  }
  await adoptProposal(context.projectId, PROPOSAL_KINDS.IMAGE_SPEC, {
    payload: { proposalId: result.proposalId },
    silent: true,
    now: context.now
  }, handlerOptions(context));
  return {
    ...result,
    proposalStatus: "adopted"
  };
}

async function prepareProjectReferenceAsset(context) {
  const payload = await payloadWithImageSpec(context);
  const result = await prepareReferenceAsset(context.projectDir, {
    ...payload,
    now: context.now
  }, handlerOptions(context));
  return adoptPreparedImageSpecIfNeeded(context, result);
}

async function prepareProjectWebReferenceAsset(context) {
  const payload = await payloadWithImageSpec(context);
  const result = await prepareWebReferenceAsset(context.projectDir, {
    ...payload,
    now: context.now
  }, handlerOptions(context));
  return adoptPreparedImageSpecIfNeeded(context, result);
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
