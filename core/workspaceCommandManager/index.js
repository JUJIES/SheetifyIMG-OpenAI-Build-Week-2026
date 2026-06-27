"use strict";

const path = require("node:path");
const { openProject } = require("../projectManager");
const { buildWorkspace } = require("../workspaceManager");
const { validateWorkflowCommand } = require("../workflowState");
const { refreshStatusSnapshot } = require("../statusSnapshot");
const { runWorkspaceCommandHandler } = require("../workspaceCommandHandlers");

const DEFAULT_REPO_ROOT = path.resolve(__dirname, "..", "..");
const DEFAULT_PROJECTS_DIR = path.join(DEFAULT_REPO_ROOT, "projects");

function projectDirFor(projectId, options = {}) {
  const projectsDir = options.projectsDir || DEFAULT_PROJECTS_DIR;
  return path.join(projectsDir, projectId);
}

async function assertWorkflowCommandAllowed(projectId, command, payload, options = {}) {
  const workspace = await buildWorkspace(projectId, options);
  const validation = validateWorkflowCommand(workspace, command, payload);
  if (!validation.ok) {
    throw new Error(validation.reason || `Workflow command is not allowed: ${command}`);
  }
}

async function runWorkspaceCommand(projectId, input = {}, options = {}) {
  const repoRoot = options.repoRoot || DEFAULT_REPO_ROOT;
  const projectsDir = options.projectsDir || DEFAULT_PROJECTS_DIR;
  const worksheetsDir = options.worksheetsDir;
  const projectDir = projectDirFor(projectId, { projectsDir });
  const project = await openProject(projectId, { projectsDir });
  const command = input.command || input.id;
  const payload = input.payload || {};
  const now = input.now || options.now || new Date().toISOString();

  await assertWorkflowCommandAllowed(projectId, command, payload, {
    repoRoot,
    projectsDir,
    worksheetsDir,
    now
  });

  const result = await runWorkspaceCommandHandler({
    projectId,
    project,
    projectDir,
    command,
    payload,
    input,
    repoRoot,
    projectsDir,
    worksheetsDir,
    now
  });

  await refreshStatusSnapshot(projectDir, {
    now,
    source: `workspace_command:${command}`
  });

  return {
    command,
    result,
    workspace: await buildWorkspace(projectId, { repoRoot, projectsDir, worksheetsDir })
  };
}

module.exports = {
  runWorkspaceCommand
};
