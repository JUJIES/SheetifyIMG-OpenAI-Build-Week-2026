"use strict";

const { getAiRuntimeStatus, getOpenAiRequestConfig } = require("../aiConfig");
const { createResponse, extractOutputText } = require("../openaiClient");
const { estimateOpenAiTextCost } = require("../imageCostManager");
const { logModelRun, sanitizeErrorMessage } = require("../modelRunLogger");
const { measureModelRequest } = require("../modelRequestMetrics");
const { ROUTE_PURPOSES, routeForPurpose } = require("../modelRouter");
const { composePrompts } = require("../promptRegistry");
const { REQUESTED_ACTIONS, evidenceAppearsInMessage } = require("../planningTurnAdapter");
const { validateNarrationPolicy } = require("../chatNarrationManager");

const RESPONSE_GOALS = Object.freeze([
  "answer",
  "brainstorm",
  "develop_component",
  "critique",
  "acknowledge"
]);
const CONFIDENCE_LEVELS = Object.freeze(["low", "medium", "high"]);
const TARGET_KINDS = Object.freeze([
  "none",
  "current_concept",
  "concept_version",
  "content_proposal",
  "draft"
]);
const FIELD_OPERATIONS = Object.freeze(["keep", "set", "clear"]);
const FIELD_STATUSES = Object.freeze(["known", "partial", "assumed", "missing"]);
const TEACHING_FIELD_IDS = Object.freeze([
  "topic",
  "targetGroup",
  "lessonGoal",
  "worksheetType",
  "specialRequirements"
]);
const NEGATABLE_ACTIONS = Object.freeze([
  "all",
  ...Object.values(REQUESTED_ACTIONS).filter((action) => action !== REQUESTED_ACTIONS.NONE)
]);
const MAX_REPLY_LENGTH = 2400;

function textValue(value, max = 1000) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  return text ? text.slice(0, max) : null;
}

function visibleTextValue(value, max = MAX_REPLY_LENGTH) {
  const text = String(value ?? "")
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return text ? text.slice(0, max) : null;
}

function boundedNumber(value, min, max, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(min, Math.min(max, number)) : fallback;
}

function compactText(value, max = 700) {
  const text = String(value || "").trim();
  if (text.length <= max) {
    return text;
  }
  return `${text.slice(0, max - 1).trim()}…`;
}

function boundedLatestMessage(value, max = 16000) {
  const text = String(value || "").trim();
  if (!text || text.length <= max) {
    return text || null;
  }
  const marker = "\n\n[... Mitte für das Modell gekürzt; Anfang und letzte Korrekturen folgen ...]\n\n";
  const tailBudget = Math.min(7000, Math.floor(max * 0.45));
  const headBudget = max - marker.length - tailBudget;
  return `${text.slice(0, headBudget).trimEnd()}${marker}${text.slice(-tailBudget).trimStart()}`;
}

function compactMessages(messages = []) {
  return (Array.isArray(messages) ? messages : [])
    .slice(-16)
    .map((message) => ({
      role: message.role === "assistant" ? "assistant" : "user",
      content: compactText(message.content || message.message, 700),
      createdAt: message.createdAt || null,
      revisionTarget: message.revisionTarget || null
    }))
    .filter((message) => message.content);
}

function priorMessages(messages = [], latestUserEventId = null) {
  if (!latestUserEventId) {
    return messages;
  }
  return (Array.isArray(messages) ? messages : [])
    .filter((message) => message.id !== latestUserEventId);
}

function compactContent(content = null) {
  if (!content || typeof content !== "object") {
    return null;
  }
  return {
    artifactId: content.artifactId || null,
    version: Number(content.version || 0) || null,
    status: content.status || null,
    title: compactText(content.title, 180),
    outputPreference: content.outputPreference || null,
    readingTexts: (content.readingTexts || []).slice(0, 8).map((entry) => ({
      id: entry.id || null,
      page: entry.page || null,
      role: entry.role || null,
      title: compactText(entry.title, 180),
      body: compactText(entry.body, 1200)
    })),
    tasks: (content.tasks || []).slice(0, 12).map((entry) => ({
      id: entry.id || null,
      page: entry.page || null,
      groupLabel: compactText(entry.groupLabel, 120),
      prompt: compactText(entry.prompt, 700),
      expectedAnswer: compactText(entry.expectedAnswer, 500),
      materialRefs: entry.materialRefs || [],
      difficulty: entry.difficulty || null
    })),
    imageMaterials: (content.imageMaterials || []).slice(0, 8).map((entry) => ({
      id: entry.id || null,
      page: entry.page || null,
      prompt: compactText(entry.prompt, 500),
      purpose: compactText(entry.purpose, 300),
      placement: compactText(entry.placement, 240)
    })),
    solutionNotes: (content.solutionNotes || []).slice(0, 12).map((entry) => compactText(entry, 400))
  };
}

function compactWorkspace(workspace = {}) {
  const currentContent = workspace.documents?.content?.data || null;
  const openProposal = workspace.proposals?.latestContentMirror || null;
  return {
    project: workspace.project || null,
    teachingContext: workspace.teachingContext || null,
    inputReadiness: workspace.inputReadiness || null,
    currentConcept: compactContent(currentContent),
    openConceptProposal: openProposal ? {
      proposalId: openProposal.proposalId || null,
      title: compactText(openProposal.title, 180),
      data: compactContent(openProposal.data)
    } : null,
    conceptHistory: (workspace.artifacts?.concepts || []).slice(-8).map((concept) => ({
      id: concept.id || null,
      version: concept.version || null,
      status: concept.status || null,
      current: concept.current === true,
      title: compactText(concept.title, 180)
    })),
    candidateCount: Number(workspace.latestRun?.candidateCount || workspace.preview?.candidates?.length || 0) || 0,
    enabledActions: (workspace.commands || [])
      .filter((command) => command.enabled)
      .map((command) => ({
        id: command.id,
        requiresConfirmation: command.requiresConfirmation === true,
        confirmationKind: command.confirmationKind || null
      }))
  };
}

function planningTurnPayload(input = {}) {
  return {
    task: "Understand and answer one SheetifyIMG planning turn; request a workflow action only when explicitly authorized.",
    latestUserMessage: boundedLatestMessage(input.message),
    latestUserEventId: input.userEvent?.id || null,
    uiEvent: input.uiEvent || "chat_message",
    revisionTarget: input.revisionTarget || null,
    attachments: (input.attachments || []).map((attachment) => ({
      kind: attachment.kind || null,
      label: attachment.label || attachment.originalName || null,
      mimeType: attachment.mimeType || null,
      path: attachment.path || null,
      artifactId: attachment.artifactId || null
    })),
    workspace: compactWorkspace(input.workspace || {}),
    recentMessages: compactMessages(priorMessages(
      input.messages || input.workspace?.chat?.messages || [],
      input.userEvent?.id || null
    ))
  };
}

function teachingFieldSchema() {
  return {
    type: "object",
    additionalProperties: false,
    required: ["operation", "value", "status", "confidence", "evidence"],
    properties: {
      operation: { type: "string", enum: FIELD_OPERATIONS },
      value: { type: ["string", "null"] },
      status: { type: "string", enum: FIELD_STATUSES },
      confidence: { type: "number", minimum: 0, maximum: 1 },
      evidence: { type: ["string", "null"] }
    }
  };
}

function planningTurnSchema() {
  return {
    type: "object",
    additionalProperties: false,
    required: [
      "responseGoal",
      "requestedAction",
      "confidence",
      "target",
      "actionAuthorization",
      "negatedActions",
      "chainRequested",
      "teachingContextPatch",
      "readiness",
      "ambiguity",
      "actionHandoff",
      "visibleReply",
      "reason"
    ],
    properties: {
      responseGoal: { type: "string", enum: RESPONSE_GOALS },
      requestedAction: { type: "string", enum: Object.values(REQUESTED_ACTIONS) },
      confidence: { type: "string", enum: CONFIDENCE_LEVELS },
      target: {
        type: "object",
        additionalProperties: false,
        required: ["kind", "conceptVersion", "proposalId", "contentMirrorId", "runId", "candidateId", "page"],
        properties: {
          kind: { type: "string", enum: TARGET_KINDS },
          conceptVersion: { type: ["integer", "null"], minimum: 1 },
          proposalId: { type: ["string", "null"] },
          contentMirrorId: { type: ["string", "null"] },
          runId: { type: ["string", "null"] },
          candidateId: { type: ["string", "null"] },
          page: { type: ["integer", "null"], minimum: 1 }
        }
      },
      actionAuthorization: {
        type: "object",
        additionalProperties: false,
        required: ["explicit", "source", "evidence"],
        properties: {
          explicit: { type: "boolean" },
          source: { type: "string", enum: ["none", "explicit_message"] },
          evidence: { type: ["string", "null"] }
        }
      },
      negatedActions: {
        type: "array",
        items: { type: "string", enum: NEGATABLE_ACTIONS },
        maxItems: 8
      },
      chainRequested: { type: "boolean" },
      teachingContextPatch: {
        type: "object",
        additionalProperties: false,
        required: ["forceWithAssumptions", "forceEvidence", "fields"],
        properties: {
          forceWithAssumptions: { type: "boolean" },
          forceEvidence: { type: ["string", "null"] },
          fields: {
            type: "object",
            additionalProperties: false,
            required: TEACHING_FIELD_IDS,
            properties: Object.fromEntries(TEACHING_FIELD_IDS.map((id) => [id, teachingFieldSchema()]))
          }
        }
      },
      readiness: {
        type: "object",
        additionalProperties: false,
        required: ["status", "missing"],
        properties: {
          status: { type: "string", enum: ["needs_discussion", "usable_with_assumptions", "ready"] },
          missing: { type: "array", items: { type: "string" }, maxItems: 8 }
        }
      },
      ambiguity: {
        type: "object",
        additionalProperties: false,
        required: ["level", "reasons"],
        properties: {
          level: { type: "string", enum: ["none", "low", "medium", "high"] },
          reasons: { type: "array", items: { type: "string" }, maxItems: 4 }
        }
      },
      actionHandoff: { type: ["string", "null"] },
      visibleReply: { type: ["string", "null"] },
      reason: { type: ["string", "null"] }
    }
  };
}

function normalizeTeachingPatch(rawPatch = {}, message = "") {
  const rawFields = rawPatch.fields || {};
  const fields = {};
  for (const id of TEACHING_FIELD_IDS) {
    const raw = rawFields[id] || {};
    const requestedOperation = FIELD_OPERATIONS.includes(raw.operation) ? raw.operation : "keep";
    const evidence = textValue(raw.evidence, 300);
    const evidenceValid = requestedOperation === "keep" || evidenceAppearsInMessage(evidence, message);
    const operation = evidenceValid ? requestedOperation : "keep";
    fields[id] = {
      operation,
      value: operation === "set" ? textValue(raw.value, 600) : null,
      status: FIELD_STATUSES.includes(raw.status) ? raw.status : operation === "set" ? "known" : "missing",
      confidence: boundedNumber(raw.confidence, 0, 1, 0),
      evidence: operation === "keep" ? null : evidence
    };
  }
  const forceEvidence = textValue(rawPatch.forceEvidence, 300);
  return {
    forceWithAssumptions: rawPatch.forceWithAssumptions === true
      && evidenceAppearsInMessage(forceEvidence, message),
    forceEvidence: evidenceAppearsInMessage(forceEvidence, message) ? forceEvidence : null,
    fields
  };
}

function normalizePlanningTurn(raw = {}, message = "") {
  const requestedAction = Object.values(REQUESTED_ACTIONS).includes(raw.requestedAction)
    ? raw.requestedAction
    : REQUESTED_ACTIONS.NONE;
  const visibleReply = visibleTextValue(raw.visibleReply, MAX_REPLY_LENGTH);
  if (requestedAction === REQUESTED_ACTIONS.NONE && !visibleReply) {
    throw new Error("Planning turn did not provide a visible chat reply for a chat-only turn.");
  }
  if (requestedAction === REQUESTED_ACTIONS.NONE) {
    const narrationValidation = validateNarrationPolicy(visibleReply, { kind: "planning_chat_only" });
    if (!narrationValidation.ok) {
      throw new Error(`Planning turn visible reply violates narration policy: ${narrationValidation.reason}.`);
    }
  }
  const target = raw.target || {};
  const authorization = raw.actionAuthorization || {};
  return {
    schemaVersion: 1,
    responseGoal: RESPONSE_GOALS.includes(raw.responseGoal) ? raw.responseGoal : "acknowledge",
    requestedAction,
    confidence: CONFIDENCE_LEVELS.includes(raw.confidence) ? raw.confidence : "low",
    target: {
      kind: TARGET_KINDS.includes(target.kind) ? target.kind : "none",
      conceptVersion: Number(target.conceptVersion || 0) || null,
      proposalId: textValue(target.proposalId, 160),
      contentMirrorId: textValue(target.contentMirrorId, 160),
      runId: textValue(target.runId, 160),
      candidateId: textValue(target.candidateId, 160),
      page: Number(target.page || 0) || null
    },
    actionAuthorization: {
      explicit: authorization.explicit === true,
      source: authorization.source === "explicit_message" ? "explicit_message" : "none",
      evidence: textValue(authorization.evidence, 300)
    },
    negatedActions: [...new Set((raw.negatedActions || []).filter((action) => NEGATABLE_ACTIONS.includes(action)))],
    chainRequested: raw.chainRequested === true,
    teachingContextPatch: normalizeTeachingPatch(raw.teachingContextPatch, message),
    readiness: {
      status: ["needs_discussion", "usable_with_assumptions", "ready"].includes(raw.readiness?.status)
        ? raw.readiness.status
        : "needs_discussion",
      missing: (raw.readiness?.missing || []).map((entry) => textValue(entry, 160)).filter(Boolean).slice(0, 8)
    },
    ambiguity: {
      level: ["none", "low", "medium", "high"].includes(raw.ambiguity?.level)
        ? raw.ambiguity.level
        : "none",
      reasons: (raw.ambiguity?.reasons || []).map((entry) => textValue(entry, 200)).filter(Boolean).slice(0, 4)
    },
    actionHandoff: requestedAction === REQUESTED_ACTIONS.NONE
      ? null
      : textValue(raw.actionHandoff, 1800),
    visibleReply: requestedAction === REQUESTED_ACTIONS.NONE ? visibleReply : null,
    reason: textValue(raw.reason, 400)
  };
}

function parsePlanningTurn(outputText, message = "") {
  const text = String(outputText || "").trim();
  if (!text) {
    throw new Error("Planning turn response did not contain output text.");
  }
  return normalizePlanningTurn(JSON.parse(text), message);
}

function modelInput(payload, contentItems = []) {
  const items = [{
    type: "input_text",
    text: JSON.stringify(payload, null, 2)
  }, ...(Array.isArray(contentItems) ? contentItems : []).filter(Boolean)];
  return [{
    role: "user",
    content: items.length === 1 ? items[0].text : items
  }];
}

async function interpretPlanningTurn(projectDir, input = {}, options = {}) {
  if (typeof options.planningTurnInterpreter === "function") {
    return normalizePlanningTurn(await options.planningTurnInterpreter(input), input.message);
  }

  const env = options.env || process.env;
  const runtime = getAiRuntimeStatus(env);
  if (runtime.status !== "ready") {
    throw new Error(runtime.fallbackReason || "OpenAI is not configured.");
  }
  const requestConfig = getOpenAiRequestConfig(env);
  const route = routeForPurpose(ROUTE_PURPOSES.PLANNING_TURN, requestConfig);
  const payload = planningTurnPayload(input);
  const responseBody = {
    model: route.model || requestConfig.textModel,
    instructions: await composePrompts(route.promptNames, {
      repoRoot: options.promptRoot || options.repoRoot
    }),
    input: modelInput(payload, input.openAiContentItems),
    text: {
      format: {
        type: "json_schema",
        name: "sheetifyimg_planning_turn",
        strict: true,
        schema: planningTurnSchema()
      }
    },
    reasoning: route.reasoningEffort && route.reasoningEffort !== "none"
      ? { effort: route.reasoningEffort }
      : undefined,
    max_output_tokens: 3200,
    store: false
  };
  const requestShape = measureModelRequest(responseBody, {
    contextSections: payload
  });
  const startedAt = Date.now();
  let response = null;
  try {
    response = await createResponse(responseBody, requestConfig);
    const responseModel = response.model || route.model || requestConfig.textModel;
    const usage = response.usage || null;
    const turn = parsePlanningTurn(extractOutputText(response), input.message);
    await logModelRun(projectDir, {
      status: "success",
      source: "planning_turn",
      purpose: route.purpose,
      route: route.route,
      promptNames: route.promptNames,
      model: responseModel,
      reasoningEffort: route.reasoningEffort,
      responseId: response.id || null,
      durationMs: Date.now() - startedAt,
      usage,
      costEstimate: estimateOpenAiTextCost({ usage, model: responseModel }),
      requestShape,
      metadata: { flowVariant: "v2" },
      attribution: options.usageAttribution,
      uiEvent: input.uiEvent || "chat_message"
    }, { now: options.now });
    return {
      ...turn,
      provider: {
        name: "openai",
        responseId: response.id || null,
        model: responseModel,
        route: route.route,
        purpose: route.purpose
      }
    };
  } catch (error) {
    const responseModel = response?.model || route.model || requestConfig.textModel;
    const usage = response?.usage || null;
    await logModelRun(projectDir, {
      status: "error",
      source: "planning_turn",
      purpose: route.purpose,
      route: route.route,
      promptNames: route.promptNames,
      model: responseModel,
      reasoningEffort: route.reasoningEffort,
      responseId: response?.id || null,
      durationMs: Date.now() - startedAt,
      usage,
      costEstimate: estimateOpenAiTextCost({ usage, model: responseModel }),
      requestShape,
      metadata: { flowVariant: "v2" },
      attribution: options.usageAttribution,
      uiEvent: input.uiEvent || "chat_message",
      error: sanitizeErrorMessage(error)
    }, { now: options.now });
    throw error;
  }
}

module.exports = {
  interpretPlanningTurn,
  normalizePlanningTurn,
  planningTurnPayload,
  planningTurnSchema,
  __testing: {
    compactContent,
    compactWorkspace,
    boundedLatestMessage,
    normalizeTeachingPatch
  }
};
