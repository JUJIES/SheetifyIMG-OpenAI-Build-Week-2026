"use strict";

const LIMITS = Object.freeze({
  path: 180,
  action: 120,
  purpose: 220,
  steps: 8,
  refsPerStep: 16
});

function compactText(value, maxLength) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (!text || text.length <= maxLength) {
    return text;
  }
  return text.slice(0, Math.max(1, maxLength - 1)).trimEnd() + "…";
}

function emptyDidacticThread() {
  return {
    path: "",
    steps: []
  };
}

function didacticThreadSchema({ nullable = false } = {}) {
  return {
    type: nullable ? ["object", "null"] : "object",
    additionalProperties: false,
    required: ["path", "steps"],
    properties: {
      path: { type: "string" },
      steps: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["id", "action", "purpose", "after", "refs"],
          properties: {
            id: { type: "string" },
            action: { type: "string" },
            purpose: { type: "string" },
            after: { type: ["string", "null"] },
            refs: { type: "array", items: { type: "string" } }
          }
        }
      }
    }
  };
}

function contentElementIds(content = {}) {
  return new Set([
    ...(Array.isArray(content.readingTexts) ? content.readingTexts : []),
    ...(Array.isArray(content.tasks) ? content.tasks : []),
    ...(Array.isArray(content.imageMaterials) ? content.imageMaterials : [])
  ].map((entry) => String(entry?.id || "").trim()).filter(Boolean));
}

function normalizeDidacticThread(value, content = {}) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return emptyDidacticThread();
  }

  const knownElementIds = contentElementIds(content);
  const usedStepIds = new Set();
  const usedElementRefs = new Set();
  const rawSteps = Array.isArray(value.steps) ? value.steps.slice(0, LIMITS.steps) : [];
  const steps = rawSteps.map((step, index) => {
    let id = compactText(step?.id, 80) || `step_${index + 1}`;
    if (usedStepIds.has(id)) {
      id = `step_${index + 1}`;
    }
    while (usedStepIds.has(id)) {
      id = `${id}_${usedStepIds.size + 1}`;
    }
    usedStepIds.add(id);

    const refs = [];
    for (const refValue of Array.isArray(step?.refs) ? step.refs : []) {
      const ref = String(refValue || "").trim();
      if (!ref || !knownElementIds.has(ref) || usedElementRefs.has(ref)) {
        continue;
      }
      usedElementRefs.add(ref);
      refs.push(ref);
      if (refs.length >= LIMITS.refsPerStep) {
        break;
      }
    }

    return {
      id,
      action: compactText(step?.action, LIMITS.action),
      purpose: compactText(step?.purpose, LIMITS.purpose),
      after: compactText(step?.after, 80) || null,
      refs
    };
  }).filter((step) => step.action || step.purpose || step.refs.length);

  const validStepIds = new Set(steps.map((step) => step.id));
  for (const step of steps) {
    if (!step.after || step.after === step.id || !validStepIds.has(step.after)) {
      step.after = null;
    }
  }

  return {
    path: compactText(value.path, LIMITS.path),
    steps
  };
}

function didacticThreadCoverage(thread, content = {}) {
  const normalized = normalizeDidacticThread(thread, content);
  const referenced = new Set(normalized.steps.flatMap((step) => step.refs));
  const taskIds = (Array.isArray(content.tasks) ? content.tasks : [])
    .map((task) => String(task?.id || "").trim())
    .filter(Boolean);
  return {
    taskCount: taskIds.length,
    referencedTaskCount: taskIds.filter((id) => referenced.has(id)).length,
    missingTaskRefs: taskIds.filter((id) => !referenced.has(id))
  };
}

module.exports = {
  LIMITS,
  didacticThreadSchema,
  didacticThreadCoverage,
  emptyDidacticThread,
  normalizeDidacticThread
};
