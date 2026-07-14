"use strict";

const ROUTE_PURPOSES = Object.freeze({
  ORCHESTRATOR: "orchestrator",
  LESSON_BRIEF: "lessonbrief",
  CONTENT_MIRROR: "content_mirror",
  CONTENT_DELTA: "content_delta",
  IMAGE_SPEC: "image_spec",
  CONTENT_WARNINGS: "content_warnings",
  CHAT_INTENT: "chat_intent_interpretation",
  SEMANTIC_INTERPRETATION: "semantic_interpretation",
  FINAL_CHAT: "final_chat",
  NARRATION: "narration",
  IMAGE_GENERATION: "image_generation",
  RENDER: "render"
});

const IMAGE_TERMS = [
  "bild",
  "grafik",
  "illustration",
  "comic",
  "cartoon",
  "skizze",
  "foto",
  "materialbild",
  "diagramm",
  "infografik",
  "szene",
  "visual"
];

const QUALITY_TERMS = [
  "pruefen",
  "fachlich",
  "didaktisch",
  "afb",
  "operator",
  "leichter",
  "schwerer",
  "pruefungsniveau",
  "erwartungshorizont",
  "loesung",
  "passt",
  "redundant",
  "ueberfordert"
];

function includesAny(value, terms) {
  const normalized = String(value || "")
    .toLowerCase()
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/ß/g, "ss");
  return terms.some((term) => normalized.includes(term));
}

function routeForPurpose(purpose, requestConfig = {}) {
  if (purpose === ROUTE_PURPOSES.LESSON_BRIEF) {
    return {
      purpose,
      route: "quality_reasoning",
      model: requestConfig.reasoningModel,
      promptNames: ["global", "lesson_brief"],
      reasoningEffort: "medium"
    };
  }
  if (purpose === ROUTE_PURPOSES.CONTENT_MIRROR) {
    return {
      purpose,
      route: "quality_reasoning",
      model: requestConfig.reasoningModel,
      promptNames: ["global", "content_mirror"],
      reasoningEffort: "medium"
    };
  }
  if (purpose === ROUTE_PURPOSES.CONTENT_DELTA) {
    return {
      purpose,
      route: "quality_reasoning_delta",
      model: requestConfig.reasoningModel,
      promptNames: ["global", "content_delta"],
      reasoningEffort: "medium"
    };
  }
  if (purpose === ROUTE_PURPOSES.IMAGE_SPEC) {
    return {
      purpose,
      route: "quality_reasoning",
      model: requestConfig.textModel,
      promptNames: ["global", "image_spec"],
      reasoningEffort: "medium"
    };
  }
  if (purpose === ROUTE_PURPOSES.CONTENT_WARNINGS) {
    return {
      purpose,
      route: "quality_reasoning",
      model: requestConfig.textModel,
      promptNames: ["global", "quality_check"],
      reasoningEffort: "medium"
    };
  }
  if (purpose === ROUTE_PURPOSES.CHAT_INTENT) {
    return {
      purpose,
      route: "chat_intent",
      model: requestConfig.textModel,
      promptNames: ["chat_intent_inline"],
      reasoningEffort: "high"
    };
  }
  if (purpose === ROUTE_PURPOSES.SEMANTIC_INTERPRETATION) {
    return {
      purpose,
      route: "semantic_interpretation",
      model: requestConfig.textModel,
      promptNames: ["global", "semantic_interpreter"],
      reasoningEffort: "high"
    };
  }
  if (purpose === ROUTE_PURPOSES.FINAL_CHAT) {
    return {
      purpose,
      route: "orchestrator",
      model: requestConfig.textModel,
      promptNames: ["global", "final_chat"],
      reasoningEffort: "low"
    };
  }
  if (purpose === ROUTE_PURPOSES.NARRATION) {
    return {
      purpose,
      route: "narration",
      model: requestConfig.textModel,
      promptNames: ["chat_narration_inline"],
      reasoningEffort: "low"
    };
  }
  if (purpose === ROUTE_PURPOSES.IMAGE_GENERATION) {
    return {
      purpose,
      route: "image_generation",
      model: requestConfig.imageModel,
      promptNames: [],
      reasoningEffort: null
    };
  }
  if (purpose === ROUTE_PURPOSES.RENDER) {
    return {
      purpose,
      route: "render",
      model: null,
      promptNames: [],
      reasoningEffort: null
    };
  }

  return {
    purpose: ROUTE_PURPOSES.ORCHESTRATOR,
    route: "orchestrator",
    model: requestConfig.textModel,
    promptNames: ["global", "orchestrator"],
    reasoningEffort: requestConfig.reasoningEffort || "low"
  };
}

function chatRouteForPurpose(purpose, requestConfig = {}) {
  const route = routeForPurpose(purpose, requestConfig);
  if (route.route === "render") {
    return route;
  }
  return {
    ...route,
    promptNames: ["global", "orchestrator"]
  };
}

function firstIncompleteStep(workspace = {}) {
  return (workspace.steps || []).find((step) => !step.complete)?.id || "auftrag";
}

function routeChatRequest({ input = {}, workspace = {}, requestConfig = {} } = {}) {
  const uiEvent = String(input.uiEvent || "chat_message");
  const userMessage = String(input.message || "");
  const pipelineState = input.pipelineState || firstIncompleteStep(workspace);
  const hasConcept = Boolean(workspace.documents?.brief?.data || workspace.documents?.content?.data);

  if (uiEvent === "export") {
    return routeForPurpose(ROUTE_PURPOSES.RENDER, requestConfig);
  }
  if (uiEvent === "visual_feedback") {
    return chatRouteForPurpose(ROUTE_PURPOSES.IMAGE_SPEC, requestConfig);
  }
  if (uiEvent === "quality_check" || (hasConcept && includesAny(userMessage, QUALITY_TERMS))) {
    return chatRouteForPurpose(ROUTE_PURPOSES.CONTENT_WARNINGS, requestConfig);
  }
  if (uiEvent === "generate_image" || (hasConcept && includesAny(userMessage, IMAGE_TERMS))) {
    return chatRouteForPurpose(ROUTE_PURPOSES.IMAGE_SPEC, requestConfig);
  }
  if (uiEvent === "continue" && (pipelineState === "input" || pipelineState === "auftrag")) {
    return chatRouteForPurpose(ROUTE_PURPOSES.LESSON_BRIEF, requestConfig);
  }
  if (uiEvent === "continue" && (pipelineState === "concept" || pipelineState === "content")) {
    return chatRouteForPurpose(ROUTE_PURPOSES.CONTENT_MIRROR, requestConfig);
  }
  if (uiEvent === "continue" && pipelineState === "pruefung") {
    return chatRouteForPurpose(ROUTE_PURPOSES.CONTENT_WARNINGS, requestConfig);
  }
  if (uiEvent === "continue" && (pipelineState === "drafts" || pipelineState === "entwuerfe" || pipelineState === "kandidaten")) {
    return chatRouteForPurpose(ROUTE_PURPOSES.IMAGE_SPEC, requestConfig);
  }

  return routeForPurpose(ROUTE_PURPOSES.ORCHESTRATOR, requestConfig);
}

module.exports = {
  ROUTE_PURPOSES,
  routeChatRequest,
  routeForPurpose
};
