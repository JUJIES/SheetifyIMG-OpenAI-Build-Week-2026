"use strict";

const path = require("node:path");
const { ARTIFACT_TYPES } = require("../contracts");
const { createLessonBriefVersion } = require("../briefManager");
const { createContentMirrorVersion } = require("../contentMirrorManager");
const { PROPOSAL_KINDS, adoptProposal, generateProposal } = require("../aiProposalManager");
const { readEvents } = require("../eventLog");
const { defaultBriefDraft, defaultContentDraft } = require("../workspaceCommandDrafts");
const { activateContentMirrorVersion } = require("./contentMirrorActivation");
const {
  approveCurrentBrief,
  approveCurrentContent,
  assertProposalMatchesCurrentState,
  currentOrLatestArtifact,
  handlerOptions,
  readJson
} = require("./shared");

async function generateCompleteConceptProposal(context) {
  const { projectId, projectDir, payload, input, now } = context;
  const sharedInput = {
    ...payload,
    message: payload.message || input.message || "Formuliere ein vollständiges Arbeitsblatt-Konzept mit Text, Aufgaben und Bildidee.",
    now
  };
  const lesson = await generateProposal(projectId, PROPOSAL_KINDS.LESSON_BRIEF, {
    ...sharedInput,
    silent: true
  }, handlerOptions(context));
  await adoptProposal(projectId, PROPOSAL_KINDS.LESSON_BRIEF, {
    payload: {
      proposalId: lesson.proposal.proposalId
    },
    silent: true,
    now
  }, handlerOptions(context));
  await approveCurrentBrief(projectDir, handlerOptions(context));
  return generateProposal(projectId, PROPOSAL_KINDS.CONTENT_MIRROR, {
    ...sharedInput,
    message: payload.message || input.message || "Formuliere daraus jetzt das vollständige sichtbare Arbeitsblatt-Konzept.",
    silent: false
  }, handlerOptions(context));
}

async function generateLessonBriefProposal(context) {
  const { projectId, payload, input, now } = context;
  if (payload.completeConcept === true) {
    return generateCompleteConceptProposal(context);
  }
  return generateProposal(projectId, PROPOSAL_KINDS.LESSON_BRIEF, {
    ...payload,
    message: payload.message || input.message,
    now
  }, handlerOptions(context));
}

async function adoptLessonBriefProposal(context) {
  const { projectId, projectDir, payload, input, now } = context;
  const result = await adoptProposal(projectId, PROPOSAL_KINDS.LESSON_BRIEF, {
    payload,
    silent: payload.silent === true || input.silent === true || payload.continueToContent === true,
    now
  }, handlerOptions(context));
  if (payload.continueToContent === true) {
    await approveCurrentBrief(projectDir, handlerOptions(context));
    return generateProposal(projectId, PROPOSAL_KINDS.CONTENT_MIRROR, {
      ...payload,
      message: payload.message || input.message || "Formuliere daraus jetzt das vollständige sichtbare Arbeitsblatt-Konzept.",
      silent: false,
      now
    }, handlerOptions(context));
  }
  return result;
}

function generateContentMirrorProposal(context) {
  const { projectId, payload, input, now } = context;
  return generateProposal(projectId, PROPOSAL_KINDS.CONTENT_MIRROR, {
    ...payload,
    message: payload.message || input.message,
    now
  }, handlerOptions(context));
}

async function adoptContentMirrorProposal(context) {
  const { projectId, projectDir, payload, input, now } = context;
  await assertProposalMatchesCurrentState(projectDir, payload.proposalId, PROPOSAL_KINDS.CONTENT_MIRROR);
  let result = await adoptProposal(projectId, PROPOSAL_KINDS.CONTENT_MIRROR, {
    payload,
    silent: payload.silent === true || input.silent === true,
    now
  }, handlerOptions(context));
  if (payload.approve === true) {
    const approvedContent = await approveCurrentContent(projectDir, handlerOptions(context));
    result = {
      ...result,
      approved: true,
      approvedContent
    };
  }
  return result;
}

function activateContentVersion(context) {
  return activateContentMirrorVersion(context.projectDir, context.payload, handlerOptions(context));
}

function generateContentWarningsProposal(context) {
  const { projectId, payload, input, now } = context;
  return generateProposal(projectId, PROPOSAL_KINDS.CONTENT_WARNINGS, {
    ...payload,
    message: payload.message || input.message,
    now
  }, handlerOptions(context));
}

function adoptContentWarningsProposal(context) {
  const { projectId, payload, now } = context;
  return adoptProposal(projectId, PROPOSAL_KINDS.CONTENT_WARNINGS, {
    payload,
    now
  }, handlerOptions(context));
}

function createBriefDraft(context) {
  return createLessonBriefVersion(
    context.projectDir,
    context.payload.brief || defaultBriefDraft(context.project, context.payload),
    handlerOptions(context)
  );
}

function approveBrief(context) {
  return approveCurrentBrief(context.projectDir, handlerOptions(context));
}

async function createContentDraft(context) {
  const briefArtifact = await currentOrLatestArtifact(context.projectDir, "lessonbriefId", ARTIFACT_TYPES.LESSON_BRIEF);
  const brief = briefArtifact ? await readJson(path.join(context.projectDir, briefArtifact.path)) : {};
  const events = await readEvents(context.projectDir);
  return createContentMirrorVersion(
    context.projectDir,
    context.payload.content || defaultContentDraft(context.project, context.payload, brief, events),
    handlerOptions(context)
  );
}

function approveContent(context) {
  return approveCurrentContent(context.projectDir, handlerOptions(context));
}

const conceptCommandHandlers = {
  generate_lessonbrief_proposal: generateLessonBriefProposal,
  adopt_lessonbrief_proposal: adoptLessonBriefProposal,
  generate_content_mirror_proposal: generateContentMirrorProposal,
  adopt_content_mirror_proposal: adoptContentMirrorProposal,
  activate_content_mirror_version: activateContentVersion,
  generate_content_warnings_proposal: generateContentWarningsProposal,
  adopt_content_warnings_proposal: adoptContentWarningsProposal,
  create_brief_draft: createBriefDraft,
  approve_current_brief: approveBrief,
  create_content_draft: createContentDraft,
  approve_current_content: approveContent
};

module.exports = {
  conceptCommandHandlers
};
