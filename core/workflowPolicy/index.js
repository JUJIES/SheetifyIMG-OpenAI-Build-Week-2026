"use strict";

const SAFE_WORKFLOW_COMMANDS = new Set([
  "approve_current_brief",
  "approve_current_content",
  "create_brief_draft",
  "create_content_draft",
  "generate_lessonbrief_proposal",
  "adopt_lessonbrief_proposal",
  "generate_content_mirror_proposal",
  "generate_candidate_from_content_proposal",
  "adopt_content_mirror_proposal",
  "generate_content_warnings_proposal",
  "adopt_content_warnings_proposal",
  "prepare_image_spec",
  "adopt_image_spec",
  "prepare_reference_asset",
  "prepare_web_reference_asset",
  "generate_image_candidate",
  "prepare_series_export"
]);

function isEnabledWorkflowCommand(command) {
  return Boolean(command?.enabled && SAFE_WORKFLOW_COMMANDS.has(command.id));
}

function workflowCommandPayload(command = {}) {
  if (command.defaultPayload) {
    return command.defaultPayload;
  }
  if (command.defaultCandidateId) {
    return { candidateId: command.defaultCandidateId };
  }
  return {};
}

function referenceCanBeSkipped(command = null) {
  const policy = command?.referencePolicy || {};
  return policy.canProceedWithoutReference !== false;
}

function firstCommand(commands, ids) {
  return ids.map((id) => commands.find((command) => command.id === id)).find(Boolean) || null;
}

function visibleWorkflowCommands(workspace = {}) {
  const commands = (workspace.commands || []).filter(isEnabledWorkflowCommand);
  const hasBrief = Boolean(workspace.documents?.brief?.data);
  const hasContent = Boolean(workspace.documents?.content?.data);
  const hasConcept = hasBrief
    || hasContent
    || Boolean(workspace.proposals?.latestLessonBrief || workspace.proposals?.latestContentMirror);
  const hasSelection = Boolean(workspace.latestRun?.selectedPageCount);
  const hasExport = Boolean(workspace.workspaceEntry?.availability?.hasExport || workspace.preview?.pdfs?.length);
  const approveContentCommand = commands.find((command) => command.id === "approve_current_content");
  const prepareImageSpecCommand = commands.find((command) => command.id === "prepare_image_spec");
  const hasImageSpecProposal = Boolean(workspace.proposals?.latestImageSpec);
  const hasActiveImageSpec = Boolean(workspace.proposals?.activeImageSpec);
  const shouldShowReferencePreflight = Boolean(prepareImageSpecCommand?.referencePreflight);
  const contentNeedsRepair = hasContent
    && workspace.documents?.content?.status === "draft"
    && !approveContentCommand
    && !hasSelection
    && !hasExport;
  const canAdoptLessonProposal = !hasBrief && !hasContent && !hasSelection && !hasExport;
  const canAdoptContentProposal = Boolean(workspace.proposals?.latestContentMirror);
  const commandOrder = [
    ...(canAdoptLessonProposal ? ["adopt_lessonbrief_proposal"] : []),
    ...(canAdoptContentProposal ? ["adopt_content_mirror_proposal"] : []),
    "adopt_content_warnings_proposal",
    ...(hasConcept ? [] : ["generate_lessonbrief_proposal"]),
    ...(hasBrief && (!hasContent || contentNeedsRepair) ? ["generate_content_mirror_proposal"] : []),
    ...(hasContent ? ["approve_current_content"] : []),
    ...(!hasBrief ? ["create_brief_draft"] : []),
    ...(hasBrief && (!hasContent || contentNeedsRepair) ? ["create_content_draft"] : []),
    ...(hasImageSpecProposal ? ["prepare_reference_asset", "prepare_web_reference_asset", "adopt_image_spec"] : []),
    ...(shouldShowReferencePreflight ? ["prepare_image_spec"] : []),
    ...(hasActiveImageSpec ? ["prepare_reference_asset", "prepare_web_reference_asset"] : []),
    ...(hasContent ? ["generate_image_candidate"] : [])
  ];
  const next = firstCommand(commands, commandOrder);
  if (!next) {
    return [];
  }

  const companionIds = {
    generate_content_mirror_proposal: ["create_content_draft"],
    prepare_image_spec: ["generate_image_candidate"],
    prepare_reference_asset: referenceCanBeSkipped(next) ? ["adopt_image_spec", "generate_image_candidate"] : ["adopt_image_spec"],
    prepare_web_reference_asset: referenceCanBeSkipped(next) ? ["adopt_image_spec", "generate_image_candidate"] : ["adopt_image_spec"],
    adopt_image_spec: ["prepare_reference_asset"]
  };
  const companion = firstCommand(commands, companionIds[next.id] || []);
  return [next, companion].filter(Boolean);
}

function workflowActionSummaries(workspace = {}) {
  return visibleWorkflowCommands(workspace).map((command) => ({
    id: command.id,
    command: command.id,
    label: command.label,
    payload: workflowCommandPayload(command),
    requiresConfirmation: command.requiresConfirmation === true,
    confirmationKind: command.confirmationKind || null,
    reason: command.reason || null
  }));
}

module.exports = {
  isEnabledWorkflowCommand,
  visibleWorkflowCommands,
  workflowActionSummaries,
  workflowCommandPayload
};
