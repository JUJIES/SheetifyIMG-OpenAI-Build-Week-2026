"use strict";

const path = require("node:path");
const { EVENT_TYPES } = require("../contracts");
const { appendEvent, readEvents } = require("../eventLog");
const { getAiRuntimeStatus, getOpenAiRequestConfig } = require("../aiConfig");
const { missingInputAssistantMessage } = require("../inputReadiness");
const { buildAiTools, suggestedActionsFromToolCalls } = require("../aiToolRegistry");
const { createResponse, extractOutputText, extractToolCalls } = require("../openaiClient");
const { logModelRun, sanitizeErrorMessage } = require("../modelRunLogger");
const { routeChatRequest } = require("../modelRouter");
const { composePrompts } = require("../promptRegistry");
const { buildProductionContext, productionContextToPrompt } = require("../productionContext");
const { updateTeachingContextFromMessage } = require("../teachingContextManager");
const { saveVisualFeedbackAttachments } = require("../visualFeedbackManager");
const { resolveChatActionOffer, resolveChatCommand } = require("../chatCommandResolver");
const { narrateChatMoment } = require("../chatNarrationManager");
const { runWorkspaceCommand } = require("../workspaceCommandManager");
const { buildWorkspace, workspaceMessagesFromEvents } = require("../workspaceManager");
const { visibleWorkflowCommands, workflowCommandPayload } = require("../workflowPolicy");

const DEFAULT_REPO_ROOT = path.resolve(__dirname, "..", "..");
const DEFAULT_PROJECTS_DIR = path.join(DEFAULT_REPO_ROOT, "projects");
const AUTOPILOT_CONTINUATION_COMMANDS = new Set([
  "generate_content_mirror_proposal"
]);

function projectDirFor(projectId, projectsDir) {
  return path.join(projectsDir, projectId);
}

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

function mentionsExactContent(message) {
  return /\b(genau|exakt|1:1|unveraendert|unverändert|nicht umschreiben)\b/i.test(String(message || ""));
}

function fallbackAssistantMessageForSuggestedActions(suggestedActions = [], input = {}) {
  const firstAction = suggestedActions[0] || null;
  if (!firstAction) {
    return null;
  }
  const userMessage = String(input.message || "");
  if (firstAction.command === "generate_lessonbrief_proposal") {
    if (firstAction.confirmationKind === "concept_with_assumptions") {
      return "Es fehlen noch wichtige Rahmeninfos, vor allem zum Ziel der Stunde. Ich kann trotzdem ein erstes Arbeitsblatt-Konzept mit Annahmen vorbereiten, aber die Passung kann darunter leiden. Bitte bestätige bewusst, wenn ich fortfahren soll.";
    }
    if (mentionsExactContent(userMessage)) {
      return "Ich habe deine Vorgaben als verbindlich verstanden. Ich würde daraus jetzt ein vollständiges Arbeitsblatt-Konzept mit Text, Aufgaben und Bildidee vorbereiten. Fehlende Strukturdetails ergänze ich nur vorsichtig als Annahme.";
    }
    return "Der Unterrichtsrahmen ist klar genug. Ich würde jetzt ein vollständiges Arbeitsblatt-Konzept vorbereiten: mit sichtbarem Text, Aufgaben, Bildidee und DIN-A4-Struktur. Offene optionale Stellen markiere ich als Annahme.";
  }
  if (firstAction.command === "generate_content_mirror_proposal") {
    return "Ich kann den vorhandenen Planungsstand jetzt zu einem vollständigen Arbeitsblatt-Konzept ausformulieren: mit sichtbarem Text, Aufgaben, erwarteten Antworten und Bildidee. Danach prüfst du den kompletten Stand.";
  }
  if (firstAction.command === "approve_current_content") {
    return "Das Arbeitsblatt-Konzept wirkt konkret genug für Kandidaten. Wenn du es freigibst, wird genau dieser Inhalt zur Grundlage der Bildgenerierung.";
  }
  if (firstAction.command === "generate_image_candidate") {
    return "Das Konzept ist freigegeben. Ich kann daraus jetzt einen Bild-Kandidaten erzeugen; danach hängt SheetifyIMG automatisch ein PDF zum Herunterladen an. Die Bildgenerierung braucht deine bewusste Kostenbestätigung.";
  }
  return null;
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
  const fallback = fallbackAssistantMessageForSuggestedActions(suggestedActions, input) || (
    suggestedActions.length
      ? "Ich habe den nächsten sinnvollen Produktionsschritt vorbereitet. Bitte führe ihn bewusst über die vorgeschlagene Aktion aus."
      : "Ich habe den aktuellen Projektstand geprüft. Gerade ist kein neuer sicherer Produktionsschritt sichtbar."
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

function autoCommandMessage(commandId) {
  const messages = {
    generate_lessonbrief_proposal: "Ich habe ein vollständiges Arbeitsblatt-Konzept vorbereitet.",
    adopt_lessonbrief_proposal: "Konzept übernommen.",
    generate_content_mirror_proposal: "Ich habe das Arbeitsblatt-Konzept ausformuliert.",
    adopt_content_mirror_proposal: "Konzept angepasst und freigegeben.",
    approve_current_content: "Das Arbeitsblatt-Konzept ist freigegeben.",
    generate_image_candidate: "Der Kandidat ist fertig; das PDF wird direkt am Kandidaten angeboten."
  };
  return messages[commandId] || "Ich habe den nächsten Schritt ausgeführt.";
}

function nextActionPrompt(commandId) {
  const prompts = {
    generate_lessonbrief_proposal: "Prüf Text, Aufgaben und Bildidee. Wenn es passt, übernehme ich das Konzept; wenn nicht, gib mir Feedback.",
    adopt_lessonbrief_proposal: "Ich formuliere daraus als Nächstes das vollständige Arbeitsblatt-Konzept aus.",
    generate_content_mirror_proposal: "Prüf Text, Aufgaben und Bildidee. Wenn es passt, übernehme ich das Konzept; wenn nicht, gib mir Feedback.",
    adopt_content_mirror_proposal: "Ich kann daraus jetzt einen neuen Kandidaten erzeugen; die Bildgenerierung braucht deine bewusste Kostenbestätigung.",
    approve_current_content: "Der nächste Schritt ist Bildgenerierung und braucht deine bewusste Bestätigung im Button.",
    generate_image_candidate: "Für den Bild-Kandidaten brauche ich als Nächstes deine bewusste Bestätigung im Button."
  };
  return prompts[commandId] || "Soll ich mit dem nächsten Schritt weitermachen?";
}

function nextSuggestedAction(workspace = {}) {
  const command = visibleWorkflowCommands(workspace)[0] || null;
  if (!command) {
    return null;
  }
  return {
    command: command.id,
    label: command.label,
    payload: workflowCommandPayload(command)
  };
}

function latestAssistantResponse(workspace = {}) {
  const assistant = [...(workspace.chat?.messages || [])].reverse()
    .find((message) => message.role === "assistant");
  return assistant ? {
    id: assistant.id,
    role: "assistant",
    createdAt: assistant.createdAt,
    content: assistant.content || "",
    suggestedActions: assistant.suggestedActions || [],
    proposal: assistant.proposal || null
  } : null;
}

async function appendAutoCommandMessage(projectDir, commandId, now, action = null, context = {}) {
  const fallback = action
    ? `${autoCommandMessage(commandId)} ${nextActionPrompt(commandId)}`
    : autoCommandMessage(commandId);
  const message = await narrateChatMoment(projectDir, {
    kind: "workflow_followup",
    fallback,
    commandId,
    action,
    suggestedActions: action ? [action] : [],
    workspace: context.workspace || {},
    requiresPaidConfirmation: action?.requiresConfirmation === true
  }, {
    now,
    uiEvent: "workflow_followup"
  });
  return appendEvent(projectDir, {
    type: EVENT_TYPES.ASSISTANT_MESSAGE,
    createdAt: now,
    step: "auftrag",
    payload: {
      mode: "narration",
      message,
      suggestedActions: action ? [action] : []
    }
  }, { now });
}

function canContinueOnAutopilot(command = {}) {
  return Boolean(command?.enabled)
    && command.requiresConfirmation !== true
    && AUTOPILOT_CONTINUATION_COMMANDS.has(command.id);
}

async function runAutopilotContinuation(projectId, workspace, options = {}) {
  const nextCommand = visibleWorkflowCommands(workspace)[0] || null;
  if (!canContinueOnAutopilot(nextCommand)) {
    return {
      commandId: null,
      workspace
    };
  }
  const commandResult = await runWorkspaceCommand(projectId, {
    command: nextCommand.id,
    payload: workflowCommandPayload(nextCommand),
    now: options.now
  }, options);
  return {
    commandId: nextCommand.id,
    workspace: commandResult.workspace
  };
}

async function runResolvedChatCommand(projectId, projectDir, resolved, options = {}) {
  let commandResult;
  const resolvedPayload = resolved.command === "adopt_content_mirror_proposal" && resolved.payload?.approve === true
    ? { ...resolved.payload, silent: true }
    : resolved.payload || {};
  try {
    commandResult = await runWorkspaceCommand(projectId, {
      command: resolved.command,
      payload: resolvedPayload,
      now: options.now
    }, options);
  } catch (error) {
    const workspace = await buildWorkspace(projectId, options);
    const assistantResponse = latestAssistantResponse(workspace);
    if (assistantResponse) {
      return {
        mode: "local_command_error",
        response: assistantResponse,
        messages: workspace.chat?.messages || [],
        workspace
      };
    }
    throw error;
  }
  let workspace = commandResult.workspace;
  let followUpCommandId = resolved.command;
  if (resolved.autopilot) {
    const continuation = await runAutopilotContinuation(projectId, workspace, options);
    workspace = continuation.workspace;
    followUpCommandId = continuation.commandId || followUpCommandId;
  }
  let assistantResponse = latestAssistantResponse(workspace);
  const latestUserIndex = (workspace.chat?.messages || []).findLastIndex((message) => message.role === "user");
  const latestAssistantIndex = (workspace.chat?.messages || []).findLastIndex((message) => message.role === "assistant");
  const latestAssistant = latestAssistantIndex >= 0 ? workspace.chat.messages[latestAssistantIndex] : null;
  const shouldAppendFollowUp = latestAssistantIndex < latestUserIndex
    || (latestAssistantIndex > latestUserIndex && !(latestAssistant?.suggestedActions || []).length);
  if (shouldAppendFollowUp) {
    const action = nextSuggestedAction(workspace);
    await appendAutoCommandMessage(projectDir, followUpCommandId, options.now, action, { workspace });
    workspace = await buildWorkspace(projectId, options);
    assistantResponse = latestAssistantResponse(workspace);
  }
  return {
    mode: "local_command",
    response: assistantResponse || {
      role: "assistant",
      createdAt: options.now,
      content: autoCommandMessage(resolved.command),
      suggestedActions: []
    },
    messages: workspace.chat?.messages || [],
    workspace
  };
}

async function readChat(projectId, options = {}) {
  const repoRoot = options.repoRoot || DEFAULT_REPO_ROOT;
  const projectsDir = options.projectsDir || DEFAULT_PROJECTS_DIR;
  const runtime = getAiRuntimeStatus();
  const workspace = await buildWorkspace(projectId, { repoRoot, projectsDir });
  return {
    mode: runtime.mode,
    runtime,
    messages: workspace.chat?.messages || [],
    workspace
  };
}

async function sendChatMessage(projectId, input = {}, options = {}) {
  const repoRoot = options.repoRoot || DEFAULT_REPO_ROOT;
  const projectsDir = options.projectsDir || DEFAULT_PROJECTS_DIR;
  const projectDir = projectDirFor(projectId, projectsDir);
  const now = input.now || options.now || new Date().toISOString();
  const message = String(input.message || "").trim();
  if (!message) {
    throw new Error("Message is required.");
  }

  const runtime = getAiRuntimeStatus();

  const visualFeedback = await saveVisualFeedbackAttachments(projectDir, input.attachments || [], {
    repoRoot,
    now
  });
  const attachments = visualFeedback.map((entry) => entry.attachment);
  const openAiImages = visualFeedback.map((entry) => entry.openAiImage);

  await appendEvent(projectDir, {
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
  await updateTeachingContextFromMessage(projectDir, message, { now });

  const workspace = await buildWorkspace(projectId, { repoRoot, projectsDir });
  const events = await readEvents(projectDir);
  const messages = workspaceMessagesFromEvents(events);
  const resolvedCommand = resolveChatCommand(workspace, message);
  if (resolvedCommand) {
    return runResolvedChatCommand(projectId, projectDir, resolvedCommand, {
      repoRoot,
      projectsDir,
      now
    });
  }
  const actionOffer = resolveChatActionOffer(workspace, message);
  if (actionOffer) {
    const narratedMessage = await narrateChatMoment(projectDir, {
      kind: "local_action_offer",
      fallback: actionOffer.message,
      userMessage: message,
      suggestedActions: actionOffer.suggestedActions || [],
      workspace,
      requiresPaidConfirmation: actionOffer.suggestedActions?.some((action) => action.requiresConfirmation === true) === true
    }, {
      now,
      uiEvent: input.uiEvent || "chat_message"
    });
    const assistantEvent = await appendEvent(projectDir, {
      type: EVENT_TYPES.ASSISTANT_MESSAGE,
      createdAt: now,
      step: "auftrag",
      payload: {
        mode: "local_action_offer",
        message: narratedMessage,
        suggestedActions: actionOffer.suggestedActions || []
      }
    }, { now });
    const nextWorkspace = await buildWorkspace(projectId, { repoRoot, projectsDir });
    return {
      mode: "local_action_offer",
      runtime,
      response: {
        id: assistantEvent.id,
        role: "assistant",
        createdAt: assistantEvent.createdAt,
        content: narratedMessage,
        suggestedActions: actionOffer.suggestedActions || []
      },
      messages: nextWorkspace.chat?.messages || [],
      workspace: nextWorkspace
    };
  }

  if (runtime.status !== "ready") {
    throw new Error(runtime.fallbackReason || "OpenAI is not configured.");
  }

  if (!workspace.inputReadiness?.ready && !(workspace.documents?.brief?.data || workspace.documents?.content?.data)) {
    const assistantMessage = missingInputAssistantMessage();
    const assistantEvent = await appendEvent(projectDir, {
      type: EVENT_TYPES.ASSISTANT_MESSAGE,
      createdAt: now,
      step: "auftrag",
      payload: {
        mode: "local_input_gate",
        message: assistantMessage,
        suggestedActions: []
      }
    }, { now });
    const nextWorkspace = await buildWorkspace(projectId, { repoRoot, projectsDir });
    return {
      mode: "local_input_gate",
      runtime,
      response: {
        id: assistantEvent.id,
        role: "assistant",
        createdAt: assistantEvent.createdAt,
        content: assistantMessage,
        suggestedActions: []
      },
      messages: nextWorkspace.chat?.messages || [],
      workspace: nextWorkspace
    };
  }
  const tools = buildAiTools(workspace);
  const requestConfig = getOpenAiRequestConfig();
  const route = routeChatRequest({ input: { ...input, message, attachments }, workspace, requestConfig });
  const productionContext = buildProductionContext({
    workspace,
    messages,
    input: { ...input, message, attachments },
    route,
    now
  });
  const instructions = await composePrompts(route.promptNames, { repoRoot });
  const startedAt = Date.now();

  try {
    const responseBody = {
      model: route.model || requestConfig.textModel,
      instructions,
      input: inputForOpenAi(productionContext, messages, openAiImages),
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

    const response = await createResponse(responseBody, requestConfig);

    const toolCalls = extractToolCalls(response);
    const suggestedActions = suggestedActionsFromToolCalls(toolCalls, workspace);
    const outputText = extractOutputText(response);
    const assistantMessage = outputText && !contradictsRequiredConfirmation(outputText, suggestedActions)
      ? outputText
      : await assistantMessageForSuggestedActions(
      projectDir,
      suggestedActions,
      { ...input, message },
      workspace,
      { now }
    );

    const assistantEvent = await appendEvent(projectDir, {
      type: EVENT_TYPES.ASSISTANT_MESSAGE,
      createdAt: now,
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
    }, { now });
    await logModelRun(projectDir, {
      status: "success",
      source: "chat",
      purpose: route.purpose,
      route: route.route,
      promptNames: route.promptNames,
      model: response.model || route.model || requestConfig.textModel,
      responseId: response.id || null,
      toolCallCount: toolCalls.length,
      durationMs: Date.now() - startedAt,
      uiEvent: input.uiEvent || "chat_message"
    }, { now });

    const nextWorkspace = await buildWorkspace(projectId, { repoRoot, projectsDir });
    return {
      mode: "openai",
      runtime,
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
      uiEvent: input.uiEvent || "chat_message",
      error
    }, { now });
    const assistantEvent = await appendEvent(projectDir, {
      type: EVENT_TYPES.ASSISTANT_MESSAGE,
      createdAt: now,
      step: "auftrag",
      payload: {
        mode: "openai_error",
        message: errorMessage,
        suggestedActions: []
      }
    }, { now });
    const nextWorkspace = await buildWorkspace(projectId, { repoRoot, projectsDir });
    return {
      mode: "openai_error",
      runtime: {
        ...runtime,
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
  readChat,
  sendChatMessage,
  __testing: {
    contradictsRequiredConfirmation
  }
};
