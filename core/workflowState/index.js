"use strict";

const WORKFLOW_STATE_VERSION = "v0.1-kernel";
const SAFE_WORKFLOW_COMMANDS = new Set([
  "approve_current_brief",
  "approve_current_content",
  "create_brief_draft",
  "create_content_draft",
  "create_run",
  "activate_content_mirror_version",
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
  "deposit_worksheet"
]);

const GUARDED_WORKFLOW_COMMANDS = new Set([
  "adopt_content_mirror_proposal",
  "activate_content_mirror_version",
  "adopt_image_spec",
  "prepare_reference_asset",
  "prepare_web_reference_asset",
  "generate_candidate_from_content_proposal",
  "generate_image_candidate",
  "deposit_worksheet"
]);

const RETIRED_LEGACY_WORKFLOW_COMMANDS = new Set([
  "select_candidate",
  "prepare_export"
]);

function commandById(workspace = {}, commandId) {
  return (workspace.commands || []).find((command) => command.id === commandId) || null;
}

function enabledCommand(workspace = {}, commandId) {
  const command = commandById(workspace, commandId);
  return command?.enabled ? command : null;
}

function isEnabledWorkflowCommand(command) {
  return Boolean(command?.enabled && SAFE_WORKFLOW_COMMANDS.has(command.id));
}

function workflowCommandPayload(command = {}) {
  if (command.payload) {
    return command.payload;
  }
  if (command.defaultPayload) {
    return command.defaultPayload;
  }
  if (command.defaultCandidateId) {
    return { candidateId: command.defaultCandidateId };
  }
  return {};
}

function imageSpecContentMirrorId(imageSpec = null) {
  return imageSpec?.source?.currentContentMirrorId
    || imageSpec?.data?.source?.currentContentMirrorId
    || null;
}

function deriveWorkflowFacts(workspace = {}) {
  const currentConceptId = workspace.artifacts?.currentContent?.id
    || workspace.documents?.content?.artifactId
    || null;
  const activeImageSpec = workspace.proposals?.activeImageSpec || null;
  const latestImageSpec = workspace.proposals?.latestImageSpec || null;
  const hasBrief = Boolean(workspace.documents?.brief?.data || workspace.artifacts?.currentBrief || workspace.documents?.brief?.artifactId);
  const hasContent = Boolean(workspace.documents?.content?.data || workspace.artifacts?.currentContent || workspace.documents?.content?.artifactId);
  const hasCurrentCandidate = Boolean(workspace.latestRun?.candidateCount);
  const hasAnyCandidate = Boolean(workspace.latestRun?.rawCandidateCount || workspace.latestRun?.manifest?.candidates?.length);
  const hasUnselectedCurrentCandidate = workspace.latestRun?.hasUnselectedCurrentCandidate === true;

  return {
    version: WORKFLOW_STATE_VERSION,
    projectId: workspace.project?.projectId || null,
    projectType: workspace.project?.projectType || null,
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
    latestCurrentCandidateId: workspace.latestRun?.latestCurrentCandidateId || null,
    hasUnselectedCurrentCandidate,
    hasCurrentSelection: false,
    hasAnySelection: false,
    selectedConceptId: null,
    selectionIsCurrent: true,
    hasOutdatedSelection: false,
    hasCurrentExport: false,
    hasAnyExport: false,
    exportCount: 0,
    rawExportCount: 0,
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
    payload: workflowCommandPayload(command),
    requiresConfirmation: command.requiresConfirmation === true,
    confirmationKind: command.confirmationKind || null,
    confirmationTitle: command.confirmationTitle || null,
    confirmationMessage: command.confirmationMessage || null,
    confirmationAcceptLabel: command.confirmationAcceptLabel || null,
    decisionPrompt: command.decisionPrompt || null,
    decisionLabel: command.decisionLabel || null,
    imageProviders: command.imageProviders || null,
    referencePolicy: command.referencePolicy || null,
    referencePreflight: command.referencePreflight === true,
    reason: command.reason || null,
    shownBecause,
    source: WORKFLOW_STATE_VERSION,
    ...meta
  };
}

function referenceCanBeSkipped(command = null) {
  const policy = command?.referencePolicy || {};
  return policy.canProceedWithoutReference !== false;
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
    && !approveContentCommand;
  const primaryCandidates = [
    ...(facts.hasOpenContentProposal
      ? [{ id: "adopt_content_mirror_proposal", shownBecause: "open_concept_revision" }]
      : []),
    ...(facts.hasOpenLessonBriefProposal && !facts.hasBrief && !facts.hasContent
      ? [{ id: "adopt_lessonbrief_proposal", shownBecause: "open_lessonbrief_proposal" }]
      : []),
    ...(facts.hasOpenWarningsProposal
      ? [{ id: "adopt_content_warnings_proposal", shownBecause: "open_content_warnings_proposal" }]
      : []),
    ...((facts.hasOpenImageSpecProposal || facts.hasActiveImageSpec) && !facts.hasCurrentCandidate
      ? [
        { id: "prepare_reference_asset", shownBecause: "reference_asset_required_or_recommended" },
        { id: "prepare_web_reference_asset", shownBecause: "web_reference_required_or_recommended" }
      ]
      : []),
    ...(facts.hasOpenImageSpecProposal
      ? [{ id: "adopt_image_spec", shownBecause: "open_image_spec_proposal" }]
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
    ...(facts.hasCurrentCandidate
      ? [{
        id: "deposit_worksheet",
        shownBecause: facts.hasUnselectedCurrentCandidate
          ? "new_candidate_variant_ready_for_worksheet_deposit"
          : "candidate_ready_for_worksheet_deposit"
      }]
      : []),
    ...(facts.currentConceptApproved
      ? [{
        id: "generate_image_candidate",
        shownBecause: facts.hasCurrentCandidate
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
  if (primary.command === "deposit_worksheet") {
    const candidateCommand = enabledCommand(workspace, "generate_image_candidate");
    if (candidateCommand) {
      actions.push(actionFromCommand(candidateCommand, "alternative_candidate_variant"));
    }
  }
  if (
    primary.command === "prepare_image_spec"
    && referenceCanBeSkipped(commandById(workspace, primary.command))
  ) {
    const candidateCommand = enabledCommand(workspace, "generate_image_candidate");
    if (candidateCommand) {
      actions.push(actionFromCommand(candidateCommand, "image_spec_preflight_can_be_completed_inline"));
    }
  }
  const referenceCommand = enabledCommand(workspace, "prepare_reference_asset")
    || enabledCommand(workspace, "prepare_web_reference_asset");
  if (
    referenceCommand
    && !actions.some((action) => (action.command || action.id) === referenceCommand.id)
  ) {
    actions.push(actionFromCommand(referenceCommand, "reference_available_for_next_variant"));
  }
  if (["prepare_reference_asset", "prepare_web_reference_asset"].includes(primary.command)) {
    const adoptCommand = enabledCommand(workspace, "adopt_image_spec");
    if (adoptCommand) {
      actions.push(actionFromCommand(adoptCommand, "adopt_image_spec_without_reference"));
    }
  }
  if (
    ["prepare_reference_asset", "prepare_web_reference_asset"].includes(primary.command)
    && referenceCanBeSkipped(commandById(workspace, primary.command))
  ) {
    const candidateCommand = enabledCommand(workspace, "generate_image_candidate");
    if (candidateCommand) {
      actions.push(actionFromCommand(candidateCommand, "reference_can_be_skipped_or_already_satisfied"));
    }
  }
  return actions;
}

function summarizeActions(actions = []) {
  return actions.map((action) => ({
    id: action.id,
    command: action.command,
    label: action.label,
    shownBecause: action.shownBecause,
    payload: action.payload || {},
    requiresConfirmation: action.requiresConfirmation === true,
    confirmationKind: action.confirmationKind || null,
    reason: action.reason || null
  }));
}

function visibleCommandsFromActions(actions = []) {
  return actions.map((action) => ({
    id: action.command || action.id,
    command: action.command || action.id,
    label: action.label,
    enabled: true,
    defaultPayload: action.payload || {},
    payload: action.payload || {},
    requiresConfirmation: action.requiresConfirmation === true,
    confirmationKind: action.confirmationKind || null,
    confirmationTitle: action.confirmationTitle || null,
    confirmationMessage: action.confirmationMessage || null,
    confirmationAcceptLabel: action.confirmationAcceptLabel || null,
    decisionPrompt: action.decisionPrompt || null,
    decisionLabel: action.decisionLabel || null,
    imageProviders: action.imageProviders || null,
    referencePolicy: action.referencePolicy || null,
    referencePreflight: action.referencePreflight === true,
    reason: action.reason || null,
    shownBecause: action.shownBecause || null,
    source: action.source || WORKFLOW_STATE_VERSION
  }));
}

function materializedVisibleCommands(workspace = {}) {
  if (!Array.isArray(workspace.visibleCommands)) {
    return null;
  }
  const commands = workspace.visibleCommands.filter((command) => command && command.source === WORKFLOW_STATE_VERSION);
  return commands.length === workspace.visibleCommands.length ? commands : null;
}

function visibleWorkflowCommands(workspace = {}) {
  const visibleCommands = materializedVisibleCommands(workspace);
  if (visibleCommands) {
    return visibleCommands;
  }
  const actions = Array.isArray(workspace.workflowActions)
    ? workspace.workflowActions
    : deriveWorkflowActions(workspace);
  return visibleCommandsFromActions(actions);
}

function workflowActionSummaries(workspace = {}) {
  return summarizeActions(deriveWorkflowActions(workspace));
}

function validateWorkflowCommand(workspace = {}, commandId, payload = {}) {
  const facts = deriveWorkflowFacts(workspace);
  const command = commandById(workspace, commandId);
  const enabled = enabledCommand(workspace, commandId);

  if (RETIRED_LEGACY_WORKFLOW_COMMANDS.has(commandId)) {
    return {
      ok: false,
      reason: "Legacy-Auswahl und Legacy-Export sind im MVP kein Produktionspfad mehr. Entwürfe werden direkt als Arbeitsblatt abgelegt."
    };
  }
  if (!command || !SAFE_WORKFLOW_COMMANDS.has(commandId)) {
    return {
      ok: false,
      reason: `Unsupported workflow command: ${commandId}`
    };
  }
  if (!enabled) {
    if (commandId === "deposit_worksheet" && !facts.hasCurrentCandidate) {
      return {
        ok: false,
        reason: facts.hasAnyCandidate
          ? "Die vorhandenen Entwurf gehören zu einem älteren Konzeptstand."
          : "Es gibt noch keinen aktuellen Entwurf mit Seiten."
      };
    }
    return {
      ok: false,
      reason: command.reason || `Workflow command is not enabled: ${commandId}`
    };
  }
  if (!GUARDED_WORKFLOW_COMMANDS.has(commandId)) {
    return { ok: true };
  }
  if (commandId === "deposit_worksheet" && !facts.hasCurrentCandidate) {
    return {
      ok: false,
      reason: facts.hasAnyCandidate
        ? "Die vorhandenen Entwurf gehören zu einem älteren Konzeptstand."
        : "Es gibt noch keinen aktuellen Entwurf mit Seiten."
    };
  }
  if (commandId === "activate_content_mirror_version") {
    const requestedConceptId = payload.contentMirrorId || payload.conceptId || null;
    const requestedVersion = Number(payload.conceptVersion || payload.version || 0) || null;
    const concepts = Array.isArray(workspace.artifacts?.concepts) ? workspace.artifacts.concepts : [];
    const target = concepts.find((concept) => {
      return (requestedConceptId && concept.id === requestedConceptId)
        || (requestedVersion && Number(concept.version || 0) === requestedVersion);
    });
    if (!target) {
      return {
        ok: false,
        reason: "Bitte die gewünschte Konzeptversion explizit auswählen."
      };
    }
    if (!["approved", "draft"].includes(target.status)) {
      return {
        ok: false,
        reason: "Diese Konzeptversion kann nicht als Arbeitsstand übernommen werden."
      };
    }
  }
  if (
    ["generate_candidate_from_content_proposal", "adopt_content_mirror_proposal"].includes(commandId)
    && !payload.proposalId
  ) {
    return {
      ok: false,
      reason: "Bitte den aktuellen Konzeptvorschlag explizit auswaehlen."
    };
  }
  if (commandId === "adopt_image_spec" && !payload.proposalId) {
    return {
      ok: false,
      reason: "Bitte die aktuelle Entwurfsvorbereitung explizit auswaehlen."
    };
  }
  if (commandId === "generate_image_candidate" && !facts.currentConceptApproved) {
    return {
      ok: false,
      reason: "Arbeitsblatt-Konzept ist noch nicht freigegeben."
    };
  }
  return { ok: true };
}

module.exports = {
  WORKFLOW_STATE_VERSION,
  deriveWorkflowActions,
  deriveWorkflowFacts,
  isEnabledWorkflowCommand,
  summarizeActions,
  validateWorkflowCommand,
  visibleWorkflowCommands,
  workflowActionSummaries,
  workflowCommandPayload
};
