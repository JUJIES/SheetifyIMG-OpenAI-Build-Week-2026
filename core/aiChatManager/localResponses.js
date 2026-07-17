"use strict";

const { EVENT_TYPES } = require("../contracts");
const { appendEvent } = require("../eventLog");
const { missingInputAssistantMessage } = require("../inputReadiness");
const { brainstormingIntent } = require("../chatCommandResolver");
const { INTENTS } = require("../chatIntentInterpreter");
const { narrateChatMoment } = require("../chatNarrationManager");
const { localActionOfferFallback } = require("../chatPersonaManager");
const { buildWorkspace } = require("../workspaceManager");

function shouldUseLegacyChatFallback(intent = {}) {
  return false;
}

function directQuestionMessage(message = "") {
  return /[?？]\s*$/.test(String(message || "").trim());
}

function shouldUseConciseQuestionRoute(intent = {}, message = "") {
  return intent?.intent === INTENTS.QUESTION || directQuestionMessage(message);
}

function shouldUseConciseBrainstormRoute(intent = {}, message = "") {
  return intent?.intent === INTENTS.BRAINSTORM || brainstormingIntent(message);
}

function cleanContextValue(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function teachingContextValue(workspace = {}, fieldId) {
  return cleanContextValue(workspace.teachingContext?.fields?.[fieldId]?.value);
}

function starterProjectContext(workspace = {}) {
  const project = workspace.project || {};
  const topic = teachingContextValue(workspace, "topic")
    || cleanContextValue(project.topic);
  const targetGroup = teachingContextValue(workspace, "targetGroup")
    || cleanContextValue(project.targetGroup);
  const subject = cleanContextValue(project.subject);
  return {
    subject,
    topic,
    targetGroup
  };
}

function hasStarterProjectContext(workspace = {}) {
  const context = starterProjectContext(workspace);
  return Boolean(context.topic || context.targetGroup || context.subject);
}

function isStarterIdeasRequest(intent = {}, message = "") {
  return shouldUseConciseBrainstormRoute(intent, message);
}

function shouldOfferStarterIdeas(workspace = {}, intent = {}, message = "") {
  return isStarterIdeasRequest(intent, message)
    && hasStarterProjectContext(workspace)
    && !(workspace.documents?.brief?.data || workspace.documents?.content?.data);
}

function manualCandidateFlowMessage(intent = {}) {
  if (intent?.intent === INTENTS.PDF_EXPORT) {
    return "PDFs entstehen jetzt über abgelegte Arbeitsblätter. Wenn dir ein Entwurf gefällt, lege ihn in der Entwurfsansicht in den Arbeitsblättern ab; dort ist der Stand dann als fester PDF-Snapshot verfügbar.";
  }
  if (intent?.intent === INTENTS.SELECTION) {
    return "Die alte Auswahl-Schleife ist raus. Wähle den passenden Entwurf in der Vorschau aus und lege ihn dort in den Arbeitsblättern ab, wenn er fest übernommen werden soll.";
  }
  return null;
}

async function appendAssistantResponse(projectId, projectDir, payload = {}, options = {}) {
  const now = options.now;
  const assistantEvent = await appendEvent(projectDir, {
    type: EVENT_TYPES.ASSISTANT_MESSAGE,
    createdAt: now,
    step: "auftrag",
    payload
  }, { now });
  const workspace = await buildWorkspace(projectId, {
    repoRoot: options.repoRoot,
    projectsDir: options.projectsDir
  });
  return {
    mode: payload.mode,
    runtime: options.runtime,
    response: {
      id: assistantEvent.id,
      role: "assistant",
      createdAt: assistantEvent.createdAt,
      content: payload.message,
      suggestedActions: payload.suggestedActions || []
    },
    messages: workspace.chat?.messages || [],
    workspace
  };
}

async function appendLocalActionOfferResponse(projectId, projectDir, actionOffer = {}, input = {}, options = {}) {
  const suggestedActions = actionOffer.suggestedActions || [];
  const fallback = localActionOfferFallback(actionOffer, {
    message: input.message,
    workspace: input.workspace || {}
  });
  const narratedMessage = await narrateChatMoment(projectDir, {
    kind: "local_action_offer",
    fallback,
    userMessage: input.message,
    suggestedActions,
    workspace: input.workspace || {},
    requiresPaidConfirmation: suggestedActions.some((action) => action.requiresConfirmation === true)
  }, {
    now: options.now,
    uiEvent: input.uiEvent || "chat_message",
    usageAttribution: options.usageAttribution
  });
  return appendAssistantResponse(projectId, projectDir, {
    mode: "local_action_offer",
    message: narratedMessage,
    suggestedActions
  }, options);
}

async function appendManualCandidateFlowResponse(projectId, projectDir, intent = {}, options = {}) {
  const message = manualCandidateFlowMessage(intent);
  if (!message) {
    return null;
  }
  return appendAssistantResponse(projectId, projectDir, {
    mode: "local_manual_candidate_flow",
    message,
    suggestedActions: []
  }, options);
}

async function appendInputGateResponse(projectId, projectDir, options = {}) {
  return appendAssistantResponse(projectId, projectDir, {
    mode: "local_input_gate",
    message: missingInputAssistantMessage(),
    suggestedActions: []
  }, options);
}

module.exports = {
  appendInputGateResponse,
  appendLocalActionOfferResponse,
  appendManualCandidateFlowResponse,
  manualCandidateFlowMessage,
  shouldOfferStarterIdeas,
  shouldUseConciseBrainstormRoute,
  shouldUseConciseQuestionRoute,
  shouldUseLegacyChatFallback
};
