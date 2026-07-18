"use strict";

const path = require("node:path");
const { openProject } = require("../projectManager");
const { appendChatRoutingTrace } = require("../chatRoutingTraceManager");
const { buildWorkspace } = require("../workspaceManager");
const { validateWorkflowCommand } = require("../workflowState");
const { refreshStatusSnapshot } = require("../statusSnapshot");
const { runWorkspaceCommandHandler } = require("../workspaceCommandHandlers");
const { runExclusiveWorkspaceCommand } = require("../workspaceCommandExecutionManager");
const { DEFAULT_PLANNING_FLOW, resolvePlanningFlow } = require("../planningFlowConfig");
const {
  createUsageAttribution,
  extendUsageAttribution
} = require("../usageAttributionManager");

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

function workflowCommandTraceIntent(command, payload = {}) {
  return {
    intent: "workflow_command",
    confidence: "high",
    target: {
      kind: "command",
      commandId: command
    },
    wantsCandidate: command === "generate_image_candidate" || command === "generate_candidate_from_content_proposal",
    wantsAdoption: command === "adopt_content_mirror_proposal" || command === "generate_candidate_from_content_proposal",
    wantsContentChange: command === "generate_content_mirror_proposal",
    isQuestion: false,
    targetBasis: payload.proposalId ? "content_proposal" : "command",
    riskLevel: "none",
    executionPolicy: "execute_command",
    source: "ui",
    reason: "Workflow command was triggered directly from the UI."
  };
}

async function appendWorkspaceCommandTrace(
  projectId,
  projectDir,
  input = {},
  beforeWorkspace = {},
  afterWorkspace = {},
  now,
  usageAttribution = null,
  planningFlow = DEFAULT_PLANNING_FLOW
) {
  const command = input.command || input.id;
  const payload = input.payload || {};
  const intent = workflowCommandTraceIntent(command, payload);
  await appendChatRoutingTrace(projectDir, {
    context: {
      message: input.message || input.label || command,
      usageAttribution,
      flowVariant: planningFlow,
      workspace: beforeWorkspace,
      intent,
      intentDecision: {
        semanticSource: "ui",
        finalSource: "ui",
        guardApplied: false,
        guardCategory: "hard_guard",
        deterministicGuardCategory: "hard_guard",
        reason: "ui_workflow_command",
        intent
      }
    },
    message: input.message || input.label || command,
    now,
    projectId,
    resolution: {
      kind: "command",
      command: {
        source: "ui_workflow_command",
        command,
        payload
      }
    },
    result: {
      mode: "workspace_command",
      response: {
        content: null,
        suggestedActions: []
      },
      workspace: afterWorkspace
    },
    uiEvent: input.uiEvent || "workflow_command"
  });
}

async function runWorkspaceCommandUnlocked(projectId, input = {}, options = {}) {
  const repoRoot = options.repoRoot || DEFAULT_REPO_ROOT;
  const promptRoot = options.promptRoot || repoRoot;
  const projectsDir = options.projectsDir || DEFAULT_PROJECTS_DIR;
  const worksheetsDir = options.worksheetsDir;
  const projectDir = projectDirFor(projectId, { projectsDir });
  const project = await openProject(projectId, { projectsDir });
  const command = input.command || input.id;
  const payload = input.payload || {};
  const now = input.now || options.now || new Date().toISOString();
  const planningFlow = resolvePlanningFlow(options);
  const usageAttribution = extendUsageAttribution(
    createUsageAttribution(options.usageAttribution, {
      projectId,
      operationKind: "workspace_command"
    }),
    { commandId: command }
  );
  const traceCommand = options.traceCommand === true;
  const beforeWorkspace = traceCommand
    ? await buildWorkspace(projectId, { repoRoot, projectsDir, worksheetsDir })
    : null;

  await assertWorkflowCommandAllowed(projectId, command, payload, {
    repoRoot,
    promptRoot,
    projectsDir,
    worksheetsDir,
    now,
    planningFlow,
    usageAttribution,
    generationQuota: options.generationQuota || null
  });

  const result = await runWorkspaceCommandHandler({
    projectId,
    project,
    projectDir,
    command,
    payload,
    input,
    repoRoot,
    promptRoot,
    projectsDir,
    worksheetsDir,
    now,
    planningFlow,
    usageAttribution,
    generationQuota: options.generationQuota || null
  });

  await refreshStatusSnapshot(projectDir, {
    now,
    source: `workspace_command:${command}`
  });

  const workspace = await buildWorkspace(projectId, { repoRoot, projectsDir, worksheetsDir });
  if (traceCommand) {
    await appendWorkspaceCommandTrace(
      projectId,
      projectDir,
      input,
      beforeWorkspace,
      workspace,
      now,
      usageAttribution,
      planningFlow
    );
  }

  return {
    command,
    result,
    workspace
  };
}

async function runWorkspaceCommand(projectId, input = {}, options = {}) {
  const command = input.command || input.id;
  return runExclusiveWorkspaceCommand(projectId, command, () => (
    runWorkspaceCommandUnlocked(projectId, input, options)
  ));
}

module.exports = {
  runWorkspaceCommand
};
