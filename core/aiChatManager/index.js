"use strict";

const path = require("node:path");
const { EVENT_TYPES } = require("../contracts");
const { appendEvent, readEvents } = require("../eventLog");
const { getAiRuntimeStatus } = require("../aiConfig");
const { updateTeachingContextFromMessage } = require("../teachingContextManager");
const { saveVisualFeedbackAttachments } = require("../visualFeedbackManager");
const {
  resolveChatActionOffer,
  resolveChatActionOfferFromIntent,
  resolveChatCommand,
  resolveChatCommandFromIntent
} = require("../chatCommandResolver");
const { interpretChatIntentDecision } = require("../chatIntentInterpreter");
const { buildWorkspace, workspaceMessagesFromEvents } = require("../workspaceManager");
const { runResolvedChatCommand } = require("./commandRunner");
const {
  appendInputGateResponse,
  appendLocalActionOfferResponse,
  appendManualCandidateFlowResponse,
  appendStarterIdeasResponse,
  shouldOfferStarterIdeas,
  shouldUseLegacyChatFallback
} = require("./localResponses");
const {
  contradictsRequiredConfirmation,
  sendOpenAiChatResponse
} = require("./openAiResponder");

const DEFAULT_REPO_ROOT = path.resolve(__dirname, "..", "..");
const DEFAULT_PROJECTS_DIR = path.join(DEFAULT_REPO_ROOT, "projects");

function projectDirFor(projectId, projectsDir) {
  return path.join(projectsDir, projectId);
}

async function readChat(projectId, options = {}) {
  const repoRoot = options.repoRoot || DEFAULT_REPO_ROOT;
  const projectsDir = options.projectsDir || DEFAULT_PROJECTS_DIR;
  const worksheetsDir = options.worksheetsDir;
  const runtime = getAiRuntimeStatus();
  const workspace = await buildWorkspace(projectId, { repoRoot, projectsDir, worksheetsDir });
  return {
    mode: runtime.mode,
    runtime,
    messages: workspace.chat?.messages || [],
    workspace
  };
}

async function appendUserChatEvent(projectDir, input = {}, message = "", attachments = [], now) {
  return appendEvent(projectDir, {
    type: EVENT_TYPES.USER_MESSAGE,
    createdAt: now,
    step: "auftrag",
    payload: {
      mode: "openai",
      message,
      uiEvent: input.uiEvent || "chat_message",
      canvasFocus: input.canvasFocus || null,
      attachments
    }
  }, { now });
}

async function prepareChatContext(projectId, projectDir, input = {}, options = {}) {
  const repoRoot = options.repoRoot;
  const projectsDir = options.projectsDir;
  const worksheetsDir = options.worksheetsDir;
  const now = options.now;
  const message = String(input.message || "").trim();
  if (!message) {
    throw new Error("Message is required.");
  }

  const visualFeedback = await saveVisualFeedbackAttachments(projectDir, input.attachments || [], {
    repoRoot,
    now
  });
  const attachments = visualFeedback.map((entry) => entry.attachment);
  const openAiImages = visualFeedback.map((entry) => entry.openAiImage);

  await appendUserChatEvent(projectDir, input, message, attachments, now);
  await updateTeachingContextFromMessage(projectDir, message, { now });

  const workspace = await buildWorkspace(projectId, { repoRoot, projectsDir, worksheetsDir });
  const events = await readEvents(projectDir);
  const messages = workspaceMessagesFromEvents(events);
  const intentDecision = await interpretChatIntentDecision(projectDir, {
    workspace,
    message,
    messages
  }, {
    repoRoot,
    now,
    uiEvent: input.uiEvent || "chat_message",
    chatIntentInterpreter: options.chatIntentInterpreter
  });

  return {
    attachments,
    intent: intentDecision.intent,
    intentDecision,
    message,
    messages,
    openAiImages,
    workspace
  };
}

async function sendChatMessage(projectId, input = {}, options = {}) {
  const repoRoot = options.repoRoot || DEFAULT_REPO_ROOT;
  const projectsDir = options.projectsDir || DEFAULT_PROJECTS_DIR;
  const projectDir = projectDirFor(projectId, projectsDir);
  const now = input.now || options.now || new Date().toISOString();
  const runtime = getAiRuntimeStatus();
  const chatOptions = {
    ...options,
    repoRoot,
    projectsDir,
    now
  };

  const context = await prepareChatContext(projectId, projectDir, input, chatOptions);
  const resolvedCommand = resolveChatCommandFromIntent(context.workspace, context.intent, context.message)
    || (shouldUseLegacyChatFallback(context.intent) ? resolveChatCommand(context.workspace, context.message) : null);
  if (resolvedCommand) {
    return runResolvedChatCommand(projectId, projectDir, resolvedCommand, {
      repoRoot,
      projectsDir,
      worksheetsDir: options.worksheetsDir,
      now
    });
  }

  const actionOffer = resolveChatActionOfferFromIntent(context.workspace, context.intent, context.message)
    || (shouldUseLegacyChatFallback(context.intent) ? resolveChatActionOffer(context.workspace, context.message) : null);
  if (actionOffer) {
    return appendLocalActionOfferResponse(projectId, projectDir, actionOffer, {
      message: context.message,
      uiEvent: input.uiEvent,
      workspace: context.workspace
    }, {
      repoRoot,
      projectsDir,
      runtime,
      now
    });
  }

  const manualResponse = await appendManualCandidateFlowResponse(projectId, projectDir, context.intent, {
    repoRoot,
    projectsDir,
    runtime,
    now
  });
  if (manualResponse) {
    return manualResponse;
  }

  const starterIdeas = shouldOfferStarterIdeas(context.workspace, context.intent, context.message);
  if (runtime.status !== "ready") {
    if (starterIdeas) {
      return appendStarterIdeasResponse(projectId, projectDir, context.workspace, {
        repoRoot,
        projectsDir,
        runtime,
        now
      });
    }
    throw new Error(runtime.fallbackReason || "OpenAI is not configured.");
  }

  if (!context.workspace.inputReadiness?.ready
    && !(context.workspace.documents?.brief?.data || context.workspace.documents?.content?.data)
    && !starterIdeas) {
    return appendInputGateResponse(projectId, projectDir, {
      repoRoot,
      projectsDir,
      runtime,
      now
    });
  }

  return sendOpenAiChatResponse(projectId, projectDir, {
    attachments: context.attachments,
    intent: context.intent,
    messages: context.messages,
    message: context.message,
    openAiImages: context.openAiImages,
    rawInput: input,
    runtime,
    workspace: context.workspace
  }, {
    repoRoot,
    projectsDir,
    now
  });
}

module.exports = {
  readChat,
  sendChatMessage,
  __testing: {
    contradictsRequiredConfirmation
  }
};
