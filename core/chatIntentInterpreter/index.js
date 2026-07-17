"use strict";

const { getAiRuntimeStatus, getOpenAiRequestConfig } = require("../aiConfig");
const { createResponse, extractOutputText } = require("../openaiClient");
const { logModelRun, sanitizeErrorMessage } = require("../modelRunLogger");
const { estimateOpenAiTextCost } = require("../imageCostManager");
const { measureModelRequest } = require("../modelRequestMetrics");
const { ROUTE_PURPOSES, routeForPurpose } = require("../modelRouter");
const {
  adoptionIntent,
  adviceQuestionIntent,
  brainstormingIntent,
  candidateCreationHoldIntent,
  candidateGenerationIntent,
  conceptCreationHoldIntent,
  conceptDesignRevisionIntent,
  conceptVersionActionIntent,
  conceptVersionTarget,
  conditionalNoOpCheckIntent,
  contentChangeIntent,
  directContextConceptRequestIntent,
  explicitWorksheetDepositIntent,
  explicitConceptTargetIntent,
  hasCandidateContext,
  newConceptFromContextIntent,
  newConceptWithDesignReferenceIntent,
  normalizeText,
  pdfExportIntent,
  proposalAdoptionHoldIntent,
  questionIntent,
  selectionAsVisualReferenceIntent,
  selectionIntent,
  skipReferenceIntent,
  visualCandidateFeedbackIntent,
  workflowActionStopIntent,
  workflowCreationHoldIntent
} = require("../chatIntentSignals");

const INTENTS = Object.freeze({
  NONE: "none",
  QUESTION: "question",
  BRAINSTORM: "brainstorm",
  CANDIDATE_GENERATION: "candidate_generation",
  CONCEPT_VERSION_ACTIVATION: "concept_version_activation",
  CONTENT_PROPOSAL_ADOPTION: "content_proposal_adoption",
  CONTENT_PROPOSAL_ADOPTION_CANDIDATE_CHAIN: "content_proposal_adoption_candidate_chain",
  CREATE_NEW_CONCEPT_FROM_CONTEXT: "create_new_concept_from_context",
  CONCEPT_REVISION: "concept_revision",
  SKIP_REFERENCE: "skip_reference",
  PDF_EXPORT: "pdf_export",
  SELECTION: "selection"
});

const VALID_INTENTS = new Set(Object.values(INTENTS));
const VALID_CONFIDENCE = new Set(["low", "medium", "high"]);
const REVISION_TARGET_KINDS = new Set(["concept", "draft"]);
const RISK_LEVELS = Object.freeze({
  NONE: "none",
  SAFE: "safe",
  WORKFLOW_WRITE: "workflow_write",
  PAID: "paid"
});
const EXECUTION_POLICIES = Object.freeze({
  NONE: "none",
  ASK_CLARIFICATION: "ask_clarification",
  OFFER_ACTION: "offer_action",
  AUTO_EXECUTE: "auto_execute",
  AUTO_OPEN_CONFIRMATION: "auto_open_confirmation",
  AUTO_EXECUTE_THEN_CONFIRMATION: "auto_execute_then_confirmation"
});
const TARGET_BASES = Object.freeze({
  NONE: "none",
  CURRENT_CONCEPT: "current_concept",
  CONCEPT_VERSION: "concept_version",
  CONTENT_PROPOSAL: "content_proposal",
  CANDIDATE: "candidate",
  PDF: "pdf"
});
const TARGET_KINDS = Object.freeze({
  NONE: "none",
  CURRENT_CONCEPT: "current_concept",
  CONCEPT_VERSION: "concept_version",
  CONTENT_PROPOSAL: "content_proposal",
  DRAFT: "draft",
  LATEST_OFFER: "latest_offer",
  PDF: "pdf"
});
const AMBIGUITY_LEVELS = Object.freeze({
  NONE: "none",
  LOW: "low",
  MEDIUM: "medium",
  HIGH: "high"
});
const VALID_AMBIGUITY_LEVELS = new Set(Object.values(AMBIGUITY_LEVELS));
const GUARD_CATEGORIES = Object.freeze({
  HARD: "hard_guard",
  STATE: "state_guard",
  SEMANTIC: "semantic_hint"
});
const MAX_MESSAGE_LENGTH = 800;
const LOCAL_ROUTABLE_INTENTS = new Set([
  INTENTS.CANDIDATE_GENERATION,
  INTENTS.CONCEPT_VERSION_ACTIVATION,
  INTENTS.CONTENT_PROPOSAL_ADOPTION,
  INTENTS.CONTENT_PROPOSAL_ADOPTION_CANDIDATE_CHAIN,
  INTENTS.CREATE_NEW_CONCEPT_FROM_CONTEXT,
  INTENTS.CONCEPT_REVISION,
  INTENTS.SKIP_REFERENCE
]);

function textValue(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function explicitRevisionTarget(input = {}) {
  const target = input.revisionTarget && typeof input.revisionTarget === "object"
    ? input.revisionTarget
    : null;
  if (!target || target.source !== "explicit" || !REVISION_TARGET_KINDS.has(target.kind)) {
    return null;
  }
  return target;
}

function normalizeRevisionTarget(value = null) {
  if (!value || typeof value !== "object" || !REVISION_TARGET_KINDS.has(value.kind)) {
    return null;
  }
  const base = {
    source: value.source === "inferred" ? "inferred" : "explicit",
    kind: value.kind,
    label: textValue(value.label).slice(0, 80) || null,
    projectId: textValue(value.projectId).slice(0, 160) || null
  };
  if (value.kind === "concept") {
    const conceptVersion = Number(value.conceptVersion || 0) || null;
    return {
      ...base,
      proposalId: textValue(value.proposalId).slice(0, 160) || null,
      contentMirrorId: textValue(value.contentMirrorId || value.conceptId).slice(0, 160) || null,
      conceptVersion: Number.isInteger(conceptVersion) && conceptVersion > 0 ? conceptVersion : null,
      elementId: textValue(value.elementId).slice(0, 160) || null,
      elementType: textValue(value.elementType).slice(0, 40) || null,
      elementLabel: textValue(value.elementLabel).slice(0, 120) || null,
      elementPage: Number.isInteger(Number(value.elementPage)) && Number(value.elementPage) > 0
        ? Number(value.elementPage)
        : null
    };
  }
  const page = Number(value.page || 0) || null;
  return {
    ...base,
    runId: textValue(value.runId).slice(0, 160) || null,
    candidateId: textValue(value.candidateId).slice(0, 160) || null,
    page: Number.isInteger(page) && page > 0 ? page : null
  };
}

function candidateCreatedAtValue(candidate = {}) {
  return candidate.createdAt
    || candidate.generation?.createdAt
    || candidate.pages?.[0]?.metadata?.createdAt
    || "";
}

function sortedCandidateTargets(workspace = {}) {
  const candidates = Array.isArray(workspace.artifacts?.candidates)
    ? workspace.artifacts.candidates
    : workspace.preview?.candidates || [];
  return candidates
    .filter((candidate) => (candidate.pages || []).length > 0)
    .map((candidate, index) => ({ candidate, index }))
    .sort((left, right) => {
      return String(candidateCreatedAtValue(left.candidate)).localeCompare(String(candidateCreatedAtValue(right.candidate)))
        || String(left.candidate.runId || "").localeCompare(String(right.candidate.runId || ""))
        || String(left.candidate.id || "").localeCompare(String(right.candidate.id || ""))
        || left.index - right.index;
    })
    .map((entry, index) => ({
      ...entry.candidate,
      displayNumber: index + 1
    }));
}

function candidateNumberTarget(message) {
  const text = normalizeText(message);
  const match = text.match(/\b(?:entwurf|kandidat|candidate|bundle|variante)\s*0*(\d+)\b/);
  return match ? Number(match[1]) || null : null;
}

function inferredDraftRevisionTarget(workspace = {}, message = "") {
  const targetNumber = candidateNumberTarget(message);
  if (!targetNumber) {
    return null;
  }
  const candidate = sortedCandidateTargets(workspace)
    .find((entry) => entry.displayNumber === targetNumber) || null;
  return candidate ? {
    source: "inferred",
    kind: "draft",
    label: `Entwurf ${targetNumber}`,
    projectId: workspace.project?.projectId || null,
    runId: candidate.runId || null,
    candidateId: candidate.id || null
  } : null;
}

function messageOverridesExplicitRevisionTarget(workspace = {}, message = "") {
  if (inferredDraftRevisionTarget(workspace, message)) {
    return true;
  }
  const targetVersion = conceptVersionTarget(message);
  return Boolean(targetVersion && conceptVersionActionIntent(message));
}

function configuredChatIntentInterpreterEnabled(options = {}, env = process.env) {
  if (options.chatIntentInterpreter === true) {
    return true;
  }
  if (options.chatIntentInterpreter === false) {
    return false;
  }
  const value = String(env.SHEETIFYIMG_CHAT_INTENT_INTERPRETER || "").trim().toLowerCase();
  return ["1", "true", "on", "ai", "openai", "auto"].includes(value);
}

function usableApiKey(value) {
  const text = String(value || "").trim();
  return Boolean(text) && !/test-no-network|dummy|fake|placeholder|sk-test/i.test(text);
}

function chatIntentInterpreterAvailable(options = {}, env = process.env) {
  if (!configuredChatIntentInterpreterEnabled(options, env)) {
    return false;
  }
  const runtime = getAiRuntimeStatus(env);
  return runtime.status === "ready" && usableApiKey(env.OPENAI_API_KEY);
}

function hasOpenContentProposal(workspace = {}) {
  return Boolean(workspace.proposals?.latestContentMirror);
}

function enumValue(value, validValues, fallback) {
  return validValues.has(value) ? value : fallback;
}

function ambiguityRank(level) {
  const ranks = {
    none: 0,
    low: 1,
    medium: 2,
    high: 3
  };
  return ranks[level] ?? 0;
}

function maxAmbiguity(first, second) {
  return ambiguityRank(first) >= ambiguityRank(second) ? first : second;
}

function inferTargetBasis(intent, target = {}) {
  if (target.kind === TARGET_KINDS.DRAFT || target.revisionTarget?.kind === "draft") {
    return TARGET_BASES.CANDIDATE;
  }
  if (target.kind === TARGET_KINDS.CONTENT_PROPOSAL || target.revisionTarget?.proposalId) {
    return TARGET_BASES.CONTENT_PROPOSAL;
  }
  if (target.kind === TARGET_KINDS.CURRENT_CONCEPT || target.revisionTarget?.kind === "concept") {
    return TARGET_BASES.CURRENT_CONCEPT;
  }
  if (target.kind === TARGET_KINDS.CONCEPT_VERSION || intent === INTENTS.CONCEPT_VERSION_ACTIVATION) {
    return TARGET_BASES.CONCEPT_VERSION;
  }
  if (
    intent === INTENTS.CONTENT_PROPOSAL_ADOPTION
    || intent === INTENTS.CONTENT_PROPOSAL_ADOPTION_CANDIDATE_CHAIN
    || target.proposalId
  ) {
    return TARGET_BASES.CONTENT_PROPOSAL;
  }
  if (intent === INTENTS.SELECTION) {
    return TARGET_BASES.CANDIDATE;
  }
  if (target.kind === TARGET_KINDS.PDF || intent === INTENTS.PDF_EXPORT) {
    return TARGET_BASES.PDF;
  }
  if ([INTENTS.CANDIDATE_GENERATION, INTENTS.CREATE_NEW_CONCEPT_FROM_CONTEXT, INTENTS.CONCEPT_REVISION, INTENTS.SKIP_REFERENCE].includes(intent)) {
    return TARGET_BASES.CURRENT_CONCEPT;
  }
  return TARGET_BASES.NONE;
}

function inferRiskLevel(intent, flags = {}) {
  if ([INTENTS.NONE, INTENTS.QUESTION, INTENTS.BRAINSTORM].includes(intent)) {
    return RISK_LEVELS.NONE;
  }
  if (intent === INTENTS.CANDIDATE_GENERATION || intent === INTENTS.SKIP_REFERENCE || flags.wantsCandidate) {
    return RISK_LEVELS.PAID;
  }
  if ([
    INTENTS.CONCEPT_VERSION_ACTIVATION,
    INTENTS.CONTENT_PROPOSAL_ADOPTION,
    INTENTS.CONTENT_PROPOSAL_ADOPTION_CANDIDATE_CHAIN,
    INTENTS.CREATE_NEW_CONCEPT_FROM_CONTEXT,
    INTENTS.CONCEPT_REVISION,
    INTENTS.SELECTION,
    INTENTS.PDF_EXPORT
  ].includes(intent)) {
    return RISK_LEVELS.WORKFLOW_WRITE;
  }
  return RISK_LEVELS.SAFE;
}

function normalizeAmbiguity(value = {}, intent, confidence, isQuestion) {
  const object = value && typeof value === "object" ? value : {};
  let level = enumValue(object.level, VALID_AMBIGUITY_LEVELS, AMBIGUITY_LEVELS.NONE);
  if (confidence === "low") {
    level = maxAmbiguity(level, AMBIGUITY_LEVELS.HIGH);
  }
  if (isQuestion && intent !== INTENTS.QUESTION) {
    level = maxAmbiguity(level, AMBIGUITY_LEVELS.MEDIUM);
  }
  const reasons = Array.isArray(object.reasons)
    ? object.reasons.map((reason) => textValue(reason).slice(0, 180)).filter(Boolean).slice(0, 4)
    : [];
  return {
    level,
    reasons
  };
}

function actionableWorkflowQuestionOverride(value = {}, intent, confidence, sourceMessage = "") {
  if (confidence !== "high" || intent !== INTENTS.CREATE_NEW_CONCEPT_FROM_CONTEXT) {
    return false;
  }
  if (value.isQuestion !== true && !questionIntent(sourceMessage)) {
    return false;
  }
  const rawLevel = value.ambiguity && typeof value.ambiguity === "object"
    ? value.ambiguity.level
    : AMBIGUITY_LEVELS.NONE;
  if (rawLevel === AMBIGUITY_LEVELS.HIGH) {
    return false;
  }
  return directContextConceptRequestIntent(sourceMessage);
}

function ambiguityForActionableWorkflowQuestion(value = {}) {
  const object = value && typeof value === "object" ? value : {};
  const level = object.level === AMBIGUITY_LEVELS.NONE ? AMBIGUITY_LEVELS.NONE : AMBIGUITY_LEVELS.LOW;
  const reasons = Array.isArray(object.reasons) ? object.reasons : [];
  return {
    ...object,
    level,
    reasons: [
      ...reasons,
      "Question form treated as an actionable concept request."
    ].slice(0, 4)
  };
}

function inferRequiresConfirmation(intent, riskLevel, flags = {}) {
  return riskLevel === RISK_LEVELS.PAID
    || flags.wantsCandidate === true
    || [INTENTS.CANDIDATE_GENERATION, INTENTS.SKIP_REFERENCE].includes(intent);
}

function isConfidentWorkflowIntent(intent = {}) {
  return Boolean(intent)
    && intent.confidence === "high"
    && ![INTENTS.NONE, INTENTS.QUESTION, INTENTS.BRAINSTORM].includes(intent.intent);
}

function shouldPreferDeterministicIntent(deterministic = {}, interpreted = {}) {
  const sourceMessage = normalizeText(deterministic.sourceMessage || interpreted.sourceMessage || "");
  const guardCategory = deterministicGuardCategory(deterministic, interpreted);
  if (
    interpreted.intent === INTENTS.PDF_EXPORT
    && deterministic.intent !== INTENTS.PDF_EXPORT
    && LOCAL_ROUTABLE_INTENTS.has(deterministic.intent)
    && !pdfExportIntent(sourceMessage)
    && !explicitWorksheetDepositIntent(sourceMessage)
  ) {
    return true;
  }
  const draftNumberReference = /\b(?:entwurf|entwurfe|kandidat|kandidaten|variante)\s*0*\d+\b/.test(sourceMessage);
  const explicitConceptNumberReference = /\b(?:konzept|concept)\s*(?:v|version)?\s*0*\d+\b/.test(sourceMessage)
    || /\bv(?:ersion)?\s*0*\d+\b/.test(sourceMessage);
  if (!interpreted || interpreted.confidence === "low") {
    return guardCategory !== GUARD_CATEGORIES.SEMANTIC && isConfidentWorkflowIntent(deterministic);
  }
  if (proposalAdoptionHoldIntent(sourceMessage) && intentRequiresProposalAdoption(interpreted)) {
    return true;
  }
  if (candidateCreationHoldIntent(sourceMessage) && intentRequiresCandidateGeneration(interpreted)) {
    return true;
  }
  if (conceptCreationHoldIntent(sourceMessage) && intentCreatesNewConcept(interpreted)) {
    return true;
  }
  if (guardCategory === GUARD_CATEGORIES.SEMANTIC) {
    return false;
  }
  if (guardCategory === GUARD_CATEGORIES.HARD) {
    if ([INTENTS.NONE, INTENTS.QUESTION, INTENTS.BRAINSTORM].includes(deterministic.intent)) {
      return true;
    }
    if (
      deterministic.intent === INTENTS.SKIP_REFERENCE
      && interpreted.intent === INTENTS.CANDIDATE_GENERATION
    ) {
      return true;
    }
    return false;
  }
  if (
    deterministic.intent === INTENTS.CANDIDATE_GENERATION
    && (interpreted.intent === INTENTS.CONCEPT_VERSION_ACTIVATION || interpreted.target?.conceptVersion)
    && draftNumberReference
    && !explicitConceptNumberReference
  ) {
    return true;
  }
  if (
    deterministic.intent === INTENTS.CONCEPT_VERSION_ACTIVATION
    && deterministic.target?.conceptVersion
    && explicitConceptNumberReference
  ) {
    return true;
  }
  if (
    deterministic.intent === INTENTS.CONTENT_PROPOSAL_ADOPTION
    && deterministic.target?.kind === TARGET_KINDS.CONTENT_PROPOSAL
    && conceptOnlyAdoptionMessage(sourceMessage)
    && [
      INTENTS.CONCEPT_REVISION,
      INTENTS.CONTENT_PROPOSAL_ADOPTION_CANDIDATE_CHAIN,
      INTENTS.CREATE_NEW_CONCEPT_FROM_CONTEXT
    ].includes(interpreted.intent)
  ) {
    return true;
  }
  if (deterministic.revisionTarget?.source === "explicit") {
    return true;
  }
  if (deterministic.intent === interpreted.intent) {
    if (deterministic.target?.conceptVersion && !interpreted.target?.conceptVersion) {
      return true;
    }
    if (deterministic.target?.candidateId && !interpreted.target?.candidateId) {
      return true;
    }
    if (deterministic.revisionTarget && !interpreted.revisionTarget) {
      return true;
    }
  }
  return false;
}

function assessmentOnlyIntent(message = "") {
  const text = normalizeText(message);
  const asksForAssessment = /\b(?:nur|erstmal|zunaechst|kurz)\b.{0,60}\b(?:sag|sage|sagen|einschaetz|einschaetzen|pruef|pruefen|bewert|bewerten|erklaer|erklaeren)\w*\b/.test(text)
    || /\bob\b.{0,80}\b(?:material|input|quelle|quellen|pdf|bild|bilder|anhang|anhaenge)\b.{0,80}\b(?:reicht|reichen|genug|ausreich|ausreichend|brauchbar|passt|funktioniert)\w*\b/.test(text)
    || /\b(?:material|input|quelle|quellen|pdf|bild|bilder|anhang|anhaenge)\b.{0,80}\b(?:reicht|reichen|genug|ausreich|ausreichend|brauchbar|passt|funktioniert)\w*\b/.test(text);
  if (!asksForAssessment) {
    return false;
  }
  const explicitConceptCreation = /\b(?:erstell|erstelle|mach|mache|formulier|formuliere|generier|generiere|erzeug|erzeuge)\w*\b.{0,80}\b(?:konzept|arbeitsblatt-konzept|arbeitsblatt|projektbogen|folgebogen)\b/.test(text);
  return !explicitConceptCreation;
}

function usableModelIntent(modelIntent = null) {
  return Boolean(modelIntent) && modelIntent.confidence !== "low";
}

function stateGuardTarget(intent = {}) {
  return [
    TARGET_KINDS.CONCEPT_VERSION,
    TARGET_KINDS.CONTENT_PROPOSAL,
    TARGET_KINDS.CURRENT_CONCEPT,
    TARGET_KINDS.DRAFT
  ].includes(intent.target?.kind)
    || [
      TARGET_BASES.CONCEPT_VERSION,
      TARGET_BASES.CONTENT_PROPOSAL,
      TARGET_BASES.CANDIDATE
    ].includes(intent.targetBasis);
}

function intentRequiresProposalAdoption(intent = {}) {
  return [
    INTENTS.CONTENT_PROPOSAL_ADOPTION,
    INTENTS.CONTENT_PROPOSAL_ADOPTION_CANDIDATE_CHAIN
  ].includes(intent.intent)
    || (
      intent.intent === INTENTS.CANDIDATE_GENERATION
      && intent.target?.kind === TARGET_KINDS.CONTENT_PROPOSAL
    );
}

function intentRequiresCandidateGeneration(intent = {}) {
  return intent.wantsCandidate === true
    || [
      INTENTS.CANDIDATE_GENERATION,
      INTENTS.CONTENT_PROPOSAL_ADOPTION_CANDIDATE_CHAIN,
      INTENTS.SKIP_REFERENCE
    ].includes(intent.intent);
}

function intentCreatesNewConcept(intent = {}) {
  return intent.intent === INTENTS.CREATE_NEW_CONCEPT_FROM_CONTEXT;
}

function deterministicGuardCategory(deterministic = {}, interpreted = null) {
  if (!deterministic) {
    return GUARD_CATEGORIES.SEMANTIC;
  }
  const sourceMessage = normalizeText(deterministic.sourceMessage || interpreted?.sourceMessage || "");
  if (proposalAdoptionHoldIntent(sourceMessage) && intentRequiresProposalAdoption(interpreted || {})) {
    return GUARD_CATEGORIES.STATE;
  }
  if (candidateCreationHoldIntent(sourceMessage) && intentRequiresCandidateGeneration(interpreted || {})) {
    return GUARD_CATEGORIES.STATE;
  }
  if (conceptCreationHoldIntent(sourceMessage) && intentCreatesNewConcept(interpreted || {})) {
    return GUARD_CATEGORIES.STATE;
  }
  if (deterministic.intent === INTENTS.NONE) {
    return GUARD_CATEGORIES.SEMANTIC;
  }
  if (
    workflowActionStopIntent(sourceMessage)
    || workflowCreationHoldIntent(sourceMessage)
    || conditionalNoOpCheckIntent(sourceMessage)
  ) {
    return GUARD_CATEGORIES.HARD;
  }
  if (
    deterministic.intent === INTENTS.SKIP_REFERENCE
  ) {
    return GUARD_CATEGORIES.HARD;
  }
  if (
    deterministic.revisionTarget?.source === "explicit"
    || deterministic.target?.kind === TARGET_KINDS.LATEST_OFFER
    || [INTENTS.SELECTION, INTENTS.PDF_EXPORT].includes(deterministic.intent)
    || deterministic.intent === INTENTS.CONCEPT_REVISION
    || deterministic.intent === INTENTS.CANDIDATE_GENERATION
    || deterministic.intent === INTENTS.CREATE_NEW_CONCEPT_FROM_CONTEXT
    || deterministic.intent === INTENTS.CONTENT_PROPOSAL_ADOPTION
    || deterministic.intent === INTENTS.CONTENT_PROPOSAL_ADOPTION_CANDIDATE_CHAIN
    || deterministic.requiresConfirmation === true
    || deterministic.target?.conceptVersion
    || deterministic.target?.candidateId
    || deterministic.target?.runId
  ) {
    return GUARD_CATEGORIES.STATE;
  }
  if (
    stateGuardTarget(deterministic)
  ) {
    return GUARD_CATEGORIES.STATE;
  }
  return GUARD_CATEGORIES.SEMANTIC;
}

function guardModelChatIntent(deterministicGuard = {}, modelIntent = null) {
  if (!usableModelIntent(modelIntent)) {
    return deterministicGuard;
  }
  return shouldPreferDeterministicIntent(deterministicGuard, modelIntent)
    ? deterministicGuard
    : modelIntent;
}

function buildChatIntentDecision(deterministicGuard = {}, modelIntent = null, options = {}) {
  const hasModelIntent = Boolean(modelIntent);
  const modelPrimary = usableModelIntent(modelIntent);
  const intent = guardModelChatIntent(deterministicGuard, modelIntent);
  const guardApplied = modelPrimary && intent !== modelIntent;
  const deterministicCategory = deterministicGuardCategory(deterministicGuard, modelIntent);
  const guardCategory = guardApplied || !modelPrimary
    ? deterministicCategory
    : GUARD_CATEGORIES.SEMANTIC;
  const reason = options.reason
    || (!hasModelIntent
      ? "model_intent_unavailable"
      : !modelPrimary
        ? "model_intent_low_confidence"
        : guardApplied
          ? "deterministic_guard_overrode_model"
          : "model_intent_accepted");
  return {
    schemaVersion: 1,
    intent,
    semanticSource: modelPrimary ? "model" : "deterministic",
    finalSource: intent?.source || "deterministic",
    guardApplied,
    guardCategory,
    deterministicGuardCategory: deterministicCategory,
    reason,
    deterministicGuard,
    modelIntent: modelIntent || null
  };
}

function reconcileChatIntent(deterministic = {}, interpreted = {}) {
  return guardModelChatIntent(deterministic, interpreted);
}

function deterministicBoundaryGuidanceAllowedWithoutModel(intent = {}) {
  return [INTENTS.SELECTION, INTENTS.PDF_EXPORT].includes(intent?.intent);
}

function inferExecutionPolicy(intent, input = {}) {
  const confidence = input.confidence || "low";
  const ambiguityLevel = input.ambiguity?.level || AMBIGUITY_LEVELS.NONE;
  if ([INTENTS.NONE, INTENTS.BRAINSTORM].includes(intent)) {
    return EXECUTION_POLICIES.NONE;
  }
  if (intent === INTENTS.QUESTION || input.isQuestion || confidence === "low" || ambiguityLevel === AMBIGUITY_LEVELS.HIGH) {
    return EXECUTION_POLICIES.ASK_CLARIFICATION;
  }
  if (confidence !== "high" || ambiguityLevel === AMBIGUITY_LEVELS.MEDIUM) {
    return EXECUTION_POLICIES.OFFER_ACTION;
  }
  if (intent === INTENTS.CANDIDATE_GENERATION || intent === INTENTS.SKIP_REFERENCE) {
    return EXECUTION_POLICIES.AUTO_OPEN_CONFIRMATION;
  }
  if (
    input.wantsCandidate
    && [
      INTENTS.CONCEPT_VERSION_ACTIVATION,
      INTENTS.CONTENT_PROPOSAL_ADOPTION,
      INTENTS.CONTENT_PROPOSAL_ADOPTION_CANDIDATE_CHAIN
    ].includes(intent)
  ) {
    return EXECUTION_POLICIES.AUTO_EXECUTE_THEN_CONFIRMATION;
  }
  if ([
    INTENTS.CONCEPT_VERSION_ACTIVATION,
    INTENTS.CONTENT_PROPOSAL_ADOPTION,
    INTENTS.CONTENT_PROPOSAL_ADOPTION_CANDIDATE_CHAIN,
    INTENTS.CREATE_NEW_CONCEPT_FROM_CONTEXT,
    INTENTS.CONCEPT_REVISION
  ].includes(intent)) {
    return EXECUTION_POLICIES.AUTO_EXECUTE;
  }
  return EXECUTION_POLICIES.OFFER_ACTION;
}

function baseIntent(message, overrides = {}) {
  const sourceMessage = textValue(message);
  return normalizeChatIntent({
    schemaVersion: 1,
    intent: INTENTS.NONE,
    confidence: "low",
    target: {
      kind: TARGET_KINDS.NONE,
      conceptVersion: null,
      proposalId: null,
      contentMirrorId: null,
      runId: null,
      candidateId: null,
      commandId: null,
      page: null
    },
    wantsCandidate: false,
    wantsAdoption: false,
    wantsContentChange: false,
    isQuestion: false,
    targetBasis: TARGET_BASES.NONE,
    riskLevel: RISK_LEVELS.NONE,
    executionPolicy: EXECUTION_POLICIES.NONE,
    requiresConfirmation: false,
    chainRequested: false,
    ambiguity: {
      level: AMBIGUITY_LEVELS.NONE,
      reasons: []
    },
    source: "deterministic",
    reason: null,
    sourceMessage,
    ...overrides
  }, sourceMessage);
}

function classifyChatIntent(message = "", workspace = {}) {
  const sourceMessage = textValue(message);
  const revisionTarget = messageOverridesExplicitRevisionTarget(workspace, sourceMessage)
    ? null
    : explicitRevisionTarget(workspace);
  const isQuestion = questionIntent(sourceMessage);
  const contentChange = contentChangeIntent(sourceMessage);
  const designRevision = conceptDesignRevisionIntent(sourceMessage);
  const targetVersion = conceptVersionTarget(sourceMessage);
  const versionAction = targetVersion && conceptVersionActionIntent(sourceMessage);
  const hardStopWorkflow = workflowActionStopIntent(sourceMessage);
  const holdWorkflow = workflowCreationHoldIntent(sourceMessage);
  if (hardStopWorkflow) {
    return baseIntent(sourceMessage, {
      intent: INTENTS.BRAINSTORM,
      confidence: "high",
      isQuestion: false,
      reason: "The user explicitly asks not to execute a workflow action yet."
    });
  }
  if (assessmentOnlyIntent(sourceMessage)) {
    return baseIntent(sourceMessage, {
      intent: INTENTS.BRAINSTORM,
      confidence: "high",
      isQuestion: true,
      reason: "The user asks for a chat-only material or source assessment, not a workflow action."
    });
  }
  if (adviceQuestionIntent(sourceMessage)) {
    return baseIntent(sourceMessage, {
      intent: INTENTS.QUESTION,
      confidence: "high",
      isQuestion: true,
      reason: "The user asks for advice or feedback, not a worksheet concept revision."
    });
  }
  if (conditionalNoOpCheckIntent(sourceMessage)) {
    return baseIntent(sourceMessage, {
      intent: INTENTS.QUESTION,
      confidence: "high",
      isQuestion: true,
      reason: "The user asks to check whether a requested concept change is already present and explicitly asks for a short answer instead of a new concept card."
    });
  }
  if (holdWorkflow && !revisionTarget && !contentChange && !designRevision && !versionAction) {
    return baseIntent(sourceMessage, {
      intent: INTENTS.BRAINSTORM,
      confidence: "high",
      isQuestion: false,
      reason: "The user explicitly asks not to execute a workflow action yet."
    });
  }
  if (revisionTarget?.kind === "concept") {
    return baseIntent(sourceMessage, {
      intent: INTENTS.CONCEPT_REVISION,
      confidence: "high",
      wantsCandidate: false,
      wantsAdoption: false,
      wantsContentChange: true,
      isQuestion: false,
      reason: "The composer explicitly targets the worksheet concept for revision.",
      target: {
        kind: revisionTarget.proposalId ? TARGET_KINDS.CONTENT_PROPOSAL : TARGET_KINDS.CURRENT_CONCEPT,
        conceptVersion: revisionTarget.conceptVersion || null,
        proposalId: revisionTarget.proposalId || null,
        contentMirrorId: revisionTarget.contentMirrorId || null
      },
      revisionTarget
    });
  }
  if (revisionTarget?.kind === "draft" && contentChange) {
    return baseIntent(sourceMessage, {
      intent: INTENTS.CONCEPT_REVISION,
      confidence: "high",
      wantsCandidate: !candidateCreationHoldIntent(sourceMessage),
      wantsAdoption: false,
      wantsContentChange: true,
      isQuestion: false,
      reason: "The composer explicitly targets a draft, but the requested change affects worksheet content and must revise the concept first.",
      target: {
        kind: TARGET_KINDS.DRAFT,
        runId: revisionTarget.runId || null,
        candidateId: revisionTarget.candidateId || null,
        page: revisionTarget.page || null
      },
      revisionTarget
    });
  }
  if (revisionTarget?.kind === "draft") {
    if (candidateCreationHoldIntent(sourceMessage)) {
      return baseIntent(sourceMessage, {
        intent: INTENTS.NONE,
        confidence: "high",
        wantsCandidate: false,
        wantsAdoption: false,
        wantsContentChange: false,
        isQuestion: false,
        target: {
          kind: TARGET_KINDS.DRAFT,
          runId: revisionTarget.runId || null,
          candidateId: revisionTarget.candidateId || null,
          page: revisionTarget.page || null
        },
        revisionTarget,
        reason: "The user targets a draft but explicitly asks not to create a draft yet."
      });
    }
    return baseIntent(sourceMessage, {
      intent: INTENTS.CANDIDATE_GENERATION,
      confidence: "high",
      wantsCandidate: true,
      wantsAdoption: false,
      wantsContentChange: false,
      isQuestion: false,
      reason: "The composer explicitly targets a draft for visual/layout revision.",
      target: {
        kind: TARGET_KINDS.DRAFT,
        runId: revisionTarget.runId || null,
        candidateId: revisionTarget.candidateId || null,
        page: revisionTarget.page || null
      },
      revisionTarget
    });
  }
  const visualCandidateFeedback = hasCandidateContext(workspace)
    && visualCandidateFeedbackIntent(sourceMessage)
    && !contentChange
    && !(designRevision && explicitConceptTargetIntent(sourceMessage));
  const newConceptWithDesignReference = newConceptWithDesignReferenceIntent(sourceMessage);
  const candidateGeneration = candidateGenerationIntent(sourceMessage);
  const wantsCandidate = !candidateCreationHoldIntent(sourceMessage)
    && !newConceptWithDesignReference
    && (candidateGeneration || visualCandidateFeedback);
  const wantsAdoption = adoptionIntent(sourceMessage);
  const skipReference = skipReferenceIntent(sourceMessage);
  const wantsPdfExport = explicitWorksheetDepositIntent(sourceMessage) || pdfExportIntent(sourceMessage);
  const wantsSelection = selectionIntent(sourceMessage)
    && !candidateGeneration
    && !selectionAsVisualReferenceIntent(sourceMessage)
    && !targetVersion;
  const wantsContentChange = !skipReference && (contentChange || (designRevision && !visualCandidateFeedback));
  const openProposal = hasOpenContentProposal(workspace);
  const wantsNewConceptFromContext = !wantsCandidate && (
    newConceptFromContextIntent(sourceMessage)
  );
  const isClarifyingQuestion = isQuestion
    && !wantsCandidate
    && !wantsAdoption
    && !wantsContentChange
    && !targetVersion
    && !wantsNewConceptFromContext
    && !skipReference
    && !wantsPdfExport
    && !wantsSelection;

  if (wantsPdfExport) {
    return baseIntent(sourceMessage, {
      intent: INTENTS.PDF_EXPORT,
      confidence: explicitWorksheetDepositIntent(sourceMessage) ? "high" : "medium",
      reason: explicitWorksheetDepositIntent(sourceMessage)
        ? "The user asks to store the current draft as a worksheet."
        : "The user asks for a PDF or export."
    });
  }

  if (wantsSelection) {
    return baseIntent(sourceMessage, {
      intent: INTENTS.SELECTION,
      confidence: "medium",
      reason: "The user appears to choose a candidate."
    });
  }

  if (targetVersion && conceptVersionActionIntent(sourceMessage)) {
    const draftTarget = wantsCandidate ? inferredDraftRevisionTarget(workspace, sourceMessage) : null;
    return baseIntent(sourceMessage, {
      intent: INTENTS.CONCEPT_VERSION_ACTIVATION,
      confidence: "high",
      target: {
        kind: TARGET_KINDS.CONCEPT_VERSION,
        conceptVersion: targetVersion,
        proposalId: null
      },
      wantsCandidate,
      wantsAdoption: wantsAdoption || /\b(freigeb|frei|aktuell|auswaehl|auswahl|basis|setz|setzen|nehmen|nimm)\w*\b/.test(normalizeText(sourceMessage)),
      wantsContentChange: false,
      isQuestion: false,
      ...(draftTarget ? { revisionTarget: draftTarget } : {}),
      reason: wantsCandidate
        ? "The user asks to use a specific concept version as the basis for a candidate."
        : "The user asks to make a specific concept version current."
    });
  }

  if (wantsNewConceptFromContext) {
    const normalizedSource = normalizeText(sourceMessage);
    const directConceptCommand = /\b(mach|mache|formulier|formuliere|schreib|schreibe|entwickel|bastel)\w*\b/.test(normalizedSource)
      || (/\berstell\w*\b/.test(normalizedSource) && !/\b(koennen wir|konnen wir|können wir|kann man|kannst du)\b/.test(normalizedSource));
    const directNaturalConceptRequest = /\b(?:waere|ware|wäre)\s+(?:es\s+)?(?:gut|sinnvoll|praktisch|cool)\b.{0,120}\b(?:zu haben|haben|bekommen|kriegen)\b/.test(normalizedSource);
    const directContextConceptRequest = directContextConceptRequestIntent(sourceMessage);
    const tentativeConceptRequest = !directConceptCommand
      && !directNaturalConceptRequest
      && !directContextConceptRequest
      && (
        isQuestion
        || /\b(wie findest du|was meinst du|koennen wir|können wir|kann man|waere das|wäre das|waere es|wäre es)\b/.test(normalizedSource)
      );
    return baseIntent(sourceMessage, {
      intent: INTENTS.CREATE_NEW_CONCEPT_FROM_CONTEXT,
      confidence: tentativeConceptRequest ? "medium" : "high",
      wantsCandidate: false,
      wantsAdoption: false,
      wantsContentChange: false,
      isQuestion: false,
      target: {
        kind: TARGET_KINDS.CURRENT_CONCEPT
      },
      reason: "The user asks for a new or follow-up worksheet concept based on the current project context."
    });
  }

  if (brainstormingIntent(sourceMessage)) {
    return baseIntent(sourceMessage, {
      intent: INTENTS.BRAINSTORM,
      confidence: "high",
      isQuestion: isClarifyingQuestion,
      reason: "The user asks for ideas or options, not a workflow action."
    });
  }

  if (openProposalConceptAdoptionIntent(workspace, sourceMessage) && !isClarifyingQuestion) {
    return baseIntent(sourceMessage, {
      intent: INTENTS.CONTENT_PROPOSAL_ADOPTION,
      confidence: "high",
      target: {
        kind: TARGET_KINDS.CONTENT_PROPOSAL,
        conceptVersion: null,
        proposalId: workspace.proposals?.latestContentMirror?.proposalId || null
      },
      wantsCandidate: false,
      wantsAdoption: true,
      wantsContentChange: false,
      isQuestion: false,
      reason: "The user explicitly confirms the open worksheet concept, not a draft generation."
    });
  }

  if (wantsContentChange) {
    return baseIntent(sourceMessage, {
      intent: INTENTS.CONCEPT_REVISION,
      confidence: "high",
      wantsCandidate,
      wantsAdoption,
      wantsContentChange: true,
      isQuestion: false,
      reason: "Content or concept changes must update the worksheet concept before candidate work."
    });
  }

  if (openProposal && wantsAdoption && wantsCandidate && !isClarifyingQuestion) {
    return baseIntent(sourceMessage, {
      intent: INTENTS.CONTENT_PROPOSAL_ADOPTION_CANDIDATE_CHAIN,
      confidence: "high",
      target: {
        kind: TARGET_KINDS.CONTENT_PROPOSAL,
        conceptVersion: null,
        proposalId: workspace.proposals?.latestContentMirror?.proposalId || null
      },
      wantsCandidate: true,
      wantsAdoption: true,
      wantsContentChange: false,
      isQuestion: false,
      reason: "The user asks to adopt the open worksheet concept and continue with candidate generation."
    });
  }

  if (openProposal && wantsCandidate && !isClarifyingQuestion && /\b(daraus|damit|auf dieser basis|auf grundlage|direkt)\b/.test(normalizeText(sourceMessage))) {
    return baseIntent(sourceMessage, {
      intent: INTENTS.CONTENT_PROPOSAL_ADOPTION_CANDIDATE_CHAIN,
      confidence: "medium",
      target: {
        kind: TARGET_KINDS.CONTENT_PROPOSAL,
        conceptVersion: null,
        proposalId: workspace.proposals?.latestContentMirror?.proposalId || null
      },
      wantsCandidate: true,
      wantsAdoption: true,
      wantsContentChange: false,
      isQuestion: false,
      reason: "The candidate request refers to the open concept proposal as its basis."
    });
  }

  if (openProposal && wantsAdoption && !isClarifyingQuestion) {
    return baseIntent(sourceMessage, {
      intent: INTENTS.CONTENT_PROPOSAL_ADOPTION,
      confidence: "high",
      target: {
        kind: TARGET_KINDS.CONTENT_PROPOSAL,
        conceptVersion: null,
        proposalId: workspace.proposals?.latestContentMirror?.proposalId || null
      },
      wantsCandidate: false,
      wantsAdoption: true,
      wantsContentChange: false,
      isQuestion: false,
      reason: "The user asks to adopt the open worksheet concept."
    });
  }

  if (skipReference) {
    return baseIntent(sourceMessage, {
      intent: INTENTS.SKIP_REFERENCE,
      confidence: "high",
      target: {
        kind: TARGET_KINDS.CURRENT_CONCEPT
      },
      wantsCandidate: true,
      isQuestion: false,
      reason: "The user wants to continue without a reference image."
    });
  }

  if (wantsCandidate && !isClarifyingQuestion) {
    const draftTarget = inferredDraftRevisionTarget(workspace, sourceMessage);
    return baseIntent(sourceMessage, {
      intent: INTENTS.CANDIDATE_GENERATION,
      confidence: "high",
      wantsCandidate: true,
      isQuestion: false,
      target: draftTarget ? {
        kind: TARGET_KINDS.DRAFT,
        runId: draftTarget.runId,
        candidateId: draftTarget.candidateId,
        page: draftTarget.page || null
      } : {
        kind: TARGET_KINDS.CURRENT_CONCEPT
      },
      ...(draftTarget ? { revisionTarget: draftTarget } : {}),
      reason: "The user explicitly asks for a candidate or image variant."
    });
  }

  if (isClarifyingQuestion) {
    return baseIntent(sourceMessage, {
      intent: INTENTS.QUESTION,
      confidence: "high",
      isQuestion: true,
      reason: "The user asks for clarification rather than giving a clear workflow instruction."
    });
  }

  return baseIntent(sourceMessage, {
    reason: "No clear workflow intent detected."
  });
}

function boundedVersion(value) {
  const number = Number(value);
  if (!Number.isInteger(number) || number <= 0 || number > 999) {
    return null;
  }
  return number;
}

function boundedPage(value) {
  const number = Number(value);
  if (!Number.isInteger(number) || number <= 0 || number > 999) {
    return null;
  }
  return number;
}

function normalizeTargetKind(value) {
  return Object.values(TARGET_KINDS).includes(value) ? value : null;
}

function inferTargetKind(intent, target = {}, revisionTarget = null) {
  const explicitKind = normalizeTargetKind(target.kind);
  if (explicitKind) {
    return explicitKind;
  }
  if (revisionTarget?.kind === "draft") {
    return TARGET_KINDS.DRAFT;
  }
  if (revisionTarget?.proposalId || target.proposalId) {
    return TARGET_KINDS.CONTENT_PROPOSAL;
  }
  if (revisionTarget?.kind === "concept") {
    return TARGET_KINDS.CURRENT_CONCEPT;
  }
  if (intent === INTENTS.CONCEPT_VERSION_ACTIVATION || target.conceptVersion) {
    return TARGET_KINDS.CONCEPT_VERSION;
  }
  if (
    intent === INTENTS.CONTENT_PROPOSAL_ADOPTION
    || intent === INTENTS.CONTENT_PROPOSAL_ADOPTION_CANDIDATE_CHAIN
  ) {
    return TARGET_KINDS.CONTENT_PROPOSAL;
  }
  if (intent === INTENTS.SELECTION || target.candidateId || target.runId) {
    return TARGET_KINDS.DRAFT;
  }
  if (intent === INTENTS.PDF_EXPORT) {
    return TARGET_KINDS.PDF;
  }
  if ([INTENTS.CANDIDATE_GENERATION, INTENTS.CREATE_NEW_CONCEPT_FROM_CONTEXT, INTENTS.CONCEPT_REVISION, INTENTS.SKIP_REFERENCE].includes(intent)) {
    return TARGET_KINDS.CURRENT_CONCEPT;
  }
  return TARGET_KINDS.NONE;
}

function normalizeTarget(value = {}, intent, revisionTarget = null) {
  const target = value && typeof value === "object" ? value : {};
  const kind = inferTargetKind(intent, target, revisionTarget);
  const conceptVersion = boundedVersion(target.conceptVersion || revisionTarget?.conceptVersion);
  const proposalId = textValue(target.proposalId || revisionTarget?.proposalId) || null;
  const contentMirrorId = textValue(target.contentMirrorId || target.conceptId || revisionTarget?.contentMirrorId) || null;
  const runId = textValue(target.runId || revisionTarget?.runId) || null;
  const candidateId = textValue(target.candidateId || revisionTarget?.candidateId) || null;
  const commandId = textValue(target.commandId || target.command) || null;
  return {
    kind,
    conceptVersion: kind === TARGET_KINDS.CONCEPT_VERSION ? conceptVersion : null,
    proposalId: kind === TARGET_KINDS.CONTENT_PROPOSAL ? proposalId : null,
    contentMirrorId: [TARGET_KINDS.CURRENT_CONCEPT, TARGET_KINDS.CONCEPT_VERSION].includes(kind) ? contentMirrorId : null,
    runId: kind === TARGET_KINDS.DRAFT ? runId : null,
    candidateId: kind === TARGET_KINDS.DRAFT ? candidateId : null,
    commandId: kind === TARGET_KINDS.LATEST_OFFER ? commandId : null,
    page: kind === TARGET_KINDS.DRAFT ? boundedPage(target.page || revisionTarget?.page) : null
  };
}

function conceptOnlyAdoptionMessage(sourceMessage = "") {
  const text = normalizeText(sourceMessage);
  if (!/\b(konzept|arbeitsblatt-konzept|konzeptvorschlag|konzeptkarte)\b/.test(text)) {
    return false;
  }
  return !candidateGenerationIntent(sourceMessage)
    && !visualCandidateFeedbackIntent(sourceMessage)
    && !contentChangeIntent(sourceMessage)
    && !conceptDesignRevisionIntent(sourceMessage)
    && !/\b(entwurf|entwuerf|entwurfs|bild|bildgenerierung|variante|ausgabe|rendern|generieren)\b/.test(text);
}

function openProposalConceptAdoptionIntent(workspace = {}, sourceMessage = "") {
  if (!workspace.proposals?.latestContentMirror?.proposalId || !conceptOnlyAdoptionMessage(sourceMessage)) {
    return false;
  }
  const text = normalizeText(sourceMessage);
  return /\b(ok|okay|mach|mache|nimm|nehmen|uebernimm|übernimm|uebernehmen|übernehmen|adoptier|adoptieren|verwende|nutze|passt)\b/.test(text);
}

function normalizeChatIntent(value = {}, sourceMessage = "") {
  const normalizedSourceMessage = textValue(value.sourceMessage || sourceMessage).slice(0, MAX_MESSAGE_LENGTH);
  let intent = VALID_INTENTS.has(value.intent) ? value.intent : INTENTS.NONE;
  const confidence = VALID_CONFIDENCE.has(value.confidence) ? value.confidence : "low";
  let wantsCandidate = value.wantsCandidate === true;
  const wantsAdoption = value.wantsAdoption === true;
  let reason = textValue(value.reason).slice(0, 300) || null;
  const downgradeConceptOnlyChain = (
    intent === INTENTS.CONTENT_PROPOSAL_ADOPTION_CANDIDATE_CHAIN
    || (intent === INTENTS.CONTENT_PROPOSAL_ADOPTION && wantsCandidate)
  ) && conceptOnlyAdoptionMessage(normalizedSourceMessage);
  if (downgradeConceptOnlyChain) {
    intent = INTENTS.CONTENT_PROPOSAL_ADOPTION;
    wantsCandidate = false;
    reason = [
      reason,
      "Downgraded candidate chain because the teacher asked only for concept-level work."
    ].filter(Boolean).join(" ");
  }
  const wantsContentChange = value.wantsContentChange === true || intent === INTENTS.CONCEPT_REVISION;
  const revisionTarget = normalizeRevisionTarget(value.revisionTarget);
  const normalizedTarget = normalizeTarget(value.target, intent, revisionTarget);
  const actionableQuestion = actionableWorkflowQuestionOverride(value, intent, confidence, normalizedSourceMessage);
  const isQuestion = !actionableQuestion && (value.isQuestion === true || intent === INTENTS.QUESTION);
  const ambiguityInput = actionableQuestion
    ? ambiguityForActionableWorkflowQuestion(value.ambiguity)
    : value.ambiguity;
  const ambiguity = normalizeAmbiguity(ambiguityInput, intent, confidence, isQuestion);
  const inferredRiskLevel = inferRiskLevel(intent, { wantsCandidate });
  const riskLevel = inferredRiskLevel;
  const executionPolicy = inferExecutionPolicy(intent, {
      confidence,
      ambiguity,
      isQuestion,
      wantsCandidate,
      riskLevel
    });
  const requiresConfirmation = inferRequiresConfirmation(intent, riskLevel, { wantsCandidate });
  return {
    schemaVersion: 1,
    intent,
    confidence,
    target: normalizedTarget,
    wantsCandidate,
    wantsAdoption,
    wantsContentChange,
    isQuestion,
    revisionTarget,
    targetBasis: inferTargetBasis(intent, { ...normalizedTarget, revisionTarget }),
    riskLevel,
    executionPolicy,
    requiresConfirmation,
    chainRequested: !downgradeConceptOnlyChain && (value.chainRequested === true
      || intent === INTENTS.CONTENT_PROPOSAL_ADOPTION_CANDIDATE_CHAIN
      || (wantsCandidate && [
        INTENTS.CONCEPT_VERSION_ACTIVATION,
        INTENTS.CONTENT_PROPOSAL_ADOPTION,
        INTENTS.CONTENT_PROPOSAL_ADOPTION_CANDIDATE_CHAIN
      ].includes(intent))),
    ambiguity,
    source: value.source === "model" ? "model" : "deterministic",
    reason,
    sourceMessage: normalizedSourceMessage
  };
}

function jsonTextFromOutput(text) {
  const raw = String(text || "").trim();
  if (!raw) {
    return "";
  }
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced?.[1]) {
    return fenced[1].trim();
  }
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start >= 0 && end > start) {
    return raw.slice(start, end + 1);
  }
  return raw;
}

function parseChatIntent(outputText, sourceMessage = "") {
  const jsonText = jsonTextFromOutput(outputText);
  if (!jsonText) {
    return null;
  }
  return normalizeChatIntent({
    ...JSON.parse(jsonText),
    source: "model"
  }, sourceMessage);
}

function truncate(value, max = 400) {
  const text = textValue(value);
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function compactMessages(messages = []) {
  return (Array.isArray(messages) ? messages : [])
    .slice(-8)
    .map((message) => ({
      role: message.role === "assistant" ? "assistant" : "user",
      content: truncate(message.content || message.message, 500)
    }))
    .filter((message) => message.content);
}

function compactConcepts(workspace = {}) {
  return (Array.isArray(workspace.artifacts?.concepts) ? workspace.artifacts.concepts : [])
    .slice(-8)
    .map((concept) => ({
      id: concept.id || null,
      version: boundedVersion(concept.version),
      status: concept.status || null,
      current: concept.current === true,
      title: truncate(concept.title || concept.summary, 140)
    }));
}

function compactCommands(workspace = {}) {
  return (workspace.commands || [])
    .filter((command) => command.enabled)
    .slice(0, 12)
    .map((command) => ({
      id: command.id,
      label: truncate(command.label, 120),
      requiresConfirmation: command.requiresConfirmation === true
    }));
}

function compactWorkspace(workspace = {}) {
  return {
    currentConcept: workspace.artifacts?.currentContent ? {
      id: workspace.artifacts.currentContent.id || null,
      version: boundedVersion(workspace.artifacts.currentContent.version),
      status: workspace.artifacts.currentContent.status || workspace.documents?.content?.status || null
    } : null,
    concepts: compactConcepts(workspace),
    openContentProposal: workspace.proposals?.latestContentMirror ? {
      proposalId: workspace.proposals.latestContentMirror.proposalId || null,
      title: truncate(workspace.proposals.latestContentMirror.title, 160)
    } : null,
    candidateState: {
      candidateCount: Number(workspace.latestRun?.candidateCount || workspace.preview?.candidates?.length || 0) || 0,
      selectedCandidateId: workspace.latestRun?.selectedCandidateId || null
    },
    enabledActions: compactCommands(workspace),
    recentMessages: compactMessages(workspace.chat?.messages || [])
  };
}

function interpreterPayload(input = {}) {
  return {
    task: "Interpret the latest teacher chat message as one workflow intent for SheetifyIMG.",
    latestUserMessage: truncate(input.message, MAX_MESSAGE_LENGTH),
    workspace: compactWorkspace(input.workspace || {}),
    revisionTarget: input.revisionTarget || null,
    allowedIntents: Object.values(INTENTS)
  };
}

function intentSchema() {
  return {
    type: "object",
    additionalProperties: false,
    required: [
      "intent",
      "confidence",
      "target",
      "wantsCandidate",
      "wantsAdoption",
      "wantsContentChange",
      "isQuestion",
      "targetBasis",
      "riskLevel",
      "executionPolicy",
      "requiresConfirmation",
      "chainRequested",
      "ambiguity",
      "reason"
    ],
    properties: {
      intent: {
        type: "string",
        enum: Object.values(INTENTS)
      },
      confidence: {
        type: "string",
        enum: ["low", "medium", "high"]
      },
      target: {
        type: "object",
        additionalProperties: false,
        required: ["kind", "conceptVersion", "proposalId", "contentMirrorId", "runId", "candidateId", "commandId", "page"],
        properties: {
          kind: {
            type: "string",
            enum: Object.values(TARGET_KINDS)
          },
          conceptVersion: {
            type: ["integer", "null"],
            minimum: 1
          },
          proposalId: {
            type: ["string", "null"]
          },
          contentMirrorId: {
            type: ["string", "null"]
          },
          runId: {
            type: ["string", "null"]
          },
          candidateId: {
            type: ["string", "null"]
          },
          commandId: {
            type: ["string", "null"]
          },
          page: {
            type: ["integer", "null"],
            minimum: 1
          }
        }
      },
      wantsCandidate: {
        type: "boolean"
      },
      wantsAdoption: {
        type: "boolean"
      },
      wantsContentChange: {
        type: "boolean"
      },
      isQuestion: {
        type: "boolean"
      },
      targetBasis: {
        type: "string",
        enum: Object.values(TARGET_BASES)
      },
      riskLevel: {
        type: "string",
        enum: Object.values(RISK_LEVELS)
      },
      executionPolicy: {
        type: "string",
        enum: Object.values(EXECUTION_POLICIES)
      },
      requiresConfirmation: {
        type: "boolean"
      },
      chainRequested: {
        type: "boolean"
      },
      ambiguity: {
        type: "object",
        additionalProperties: false,
        required: ["level", "reasons"],
        properties: {
          level: {
            type: "string",
            enum: Object.values(AMBIGUITY_LEVELS)
          },
          reasons: {
            type: "array",
            items: {
              type: "string"
            },
            maxItems: 4
          }
        }
      },
      reason: {
        type: ["string", "null"]
      }
    }
  };
}

function intentInstructions() {
  return [
    "You classify exactly one latest teacher message for SheetifyIMG.",
    "Return only JSON matching the schema.",
    "The app, not you, executes actions. You only identify intent.",
    "Use German product concepts: Arbeitsblatt-Konzept and Entwurf.",
    "If revisionTarget.source is explicit, treat it as the strongest reference for the user's latest message.",
    "If explicit revisionTarget.kind is concept, classify concept_revision.",
    "If explicit revisionTarget.kind is draft and the user asks for visual/layout/readability changes, classify candidate_generation with wantsCandidate true.",
    "If explicit revisionTarget.kind is draft but the user asks to change text, tasks, difficulty, answers, visible worksheet content, or worksheet structure, classify concept_revision with wantsContentChange true.",
    "Entwurf selection and project PDF export are legacy chat paths. If the teacher asks for those, classify selection or pdf_export only so the app can route to manual UI guidance; do not treat them as executable workflow steps.",
    "If the message clearly asks to do something, do not mark it as a question just because it is phrased politely with 'kannst du'.",
    "If a polite question asks to remove, delete, correct, replace, or clean up visible worksheet text/content, classify concept_revision with wantsContentChange true. Examples: 'kannst du das mal rausnehmen?', 'da steht ein doppelter Punkt', 'das ist in den Inhalt gerutscht'.",
    "If they only ask whether removal would be possible or sensible, without asking you to do it, classify question.",
    "If they ask for advice, feedback, a recommendation, or what you would change, classify question unless they explicitly say to implement it. Examples: 'Was wuerdest du am Konzept aendern?', 'Wuerdest du die Vorlage als Referenz mitgeben oder neu rendern?', 'Kannst du kurz Feedback geben, ob die Bildreferenz sinnvoll waere?'.",
    "If they confirm that advice with an implementation request such as 'mach das', 'setze das um', or 'passe das Konzept entsprechend an', classify the requested workflow action.",
    "If the teacher asks to change content, tasks, text, difficulty, answers, or worksheet structure, classify concept_revision even if they also mention an Entwurf.",
    "If there is an openContentProposal and the teacher confirms with 'mach das Konzept', 'nimm das Konzept', 'übernimm das Konzept', 'ok mach das', or similar concept-level wording, classify content_proposal_adoption. Do not create another new concept from that confirmation.",
    "If the teacher asks for a new, another, further, follow-up or next Arbeitsblatt-Konzept based on the existing project/chat context, classify create_new_concept_from_context, not concept_revision.",
    "If the teacher says 'Konzept v4', 'weiteres Konzept', 'anderes Konzept', 'Folgebogen', 'naechster Bogen', or confirms in context with 'mach das' after a new/follow-up concept was discussed, classify create_new_concept_from_context when the workspace already has a concept basis and no openContentProposal is waiting for adoption.",
    "Use concept_revision only when the teacher wants to patch, correct, shorten, simplify, or otherwise modify the current/open concept rather than create a new contextual concept variant.",
    "If the teacher asks to use a specific concept version, set concept_version_activation and target.conceptVersion.",
    "If they ask to use a concept version and then make an Entwurf from it, keep concept_version_activation and set wantsCandidate true.",
    "Set target.kind as the authoritative target: concept_version for Konzept v1/v2, content_proposal for an open concept proposal, draft for Entwurf/Kandidat references, current_concept for the approved concept, pdf for PDF/export, none when there is no workflow target. Do not use latest_offer to bind chat text to UI buttons; understand confirmations from conversation context instead.",
    "Do not infer wantsCandidate, candidate_generation, or content_proposal_adoption_candidate_chain merely from available workflow buttons, suggestedActions, or UI affordances. The teacher must ask for an Entwurf, Bild, Variante, Ausgabe, or clearly confirm assistant text that explicitly proposed creating an Entwurf.",
    "If the teacher says 'mach das Konzept', 'nimm das Konzept', 'übernimm das Konzept', or asks for 'Konzept für nächste Seite' without asking for an Entwurf/Bild/Variante, keep the intent at concept level: create_new_concept_from_context, concept_revision, or content_proposal_adoption. Do not chain into paid candidate generation.",
    "Do not mark a terse actionable concept request like 'Ok Konzept für nächste Seite?' as a clarification question merely because it ends with a question mark.",
    "If there is an existing Entwurf and the teacher asks for visual/layout/readability changes while keeping content unchanged, classify candidate_generation with wantsCandidate true, not concept_revision.",
    "If there is an openContentProposal and the teacher says to adopt/take/approve it, use content_proposal_adoption.",
    "If there is an openContentProposal and the teacher says to adopt it and make an Entwurf from it, use content_proposal_adoption_candidate_chain.",
    "If they only ask whether something would be possible or what would happen, classify question.",
    "Set targetBasis to the explicit basis the teacher refers to: concept_version, content_proposal, current_concept, candidate, pdf, or none. In the schema, candidate means the internal Entwurf artifact.",
    "Set chainRequested true only when the teacher asks for linked steps in one message, for example adopting a concept and then making an Entwurf.",
    "Set ambiguity.level medium or high when the target, basis, or whether this is a question is unclear.",
    "Fill riskLevel, executionPolicy, and requiresConfirmation with your best estimate; the app will recompute them deterministically before acting.",
    "If unsure, use confidence low and intent none."
  ].join("\n");
}

async function requestModelChatIntent(projectDir, input = {}, options = {}) {
  const requestConfig = getOpenAiRequestConfig(process.env);
  const route = routeForPurpose(ROUTE_PURPOSES.CHAT_INTENT, requestConfig);
  const model = route.model || requestConfig.textModel;
  const startedAt = Date.now();
  let modelCallLogged = false;
  const payload = interpreterPayload(input);
  const responseBody = {
    model,
    instructions: intentInstructions(),
    input: [{
      role: "user",
      content: JSON.stringify(payload, null, 2)
    }],
    text: {
      format: {
        type: "json_schema",
        name: "sheetifyimg_chat_intent",
        strict: true,
        schema: intentSchema()
      }
    },
    reasoning: route.reasoningEffort && route.reasoningEffort !== "none"
      ? { effort: route.reasoningEffort }
      : undefined,
    store: false
  };
  const requestShape = measureModelRequest(responseBody, {
    contextSections: payload
  });
  try {
    const response = await createResponse(responseBody, requestConfig);
    const responseModel = response.model || model;
    const usage = response.usage || null;
    const costEstimate = estimateOpenAiTextCost({
      usage,
      model: responseModel
    });
    await logModelRun(projectDir, {
      status: "success",
      source: "chat_intent_interpreter",
      purpose: route.purpose,
      route: route.route,
      promptNames: route.promptNames,
      model: responseModel,
      reasoningEffort: route.reasoningEffort,
      responseId: response.id || null,
      durationMs: Date.now() - startedAt,
      usage,
      costEstimate,
      requestShape,
      attribution: options.usageAttribution,
      uiEvent: options.uiEvent || "chat_message"
    }, { now: options.now });
    modelCallLogged = true;
    const interpreted = parseChatIntent(extractOutputText(response), input.message);
    return interpreted || null;
  } catch (error) {
    if (!modelCallLogged) {
      await logModelRun(projectDir, {
        status: "error",
        source: "chat_intent_interpreter",
        purpose: route.purpose,
        route: route.route,
        promptNames: route.promptNames,
        model,
        reasoningEffort: route.reasoningEffort,
        durationMs: Date.now() - startedAt,
        requestShape,
        attribution: options.usageAttribution,
        uiEvent: options.uiEvent || "chat_message",
        error: sanitizeErrorMessage(error)
      }, { now: options.now });
    }
    return null;
  }
}

async function interpretChatIntentDecision(projectDir, input = {}, options = {}) {
  const deterministicGuard = classifyChatIntent(input.message, {
    ...(input.workspace || {}),
    revisionTarget: input.revisionTarget || null
  });
  if (!chatIntentInterpreterAvailable(options)) {
    if (deterministicBoundaryGuidanceAllowedWithoutModel(deterministicGuard)) {
      return buildChatIntentDecision(deterministicGuard, null, {
        reason: "model_intent_unavailable"
      });
    }
    const noModelIntent = normalizeChatIntent({
      intent: INTENTS.NONE,
      confidence: "low",
      source: "deterministic",
      reason: "No model intent is available; chat workflow actions require model interpretation.",
      sourceMessage: input.message
    }, input.message);
    return buildChatIntentDecision(noModelIntent, null, {
      reason: "model_intent_unavailable"
    });
  }
  const modelIntent = await requestModelChatIntent(projectDir, input, options);
  return buildChatIntentDecision(deterministicGuard, modelIntent);
}

async function interpretChatIntent(projectDir, input = {}, options = {}) {
  const decision = await interpretChatIntentDecision(projectDir, input, options);
  return decision.intent;
}

module.exports = {
  AMBIGUITY_LEVELS,
  EXECUTION_POLICIES,
  GUARD_CATEGORIES,
  INTENTS,
  RISK_LEVELS,
  TARGET_BASES,
  TARGET_KINDS,
  buildChatIntentDecision,
  chatIntentInterpreterAvailable,
  classifyChatIntent,
  configuredChatIntentInterpreterEnabled,
  deterministicGuardCategory,
  guardModelChatIntent,
  interpretChatIntent,
  interpretChatIntentDecision,
  normalizeChatIntent,
  parseChatIntent,
  reconcileChatIntent
};
