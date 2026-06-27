"use strict";

const { EVENT_TYPES } = require("../contracts");
const { appendEvent } = require("../eventLog");
const { getOpenAiRequestConfig } = require("../aiConfig");
const { buildAiTools, suggestedActionsFromToolCalls } = require("../aiToolRegistry");
const { createResponse, extractOutputText, extractToolCalls } = require("../openaiClient");
const { logModelRun, sanitizeErrorMessage } = require("../modelRunLogger");
const { estimateOpenAiTextCost } = require("../imageCostManager");
const { routeChatRequest } = require("../modelRouter");
const { composePrompts } = require("../promptRegistry");
const { buildProductionContext, productionContextToPrompt } = require("../productionContext");
const { narrateChatMoment } = require("../chatNarrationManager");
const { suggestedActionFallback } = require("../chatPersonaManager");
const { buildWorkspace } = require("../workspaceManager");
const {
  shouldUseConciseBrainstormRoute,
  shouldUseConciseQuestionRoute
} = require("./localResponses");

const QUESTION_MAX_OUTPUT_TOKENS = 220;
const BRAINSTORM_MAX_OUTPUT_TOKENS = 280;

function messageContentForOpenAi(message, images = []) {
  if (!images.length) {
    return message.content;
  }
  return [
    {
      type: "input_text",
      text: message.content || "Visuelle Rueckmeldung zum markierten Ausschnitt."
    },
    ...images
  ];
}

function inputForOpenAi(productionContext, messages, currentImages = []) {
  const recent = messages.slice(-12);
  const recentMessages = recent.map((message, index) => {
    const isLastUserMessage = index === recent.length - 1 && message.role !== "assistant";
    return {
      role: message.role === "assistant" ? "assistant" : "user",
      content: messageContentForOpenAi(message, isLastUserMessage ? currentImages : [])
    };
  });

  return [
    {
      role: "developer",
      content: productionContextToPrompt(productionContext)
    },
    ...recentMessages
  ];
}

function fallbackAssistantMessageForSuggestedActions(suggestedActions = [], input = {}) {
  return suggestedActionFallback(suggestedActions, input, input.workspace || {});
}

function requiresPaidConfirmation(suggestedActions = []) {
  return suggestedActions.some((action) => action.requiresConfirmation === true);
}

function contradictsRequiredConfirmation(message, suggestedActions = []) {
  if (!requiresPaidConfirmation(suggestedActions)) {
    return false;
  }
  const text = String(message || "");
  return /(?:keine|ohne|nicht\s+(?:n[oö]tig|notwendig)|brauch(?:t|st)?\s+keine).{0,90}(?:best[aä]tig|bestaetig|kostenbest[aä]tig|kostenbestaetig)/i.test(text)
    || /(?:best[aä]tig|bestaetig|kostenbest[aä]tig|kostenbestaetig).{0,90}(?:keine|ohne|nicht\s+(?:n[oö]tig|notwendig))/i.test(text);
}

async function assistantMessageForSuggestedActions(projectDir, suggestedActions = [], input = {}, workspace = {}, options = {}) {
  const fallback = input.modelMessage
    || fallbackAssistantMessageForSuggestedActions(suggestedActions, { ...input, workspace })
    || (
    suggestedActions.length
      ? "Ich habe den passenden nächsten Schritt vorbereitet. Du kannst ihn direkt über die vorgeschlagene Aktion ausführen oder vorher noch im Chat nachschärfen."
      : "Ich habe den Stand geprüft. Gerade sehe ich keinen sicheren nächsten Produktionsschritt; schick mir am besten kurz, was du ändern oder entscheiden möchtest."
  );
  return narrateChatMoment(projectDir, {
    kind: "suggested_action",
    fallback,
    userMessage: input.message,
    suggestedActions,
    workspace,
    requiresPaidConfirmation: requiresPaidConfirmation(suggestedActions)
  }, {
    now: options.now,
    uiEvent: input.uiEvent || "chat_message"
  });
}

function chatRouteForIntent(input = {}) {
  const conciseQuestionRoute = shouldUseConciseQuestionRoute(input.intent, input.message);
  const conciseBrainstormRoute = shouldUseConciseBrainstormRoute(input.intent, input.message);
  const conciseConversationRoute = conciseQuestionRoute || conciseBrainstormRoute;
  const requestConfig = getOpenAiRequestConfig();
  const baseRoute = routeChatRequest({
    input: {
      ...input.rawInput,
      message: input.message,
      attachments: input.attachments
    },
    workspace: input.workspace,
    requestConfig
  });
  const route = conciseConversationRoute
    ? {
        ...baseRoute,
        purpose: "final_chat",
        route: "orchestrator",
        promptNames: ["global", "final_chat"],
        reasoningEffort: "low"
      }
    : baseRoute;
  return {
    requestConfig,
    route,
    conciseBrainstormRoute,
    conciseConversationRoute
  };
}

async function sendOpenAiChatResponse(projectId, projectDir, input = {}, options = {}) {
  const {
    requestConfig,
    route,
    conciseBrainstormRoute,
    conciseConversationRoute
  } = chatRouteForIntent(input);
  const tools = conciseConversationRoute ? [] : buildAiTools(input.workspace);
  const productionContext = buildProductionContext({
    workspace: input.workspace,
    messages: input.messages,
    input: {
      ...input.rawInput,
      message: input.message,
      attachments: input.attachments
    },
    route,
    now: options.now
  });
  const instructions = await composePrompts(route.promptNames, { repoRoot: options.repoRoot });
  const startedAt = Date.now();

  try {
    const responseBody = {
      model: route.model || requestConfig.textModel,
      instructions,
      input: inputForOpenAi(productionContext, input.messages, input.openAiImages),
      store: false
    };
    if (tools.length > 0) {
      responseBody.tools = tools;
      responseBody.tool_choice = "auto";
    }
    if (route.reasoningEffort && route.reasoningEffort !== "none") {
      responseBody.reasoning = {
        effort: route.reasoningEffort
      };
    }
    if (conciseConversationRoute) {
      responseBody.max_output_tokens = conciseBrainstormRoute
        ? BRAINSTORM_MAX_OUTPUT_TOKENS
        : QUESTION_MAX_OUTPUT_TOKENS;
    }

    const response = await createResponse(responseBody, requestConfig);
    const responseModel = response.model || route.model || requestConfig.textModel;
    const usage = response.usage || null;
    const costEstimate = estimateOpenAiTextCost({
      usage,
      model: responseModel
    });

    const toolCalls = extractToolCalls(response);
    const suggestedActions = suggestedActionsFromToolCalls(toolCalls, input.workspace);
    const outputText = extractOutputText(response);
    const safeOutputText = outputText && !contradictsRequiredConfirmation(outputText, suggestedActions)
      ? outputText
      : null;
    const assistantMessage = suggestedActions.length
      ? await assistantMessageForSuggestedActions(
          projectDir,
          suggestedActions,
          { ...input.rawInput, message: input.message, modelMessage: safeOutputText },
          input.workspace,
          { now: options.now }
        )
      : safeOutputText || await assistantMessageForSuggestedActions(
          projectDir,
          suggestedActions,
          { ...input.rawInput, message: input.message },
          input.workspace,
          { now: options.now }
        );

    const assistantEvent = await appendEvent(projectDir, {
      type: EVENT_TYPES.ASSISTANT_MESSAGE,
      createdAt: options.now,
      step: "auftrag",
      payload: {
        mode: "openai",
        message: assistantMessage,
        suggestedActions,
        provider: {
          name: "openai",
          responseId: response.id || null,
          model: response.model || route.model || requestConfig.textModel,
          route: route.route,
          purpose: route.purpose,
          toolCallCount: toolCalls.length
        }
      }
    }, { now: options.now });
    await logModelRun(projectDir, {
      status: "success",
      source: "chat",
      purpose: route.purpose,
      route: route.route,
      promptNames: route.promptNames,
      model: responseModel,
      responseId: response.id || null,
      toolCallCount: toolCalls.length,
      durationMs: Date.now() - startedAt,
      usage,
      costEstimate,
      uiEvent: input.rawInput.uiEvent || "chat_message"
    }, { now: options.now });

    const nextWorkspace = await buildWorkspace(projectId, {
      repoRoot: options.repoRoot,
      projectsDir: options.projectsDir
    });
    return {
      mode: "openai",
      runtime: input.runtime,
      response: {
        id: assistantEvent.id,
        role: "assistant",
        createdAt: assistantEvent.createdAt,
        content: assistantMessage,
        suggestedActions,
        provider: {
          responseId: response.id || null,
          model: response.model || route.model || requestConfig.textModel,
          route: route.route,
          purpose: route.purpose
        }
      },
      messages: nextWorkspace.chat?.messages || [],
      workspace: nextWorkspace
    };
  } catch (error) {
    const errorMessage = `OpenAI-Chat konnte nicht antworten: ${sanitizeErrorMessage(error)}`;
    await logModelRun(projectDir, {
      status: "error",
      source: "chat",
      purpose: route.purpose,
      route: route.route,
      promptNames: route.promptNames,
      model: route.model || requestConfig.textModel,
      durationMs: Date.now() - startedAt,
      uiEvent: input.rawInput.uiEvent || "chat_message",
      error
    }, { now: options.now });
    const assistantEvent = await appendEvent(projectDir, {
      type: EVENT_TYPES.ASSISTANT_MESSAGE,
      createdAt: options.now,
      step: "auftrag",
      payload: {
        mode: "openai_error",
        message: errorMessage,
        suggestedActions: []
      }
    }, { now: options.now });
    const nextWorkspace = await buildWorkspace(projectId, {
      repoRoot: options.repoRoot,
      projectsDir: options.projectsDir
    });
    return {
      mode: "openai_error",
      runtime: {
        ...input.runtime,
        status: "error",
        fallbackReason: sanitizeErrorMessage(error)
      },
      response: {
        id: assistantEvent.id,
        role: "assistant",
        createdAt: assistantEvent.createdAt,
        content: errorMessage,
        suggestedActions: []
      },
      messages: nextWorkspace.chat?.messages || [],
      workspace: nextWorkspace
    };
  }
}

module.exports = {
  contradictsRequiredConfirmation,
  sendOpenAiChatResponse
};
