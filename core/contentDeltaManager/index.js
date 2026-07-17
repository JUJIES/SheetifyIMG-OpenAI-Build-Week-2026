"use strict";

const { didacticThreadSchema, normalizeDidacticThread } = require("../didacticThread");

const COLLECTIONS = Object.freeze({
  READING_TEXTS: "readingTexts",
  TASKS: "tasks",
  IMAGE_MATERIALS: "imageMaterials"
});

const OPERATIONS = Object.freeze({
  ADD: "add",
  UPDATE: "update",
  REMOVE: "remove"
});

const FIELD_CONTRACTS = Object.freeze({
  [COLLECTIONS.READING_TEXTS]: ["page", "role", "title", "body"],
  [COLLECTIONS.TASKS]: ["page", "groupLabel", "prompt", "expectedAnswer", "materialRefs", "difficulty"],
  [COLLECTIONS.IMAGE_MATERIALS]: ["page", "prompt", "purpose", "placement"]
});

const STRUCTURAL_ROOT_FIELDS = new Set([
  "outputPreference.pages",
  "outputPreference.layout",
  "outputPreference.hierarchy",
  "readingTexts.order",
  "tasks.order",
  "imageMaterials.order"
]);

const STRUCTURAL_COLLECTION_FIELDS = new Set([
  "page",
  "materialRefs",
  "role"
]);

function deepClone(value) {
  return JSON.parse(JSON.stringify(value));
}

function nullableString() {
  return { type: ["string", "null"] };
}

function nullableNumber() {
  return { type: ["number", "null"] };
}

function nullableEnum(values) {
  return { type: ["string", "null"], enum: [...values, null] };
}

function changeValueSchema(type) {
  return {
    type: "object",
    additionalProperties: false,
    required: ["change", "value"],
    properties: {
      change: { type: "boolean" },
      value: type
    }
  };
}

function orderSchema() {
  return {
    type: "object",
    additionalProperties: false,
    required: ["change", "ids"],
    properties: {
      change: { type: "boolean" },
      ids: { type: "array", items: { type: "string" } }
    }
  };
}

function entityPatchSchema(fields, properties) {
  return {
    type: "array",
    items: {
      type: "object",
      additionalProperties: false,
      required: ["operation", "id", "fields", ...Object.keys(properties)],
      properties: {
        operation: { type: "string", enum: Object.values(OPERATIONS) },
        id: { type: "string" },
        fields: { type: "array", items: { type: "string", enum: fields } },
        ...properties
      }
    }
  };
}

function contentDeltaSchema() {
  return {
    type: "object",
    additionalProperties: false,
    required: [
      "summary",
      "title",
      "outputPreference",
      "readingTextPatches",
      "taskPatches",
      "imageMaterialPatches",
      "didacticThread",
      "solutionNotes",
      "orders"
    ],
    properties: {
      summary: { type: "string" },
      title: changeValueSchema({ type: "string" }),
      outputPreference: {
        type: "object",
        additionalProperties: false,
        required: ["fields", "pages", "layout", "hierarchy"],
        properties: {
          fields: {
            type: "array",
            items: { type: "string", enum: ["pages", "layout", "hierarchy"] }
          },
          pages: nullableNumber(),
          layout: nullableString(),
          hierarchy: nullableString()
        }
      },
      readingTextPatches: entityPatchSchema(FIELD_CONTRACTS.readingTexts, {
        page: nullableNumber(),
        role: nullableEnum(["reading_text", "info_box", "source_text", "work_instruction"]),
        title: nullableString(),
        body: nullableString()
      }),
      taskPatches: entityPatchSchema(FIELD_CONTRACTS.tasks, {
        page: nullableNumber(),
        groupLabel: nullableString(),
        prompt: nullableString(),
        expectedAnswer: nullableString(),
        materialRefs: { type: ["array", "null"], items: { type: "string" } },
        difficulty: nullableString()
      }),
      imageMaterialPatches: entityPatchSchema(FIELD_CONTRACTS.imageMaterials, {
        page: nullableNumber(),
        prompt: nullableString(),
        purpose: nullableString(),
        placement: nullableString()
      }),
      didacticThread: changeValueSchema(didacticThreadSchema({ nullable: true })),
      solutionNotes: changeValueSchema({ type: "array", items: { type: "string" } }),
      orders: {
        type: "object",
        additionalProperties: false,
        required: Object.values(COLLECTIONS),
        properties: {
          readingTexts: orderSchema(),
          tasks: orderSchema(),
          imageMaterials: orderSchema()
        }
      }
    }
  };
}

function assertUniqueIds(items, label) {
  const ids = new Set();
  for (const item of items) {
    const id = String(item?.id || "").trim();
    if (!id) {
      throw new Error(`${label} contains an entry without an id.`);
    }
    if (ids.has(id)) {
      throw new Error(`${label} contains duplicate id ${id}.`);
    }
    ids.add(id);
  }
}

function normalizedFields(patch, collection) {
  const allowed = new Set(FIELD_CONTRACTS[collection]);
  const fields = Array.isArray(patch.fields) ? patch.fields : [];
  const unique = [...new Set(fields)];
  const invalid = unique.filter((field) => !allowed.has(field));
  if (invalid.length) {
    throw new Error(`${collection} patch ${patch.id} contains invalid fields: ${invalid.join(", ")}.`);
  }
  return unique;
}

function addValueForCollection(collection, patch) {
  if (collection === COLLECTIONS.READING_TEXTS) {
    if (!String(patch.body || "").trim()) {
      throw new Error(`readingTexts add ${patch.id} requires body.`);
    }
    return {
      id: patch.id,
      page: patch.page,
      role: patch.role || "reading_text",
      title: patch.title || "",
      body: patch.body || ""
    };
  }
  if (collection === COLLECTIONS.TASKS) {
    if (!String(patch.prompt || "").trim()) {
      throw new Error(`tasks add ${patch.id} requires prompt.`);
    }
    return {
      id: patch.id,
      page: patch.page,
      groupLabel: patch.groupLabel || "",
      prompt: patch.prompt || "",
      expectedAnswer: patch.expectedAnswer || "",
      materialRefs: Array.isArray(patch.materialRefs) ? patch.materialRefs : [],
      difficulty: patch.difficulty || "mittel"
    };
  }
  if (!String(patch.prompt || "").trim()) {
    throw new Error(`imageMaterials add ${patch.id} requires prompt.`);
  }
  return {
    id: patch.id,
    page: patch.page,
    prompt: patch.prompt || "",
    purpose: patch.purpose || "Arbeitsblatt-Material",
    placement: patch.placement || "auto"
  };
}

function applyEntityPatches(content, collection, patches, changedPaths) {
  const items = Array.isArray(content[collection]) ? content[collection] : [];
  assertUniqueIds(items, collection);
  const patchedIds = new Set();
  for (const patch of Array.isArray(patches) ? patches : []) {
    const id = String(patch?.id || "").trim();
    if (!id) {
      throw new Error(`${collection} patch is missing an id.`);
    }
    if (patchedIds.has(id)) {
      throw new Error(`${collection} contains more than one patch for ${id}.`);
    }
    patchedIds.add(id);
    const index = items.findIndex((item) => item.id === id);
    if (patch.operation === OPERATIONS.ADD) {
      if (index >= 0) {
        throw new Error(`${collection} entry ${id} already exists.`);
      }
      items.push(addValueForCollection(collection, { ...patch, id }));
      changedPaths.push(`${collection}.${id}.$add`);
      continue;
    }
    if (patch.operation === OPERATIONS.REMOVE) {
      if (index < 0) {
        throw new Error(`${collection} entry ${id} cannot be removed because it does not exist.`);
      }
      items.splice(index, 1);
      changedPaths.push(`${collection}.${id}.$remove`);
      continue;
    }
    if (patch.operation !== OPERATIONS.UPDATE) {
      throw new Error(`${collection} patch ${id} has an invalid operation.`);
    }
    if (index < 0) {
      throw new Error(`${collection} entry ${id} cannot be updated because it does not exist.`);
    }
    const fields = normalizedFields(patch, collection);
    if (!fields.length) {
      throw new Error(`${collection} update ${id} does not declare changed fields.`);
    }
    for (const field of fields) {
      const nextValue = patch[field];
      if (nextValue === null && field !== "page") {
        throw new Error(`${collection} update ${id}.${field} is missing its new value.`);
      }
      if (JSON.stringify(items[index][field] ?? null) === JSON.stringify(nextValue)) {
        continue;
      }
      items[index][field] = deepClone(nextValue);
      changedPaths.push(`${collection}.${id}.${field}`);
    }
  }
  content[collection] = items;
}

function applyOrder(content, collection, order, changedPaths) {
  if (!order?.change) {
    return;
  }
  const items = Array.isArray(content[collection]) ? content[collection] : [];
  const ids = Array.isArray(order.ids) ? order.ids : [];
  assertUniqueIds(items, collection);
  if (ids.length !== items.length || new Set(ids).size !== ids.length) {
    throw new Error(`${collection} order must contain every id exactly once.`);
  }
  const byId = new Map(items.map((item) => [item.id, item]));
  if (ids.some((id) => !byId.has(id))) {
    throw new Error(`${collection} order contains an unknown id.`);
  }
  const currentOrder = items.map((item) => item.id);
  if (JSON.stringify(currentOrder) !== JSON.stringify(ids)) {
    content[collection] = ids.map((id) => byId.get(id));
    changedPaths.push(`${collection}.order`);
  }
}

function visibleTextSize(content = {}) {
  return [
    content.title,
    ...(content.readingTexts || []).flatMap((entry) => [entry.title, entry.body]),
    ...(content.tasks || []).flatMap((entry) => [entry.groupLabel, entry.prompt]),
    ...(content.imageMaterials || []).flatMap((entry) => [entry.purpose, entry.prompt])
  ].map((value) => String(value || "")).join("\n").length;
}

function impactForChangeSet(baseContent, nextContent, changedPaths) {
  const structural = changedPaths.some((path) => {
    if (STRUCTURAL_ROOT_FIELDS.has(path)) {
      return true;
    }
    if (/\.(?:\$add|\$remove)$/.test(path) || path.startsWith("imageMaterials.")) {
      return true;
    }
    return [...STRUCTURAL_COLLECTION_FIELDS].some((field) => path.endsWith(`.${field}`));
  });
  const beforeSize = visibleTextSize(baseContent);
  const afterSize = visibleTextSize(nextContent);
  const sizeDelta = Math.abs(afterSize - beforeSize);
  const relativeSizeDelta = beforeSize ? sizeDelta / beforeSize : afterSize ? 1 : 0;
  const textExpansionNeedsReplan = sizeDelta > 400 || relativeSizeDelta > 0.25;
  const visibleChange = changedPaths.some((path) => {
    return path === "title"
      || /^readingTexts\..+\.(title|body|role)$/.test(path)
      || /^tasks\..+\.(groupLabel|prompt)$/.test(path)
      || path.startsWith("imageMaterials.");
  });
  return {
    imageSpecStrategy: structural || textExpansionNeedsReplan ? "regenerate" : "reuse",
    candidateStrategy: "regenerate",
    structural,
    visibleChange,
    textSizeBefore: beforeSize,
    textSizeAfter: afterSize,
    textSizeDelta: afterSize - beforeSize
  };
}

function applyContentDelta(baseContent = {}, delta = {}) {
  const content = deepClone(baseContent);
  const changedPaths = [];
  if (delta.title?.change && !String(delta.title.value || "").trim()) {
    throw new Error("A changed content title cannot be empty.");
  }
  if (delta.title?.change && content.title !== delta.title.value) {
    content.title = delta.title.value;
    changedPaths.push("title");
  }
  const outputPreference = content.outputPreference && typeof content.outputPreference === "object"
    ? content.outputPreference
    : {};
  for (const field of [...new Set(delta.outputPreference?.fields || [])]) {
    if (!["pages", "layout", "hierarchy"].includes(field)) {
      throw new Error(`outputPreference patch contains invalid field ${field}.`);
    }
    const nextValue = delta.outputPreference[field];
    if (nextValue === null && field !== "pages") {
      throw new Error(`outputPreference.${field} is missing its new value.`);
    }
    if (JSON.stringify(outputPreference[field] ?? null) !== JSON.stringify(nextValue)) {
      outputPreference[field] = nextValue;
      changedPaths.push(`outputPreference.${field}`);
    }
  }
  content.outputPreference = outputPreference;

  applyEntityPatches(content, COLLECTIONS.READING_TEXTS, delta.readingTextPatches, changedPaths);
  applyEntityPatches(content, COLLECTIONS.TASKS, delta.taskPatches, changedPaths);
  applyEntityPatches(content, COLLECTIONS.IMAGE_MATERIALS, delta.imageMaterialPatches, changedPaths);

  if (delta.didacticThread?.change) {
    if (!delta.didacticThread.value) {
      throw new Error("A changed didacticThread requires its complete new value.");
    }
    const nextThread = normalizeDidacticThread(delta.didacticThread.value, content);
    if (JSON.stringify(content.didacticThread || null) !== JSON.stringify(nextThread)) {
      content.didacticThread = nextThread;
      changedPaths.push("didacticThread");
    }
  }

  if (delta.solutionNotes?.change) {
    const nextNotes = Array.isArray(delta.solutionNotes.value) ? delta.solutionNotes.value : [];
    if (JSON.stringify(content.solutionNotes || []) !== JSON.stringify(nextNotes)) {
      content.solutionNotes = deepClone(nextNotes);
      changedPaths.push("solutionNotes");
    }
  }

  for (const collection of Object.values(COLLECTIONS)) {
    applyOrder(content, collection, delta.orders?.[collection], changedPaths);
  }

  if (!changedPaths.length) {
    throw new Error("The content delta does not change the current concept.");
  }
  return {
    content,
    changeSet: {
      strategy: "delta",
      summary: String(delta.summary || "Gezielte Konzeptaenderung").trim(),
      operationCount: changedPaths.length,
      changedPaths,
      ...impactForChangeSet(baseContent, content, changedPaths)
    }
  };
}

function compactContextForContentDelta(context = {}) {
  return {
    project: context.project || null,
    currentBrief: context.currentBrief || null,
    currentContent: context.currentContent || null,
    basisContent: context.basisContent || null,
    proposalBasis: context.proposalBasis || null,
    inputAnalyses: (Array.isArray(context.inputAnalyses) ? context.inputAnalyses : []).slice(-3),
    recentMessages: (Array.isArray(context.recentMessages) ? context.recentMessages : []).slice(-10)
  };
}

module.exports = {
  COLLECTIONS,
  OPERATIONS,
  applyContentDelta,
  compactContextForContentDelta,
  contentDeltaSchema,
  impactForChangeSet
};
