"use strict";

const { EVENT_TYPES } = require("../contracts");
const { appendEvent } = require("../eventLog");
const { narrateChatMoment } = require("../chatNarrationManager");
const { workflowFollowupFallback } = require("../chatPersonaManager");
const { runWorkspaceCommand } = require("../workspaceCommandManager");
const { buildWorkspace } = require("../workspaceManager");
const { visibleWorkflowCommands, workflowCommandPayload } = require("../workflowPolicy");

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
    const action = resolved.command === "deposit_worksheet"
      ? null
      : suggestedActionForCommand(workspace, resolved.followUpCommand, {
          autoOpenConfirmation: resolved.autoOpenConfirmation === true
        }) || nextSuggestedAction(workspace);
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

module.exports = {
  runResolvedChatCommand
};
