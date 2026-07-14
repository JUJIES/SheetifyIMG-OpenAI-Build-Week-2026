"use strict";

const { EVENT_TYPES } = require("../contracts");
const { appendEvent } = require("../eventLog");
const { narrateChatMoment } = require("../chatNarrationManager");
const { workflowFollowupFallback } = require("../chatPersonaManager");
const { runWorkspaceCommand } = require("../workspaceCommandManager");
const { buildWorkspace } = require("../workspaceManager");
const { visibleWorkflowCommands, workflowCommandPayload } = require("../workflowPolicy");
const { sanitizeErrorMessage } = require("../modelRunLogger");

const AUTOPILOT_CONTINUATION_COMMANDS = new Set([
  "generate_content_mirror_proposal"
]);

function autoCommandMessage(commandId) {
  return workflowFollowupFallback(commandId);
}

function nextSuggestedAction(workspace = {}) {
  const command = visibleWorkflowCommands(workspace)[0] || null;
  if (!command) {
    return null;
  }
  return {
    command: command.id,
    label: command.label,
    payload: workflowCommandPayload(command),
    requiresConfirmation: command.requiresConfirmation === true,
    confirmationKind: command.confirmationKind || null
  };
}

function suggestedActionForCommand(workspace = {}, commandId = null, meta = {}) {
  if (!commandId) {
    return null;
  }
  const command = visibleWorkflowCommands(workspace).find((entry) => entry.id === commandId || entry.command === commandId)
    || (workspace.commands || []).find((entry) => (entry.id === commandId || entry.command === commandId) && entry.enabled)
    || null;
  if (!command) {
    return null;
  }
  return {
    command: command.id,
    label: command.label,
    payload: workflowCommandPayload(command),
    requiresConfirmation: command.requiresConfirmation === true,
    confirmationKind: command.confirmationKind || null,
    ...meta
  };
}

function withPayloadOverride(action = null, payload = null) {
  if (!action || !payload || typeof payload !== "object") {
    return action;
  }
  return {
    ...action,
    payload: {
      ...(action.payload || {}),
      ...payload
    }
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

function latestAssistantMessage(workspace = {}) {
  return [...(workspace.chat?.messages || [])].reverse()
    .find((message) => message.role === "assistant") || null;
}

function commandErrorResponseMessage(error) {
  const detail = sanitizeErrorMessage(error);
  const punctuatedDetail = /[.!?]$/.test(detail) ? detail : `${detail}.`;
  return `Das konnte ich nicht vollständig ausführen: ${punctuatedDetail} Der aktuelle Projektstand wurde neu geladen; prüfe Konzept und Entwürfe bitte kurz, bevor du fortfährst.`;
}

async function appendCommandErrorMessage(projectDir, error, now) {
  const message = commandErrorResponseMessage(error);
  await appendEvent(projectDir, {
    type: EVENT_TYPES.ASSISTANT_MESSAGE,
    createdAt: now,
    step: "auftrag",
    payload: {
      mode: "local_command_error",
      message,
      suggestedActions: []
    }
  }, { now });
}

async function appendAutoCommandMessage(projectDir, commandId, now, action = null, context = {}) {
  const fallback = action
    ? workflowFollowupFallback(commandId, action)
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
    uiEvent: "workflow_followup",
    usageAttribution: context.usageAttribution
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
    let workspace = await buildWorkspace(projectId, options);
    const messages = workspace.chat?.messages || [];
    const latestUserIndex = messages.findLastIndex((message) => message.role === "user");
    const latestAssistantIndex = messages.findLastIndex((message) => message.role === "assistant");
    const latestAssistant = latestAssistantMessage(workspace);
    if (
      latestAssistantIndex > latestUserIndex
      && /error/i.test(String(latestAssistant?.mode || ""))
    ) {
      return {
        mode: "local_command_error",
        response: latestAssistantResponse(workspace),
        messages,
        workspace
      };
    }
    await appendCommandErrorMessage(projectDir, error, options.now || new Date().toISOString());
    workspace = await buildWorkspace(projectId, options);
    return {
      mode: "local_command_error",
      response: latestAssistantResponse(workspace),
      messages: workspace.chat?.messages || [],
      workspace
    };
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
    const action = resolved.command === "deposit_worksheet"
      ? null
      : withPayloadOverride(
          suggestedActionForCommand(workspace, resolved.followUpCommand, {
            autoOpenConfirmation: resolved.autoOpenConfirmation === true
          }) || nextSuggestedAction(workspace),
          resolved.followUpPayload || null
        );
    await appendAutoCommandMessage(projectDir, followUpCommandId, options.now, action, {
      workspace,
      usageAttribution: options.usageAttribution
    });
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

module.exports = {
  runResolvedChatCommand,
  __testing: {
    commandErrorResponseMessage,
    suggestedActionForCommand
  }
};
