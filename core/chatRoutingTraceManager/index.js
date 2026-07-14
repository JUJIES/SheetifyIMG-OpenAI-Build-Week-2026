"use strict";

const fs = require("node:fs/promises");
const path = require("node:path");

const TRACE_FILE = "chat-routing-traces.jsonl";
const MAX_TEXT = 700;

function cleanText(value, max = MAX_TEXT) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  return text ? text.slice(0, max) : null;
}

function compactTarget(target = {}) {
  return {
    kind: target.kind || "none",
    conceptVersion: target.conceptVersion || null,
    proposalId: target.proposalId || null,
    contentMirrorId: target.contentMirrorId || null,
    runId: target.runId || null,
    candidateId: target.candidateId || null,
    commandId: target.commandId || null,
    page: target.page || null
  };
}

function compactRevisionTarget(target = null) {
  if (!target || typeof target !== "object") {
    return null;
  }
  return {
    source: target.source || null,
    kind: target.kind || null,
    label: cleanText(target.label, 120),
    projectId: target.projectId || null,
    proposalId: target.proposalId || null,
    contentMirrorId: target.contentMirrorId || null,
    conceptVersion: target.conceptVersion || null,
    runId: target.runId || null,
    candidateId: target.candidateId || null,
    page: target.page || null
  };
}

function compactIntent(intent = null) {
  if (!intent || typeof intent !== "object") {
    return null;
  }
  return {
    intent: intent.intent || "none",
    confidence: intent.confidence || null,
    target: compactTarget(intent.target || {}),
    revisionTarget: compactRevisionTarget(intent.revisionTarget),
    wantsCandidate: intent.wantsCandidate === true,
    wantsAdoption: intent.wantsAdoption === true,
    wantsContentChange: intent.wantsContentChange === true,
    isQuestion: intent.isQuestion === true,
    targetBasis: intent.targetBasis || null,
    riskLevel: intent.riskLevel || null,
    executionPolicy: intent.executionPolicy || null,
    guardCategory: intent.guardCategory || null,
    requiresConfirmation: intent.requiresConfirmation === true,
    chainRequested: intent.chainRequested === true,
    ambiguity: intent.ambiguity || null,
    source: intent.source || null,
    reason: cleanText(intent.reason, 300)
  };
}

function summarizePayload(payload = {}) {
  if (!payload || typeof payload !== "object") {
    return {};
  }
  const summary = {};
  for (const key of [
    "proposalId",
    "basisProposalId",
    "contentMirrorId",
    "conceptVersion",
    "candidateId",
    "runId",
    "page",
    "approve",
    "revisionMode",
    "preserveUnmentionedConceptParts",
    "followUpIntent",
    "changeScope",
    "contentChangePolicy"
  ]) {
    if (payload[key] !== undefined) {
      summary[key] = payload[key];
    }
  }
  if (payload.message) {
    summary.message = cleanText(payload.message);
  }
  if (payload.variantInstruction) {
    summary.variantInstruction = cleanText(payload.variantInstruction);
  }
  if (payload.revisionTarget) {
    summary.revisionTarget = compactRevisionTarget(payload.revisionTarget);
  }
  if (Array.isArray(payload.referenceImages)) {
    summary.referenceImageCount = payload.referenceImages.length;
    summary.referenceImageRoles = payload.referenceImages
      .map((reference) => reference.role || null)
      .filter(Boolean)
      .slice(0, 6);
  }
  if (Array.isArray(payload.nextCandidateReferenceImages)) {
    summary.nextCandidateReferenceImageCount = payload.nextCandidateReferenceImages.length;
    summary.nextCandidateReferenceImageRoles = payload.nextCandidateReferenceImages
      .map((reference) => reference.role || null)
      .filter(Boolean)
      .slice(0, 6);
  }
  return summary;
}

function compactAction(action = null) {
  if (!action || typeof action !== "object") {
    return null;
  }
  return {
    command: action.command || action.id || null,
    label: cleanText(action.label, 120),
    requiresConfirmation: action.requiresConfirmation === true,
    confirmationKind: action.confirmationKind || null,
    autoOpenConfirmation: action.autoOpenConfirmation === true,
    payload: summarizePayload(action.payload || {})
  };
}

function compactResolution(resolution = {}) {
  const kind = resolution.kind || "none";
  if (kind === "command") {
    const command = resolution.command || {};
    return {
      kind,
      source: command.source || null,
      command: command.command || null,
      followUpCommand: command.followUpCommand || null,
      autoOpenConfirmation: command.autoOpenConfirmation === true,
      autopilot: command.autopilot === true,
      payload: summarizePayload(command.payload || {}),
      followUpPayload: summarizePayload(command.followUpPayload || {})
    };
  }
  if (kind === "action_offer") {
    const offer = resolution.offer || {};
    return {
      kind,
      source: offer.source || null,
      message: cleanText(offer.message),
      suggestedActions: (offer.suggestedActions || []).map(compactAction).filter(Boolean)
    };
  }
  return {
    kind,
    source: resolution.source || null
  };
}

function workflowActionsSnapshot(workspace = {}) {
  return (workspace.workflowActions || []).slice(0, 6).map((action) => ({
    command: action.command || action.id || null,
    label: cleanText(action.label, 120),
    requiresConfirmation: action.requiresConfirmation === true
  }));
}

function workspaceSnapshot(workspace = {}) {
  return {
    currentConceptId: workspace.artifacts?.currentContent?.id || null,
    currentConceptVersion: workspace.artifacts?.currentContent?.version || null,
    conceptCount: Number(workspace.artifacts?.concepts?.length || 0),
    latestProposalId: workspace.proposals?.latestContentMirror?.proposalId || null,
    candidateCount: Number(workspace.latestRun?.candidateCount || workspace.preview?.candidates?.length || 0),
    workflowActions: workflowActionsSnapshot(workspace)
  };
}

function candidateAction(action = {}) {
  const command = action.command || action.id || "";
  return command === "generate_image_candidate" || command === "generate_candidate_from_content_proposal";
}

function suggestedActions(result = {}) {
  return result.response?.suggestedActions || [];
}

function inferVisibleEffect(resolution = {}, result = {}, before = {}, after = {}) {
  const beforeState = workspaceSnapshot(before);
  const afterState = workspaceSnapshot(after);
  const actions = suggestedActions(result);
  if (afterState.latestProposalId && afterState.latestProposalId !== beforeState.latestProposalId) {
    return "concept_proposal_created";
  }
  if (actions.some((action) => candidateAction(action) && action.requiresConfirmation === true)) {
    return "paid_candidate_offer";
  }
  if (result.mode === "local_command_error") {
    return "command_error";
  }
  if (resolution.kind === "command") {
    const commandId = resolution.command?.command || null;
    if (commandId === "generate_image_candidate" || commandId === "generate_candidate_from_content_proposal") {
      return "candidate_generation_started";
    }
    return "workflow_command_executed";
  }
  if (actions.length) {
    return "action_offer";
  }
  if (result.mode === "local_input_gate") {
    return "input_gate";
  }
  if (result.mode === "local_manual_candidate_flow") {
    return "manual_guidance";
  }
  if (resolution.kind === "none" && result.response?.content) {
    return "chat_only";
  }
  return "no_action";
}

function tracePath(projectDir) {
  return path.join(projectDir, "history", TRACE_FILE);
}

function buildChatRoutingTrace(input = {}) {
  const result = input.result || {};
  const beforeWorkspace = input.context?.workspace || {};
  const afterWorkspace = result.workspace || beforeWorkspace;
  const responseActions = suggestedActions(result).map(compactAction).filter(Boolean);
  return {
    schemaVersion: 1,
    createdAt: input.now || new Date().toISOString(),
    projectId: input.projectId || null,
    operationId: input.operationId || input.context?.usageAttribution?.operationId || null,
    userEventId: input.context?.userEvent?.id || null,
    userMessage: cleanText(input.context?.message || input.message),
    uiEvent: input.uiEvent || null,
    routing: {
      semanticSource: input.context?.intentDecision?.semanticSource || null,
      finalSource: input.context?.intentDecision?.finalSource || null,
      guardApplied: input.context?.intentDecision?.guardApplied === true,
      guardCategory: input.context?.intentDecision?.guardCategory || null,
      deterministicGuardCategory: input.context?.intentDecision?.deterministicGuardCategory || null,
      reason: input.context?.intentDecision?.reason || null,
      deterministicIntent: compactIntent(input.context?.intentDecision?.deterministicGuard),
      modelIntent: compactIntent(input.context?.intentDecision?.modelIntent),
      finalIntent: compactIntent(input.context?.intent || input.context?.intentDecision?.intent)
    },
    resolution: compactResolution(input.resolution || {}),
    result: {
      mode: result.mode || null,
      visibleEffect: inferVisibleEffect(input.resolution || {}, result, beforeWorkspace, afterWorkspace),
      visibleAssistantMessage: cleanText(result.response?.content),
      suggestedActions: responseActions
    },
    workspaceBefore: workspaceSnapshot(beforeWorkspace),
    workspaceAfter: workspaceSnapshot(afterWorkspace)
  };
}

async function appendChatRoutingTrace(projectDir, input = {}) {
  try {
    const filePath = tracePath(projectDir);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    const trace = buildChatRoutingTrace(input);
    await fs.appendFile(filePath, `${JSON.stringify(trace)}\n`, "utf8");
    return trace;
  } catch {
    return null;
  }
}

module.exports = {
  TRACE_FILE,
  appendChatRoutingTrace,
  buildChatRoutingTrace,
  tracePath,
  __testing: {
    compactIntent,
    inferVisibleEffect,
    summarizePayload,
    workspaceSnapshot
  }
};
