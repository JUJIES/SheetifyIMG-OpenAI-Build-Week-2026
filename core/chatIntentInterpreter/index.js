"use strict";

const { getAiRuntimeStatus, getOpenAiRequestConfig } = require("../aiConfig");
const { createResponse, extractOutputText } = require("../openaiClient");
const { logModelRun, sanitizeErrorMessage } = require("../modelRunLogger");
const { estimateOpenAiTextCost } = require("../imageCostManager");
const {
  adoptionIntent,
  brainstormingIntent,
  candidateGenerationIntent,
  conceptDesignRevisionIntent,
  conceptVersionActionIntent,
  conceptVersionTarget,
  contentChangeIntent,
  explicitConceptTargetIntent,
  hasCandidateContext,
  normalizeText,
  pdfExportIntent,
  questionIntent,
  selectionIntent,
  skipReferenceIntent,
  visualCandidateFeedbackIntent
} = require("../chatIntentSignals");

const INTENTS = Object.freeze({
  NONE: "none",
  QUESTION: "question",
  BRAINSTORM: "brainstorm",
  CANDIDATE_GENERATION: "candidate_generation",
  CONCEPT_VERSION_ACTIVATION: "concept_version_activation",
  CONTENT_PROPOSAL_ADOPTION: "content_proposal_adoption",
  CONTENT_PROPOSAL_ADOPTION_CANDIDATE_CHAIN: "content_proposal_adoption_candidate_chain",
  CONCEPT_REVISION: "concept_revision",
  SKIP_REFERENCE: "skip_reference",
  PDF_EXPORT: "pdf_export",
  SELECTION: "selection"
});

const VALID_INTENTS = new Set(Object.values(INTENTS));
const VALID_CONFIDENCE = new Set(["low", "medium", "high"]);
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
const AMBIGUITY_LEVELS = Object.freeze({
  NONE: "none",
  LOW: "low",
  MEDIUM: "medium",
  HIGH: "high"
});
const VALID_AMBIGUITY_LEVELS = new Set(Object.values(AMBIGUITY_LEVELS));
const MAX_MESSAGE_LENGTH = 800;
const LOCAL_ROUTABLE_INTENTS = new Set([
  INTENTS.CANDIDATE_GENERATION,
  INTENTS.CONCEPT_VERSION_ACTIVATION,
  INTENTS.CONTENT_PROPOSAL_ADOPTION,
  INTENTS.CONTENT_PROPOSAL_ADOPTION_CANDIDATE_CHAIN,
  INTENTS.CONCEPT_REVISION,
  INTENTS.SKIP_REFERENCE
]);

function textValue(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
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
  if (intent === INTENTS.CONCEPT_VERSION_ACTIVATION || target.conceptVersion) {
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
  if (intent === INTENTS.PDF_EXPORT) {
    return TARGET_BASES.PDF;
  }
  if ([INTENTS.CANDIDATE_GENERATION, INTENTS.CONCEPT_REVISION, INTENTS.SKIP_REFERENCE].includes(intent)) {
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

function inferRequiresConfirmation(intent, riskLevel, flags = {}) {
  return riskLevel === RISK_LEVELS.PAID
    || flags.wantsCandidate === true
    || [INTENTS.CANDIDATE_GENERATION, INTENTS.SKIP_REFERENCE].includes(intent);
}

function riskRank(riskLevel) {
  return {
    [RISK_LEVELS.NONE]: 0,
    [RISK_LEVELS.SAFE]: 1,
    [RISK_LEVELS.WORKFLOW_WRITE]: 2,
    [RISK_LEVELS.PAID]: 3
  }[riskLevel] ?? 0;
}

function isConfidentWorkflowIntent(intent = {}) {
  return Boolean(intent)
    && intent.confidence === "high"
    && ![INTENTS.NONE, INTENTS.QUESTION, INTENTS.BRAINSTORM].includes(intent.intent);
}

function shouldPreferDeterministicIntent(deterministic = {}, interpreted = {}) {
  if ([INTENTS.SELECTION, INTENTS.PDF_EXPORT].includes(deterministic.intent) && deterministic.confidence !== "low") {
    return true;
  }
  if (!isConfidentWorkflowIntent(deterministic)) {
    return false;
  }
  if (!interpreted || interpreted.confidence === "low") {
    return true;
  }
  if (interpreted.confidence !== "high") {
    return true;
  }
  if ([INTENTS.NONE, INTENTS.QUESTION, INTENTS.BRAINSTORM].includes(interpreted.intent)) {
    return true;
  }
  if (deterministic.intent === interpreted.intent) {
    if (deterministic.wantsCandidate && !interpreted.wantsCandidate) {
      return true;
    }
    if (deterministic.target?.conceptVersion && !interpreted.target?.conceptVersion) {
      return true;
    }
  }
  if (interpreted.intent === INTENTS.CONCEPT_REVISION && interpreted.wantsContentChange) {
    return false;
  }
  if (LOCAL_ROUTABLE_INTENTS.has(deterministic.intent) && !LOCAL_ROUTABLE_INTENTS.has(interpreted.intent)) {
    return true;
  }
  if (deterministic.requiresConfirmation && !interpreted.requiresConfirmation) {
    return true;
  }
  return riskRank(interpreted.riskLevel) < riskRank(deterministic.riskLevel);
}

function usableModelIntent(modelIntent = null) {
  return Boolean(modelIntent) && modelIntent.confidence !== "low";
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
    reason,
    deterministicGuard,
    modelIntent: modelIntent || null
  };
}

function reconcileChatIntent(deterministic = {}, interpreted = {}) {
  return guardModelChatIntent(deterministic, interpreted);
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
      conceptVersion: null,
      proposalId: null
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
  const isQuestion = questionIntent(sourceMessage);
  const contentChange = contentChangeIntent(sourceMessage);
  const designRevision = conceptDesignRevisionIntent(sourceMessage);
  const visualCandidateFeedback = hasCandidateContext(workspace)
    && visualCandidateFeedbackIntent(sourceMessage)
    && !contentChange
    && !(designRevision && explicitConceptTargetIntent(sourceMessage));
  const wantsCandidate = candidateGenerationIntent(sourceMessage) || visualCandidateFeedback;
  const wantsAdoption = adoptionIntent(sourceMessage);
  const wantsContentChange = contentChange || (designRevision && !visualCandidateFeedback);
  const targetVersion = conceptVersionTarget(sourceMessage);
  const openProposal = hasOpenContentProposal(workspace);
  const isClarifyingQuestion = isQuestion
    && !wantsCandidate
    && !wantsAdoption
    && !wantsContentChange
    && !targetVersion
    && !skipReferenceIntent(sourceMessage)
    && !pdfExportIntent(sourceMessage)
    && !selectionIntent(sourceMessage);

  if (brainstormingIntent(sourceMessage)) {
    return baseIntent(sourceMessage, {
      intent: INTENTS.BRAINSTORM,
      confidence: "high",
      isQuestion: isClarifyingQuestion,
      reason: "The user asks for ideas or options, not a workflow action."
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

  if (targetVersion && conceptVersionActionIntent(sourceMessage)) {
    return baseIntent(sourceMessage, {
      intent: INTENTS.CONCEPT_VERSION_ACTIVATION,
      confidence: "high",
      target: {
        conceptVersion: targetVersion,
        proposalId: null
      },
      wantsCandidate,
      wantsAdoption: wantsAdoption || /\b(freigeb|frei|aktuell|auswaehl|auswahl|basis|setz|setzen|nehmen|nimm)\w*\b/.test(normalizeText(sourceMessage)),
      wantsContentChange: false,
      isQuestion: false,
      reason: wantsCandidate
        ? "The user asks to use a specific concept version as the basis for a candidate."
        : "The user asks to make a specific concept version current."
    });
  }

  if (openProposal && wantsAdoption && wantsCandidate && !isClarifyingQuestion) {
    return baseIntent(sourceMessage, {
      intent: INTENTS.CONTENT_PROPOSAL_ADOPTION_CANDIDATE_CHAIN,
      confidence: "high",
      target: {
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

  if (skipReferenceIntent(sourceMessage)) {
    return baseIntent(sourceMessage, {
      intent: INTENTS.SKIP_REFERENCE,
      confidence: "high",
      wantsCandidate: true,
      isQuestion: false,
      reason: "The user wants to continue without a reference image."
    });
  }

  if (wantsCandidate && !isClarifyingQuestion) {
    return baseIntent(sourceMessage, {
      intent: INTENTS.CANDIDATE_GENERATION,
      confidence: "high",
      wantsCandidate: true,
      isQuestion: false,
      reason: "The user explicitly asks for a candidate or image variant."
    });
  }

  if (selectionIntent(sourceMessage)) {
    return baseIntent(sourceMessage, {
      intent: INTENTS.SELECTION,
      confidence: "medium",
      reason: "The user appears to choose a candidate."
    });
  }

  if (pdfExportIntent(sourceMessage)) {
    return baseIntent(sourceMessage, {
      intent: INTENTS.PDF_EXPORT,
      confidence: "medium",
      reason: "The user asks for a PDF or export."
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

function normalizeChatIntent(value = {}, sourceMessage = "") {
  const intent = VALID_INTENTS.has(value.intent) ? value.intent : INTENTS.NONE;
  const confidence = VALID_CONFIDENCE.has(value.confidence) ? value.confidence : "low";
  const target = value.target && typeof value.target === "object" ? value.target : {};
  const normalizedTarget = {
    conceptVersion: boundedVersion(target.conceptVersion),
    proposalId: textValue(target.proposalId) || null
  };
  const wantsCandidate = value.wantsCandidate === true;
  const wantsAdoption = value.wantsAdoption === true;
  const wantsContentChange = value.wantsContentChange === true || intent === INTENTS.CONCEPT_REVISION;
  const isQuestion = value.isQuestion === true || intent === INTENTS.QUESTION;
  const ambiguity = normalizeAmbiguity(value.ambiguity, intent, confidence, isQuestion);
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
    targetBasis: inferTargetBasis(intent, normalizedTarget),
    riskLevel,
    executionPolicy,
    requiresConfirmation,
    chainRequested: value.chainRequested === true
      || intent === INTENTS.CONTENT_PROPOSAL_ADOPTION_CANDIDATE_CHAIN
      || (wantsCandidate && [
        INTENTS.CONCEPT_VERSION_ACTIVATION,
        INTENTS.CONTENT_PROPOSAL_ADOPTION,
        INTENTS.CONTENT_PROPOSAL_ADOPTION_CANDIDATE_CHAIN
      ].includes(intent)),
    ambiguity,
    source: value.source === "model" ? "model" : "deterministic",
    reason: textValue(value.reason).slice(0, 300) || null,
    sourceMessage: textValue(value.sourceMessage || sourceMessage).slice(0, MAX_MESSAGE_LENGTH)
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
        required: ["conceptVersion", "proposalId"],
        properties: {
          conceptVersion: {
            type: ["integer", "null"],
            minimum: 1
          },
          proposalId: {
            type: ["string", "null"]
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
    "Entwurf selection and project PDF export are legacy chat paths. If the teacher asks for those, classify selection or pdf_export only so the app can route to manual UI guidance; do not treat them as executable workflow steps.",
    "If the message clearly asks to do something, do not mark it as a question just because it is phrased politely with 'kannst du'.",
    "If the teacher asks to change content, tasks, text, difficulty, answers, or worksheet structure, classify concept_revision even if they also mention an Entwurf.",
    "If the teacher asks to use a specific concept version, set concept_version_activation and target.conceptVersion.",
    "If they ask to use a concept version and then make an Entwurf from it, keep concept_version_activation and set wantsCandidate true.",
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
  const model = requestConfig.textModel;
  const startedAt = Date.now();
  try {
    const response = await createResponse({
      model,
      instructions: intentInstructions(),
      input: [{
        role: "user",
        content: JSON.stringify(interpreterPayload(input), null, 2)
      }],
      text: {
        format: {
          type: "json_schema",
          name: "sheetifyimg_chat_intent",
          strict: true,
          schema: intentSchema()
        }
      },
      store: false
    }, requestConfig);
    const responseModel = response.model || model;
    const usage = response.usage || null;
    const costEstimate = estimateOpenAiTextCost({
      usage,
      model: responseModel
    });
    const interpreted = parseChatIntent(extractOutputText(response), input.message);
    await logModelRun(projectDir, {
      status: "success",
      source: "chat_intent_interpreter",
      purpose: "chat_intent_interpretation",
      route: "chat_intent",
      promptNames: ["chat_intent_inline"],
      model: responseModel,
      responseId: response.id || null,
      durationMs: Date.now() - startedAt,
      usage,
      costEstimate,
      uiEvent: options.uiEvent || "chat_message"
    }, { now: options.now });
    return interpreted || null;
  } catch (error) {
    await logModelRun(projectDir, {
      status: "error",
      source: "chat_intent_interpreter",
      purpose: "chat_intent_interpretation",
      route: "chat_intent",
      promptNames: ["chat_intent_inline"],
      model,
      durationMs: Date.now() - startedAt,
      uiEvent: options.uiEvent || "chat_message",
      error: sanitizeErrorMessage(error)
    }, { now: options.now });
    return null;
  }
}

async function interpretChatIntentDecision(projectDir, input = {}, options = {}) {
  const deterministicGuard = classifyChatIntent(input.message, input.workspace || {});
  if (!chatIntentInterpreterAvailable(options)) {
    return buildChatIntentDecision(deterministicGuard, null, {
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
  INTENTS,
  RISK_LEVELS,
  TARGET_BASES,
  buildChatIntentDecision,
  chatIntentInterpreterAvailable,
  classifyChatIntent,
  configuredChatIntentInterpreterEnabled,
  guardModelChatIntent,
  interpretChatIntent,
  interpretChatIntentDecision,
  normalizeChatIntent,
  parseChatIntent,
  reconcileChatIntent
};
