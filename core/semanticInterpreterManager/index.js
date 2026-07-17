"use strict";

const { getAiRuntimeStatus, getOpenAiRequestConfig } = require("../aiConfig");
const { createResponse, extractOutputText } = require("../openaiClient");
const { logModelRun, sanitizeErrorMessage } = require("../modelRunLogger");
const { estimateOpenAiTextCost } = require("../imageCostManager");
const { measureModelRequest } = require("../modelRequestMetrics");
const { ROUTE_PURPOSES, routeForPurpose } = require("../modelRouter");
const { composePrompts } = require("../promptRegistry");

const FIELD_IDS = Object.freeze([
  "subject",
  "topic",
  "targetGroup",
  "lessonGoal",
  "worksheetType",
  "specialRequirements"
]);

const VALID_STATUSES = new Set(["known", "partial", "assumed", "missing"]);

function configuredInterpreterEnabled(options = {}, env = process.env) {
  if (options.semanticInterpreter === true) {
    return true;
  }
  if (options.semanticInterpreter === false) {
    return false;
  }
  const value = String(env.SHEETIFYIMG_SEMANTIC_INTERPRETER || "").trim().toLowerCase();
  return ["1", "true", "on", "ai", "openai", "auto"].includes(value);
}

function usableApiKey(value) {
  const text = String(value || "").trim();
  return Boolean(text) && !/test-no-network|dummy|fake|placeholder/i.test(text);
}

function semanticInterpreterAvailable(options = {}, env = process.env) {
  if (!configuredInterpreterEnabled(options, env)) {
    return false;
  }
  const runtime = getAiRuntimeStatus(env);
  return runtime.status === "ready" && usableApiKey(env.OPENAI_API_KEY);
}

function textValue(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function recentMessagesFromEvents(events = []) {
  return (events || [])
    .filter((event) => event.type === "user_message" || event.type === "assistant_message")
    .slice(-10)
    .map((event) => ({
      role: event.type === "assistant_message" ? "assistant" : "user",
      content: textValue(event.payload?.message || event.payload?.content),
      createdAt: event.createdAt || null
    }))
    .filter((entry) => entry.content);
}

function interpreterPayload(input = {}) {
  const context = input.context || {};
  const fields = context.fields || {};
  return {
    task: "Interpret the latest teacher message into teaching-context fields.",
    latestUserMessage: textValue(input.message),
    project: {
      projectName: input.project?.title || null,
      subject: input.project?.subject || null,
      topic: input.project?.topic || null,
      targetGroup: input.project?.targetGroup || input.project?.manifest?.targetGroup || null
    },
    currentTeachingContext: {
      phase: context.phase || null,
      forcedWithAssumptions: context.forcedWithAssumptions === true,
      fields: Object.fromEntries(FIELD_IDS.map((id) => [id, {
        value: fields[id]?.value || null,
        status: fields[id]?.status || "missing",
        source: fields[id]?.source || null,
        assumption: fields[id]?.assumption === true
      }]))
    },
    recentMessages: recentMessagesFromEvents(input.events)
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

function boundedConfidence(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    return 0;
  }
  return Math.max(0, Math.min(1, number));
}

function normalizeField(field = {}) {
  const value = textValue(field.value);
  const status = VALID_STATUSES.has(field.status) ? field.status : value ? "known" : "missing";
  return {
    value: value || null,
    status: value ? status : "missing",
    confidence: boundedConfidence(field.confidence),
    reason: textValue(field.reason) || null
  };
}

function normalizeSemanticInterpretation(value = {}) {
  const fields = {};
  for (const id of FIELD_IDS) {
    fields[id] = normalizeField(value.fields?.[id]);
  }
  return {
    fields,
    forceWithAssumptions: value.forceWithAssumptions === true,
    nextQuestion: textValue(value.nextQuestion) || null,
    overallReason: textValue(value.overallReason) || null
  };
}

function parseSemanticInterpretation(outputText) {
  const jsonText = jsonTextFromOutput(outputText);
  if (!jsonText) {
    return null;
  }
  return normalizeSemanticInterpretation(JSON.parse(jsonText));
}

async function interpretTeachingContext(projectDir, input = {}, options = {}) {
  if (!semanticInterpreterAvailable(options)) {
    return null;
  }
  const requestConfig = getOpenAiRequestConfig();
  const route = routeForPurpose(ROUTE_PURPOSES.SEMANTIC_INTERPRETATION, requestConfig);
  const instructions = await composePrompts(route.promptNames, {
    repoRoot: options.promptRoot || options.repoRoot
  });
  const startedAt = Date.now();
  let modelCallLogged = false;
  const payload = interpreterPayload(input);
  const responseBody = {
    model: route.model || requestConfig.textModel,
    instructions,
    input: [{
      role: "user",
      content: JSON.stringify(payload, null, 2)
    }],
    store: false,
    reasoning: route.reasoningEffort && route.reasoningEffort !== "none"
      ? { effort: route.reasoningEffort }
      : undefined
  };
  const requestShape = measureModelRequest(responseBody, {
    contextSections: payload
  });

  try {
    const response = await createResponse(responseBody, requestConfig);
    const responseModel = response.model || route.model || requestConfig.textModel;
    const usage = response.usage || null;
    const costEstimate = estimateOpenAiTextCost({
      usage,
      model: responseModel
    });
    await logModelRun(projectDir, {
      status: "success",
      source: "semantic_interpreter",
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
    const interpretation = parseSemanticInterpretation(extractOutputText(response));
    return interpretation;
  } catch (error) {
    if (!modelCallLogged) {
      await logModelRun(projectDir, {
        status: "error",
        source: "semantic_interpreter",
        purpose: route.purpose,
        route: route.route,
        promptNames: route.promptNames,
        model: route.model || requestConfig.textModel,
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

module.exports = {
  FIELD_IDS,
  configuredInterpreterEnabled,
  interpretTeachingContext,
  normalizeSemanticInterpretation,
  parseSemanticInterpretation,
  semanticInterpreterAvailable
};
