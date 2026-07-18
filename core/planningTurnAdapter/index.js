"use strict";

const {
  AMBIGUITY_LEVELS,
  INTENTS,
  TARGET_KINDS,
  normalizeChatIntent
} = require("../chatIntentInterpreter");
const {
  candidateCreationHoldIntent,
  conceptCreationHoldIntent,
  proposalAdoptionHoldIntent,
  workflowActionStopIntent
} = require("../chatIntentSignals");

const REQUESTED_ACTIONS = Object.freeze({
  NONE: "none",
  CREATE_CONCEPT: "create_concept",
  CREATE_CONCEPT_THEN_DRAFT: "create_concept_then_draft",
  REVISE_CONCEPT: "revise_concept",
  REVISE_CONCEPT_THEN_DRAFT: "revise_concept_then_draft",
  PREPARE_DRAFT: "prepare_draft",
  ADOPT_CONCEPT: "adopt_concept",
  ADOPT_CONCEPT_THEN_DRAFT: "adopt_concept_then_draft",
  ACTIVATE_CONCEPT_VERSION: "activate_concept_version",
  ACTIVATE_CONCEPT_VERSION_THEN_DRAFT: "activate_concept_version_then_draft",
  SKIP_REFERENCE: "skip_reference"
});

const ACTION_TO_INTENT = Object.freeze({
  [REQUESTED_ACTIONS.CREATE_CONCEPT]: INTENTS.CREATE_NEW_CONCEPT_FROM_CONTEXT,
  [REQUESTED_ACTIONS.CREATE_CONCEPT_THEN_DRAFT]: INTENTS.CREATE_NEW_CONCEPT_FROM_CONTEXT,
  [REQUESTED_ACTIONS.REVISE_CONCEPT]: INTENTS.CONCEPT_REVISION,
  [REQUESTED_ACTIONS.REVISE_CONCEPT_THEN_DRAFT]: INTENTS.CONCEPT_REVISION,
  [REQUESTED_ACTIONS.PREPARE_DRAFT]: INTENTS.CANDIDATE_GENERATION,
  [REQUESTED_ACTIONS.ADOPT_CONCEPT]: INTENTS.CONTENT_PROPOSAL_ADOPTION,
  [REQUESTED_ACTIONS.ADOPT_CONCEPT_THEN_DRAFT]: INTENTS.CONTENT_PROPOSAL_ADOPTION_CANDIDATE_CHAIN,
  [REQUESTED_ACTIONS.ACTIVATE_CONCEPT_VERSION]: INTENTS.CONCEPT_VERSION_ACTIVATION,
  [REQUESTED_ACTIONS.ACTIVATE_CONCEPT_VERSION_THEN_DRAFT]: INTENTS.CONCEPT_VERSION_ACTIVATION,
  [REQUESTED_ACTIONS.SKIP_REFERENCE]: INTENTS.SKIP_REFERENCE
});

function normalizedEvidence(value) {
  return String(value || "").replace(/\s+/g, " ").trim().toLocaleLowerCase("de");
}

function evidenceAppearsInMessage(evidence, message) {
  const needle = normalizedEvidence(evidence);
  const haystack = normalizedEvidence(message);
  return Boolean(needle && haystack && haystack.includes(needle));
}

function noActionIntentForGoal(goal) {
  if (["brainstorm", "develop_component"].includes(goal)) {
    return INTENTS.BRAINSTORM;
  }
  if (["answer", "critique"].includes(goal)) {
    return INTENTS.QUESTION;
  }
  return INTENTS.NONE;
}

function deicticActionStopIntent(message = "") {
  const text = String(message || "").trim();
  return /(?:^|[.!?]\s*)(?:mach|mache|tu|tue)\s+(?:das|es)(?:\s+bitte)?\s+(?:doch\s+)?nicht\b/i.test(text)
    || /\b(?:doch\s+nicht|nicht\s+ausf(?:ü|ue)hren)\s*[.!?]*$/i.test(text);
}

function actionBlockedByHardGuard(action, message) {
  if (action === REQUESTED_ACTIONS.NONE) {
    return null;
  }
  if (workflowActionStopIntent(message)) {
    return "global_action_stop";
  }
  if (deicticActionStopIntent(message)) {
    return "deictic_action_stop";
  }
  if (
    [REQUESTED_ACTIONS.CREATE_CONCEPT, REQUESTED_ACTIONS.CREATE_CONCEPT_THEN_DRAFT].includes(action)
    && conceptCreationHoldIntent(message)
  ) {
    return "concept_creation_hold";
  }
  if (
    [
      REQUESTED_ACTIONS.PREPARE_DRAFT,
      REQUESTED_ACTIONS.CREATE_CONCEPT_THEN_DRAFT,
      REQUESTED_ACTIONS.REVISE_CONCEPT_THEN_DRAFT,
      REQUESTED_ACTIONS.ADOPT_CONCEPT_THEN_DRAFT,
      REQUESTED_ACTIONS.ACTIVATE_CONCEPT_VERSION_THEN_DRAFT,
      REQUESTED_ACTIONS.SKIP_REFERENCE
    ].includes(action)
    && candidateCreationHoldIntent(message)
  ) {
    return "draft_creation_hold";
  }
  if (
    [REQUESTED_ACTIONS.ADOPT_CONCEPT, REQUESTED_ACTIONS.ADOPT_CONCEPT_THEN_DRAFT].includes(action)
    && proposalAdoptionHoldIntent(message)
  ) {
    return "proposal_adoption_hold";
  }
  return null;
}

function actionAuthorizationError(turn = {}, message = "") {
  if (turn.requestedAction === REQUESTED_ACTIONS.NONE) {
    return null;
  }
  const authorization = turn.actionAuthorization || {};
  if (turn.confidence !== "high") {
    return "action_confidence_not_high";
  }
  if (authorization.explicit !== true || authorization.source !== "explicit_message") {
    return "action_not_explicitly_authorized";
  }
  if (!evidenceAppearsInMessage(authorization.evidence, message)) {
    return "authorization_evidence_not_in_latest_message";
  }
  const negatedActions = new Set(turn.negatedActions || []);
  if (negatedActions.has("all") || negatedActions.has(turn.requestedAction)) {
    return "requested_action_is_negated";
  }
  return actionBlockedByHardGuard(turn.requestedAction, message);
}

function normalizedTarget(turn = {}) {
  const target = turn.target || {};
  return {
    kind: Object.values(TARGET_KINDS).includes(target.kind) ? target.kind : TARGET_KINDS.NONE,
    conceptVersion: target.conceptVersion || null,
    proposalId: target.proposalId || null,
    contentMirrorId: target.contentMirrorId || null,
    runId: target.runId || null,
    candidateId: target.candidateId || null,
    commandId: null,
    page: target.page || null
  };
}

function explicitRevisionTargetForAction(turn = {}, revisionTarget = null) {
  if (
    !revisionTarget
    || typeof revisionTarget !== "object"
    || revisionTarget.source !== "explicit"
    || !["concept", "draft"].includes(revisionTarget.kind)
  ) {
    return null;
  }
  if (![
    REQUESTED_ACTIONS.REVISE_CONCEPT,
    REQUESTED_ACTIONS.REVISE_CONCEPT_THEN_DRAFT,
    REQUESTED_ACTIONS.PREPARE_DRAFT
  ].includes(turn.requestedAction)) {
    return null;
  }
  const modelTarget = normalizedTarget(turn);
  if (modelTarget.kind === TARGET_KINDS.CONCEPT_VERSION && modelTarget.conceptVersion) {
    return null;
  }
  if (
    modelTarget.kind === TARGET_KINDS.DRAFT
    && modelTarget.candidateId
    && (
      revisionTarget.kind !== "draft"
      || (revisionTarget.candidateId && revisionTarget.candidateId !== modelTarget.candidateId)
    )
  ) {
    return null;
  }
  if (
    modelTarget.kind === TARGET_KINDS.CONTENT_PROPOSAL
    && modelTarget.proposalId
    && (
      revisionTarget.kind !== "concept"
      || (revisionTarget.proposalId && revisionTarget.proposalId !== modelTarget.proposalId)
    )
  ) {
    return null;
  }
  if (
    modelTarget.kind === TARGET_KINDS.CURRENT_CONCEPT
    && modelTarget.contentMirrorId
    && (
      revisionTarget.kind !== "concept"
      || (revisionTarget.contentMirrorId && revisionTarget.contentMirrorId !== modelTarget.contentMirrorId)
    )
  ) {
    return null;
  }
  return revisionTarget;
}

function targetFromRevisionTarget(revisionTarget = null, fallback = {}) {
  if (revisionTarget?.kind === "concept") {
    const proposalId = revisionTarget.proposalId || fallback.proposalId || null;
    const contentMirrorId = revisionTarget.contentMirrorId || fallback.contentMirrorId || null;
    return {
      kind: proposalId ? TARGET_KINDS.CONTENT_PROPOSAL : TARGET_KINDS.CURRENT_CONCEPT,
      conceptVersion: revisionTarget.conceptVersion || fallback.conceptVersion || null,
      proposalId,
      contentMirrorId,
      runId: null,
      candidateId: null,
      commandId: null,
      page: null
    };
  }
  if (revisionTarget?.kind === "draft") {
    return {
      kind: TARGET_KINDS.DRAFT,
      conceptVersion: null,
      proposalId: null,
      contentMirrorId: null,
      runId: revisionTarget.runId || fallback.runId || null,
      candidateId: revisionTarget.candidateId || fallback.candidateId || null,
      commandId: null,
      page: revisionTarget.page || fallback.page || null
    };
  }
  return fallback;
}

function intentFromPlanningTurn(turn = {}, message = "", options = {}) {
  const action = turn.requestedAction || REQUESTED_ACTIONS.NONE;
  const revisionTarget = explicitRevisionTargetForAction(turn, options.revisionTarget);
  const intentName = ACTION_TO_INTENT[action] || noActionIntentForGoal(turn.responseGoal);
  const compoundDraftActions = new Set([
    REQUESTED_ACTIONS.CREATE_CONCEPT_THEN_DRAFT,
    REQUESTED_ACTIONS.REVISE_CONCEPT_THEN_DRAFT,
    REQUESTED_ACTIONS.ADOPT_CONCEPT_THEN_DRAFT,
    REQUESTED_ACTIONS.ACTIVATE_CONCEPT_VERSION_THEN_DRAFT
  ]);
  const draftChainRequested = compoundDraftActions.has(action)
    && !(turn.negatedActions || []).includes(REQUESTED_ACTIONS.PREPARE_DRAFT)
    && !candidateCreationHoldIntent(message);
  const wantsCandidate = action === REQUESTED_ACTIONS.PREPARE_DRAFT
    || action === REQUESTED_ACTIONS.ADOPT_CONCEPT_THEN_DRAFT
    || draftChainRequested;
  const wantsAdoption = [
    REQUESTED_ACTIONS.ADOPT_CONCEPT,
    REQUESTED_ACTIONS.ADOPT_CONCEPT_THEN_DRAFT,
    REQUESTED_ACTIONS.ACTIVATE_CONCEPT_VERSION_THEN_DRAFT
  ].includes(action);
  const intent = normalizeChatIntent({
    intent: intentName,
    confidence: turn.confidence || "low",
    target: targetFromRevisionTarget(revisionTarget, normalizedTarget(turn)),
    revisionTarget,
    wantsCandidate,
    wantsAdoption,
    wantsContentChange: [REQUESTED_ACTIONS.REVISE_CONCEPT, REQUESTED_ACTIONS.REVISE_CONCEPT_THEN_DRAFT].includes(action),
    isQuestion: action === REQUESTED_ACTIONS.NONE && ["answer", "critique"].includes(turn.responseGoal),
    chainRequested: draftChainRequested,
    ambiguity: turn.ambiguity || { level: AMBIGUITY_LEVELS.NONE, reasons: [] },
    source: "model",
    reason: turn.reason || null,
    sourceMessage: message
  }, message);
  return {
    ...intent,
    planningFlow: "v2",
    responseGoal: turn.responseGoal || null,
    requestedAction: action,
    actionAuthorization: turn.actionAuthorization || null,
    negatedActions: turn.negatedActions || [],
    planningReadiness: turn.readiness || null,
    planningHandoff: turn.actionHandoff || null
  };
}

function planningTurnDecision(turn = {}, message = "", options = {}) {
  const authorizationError = actionAuthorizationError(turn, message);
  if (authorizationError) {
    return {
      ok: false,
      reason: authorizationError,
      turn
    };
  }
  const modelIntent = intentFromPlanningTurn(turn, message);
  const intent = intentFromPlanningTurn(turn, message, {
    revisionTarget: options.revisionTarget || null
  });
  const explicitTargetBound = Boolean(intent.revisionTarget);
  return {
    ok: true,
    intent,
    decision: {
      schemaVersion: 2,
      intent,
      semanticSource: "planning_turn",
      finalSource: "model",
      guardApplied: explicitTargetBound,
      guardCategory: explicitTargetBound ? "state_guard" : "semantic_hint",
      deterministicGuardCategory: explicitTargetBound ? "state_guard" : "hard_guard",
      reason: explicitTargetBound
        ? "planning_turn_explicit_revision_target_bound"
        : turn.requestedAction === REQUESTED_ACTIONS.NONE
          ? "planning_turn_chat_only"
          : "planning_turn_action_authorized",
      deterministicGuard: explicitTargetBound ? intent : null,
      modelIntent,
      planningTurn: turn
    }
  };
}

module.exports = {
  REQUESTED_ACTIONS,
  actionAuthorizationError,
  evidenceAppearsInMessage,
  planningTurnDecision
};
