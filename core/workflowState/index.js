"use strict";

const WORKFLOW_STATE_VERSION = "v2-shadow";

function commandById(workspace = {}, commandId) {
  return (workspace.commands || []).find((command) => command.id === commandId) || null;
}

function enabledCommand(workspace = {}, commandId) {
  const command = commandById(workspace, commandId);
  return command?.enabled ? command : null;
}

function commandPayload(command = {}) {
  if (command.defaultPayload) {
    return command.defaultPayload;
  }
  if (command.defaultCandidateId) {
    return { candidateId: command.defaultCandidateId };
  }
  return {};
}

function contentMirrorIdFromConcept(concept = {}) {
  return concept.contentMirrorId || concept.conceptId || null;
}

function imageSpecContentMirrorId(imageSpec = null) {
  return imageSpec?.source?.currentContentMirrorId
    || imageSpec?.data?.source?.currentContentMirrorId
    || null;
}

function exportCount(workspace = {}) {
  return Number(workspace.preview?.pdfs?.length || 0)
    + (workspace.workspaceEntry?.availability?.hasExport ? 1 : 0);
}

function hasExport(workspace = {}) {
  return exportCount(workspace) > 0;
}

function deriveWorkflowFacts(workspace = {}) {
  const currentConceptId = workspace.artifacts?.currentContent?.id
    || workspace.documents?.content?.artifactId
    || null;
  const selectedConceptId = workspace.latestRun?.selectionContentMirrorId
    || contentMirrorIdFromConcept(workspace.latestRun?.selectedCandidateConcept || workspace.latestRun?.concept || {});
  const activeImageSpec = workspace.proposals?.activeImageSpec || null;
  const latestImageSpec = workspace.proposals?.latestImageSpec || null;
  const hasBrief = Boolean(workspace.documents?.brief?.data || workspace.artifacts?.currentBrief || workspace.documents?.brief?.artifactId);
  const hasContent = Boolean(workspace.documents?.content?.data || workspace.artifacts?.currentContent || workspace.documents?.content?.artifactId);
  const hasCurrentSelection = Boolean(workspace.latestRun?.selectedPageCount);
  const hasAnySelection = Boolean(workspace.latestRun?.rawSelectedPageCount || workspace.latestRun?.selection?.pages?.length);
  const hasCurrentCandidate = Boolean(workspace.latestRun?.candidateCount);
  const hasAnyCandidate = Boolean(workspace.latestRun?.rawCandidateCount || workspace.latestRun?.manifest?.candidates?.length);
  const hasCurrentExport = hasExport(workspace) && hasCurrentSelection && !workspace.latestRun?.hasOutdatedSelection;

  return {
    version: WORKFLOW_STATE_VERSION,
    projectId: workspace.project?.projectId || null,
    hasBrief,
    hasContent,
    hasConcept: hasBrief
      || hasContent
      || Boolean(workspace.proposals?.latestLessonBrief)
      || Boolean(workspace.proposals?.latestContentMirror),
    currentConceptId,
    currentConceptApproved: workspace.approval?.canGenerate === true,
    currentContentStatus: workspace.documents?.content?.status || null,
    hasOpenLessonBriefProposal: Boolean(workspace.proposals?.latestLessonBrief),
    openLessonBriefProposalId: workspace.proposals?.latestLessonBrief?.proposalId || null,
    hasOpenContentProposal: Boolean(workspace.proposals?.latestContentMirror),
    openContentProposalId: workspace.proposals?.latestContentMirror?.proposalId || null,
    hasOpenWarningsProposal: Boolean(workspace.proposals?.latestContentWarnings),
    openWarningsProposalId: workspace.proposals?.latestContentWarnings?.proposalId || null,
    hasOpenImageSpecProposal: Boolean(latestImageSpec),
    openImageSpecProposalId: latestImageSpec?.proposalId || null,
    hasActiveImageSpec: Boolean(activeImageSpec),
    activeImageSpecId: activeImageSpec?.proposalId || null,
    activeImageSpecConceptId: imageSpecContentMirrorId(activeImageSpec),
    hasActiveImageSpecForCurrentConcept: Boolean(activeImageSpec)
      && (!currentConceptId || !imageSpecContentMirrorId(activeImageSpec) || imageSpecContentMirrorId(activeImageSpec) === currentConceptId),
    hasCurrentCandidate,
    hasAnyCandidate,
    currentCandidateCount: Number(workspace.latestRun?.candidateCount || 0),
    rawCandidateCount: Number(workspace.latestRun?.rawCandidateCount || workspace.latestRun?.manifest?.candidates?.length || 0),
    hasCurrentSelection,
    hasAnySelection,
    selectedConceptId: selectedConceptId || null,
    selectionIsCurrent: workspace.latestRun?.selectionIsCurrent !== false,
    hasOutdatedSelection: workspace.latestRun?.hasOutdatedSelection === true,
    hasCurrentExport,
    hasAnyExport: hasExport(workspace),
    exportCount: exportCount(workspace),
    latestRunId: workspace.latestRun?.runId || null
  };
}

function actionFromCommand(command, shownBecause, meta = {}) {
  if (!command) {
    return null;
  }
  return {
    id: command.id,
    command: command.id,
    label: command.label,
    payload: commandPayload(command),
    requiresConfirmation: command.requiresConfirmation === true,
    confirmationKind: command.confirmationKind || null,
    reason: command.reason || null,
    shownBecause,
    source: WORKFLOW_STATE_VERSION,
    ...meta
  };
}

function firstEnabledAction(workspace, candidates) {
  for (const candidate of candidates) {
    const command = enabledCommand(workspace, candidate.id);
    if (command) {
      return actionFromCommand(command, candidate.shownBecause, candidate.meta || {});
    }
  }
  return null;
}

function deriveWorkflowActions(workspace = {}) {
  const facts = deriveWorkflowFacts(workspace);
  const approveContentCommand = enabledCommand(workspace, "approve_current_content");
  const prepareImageSpecCommand = enabledCommand(workspace, "prepare_image_spec");
  const contentNeedsRepair = facts.hasContent
    && facts.currentContentStatus === "draft"
    && !approveContentCommand
    && !facts.hasAnySelection
    && !facts.hasAnyExport;
  const primaryCandidates = [
    ...(facts.hasOpenContentProposal
      ? [{ id: "adopt_content_mirror_proposal", shownBecause: "open_concept_revision" }]
      : []),
    ...(facts.hasOpenLessonBriefProposal && !facts.hasBrief && !facts.hasContent && !facts.hasAnySelection && !facts.hasAnyExport
      ? [{ id: "adopt_lessonbrief_proposal", shownBecause: "open_lessonbrief_proposal" }]
      : []),
    ...(facts.hasOpenWarningsProposal
      ? [{ id: "adopt_content_warnings_proposal", shownBecause: "open_content_warnings_proposal" }]
      : []),
    ...(facts.hasOpenImageSpecProposal
      ? [{ id: "adopt_image_spec", shownBecause: "open_image_spec_proposal" }]
      : []),
    ...(facts.hasOpenImageSpecProposal || facts.hasActiveImageSpec
      ? [
        { id: "prepare_reference_asset", shownBecause: "reference_asset_required_or_recommended" },
        { id: "prepare_web_reference_asset", shownBecause: "web_reference_required_or_recommended" }
      ]
      : []),
    ...(!facts.hasConcept
      ? [{ id: "generate_lessonbrief_proposal", shownBecause: "missing_concept" }]
      : []),
    ...(facts.hasBrief && (!facts.hasContent || contentNeedsRepair)
      ? [{ id: "generate_content_mirror_proposal", shownBecause: "missing_or_repairing_content" }]
      : []),
    ...(facts.hasContent
      ? [{ id: "approve_current_content", shownBecause: "draft_content_ready" }]
      : []),
    ...(prepareImageSpecCommand?.referencePreflight
      ? [{ id: "prepare_image_spec", shownBecause: "image_spec_preflight_needed" }]
      : []),
    ...(facts.hasCurrentCandidate && !facts.hasCurrentSelection
      ? [{ id: "select_candidate", shownBecause: "candidate_without_selection" }]
      : []),
    ...(facts.hasCurrentSelection && !facts.hasCurrentExport
      ? [{ id: "prepare_export", shownBecause: "selection_without_export" }]
      : []),
    ...(facts.currentConceptApproved
      ? [{
        id: "generate_image_candidate",
        shownBecause: facts.hasCurrentExport
          ? "export_exists_variant_allowed"
          : facts.hasOutdatedSelection
            ? "selection_outdated_for_current_concept"
            : facts.hasCurrentCandidate
              ? "candidate_exists_variant_allowed"
              : "approved_concept_without_candidate"
      }]
      : [])
  ];
  const primary = firstEnabledAction(workspace, primaryCandidates);

  if (!primary) {
    return [];
  }

  const actions = [primary];
  if (primary.command === "select_candidate") {
    const variantCommand = enabledCommand(workspace, "generate_image_candidate");
    if (variantCommand) {
      actions.push(actionFromCommand(variantCommand, "alternative_candidate_variant"));
    }
  }
  if (["prepare_reference_asset", "prepare_web_reference_asset", "adopt_image_spec"].includes(primary.command)) {
    const candidateCommand = enabledCommand(workspace, "generate_image_candidate");
    if (candidateCommand) {
      actions.push(actionFromCommand(candidateCommand, "reference_can_be_skipped_or_already_satisfied"));
    }
  }
  return actions;
}

function summarizeActions(actions = []) {
  return actions.map((action) => ({
    command: action.command,
    label: action.label,
    shownBecause: action.shownBecause,
    payload: action.payload || {}
  }));
}

module.exports = {
  WORKFLOW_STATE_VERSION,
  deriveWorkflowActions,
  deriveWorkflowFacts,
  summarizeActions
};
