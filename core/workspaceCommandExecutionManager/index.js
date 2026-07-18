"use strict";

const activeCommandsByProject = new Map();

function nonEmpty(value) {
  const text = String(value || "").trim();
  return text || null;
}

function commandInProgressError(projectId, activeCommand = {}) {
  const error = new Error("In diesem Projekt läuft bereits eine Aktion. Warte kurz, bis sie abgeschlossen ist.");
  error.name = "WorkspaceCommandInProgressError";
  error.code = "WORKSPACE_COMMAND_IN_PROGRESS";
  error.publicCode = "workspace_command_in_progress";
  error.statusCode = 409;
  error.projectId = projectId;
  error.activeCommandId = activeCommand.commandId || null;
  return error;
}

function activeWorkspaceCommand(projectId) {
  return activeCommandsByProject.get(nonEmpty(projectId)) || null;
}

async function runExclusiveWorkspaceCommand(projectId, commandId, runner) {
  const normalizedProjectId = nonEmpty(projectId);
  if (!normalizedProjectId) {
    throw new Error("projectId is required for workspace command execution.");
  }
  if (typeof runner !== "function") {
    throw new Error("runner is required for workspace command execution.");
  }

  const activeCommand = activeWorkspaceCommand(normalizedProjectId);
  if (activeCommand) {
    throw commandInProgressError(normalizedProjectId, activeCommand);
  }

  const token = Symbol(normalizedProjectId);
  activeCommandsByProject.set(normalizedProjectId, {
    token,
    commandId: nonEmpty(commandId),
    startedAt: new Date().toISOString()
  });

  try {
    return await runner();
  } finally {
    if (activeCommandsByProject.get(normalizedProjectId)?.token === token) {
      activeCommandsByProject.delete(normalizedProjectId);
    }
  }
}

module.exports = {
  activeWorkspaceCommand,
  runExclusiveWorkspaceCommand
};
