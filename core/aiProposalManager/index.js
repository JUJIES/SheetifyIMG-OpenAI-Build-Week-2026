"use strict";

const fs = require("node:fs/promises");
const path = require("node:path");
const {
  ARTIFACT_STATUSES,
  ARTIFACT_TYPES,
  EVENT_TYPES,
  PROJECT_TYPES,
  PRODUCTION_SCHEMA_VERSION
} = require("../contracts");
const { appendEvent, readEvents } = require("../eventLog");
const { appendHistoryEvent } = require("../historyManager");
const { getAiRuntimeStatus, getOpenAiRequestConfig } = require("../aiConfig");
const { createResponse, extractOutputText } = require("../openaiClient");
const { approveLessonBriefVersion, createLessonBriefVersion } = require("../briefManager");
const { createContentMirrorVersion, hasMeaningfulContent } = require("../contentMirrorManager");
const { findArtifact, listArtifacts, readArtifactIndex } = require("../artifactManager");
const {
  conceptFrameFromLegacy,
  legacyLessonBriefFromConcept,
  conceptFrameFromTeachingContext,
  normalizeConceptFrame
} = require("../conceptCompatibility");
const { readTeachingContext } = require("../teachingContextManager");
const { createContentWarningsVersion, normalizeWarnings } = require("../contentWarningManager");
const { logModelRun, sanitizeErrorMessage } = require("../modelRunLogger");
const { estimateOpenAiTextCost } = require("../imageCostManager");
const { measureModelRequest } = require("../modelRequestMetrics");
const { ROUTE_PURPOSES, routeForPurpose } = require("../modelRouter");
const { composePrompts } = require("../promptRegistry");
const { productionContextToPrompt } = require("../productionContext");
const { openProject } = require("../projectManager");
const {
  contentReadinessForGeneration,
  contentReadinessMessage,
  requestedConstraints
} = require("../contentReadiness");
const { narrateChatMoment } = require("../chatNarrationManager");
const { inferReferencePolicy, mergeReferencePolicies } = require("../referencePolicy");
const { explicitPageCountFromText, pagePlanForImageSpec } = require("../pagePlanManager");
const { normalizeReadingTexts } = require("../readingTextManager");
const { normalizeExpectedAnswer, normalizeSolutionNotes } = require("../solutionAnchorManager");
const { normalizeTaskLabelFields } = require("../taskLabelManager");
const { createUsageAttribution } = require("../usageAttributionManager");
const {
  applyContentDelta,
  compactContextForContentDelta,
  contentDeltaSchema
} = require("../contentDeltaManager");
const {
  appliedRulesForImageSpec,
  formatSelectedRulesForPrompt,
  ruleSelectionSource,
  selectRulesForProposal
} = require("../ruleSelectionManager");

const DEFAULT_REPO_ROOT = path.resolve(__dirname, "..", "..");
const DEFAULT_PROJECTS_DIR = path.join(DEFAULT_REPO_ROOT, "projects");
const PROPOSAL_KINDS = Object.freeze({
  LESSON_BRIEF: "lessonbrief",
  CONTENT_MIRROR: "content_mirror",
  CONTENT_WARNINGS: "content_warnings",
  IMAGE_SPEC: "image_spec"
});
const RECENT_MESSAGE_BUDGET = 16;
const IMPORTANT_RECENT_MESSAGE_EXTRA_BUDGET = 8;
const ASSISTANT_MESSAGE_TAIL_CHAR_LIMIT = 700;
const ASSISTANT_MESSAGE_OLDER_CHAR_LIMIT = 320;
const IMAGE_SPEC_TEXT_LIMITS = Object.freeze({
  purpose: 180,
  visualBrief: 280,
  layoutIntent: 360,
  styleNotes: 240,
  placement: 180,
  learningFunction: 220,
  listItem: 180,
  mustShowItems: 8,
  avoidItems: 8
});

async function pathExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function readJsonIfExists(filePath) {
  if (!(await pathExists(filePath))) {
    return null;
  }
  return JSON.parse(await fs.readFile(filePath, "utf8"));
}

async function writeJson(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function listProposalFiles(projectDir) {
  const dirPath = path.join(projectDir, "proposals");
  if (!(await pathExists(dirPath))) {
    return [];
  }
  const entries = await fs.readdir(dirPath, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
    .map((entry) => path.join(dirPath, entry.name))
    .sort();
}

async function readProposals(projectDir) {
  const proposals = [];
  for (const filePath of await listProposalFiles(projectDir)) {
    const proposal = await readJsonIfExists(filePath);
    if (proposal?.proposalId && proposal.kind) {
      proposals.push(proposal);
    }
  }
  return proposals.sort((left, right) => {
    return String(left.createdAt || "").localeCompare(String(right.createdAt || ""))
      || String(left.proposalId).localeCompare(String(right.proposalId));
  });
}

function nextProposalId(proposals) {
  const numbers = proposals
    .map((proposal) => Number(String(proposal.proposalId || "").match(/^proposal_(\d+)$/)?.[1] || 0))
    .filter(Boolean);
  return `proposal_${String(Math.max(0, ...numbers) + 1).padStart(3, "0")}`;
}

async function proposalById(projectDir, proposalId) {
  const proposals = await readProposals(projectDir);
  const proposal = proposals.find((entry) => entry.proposalId === proposalId) || null;
  if (!proposal) {
    throw new Error(`Proposal does not exist: ${proposalId}`);
  }
  return proposal;
}

function latestByKind(proposals, kind, status = "proposed") {
  return proposals
    .filter((proposal) => proposal.kind === kind)
    .filter((proposal) => proposal.status === status)
    .sort((left, right) => String(right.createdAt || "").localeCompare(String(left.createdAt || ""))
      || String(right.proposalId || "").localeCompare(String(left.proposalId || "")))[0] || null;
}

async function readProposalState(projectDir) {
  const proposals = await readProposals(projectDir);
  const manifest = await readJsonIfExists(path.join(projectDir, "project-manifest.json"));
  const currentContentMirrorId = manifest?.currentArtifacts?.contentMirrorId || null;
  const activeImageSpec = proposals
    .filter((proposal) => proposal.kind === PROPOSAL_KINDS.IMAGE_SPEC && proposal.status === "adopted")
    .filter((proposal) => !currentContentMirrorId || proposal.source?.currentContentMirrorId === currentContentMirrorId)
    .sort((left, right) => String(right.createdAt || "").localeCompare(String(left.createdAt || ""))
      || String(right.proposalId || "").localeCompare(String(left.proposalId || "")))[0] || null;
  return {
    counts: {
      total: proposals.length,
      proposed: proposals.filter((proposal) => proposal.status === "proposed").length,
      adopted: proposals.filter((proposal) => proposal.status === "adopted").length
    },
    latestLessonBrief: summarizeProposal(latestByKind(proposals, PROPOSAL_KINDS.LESSON_BRIEF)),
    latestContentMirror: summarizeProposal(latestByKind(proposals, PROPOSAL_KINDS.CONTENT_MIRROR)),
    latestContentWarnings: summarizeProposal(latestByKind(proposals, PROPOSAL_KINDS.CONTENT_WARNINGS)),
    latestImageSpec: summarizeProposal(latestByKind(proposals, PROPOSAL_KINDS.IMAGE_SPEC)),
    activeImageSpec: summarizeProposal(activeImageSpec)
  };
}

function summarizeProposal(proposal) {
  if (!proposal) {
    return null;
  }
  return {
    proposalId: proposal.proposalId,
    kind: proposal.kind,
    status: proposal.status,
    createdAt: proposal.createdAt,
    title: proposal.title || titleFromProposal(proposal),
    summary: proposal.summary || "",
    conceptFrame: proposal.conceptFrame || null,
    data: proposal.data || null,
    source: proposal.source || null,
    model: proposal.createdBy?.model || null,
    path: proposal.path || null
  };
}

function titleFromProposal(proposal) {
  if (proposal.kind === PROPOSAL_KINDS.LESSON_BRIEF) {
    return proposal.data?.topic || "Arbeitsblatt-Konzept";
  }
  if (proposal.kind === PROPOSAL_KINDS.CONTENT_MIRROR) {
    return proposal.data?.title || "Arbeitsblatt-Konzept";
  }
  if (proposal.kind === PROPOSAL_KINDS.IMAGE_SPEC) {
    return proposal.data?.purpose || "Bildplanung";
  }
  return proposal.data?.summary || "Konzept-Feedback";
}

function stringOrNull(value) {
  const text = String(value || "").trim();
  return text || null;
}

function arrayOfStrings(values) {
  return (Array.isArray(values) ? values : [])
    .map((value) => String(value || "").trim())
    .filter(Boolean);
}

function normalizedSearchText(value) {
  return String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\u00df/g, "ss")
    .toLowerCase();
}

function isSolutionText(value) {
  const text = normalizedSearchText(value);
  return /\b(losung|loesung|losungsteil|loesungsteil|musterlosung|musterloesung|solution|answer key|expected answers?|erwartete antworten)\b/
    .test(text);
}

function visibleImageSpecStrings(values) {
  return arrayOfStrings(values).filter((value) => !isSolutionText(value));
}

function visibleImageSpecText(value, fallback) {
  const text = stringOrNull(value);
  if (!text || isSolutionText(text)) {
    return fallback;
  }
  return text;
}

function safeImageSpecIntentText(value, fallback) {
  const text = visibleImageSpecText(value, fallback);
  if (!text || hasImageSpecPromptConflict(text)) {
    return fallback;
  }
  return text;
}

function compactImageSpecText(value, maxChars) {
  const text = String(value || "").trim();
  if (!text || text.length <= maxChars) {
    return text;
  }
  const limit = Math.max(1, maxChars - 4);
  const clipped = text.slice(0, limit).replace(/\s+\S*$/, "").trim();
  return `${clipped || text.slice(0, limit).trim()} ...`;
}

function compactImageSpecItems(values, maxItems, maxChars) {
  return visibleImageSpecStrings(values)
    .map((value) => compactImageSpecText(value, maxChars))
    .filter(Boolean)
    .slice(0, maxItems);
}

function inferReferenceRole(text) {
  const normalized = normalizedSearchText(text);
  if (/\b(layout|aufbau|komposition|struktur|anordnung)\b/.test(normalized)) {
    return "layout_reference";
  }
  if (/\b(inhalt|motiv|gegenstand|objekt|figur|bildinhalt)\b/.test(normalized)) {
    return "content_reference";
  }
  return "style_reference";
}

function normalizeReferencePath(value) {
  const text = stringOrNull(value);
  if (!text) {
    return null;
  }
  return text.replaceAll("\\", "/").replace(/^\/+/, "");
}

function referenceImagesFromContext(context = {}) {
  const references = [];
  const seen = new Set();
  for (const entry of [
    ...(Array.isArray(context.referenceImages) ? context.referenceImages : []),
    ...(Array.isArray(context.runtimeReferenceImages) ? context.runtimeReferenceImages : [])
  ]) {
    const refPath = normalizeReferencePath(entry?.path || entry?.sourcePath);
    if (!refPath || seen.has(refPath)) {
      continue;
    }
    seen.add(refPath);
    references.push({
      id: entry.id || `ref_${String(references.length + 1).padStart(2, "0")}`,
      role: entry.role || "style_reference",
      path: refPath,
      purpose: entry.purpose || "Referenzbild",
      scope: entry.scope || "next_candidate",
      source: entry.source || null
    });
  }
  for (const message of context.recentMessages || []) {
    for (const attachment of message.attachments || []) {
      if (attachment.kind !== "visual_feedback") {
        continue;
      }
      const refPath = normalizeReferencePath(attachment.path);
      if (!refPath || seen.has(refPath)) {
        continue;
      }
      seen.add(refPath);
      references.push({
        id: `ref_${String(references.length + 1).padStart(2, "0")}`,
        role: inferReferenceRole(`${message.message || ""} ${attachment.label || ""}`),
        path: refPath,
        purpose: attachment.label || "Referenzbild aus dem Chat",
        scope: attachment.scope || "next_candidate",
        source: attachment.source || null
      });
    }
  }
  return references.slice(-4);
}

function normalizeReferenceImages(values = [], context = {}) {
  const fromModel = (Array.isArray(values) ? values : [])
    .map((entry, index) => {
      const refPath = normalizeReferencePath(entry?.path || entry?.sourcePath);
      return refPath ? {
        id: stringOrNull(entry.id) || `ref_${String(index + 1).padStart(2, "0")}`,
        role: stringOrNull(entry.role) || "style_reference",
        path: refPath,
        purpose: stringOrNull(entry.purpose) || "Referenzbild",
        scope: stringOrNull(entry.scope) || "next_candidate",
        source: entry.source || null
      } : null;
    })
    .filter(Boolean);
  const combined = [...fromModel, ...referenceImagesFromContext(context)];
  const seen = new Set();
  return combined
    .filter((entry) => {
      if (!entry.path || seen.has(entry.path)) {
        return false;
      }
      seen.add(entry.path);
      return true;
    })
    .slice(-4)
    .map((entry, index) => ({
      id: entry.id || `ref_${String(index + 1).padStart(2, "0")}`,
      role: entry.role || "style_reference",
      path: entry.path,
      purpose: entry.purpose || "Referenzbild",
      scope: entry.scope || "next_candidate",
      source: entry.source || null
    }));
}

function hasImageSpecPromptConflict(value) {
  const text = normalizedSearchText(value);
  return /\b(16:9|landscape|horizontal|square|quadratisch|querformat|2:3)\b/.test(text)
    || /\b(losungsteil|loesungsteil|musterlosung|musterloesung|answer key|solution section|erwartete antworten|expected answers?)\b/.test(text)
    || /\b(show|visible|sichtbar|anzeigen|abbilden)\b.{0,60}\b(losung|loesung|solution|answer|antwort)\b/.test(text);
}

function validateLessonBrief(data = {}, project) {
  const outputPreference = data.outputPreference || {};
  const brief = {
    subject: stringOrNull(data.subject) || project.subject || null,
    topic: stringOrNull(data.topic) || project.topic || project.title,
    targetGroup: stringOrNull(data.targetGroup) || project.manifest?.targetGroup || null,
    goal: stringOrNull(data.goal) || "Unterrichtsmaterial strukturiert vorbereiten.",
    requirements: arrayOfStrings(data.requirements),
    outputPreference: {
      format: stringOrNull(outputPreference.format) || "A4",
      pages: Number(outputPreference.pages) > 0 ? Number(outputPreference.pages) : null,
      layout: stringOrNull(outputPreference.layout) || "auto",
      style: stringOrNull(outputPreference.style) || "klar"
    },
    teacherNotes: arrayOfStrings(data.teacherNotes)
  };
  if (!brief.topic || !brief.goal) {
    throw new Error("Lesson brief proposal is missing topic or goal.");
  }
  return brief;
}

function normalizeOutputPreference(value = {}) {
  return {
    pages: Number(value.pages) > 0 ? Number(value.pages) : null,
    layout: stringOrNull(value.layout) || "auto",
    hierarchy: stringOrNull(value.hierarchy) || "auto"
  };
}

function normalizePageNumber(value) {
  const page = Number(value || 0);
  return Number.isInteger(page) && page > 0 ? page : null;
}

function contextTextForOutputPreference(content = {}, context = {}) {
  const teacherMessages = [
    ...(context.teacherInput?.messages || []).map((entry) => entry.message),
    ...(context.recentMessages || []).map((entry) => entry.message)
  ];
  return [
    content.title,
    content.outputPreference?.layout,
    content.outputPreference?.hierarchy,
    ...teacherMessages,
    ...(Array.isArray(content.solutionNotes) ? content.solutionNotes : []),
    ...(Array.isArray(content.readingTexts) ? content.readingTexts.flatMap((entry) => [entry.title, entry.body]) : []),
    ...(Array.isArray(content.imageMaterials)
      ? content.imageMaterials.flatMap((entry) => [entry.prompt, entry.purpose, entry.placement])
      : [])
  ].filter(Boolean).join("\n");
}

function inferContentOutputPreference(content = {}, context = {}) {
  const existing = normalizeOutputPreference(content.outputPreference || {});
  const text = contextTextForOutputPreference(content, context);
  const normalized = normalizedSearchText(text);
  const explicitPages = existing.pages || explicitPageCountFromText(text) || null;
  const wantsTaskSheet = /\b(aufgabenseite|aufgabenblatt|reines aufgabenblatt|nur aufgaben|task sheet|worksheet with tasks|single task sheet)\b/.test(normalized);
  const wantsMinimalHierarchy = /\b(keine doppelte|keine redundante|redundante hierarchie|nur eine hauptuberschrift|nur eine hauptueberschrift|ueberschrift reicht|uberschrift reicht|minimal)\b/.test(normalized);
  const inferredPages = explicitPages || (wantsTaskSheet ? 1 : null);
  return {
    pages: inferredPages,
    layout: existing.layout !== "auto"
      ? existing.layout
      : inferredPages === 1 && ((Array.isArray(content.tasks) && content.tasks.length > 0) || wantsTaskSheet)
        ? "single_task_sheet"
        : wantsTaskSheet
          ? "task_sheet"
          : "auto",
    hierarchy: existing.hierarchy !== "auto"
      ? existing.hierarchy
      : wantsMinimalHierarchy || wantsTaskSheet
        ? "minimal"
        : "auto"
  };
}

const EXCLUDED_UNSAFE_TERMS = "(?:sezier\\w*|schweineauge\\w*|schweineaugen|rinderauge\\w*|rinderaugen|tierauge\\w*|tieraugen|messer\\w*|skalpell\\w*|metzger\\w*|schneidewerkzeug\\w*|praeparation\\w*|präparation\\w*|feuer|kerze\\w*)";
const EXCLUDED_UNSAFE_PREFIX = "(?:kein(?:e|en|er|es)?|ohne|nicht\\s+mit|niemals\\s+mit|ausdruecklich\\s+ohne|ausdrücklich\\s+ohne)";
const EXCLUDED_UNSAFE_CHUNK = `\\b${EXCLUDED_UNSAFE_PREFIX}\\s+(?:(?:[\\p{L}-]+)\\s+){0,4}${EXCLUDED_UNSAFE_TERMS}\\b`;
const EXCLUDED_UNSAFE_LIST = new RegExp(
  `${EXCLUDED_UNSAFE_CHUNK}(?:\\s*(?:,|und|oder)\\s*${EXCLUDED_UNSAFE_CHUNK})*[.!;,]?`,
  "giu"
);
const EXCLUDED_UNSAFE_SUBSTITUTION = new RegExp(
  `\\b(?:statt|anstelle\\s+von)\\s+(?:einer\\s+|einem\\s+|dem\\s+|der\\s+)?${EXCLUDED_UNSAFE_TERMS}\\b`,
  "giu"
);

function removeExcludedUnsafeMentions(value) {
  const text = stringOrNull(value);
  if (!text) {
    return text;
  }
  return text
    .replace(EXCLUDED_UNSAFE_LIST, "")
    .replace(EXCLUDED_UNSAFE_SUBSTITUTION, "mit sicherem Modell")
    .replace(/\s+([.,;:!?])/g, "$1")
    .replace(/\s{2,}/g, " ")
    .replace(/,\s*\./g, ".")
    .replace(/\.\s*\./g, ".")
    .trim();
}

function validateContentMirror(data = {}, project) {
  const rawReadingTexts = Array.isArray(data.readingTexts) ? data.readingTexts : [];
  const readingTexts = normalizeReadingTexts(rawReadingTexts, {
    cleanText: removeExcludedUnsafeMentions
  }).map((entry, index) => ({
    ...entry,
    page: normalizePageNumber(rawReadingTexts[index]?.page || rawReadingTexts[index]?.pageNumber)
  }));
  const tasks = (Array.isArray(data.tasks) ? data.tasks : []).map((task, index) => {
    const normalizedTask = normalizeTaskLabelFields(task, index, {
      cleanText: removeExcludedUnsafeMentions,
      fallbackPrompt: "Bearbeite die Aufgabe."
    });
    return {
      id: normalizedTask.id,
      page: normalizePageNumber(task.page || task.pageNumber),
      groupLabel: normalizedTask.groupLabel,
      prompt: normalizedTask.prompt,
      expectedAnswer: normalizeExpectedAnswer(task.expectedAnswer, {
        cleanText: removeExcludedUnsafeMentions
      }),
      materialRefs: arrayOfStrings(task.materialRefs),
      difficulty: stringOrNull(task.difficulty) || "mittel"
    };
  }).filter((task) => task.prompt);
  const imageMaterials = (Array.isArray(data.imageMaterials) ? data.imageMaterials : []).map((material, index) => ({
    id: stringOrNull(material.id) || `image_${index + 1}`,
    page: normalizePageNumber(material.page || material.pageNumber),
    prompt: removeExcludedUnsafeMentions(material.prompt) || removeExcludedUnsafeMentions(material.description) || "",
    purpose: removeExcludedUnsafeMentions(material.purpose) || "Arbeitsblatt-Material",
    placement: removeExcludedUnsafeMentions(material.placement) || "auto"
  })).filter((material) => material.prompt);
  const content = {
    title: stringOrNull(data.title) || project.title,
    outputPreference: normalizeOutputPreference(data.outputPreference || {}),
    readingTexts,
    tasks: tasks.length ? tasks : [{
      id: "task_1",
      groupLabel: "",
      prompt: "Bearbeite die Aufgabe anhand des Materials.",
      expectedAnswer: "",
      materialRefs: [],
      difficulty: "mittel"
    }],
    imageMaterials,
    solutionNotes: normalizeSolutionNotes(data.solutionNotes, {
      cleanText: removeExcludedUnsafeMentions
    })
  };
  if (!content.title || content.tasks.length === 0) {
    throw new Error("Content mirror proposal is missing title or tasks.");
  }
  return content;
}

function proposalContextEvents(context = {}) {
  const messages = [
    ...(context.teacherInput?.messages || []),
    ...(context.recentMessages || []).filter((entry) => entry.role === "user")
  ];
  const seen = new Set();
  return messages.filter((entry) => {
    const key = messageDedupeKey(entry);
    if (!key || seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  }).map((entry) => ({
    type: EVENT_TYPES.USER_MESSAGE,
    payload: {
      message: entry.message || ""
    }
  }));
}

function normalizeContentMirrorForContext(content, context = {}) {
  const contentWithOutputPreference = {
    ...content,
    outputPreference: inferContentOutputPreference(content, context)
  };
  const constraints = requestedConstraints({
    events: proposalContextEvents(context),
    brief: context.currentBrief || {}
  });
  if (constraints.requiresSolution) {
    return contentWithOutputPreference;
  }
  return {
    ...contentWithOutputPreference,
    solutionNotes: []
  };
}

function validateWarnings(data = {}) {
  return normalizeWarnings({
    summary: data.summary || "",
    warnings: data.warnings || []
  }, {
    source: "ai_proposal"
  });
}

function validateImageSpec(data = {}, project, context = {}, ruleSelection = {}) {
  const aspectRatio = "portrait_a4_page";
  const textPolicy = "approved_text_only";
  const style = stringOrNull(data.style) || "clean_scientific";
  const topic = stringOrNull(data.topic) || project.topic || project.title;
  const purpose = compactImageSpecText(
    visibleImageSpecText(data.purpose, "Arbeitsblattseite aus Arbeitsblatt-Konzept"),
    IMAGE_SPEC_TEXT_LIMITS.purpose
  );
  const placement = compactImageSpecText(
    visibleImageSpecText(data.placement, "DIN-A4-Arbeitsblattseite"),
    IMAGE_SPEC_TEXT_LIMITS.placement
  );
  const visualBrief = compactImageSpecText(
    safeImageSpecIntentText(
      data.visualBrief || data.finalPrompt,
      `Visuelle Umsetzung einer vollstaendigen DIN-A4-Arbeitsblattseite zum Thema ${topic}.`
    ),
    IMAGE_SPEC_TEXT_LIMITS.visualBrief
  );
  const layoutIntent = compactImageSpecText(
    safeImageSpecIntentText(
      data.layoutIntent,
      "Klare A4-Arbeitsblattseite mit Titelbereich, Material-/Bildbereich, Aufgabenbereich und gut scanbarer Hierarchie."
    ),
    IMAGE_SPEC_TEXT_LIMITS.layoutIntent
  );
  const styleNotes = compactImageSpecText(
    safeImageSpecIntentText(
      data.styleNotes,
      "Ruhig, druckfreundlich, gut lesbar, schulisch, ohne dekorative Ueberladung."
    ),
    IMAGE_SPEC_TEXT_LIMITS.styleNotes
  );
  const mustShow = compactImageSpecItems(
    data.mustShow,
    IMAGE_SPEC_TEXT_LIMITS.mustShowItems,
    IMAGE_SPEC_TEXT_LIMITS.listItem
  );
  const avoid = compactImageSpecItems(
    data.avoid,
    IMAGE_SPEC_TEXT_LIMITS.avoidItems,
    IMAGE_SPEC_TEXT_LIMITS.listItem
  );
  const appliedRules = appliedRulesForImageSpec(ruleSelection);

  const referenceImages = normalizeReferenceImages(data.referenceImages, context);
  const { referencePolicy: ignoredReferencePolicy, ...imageSpecForGuardrails } = data;
  const guardrailReferencePolicy = inferReferencePolicy({
    project,
    lessonBrief: context.currentBrief || {},
    contentMirror: context.currentContent || {},
    imageSpec: imageSpecForGuardrails,
    referenceImages
  });
  const referencePolicy = mergeReferencePolicies(data.referencePolicy, guardrailReferencePolicy, {
    referenceImages
  });
  const pagePlan = pagePlanForImageSpec(context.currentContent || {}, context.currentBrief || {}, data);
  const imageSpec = {
    purpose,
    visualBrief,
    layoutIntent,
    style,
    styleNotes,
    topic,
    placement,
    learningFunction: compactImageSpecText(
      visibleImageSpecText(data.learningFunction, "Material veranschaulichen"),
      IMAGE_SPEC_TEXT_LIMITS.learningFunction
    ),
    pageRole: stringOrNull(data.pageRole) || null,
    pageNumber: Number(data.pageNumber) > 0 ? Number(data.pageNumber) : null,
    imageMaterialId: stringOrNull(data.imageMaterialId) || null,
    mustShow,
    avoid,
    referenceImages,
    referencePolicy,
    appliedRules,
    pageCount: pagePlan.pageCount,
    pagePlan: pagePlan.pages,
    aspectRatio,
    textPolicy,
    promptPreview: [
      "ImageSpec preview: strukturierte Bildabsicht, nicht der direkt gesendete Bildprompt.",
      `Visual brief: ${visualBrief}`,
      `Layout intent: ${layoutIntent}`,
      `Style: ${style}. ${styleNotes}`,
      `Must show: ${mustShow.join(", ") || topic}`,
      `Must avoid: ${avoid.join(", ") || "decorative clutter, logos, watermarks"}`
    ].join("\n")
  };
  imageSpec.finalPrompt = imageSpec.promptPreview;

  if (!imageSpec.topic || !imageSpec.visualBrief || !imageSpec.layoutIntent) {
    throw new Error("ImageSpec proposal is missing topic, visualBrief or layoutIntent.");
  }
  return imageSpec;
}

function lessonBriefSchema() {
  return {
    type: "object",
    additionalProperties: false,
    required: ["subject", "topic", "targetGroup", "goal", "requirements", "outputPreference", "teacherNotes"],
    properties: {
      subject: { type: ["string", "null"] },
      topic: { type: "string" },
      targetGroup: { type: ["string", "null"] },
      goal: { type: "string" },
      requirements: { type: "array", items: { type: "string" } },
      outputPreference: {
        type: "object",
        additionalProperties: false,
        required: ["format", "pages", "layout", "style"],
        properties: {
          format: { type: "string" },
          pages: { type: ["number", "null"] },
          layout: { type: "string" },
          style: { type: "string" }
        }
      },
      teacherNotes: { type: "array", items: { type: "string" } }
    }
  };
}

function conceptFrameSchema() {
  return {
    type: "object",
    additionalProperties: false,
    required: ["subject", "topic", "targetGroup", "goal", "requirements", "teacherNotes", "visualStyle"],
    properties: {
      subject: { type: ["string", "null"] },
      topic: { type: "string" },
      targetGroup: { type: ["string", "null"] },
      goal: { type: "string" },
      requirements: { type: "array", items: { type: "string" } },
      teacherNotes: { type: "array", items: { type: "string" } },
      visualStyle: { type: "string" }
    }
  };
}

function contentMirrorSchema() {
  return {
    type: "object",
    additionalProperties: false,
    required: ["title", "outputPreference", "readingTexts", "tasks", "imageMaterials", "solutionNotes"],
    properties: {
      title: { type: "string" },
      outputPreference: {
        type: "object",
        additionalProperties: false,
        required: ["pages", "layout", "hierarchy"],
        properties: {
          pages: { type: ["number", "null"] },
          layout: { type: "string" },
          hierarchy: { type: "string" }
        }
      },
      readingTexts: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["id", "page", "pageNumber", "role", "title", "body"],
          properties: {
            id: { type: "string" },
            page: { type: ["number", "null"] },
            pageNumber: { type: ["number", "null"] },
            role: {
              type: "string",
              enum: ["reading_text", "info_box", "source_text", "work_instruction"]
            },
            title: { type: "string" },
            body: { type: "string" }
          }
        }
      },
      tasks: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["id", "page", "pageNumber", "groupLabel", "prompt", "expectedAnswer", "materialRefs", "difficulty"],
          properties: {
            id: { type: "string" },
            page: { type: ["number", "null"] },
            pageNumber: { type: ["number", "null"] },
            groupLabel: { type: "string" },
            prompt: { type: "string" },
            expectedAnswer: { type: "string" },
            materialRefs: { type: "array", items: { type: "string" } },
            difficulty: { type: "string" }
          }
        }
      },
      imageMaterials: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["id", "page", "pageNumber", "prompt", "purpose", "placement"],
          properties: {
            id: { type: "string" },
            page: { type: ["number", "null"] },
            pageNumber: { type: ["number", "null"] },
            prompt: { type: "string" },
            purpose: { type: "string" },
            placement: { type: "string" }
          }
        }
      },
      solutionNotes: { type: "array", items: { type: "string" } }
    }
  };
}

function unifiedConceptSchema() {
  return {
    type: "object",
    additionalProperties: false,
    required: ["conceptFrame", "content"],
    properties: {
      conceptFrame: conceptFrameSchema(),
      content: contentMirrorSchema()
    }
  };
}

function unifiedConceptDeltaSchema() {
  const nullableFrame = {
    ...conceptFrameSchema(),
    type: ["object", "null"]
  };
  return {
    type: "object",
    additionalProperties: false,
    required: ["frameChanged", "conceptFrame", "changes"],
    properties: {
      frameChanged: { type: "boolean" },
      conceptFrame: nullableFrame,
      changes: contentDeltaSchema()
    }
  };
}

function warningsSchema() {
  return {
    type: "object",
    additionalProperties: false,
    required: ["summary", "warnings"],
    properties: {
      summary: { type: "string" },
      warnings: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["id", "severity", "target", "category", "message", "recommendation"],
          properties: {
            id: { type: "string" },
            severity: { type: "string", enum: ["low", "medium", "high", "error"] },
            target: { type: "string" },
            category: { type: "string" },
            message: { type: "string" },
            recommendation: { type: "string" }
          }
        }
      }
    }
  };
}

function imageSpecSchema() {
  return {
    type: "object",
    additionalProperties: false,
    required: [
      "purpose",
      "visualBrief",
      "layoutIntent",
      "style",
      "styleNotes",
      "topic",
      "placement",
      "learningFunction",
      "pageRole",
      "pageNumber",
      "imageMaterialId",
      "mustShow",
      "avoid",
      "referenceImages",
      "referencePolicy",
      "aspectRatio",
      "textPolicy"
    ],
    properties: {
      purpose: { type: "string" },
      style: { type: "string" },
      topic: { type: "string" },
      placement: { type: "string" },
      learningFunction: { type: "string" },
      pageRole: { type: ["string", "null"] },
      pageNumber: { type: ["number", "null"] },
      imageMaterialId: { type: ["string", "null"] },
      mustShow: { type: "array", items: { type: "string" } },
      avoid: { type: "array", items: { type: "string" } },
      referenceImages: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["id", "role", "path", "purpose"],
          properties: {
            id: { type: "string" },
            role: { type: "string" },
            path: { type: "string" },
            purpose: { type: "string" }
          }
        }
      },
      referencePolicy: {
        type: "object",
        additionalProperties: false,
        required: [
          "level",
          "category",
          "label",
          "reason",
          "triggers",
          "preferredSource",
          "suggestedSearchQuery",
          "suggestedAction",
          "allowImageModelToRedraw",
          "canProceedWithoutReference",
          "instructions"
        ],
        properties: {
          level: {
            type: "string",
            enum: ["none", "optional", "recommended", "required", "deterministic"]
          },
          category: { type: "string" },
          label: { type: "string" },
          reason: { type: "string" },
          triggers: { type: "array", items: { type: "string" } },
          preferredSource: {
            type: "string",
            enum: [
              "none",
              "user_upload",
              "web_reference_search",
              "user_upload_or_reference_search"
            ]
          },
          suggestedSearchQuery: { type: "string" },
          suggestedAction: { type: "string" },
          allowImageModelToRedraw: { type: "boolean" },
          canProceedWithoutReference: { type: "boolean" },
          instructions: { type: "string" }
        }
      },
      aspectRatio: { type: "string" },
      textPolicy: { type: "string" },
      visualBrief: { type: "string" },
      layoutIntent: { type: "string" },
      styleNotes: { type: "string" }
    }
  };
}

function usesContentDelta(kind, input = {}) {
  return kind === PROPOSAL_KINDS.CONTENT_MIRROR
    && input.revisionMode === "patch"
    && input.contentRevisionStrategy !== "full_snapshot";
}

function usesV2ConceptFlow(kind, input = {}) {
  return kind === PROPOSAL_KINDS.CONTENT_MIRROR
    && (input.unifiedConcept === true || input.conceptFlow === "v2");
}

function schemaForKind(kind, input = {}) {
  if (kind === PROPOSAL_KINDS.LESSON_BRIEF) {
    return { name: "sheetifyimg_lessonbrief_proposal", schema: lessonBriefSchema() };
  }
  if (kind === PROPOSAL_KINDS.CONTENT_MIRROR) {
    if (usesV2ConceptFlow(kind, input) && usesContentDelta(kind, input)) {
      return { name: "sheetifyimg_unified_worksheet_concept_delta", schema: unifiedConceptDeltaSchema() };
    }
    if (usesV2ConceptFlow(kind, input)) {
      return { name: "sheetifyimg_unified_worksheet_concept", schema: unifiedConceptSchema() };
    }
    if (usesContentDelta(kind, input)) {
      return { name: "sheetifyimg_content_delta_proposal", schema: contentDeltaSchema() };
    }
    return { name: "sheetifyimg_content_mirror_proposal", schema: contentMirrorSchema() };
  }
  if (kind === PROPOSAL_KINDS.IMAGE_SPEC) {
    return { name: "sheetifyimg_image_spec_proposal", schema: imageSpecSchema() };
  }
  return { name: "sheetifyimg_content_warnings_proposal", schema: warningsSchema() };
}

function compactAttachments(attachments = []) {
  return (Array.isArray(attachments) ? attachments : [])
    .filter((attachment) => attachment && attachment.kind)
    .map((attachment) => ({
      kind: attachment.kind,
      label: attachment.label || null,
      originalName: attachment.originalName || attachment.source?.originalName || null,
      mimeType: attachment.mimeType || attachment.source?.mimeType || null,
      artifactId: attachment.artifactId || attachment.source?.artifactId || null,
      path: attachment.path || null,
      source: attachment.source || null
    }));
}

function compactContextRefs(contextRefs = null) {
  if (!contextRefs || typeof contextRefs !== "object") {
    return null;
  }
  const inputUploads = (Array.isArray(contextRefs.inputUploads) ? contextRefs.inputUploads : [])
    .map((entry) => ({
      kind: "input_upload",
      label: entry.label || entry.originalName || null,
      originalName: entry.originalName || null,
      mimeType: entry.mimeType || null,
      artifactId: entry.artifactId || null,
      path: entry.path || null,
      modelInput: entry.modelInput || null
    }))
    .filter((entry) => entry.label || entry.path || entry.artifactId);
  if (!inputUploads.length) {
    return null;
  }
  return {
    kind: contextRefs.kind || "input_upload_analysis",
    sourceUserMessage: String(contextRefs.sourceUserMessage || "").trim() || null,
    inputUploads
  };
}

function truncateContextText(value, maxChars) {
  const text = String(value || "").trim();
  if (!text || text.length <= maxChars) {
    return text;
  }
  const clipped = text.slice(0, maxChars).replace(/\s+\S*$/, "").trim();
  return `${clipped || text.slice(0, maxChars).trim()} ...`;
}

function hasImportantRecentContext(message = {}) {
  return Boolean(message.contextRefs)
    || (Array.isArray(message.attachments) && message.attachments.length > 0);
}

function budgetRecentMessage(message = {}, isTailMessage = false) {
  if (message.role !== "assistant") {
    return message;
  }
  const maxChars = isTailMessage
    ? ASSISTANT_MESSAGE_TAIL_CHAR_LIMIT
    : ASSISTANT_MESSAGE_OLDER_CHAR_LIMIT;
  const compactedMessage = truncateContextText(message.message, maxChars);
  return {
    ...message,
    message: compactedMessage,
    compacted: compactedMessage !== String(message.message || "").trim() ? true : undefined
  };
}

function budgetRecentMessages(messages = []) {
  const tailStart = Math.max(0, messages.length - RECENT_MESSAGE_BUDGET);
  const selectedIndexes = new Set();
  for (let index = tailStart; index < messages.length; index += 1) {
    selectedIndexes.add(index);
  }
  let extraImportantCount = 0;
  for (let index = tailStart - 1; index >= 0; index -= 1) {
    if (extraImportantCount >= IMPORTANT_RECENT_MESSAGE_EXTRA_BUDGET) {
      break;
    }
    if (hasImportantRecentContext(messages[index])) {
      selectedIndexes.add(index);
      extraImportantCount += 1;
    }
  }
  return messages
    .map((message, index) => selectedIndexes.has(index)
      ? budgetRecentMessage(message, index >= tailStart)
      : null)
    .filter(Boolean);
}

function recentMessagesFromEvents(events = []) {
  const messages = events
    .filter((event) => event.type === EVENT_TYPES.USER_MESSAGE || event.type === EVENT_TYPES.ASSISTANT_MESSAGE)
    .map((event) => ({
      role: event.type === EVENT_TYPES.ASSISTANT_MESSAGE ? "assistant" : "user",
      createdAt: event.createdAt || null,
      message: String(event.payload?.message || "").trim(),
      contextRefs: compactContextRefs(event.payload?.contextRefs || null),
      revisionTarget: event.payload?.revisionTarget || null,
      attachments: compactAttachments(event.payload?.attachments || [])
    }))
    .filter((entry) => entry.message || entry.attachments.length);
  return budgetRecentMessages(messages);
}

function inputMessagesFromEvents(events = []) {
  return events
    .filter((event) => event.type === EVENT_TYPES.USER_MESSAGE)
    .map((event) => ({
      createdAt: event.createdAt || null,
      message: String(event.payload?.message || "").trim(),
      revisionTarget: event.payload?.revisionTarget || null,
      attachments: compactAttachments(event.payload?.attachments || [])
    }))
    .filter((entry) => entry.message || entry.attachments.length);
}

function messageDedupeKey(entry = {}) {
  const message = String(entry.message || "").trim().replace(/\s+/g, " ").toLowerCase();
  const createdAt = String(entry.createdAt || "").trim();
  return `${createdAt}\u0000${message}`;
}

function teacherInputMessagesFromEvents(events = [], recentMessages = null) {
  const recent = Array.isArray(recentMessages) ? recentMessages : recentMessagesFromEvents(events);
  const recentUserMessageKeys = new Set(
    recent
      .filter((entry) => entry.role === "user")
      .map(messageDedupeKey)
  );
  return inputMessagesFromEvents(events)
    .filter((entry) => !recentUserMessageKeys.has(messageDedupeKey(entry)));
}

function inputAnalysesFromEvents(events = []) {
  return events
    .filter((event) => event.type === EVENT_TYPES.ASSISTANT_MESSAGE)
    .map((event) => {
      const contextRefs = compactContextRefs(event.payload?.contextRefs || null);
      return contextRefs ? {
        createdAt: event.createdAt || null,
        message: String(event.payload?.message || "").trim(),
        contextRefs
      } : null;
    })
    .filter((entry) => entry?.message)
    .slice(-8);
}

function projectContext({ project, currentBrief, currentContent, currentWarnings, teachingContext, events = [] }) {
  const recentMessages = recentMessagesFromEvents(events);
  return {
    project: {
      projectId: project.projectId,
      title: project.title,
      subject: project.subject,
      topic: project.topic,
      targetGroup: project.manifest?.targetGroup || null,
      projectType: project.projectType
    },
    teacherInput: {
      messages: teacherInputMessagesFromEvents(events, recentMessages)
    },
    inputAnalyses: inputAnalysesFromEvents(events),
    recentMessages,
    teachingContext: teachingContext || null,
    currentBrief,
    currentContent,
    currentWarnings
  };
}

function proposalBasisId(input = {}) {
  return stringOrNull(input.basisProposalId || input.proposalBasisId);
}

function contentProposalBasisFromInput(proposals = [], kind, input = {}) {
  const basisProposalId = proposalBasisId(input);
  if (!basisProposalId || kind !== PROPOSAL_KINDS.CONTENT_MIRROR) {
    return null;
  }
  const proposal = proposals.find((entry) => entry.proposalId === basisProposalId) || null;
  if (!proposal) {
    throw new Error(`Basis-Vorschlag existiert nicht: ${basisProposalId}`);
  }
  if (proposal.kind !== PROPOSAL_KINDS.CONTENT_MIRROR) {
    throw new Error(`Basis-Vorschlag ${basisProposalId} ist kein Arbeitsblatt-Konzept.`);
  }
  if (proposal.status !== "proposed") {
    throw new Error(`Basis-Vorschlag ${basisProposalId} ist nicht mehr offen.`);
  }
  return proposal;
}

function contextWithContentProposalBasis(context = {}, proposal = null) {
  if (!proposal) {
    return context;
  }
  const conceptFrame = proposal.conceptFrame || null;
  const compatibilityBrief = conceptFrame
    ? legacyLessonBriefFromConcept(conceptFrame, proposal.data || {}, context.project || {})
    : null;
  return {
    ...context,
    proposalBasis: {
      proposalId: proposal.proposalId,
      kind: proposal.kind,
      status: proposal.status,
      title: proposal.title || titleFromProposal(proposal),
      summary: proposal.summary || "",
      source: proposal.source || null
    },
    conceptFrame,
    basisContent: proposal.data || null,
    currentBrief: compatibilityBrief || context.currentBrief,
    currentContent: proposal.data || context.currentContent
  };
}

function withDeterministicPagePlan(context = {}) {
  const pagePlan = pagePlanForImageSpec(context.currentContent || {}, context.currentBrief || {}, null);
  return {
    ...context,
    deterministicPagePlan: pagePlan
  };
}

function contextWithoutPreviousConceptContent(context = {}) {
  const { currentContent: omittedCurrentContent, basisContent: omittedBasisContent, ...safeContext } = context;
  return {
    ...safeContext,
    previousConceptBoundary: {
      contentMirrorId: omittedCurrentContent?.artifactId || null,
      conceptVersion: omittedCurrentContent?.version || null,
      contentOmitted: true,
      reason: "The previous Entwurf is a design reference only; its worksheet content is not a generation source."
    }
  };
}

function purposeForKind(kind, input = {}) {
  if (kind === PROPOSAL_KINDS.LESSON_BRIEF) {
    return ROUTE_PURPOSES.LESSON_BRIEF;
  }
  if (kind === PROPOSAL_KINDS.CONTENT_MIRROR) {
    if (usesContentDelta(kind, input)) {
      return ROUTE_PURPOSES.CONTENT_DELTA;
    }
    if (usesV2ConceptFlow(kind, input)) {
      return ROUTE_PURPOSES.WORKSHEET_CONCEPT;
    }
    return ROUTE_PURPOSES.CONTENT_MIRROR;
  }
  if (kind === PROPOSAL_KINDS.IMAGE_SPEC) {
    return ROUTE_PURPOSES.IMAGE_SPEC;
  }
  return ROUTE_PURPOSES.CONTENT_WARNINGS;
}

function userPromptForKind(kind, message, input = {}) {
  const trimmed = String(message || "").trim();
  const planningHandoff = String(input.planningHandoff || "").trim();
  if (usesV2ConceptFlow(kind, input) && usesContentDelta(kind, input)) {
    return [
      "Liefere nur die minimalen strukturierten Inhaltsaenderungen und entscheide explizit, ob sich der kompakte Konzept-Rahmen aendert.",
      input.basisProposalId
        ? `Nutze den offenen Konzeptvorschlag ${input.basisProposalId} als verbindliche Basis.`
        : "Nutze currentContent und currentBrief als verbindliche Basis.",
      "Bei frameChanged=false muss conceptFrame null sein; die App uebernimmt dann den bestehenden Rahmen exakt.",
      "Bei frameChanged=true muss conceptFrame den vollstaendigen neuen Rahmen enthalten.",
      "changes darf nur ausdruecklich betroffene sichtbare Inhalte veraendern.",
      "Erhalte alle nicht angesprochenen Konzept- und Inhaltswerte unverändert.",
      planningHandoff ? `Semantischer Handoff aus dem autorisierten Planungsturn:\n${planningHandoff}` : "",
      input.revisionTarget ? `Revision target: ${JSON.stringify(input.revisionTarget)}` : "",
      trimmed ? `Lehrkraftnachricht: ${trimmed}` : ""
    ].filter(Boolean).join("\n\n");
  }
  if (usesV2ConceptFlow(kind, input)) {
    return [
      "Erzeuge jetzt in einem gemeinsamen Planungsschritt den kompakten Konzept-Rahmen und das vollständige sichtbare Arbeitsblatt-Konzept.",
      "Nutze den gesamten Unterrichtsrahmen und die sichtbare Gesprächsgenese. Die neueste ausdrückliche Lehrkraftentscheidung gewinnt.",
      ["new_concept_from_context", "followup_concept"].includes(input.revisionMode)
        ? "Erzeuge eine eigenständige neue Konzeptfassung. Nutze vorherige Inhalte nur als Kontext und übernimm Titel, Texte, Aufgaben oder Bildmaterialien nicht automatisch."
        : "Halte Konzept-Rahmen und sichtbare Inhalte fachlich deckungsgleich.",
      input.contentRelationship === "independent_design_reference"
        ? "Das vorherige Arbeitsblatt oder der genannte Entwurf ist ausschließlich eine visuelle Referenz; vermische seine Inhalte nicht mit dem neuen Konzept."
        : "",
      planningHandoff ? `Semantischer Handoff aus dem autorisierten Planungsturn:\n${planningHandoff}` : "",
      trimmed ? `Aktueller ausdrücklicher Konzeptauftrag:\n${trimmed}` : ""
    ].filter(Boolean).join("\n\n");
  }
  if (kind === PROPOSAL_KINDS.CONTENT_MIRROR && input.revisionMode === "followup_concept") {
    return [
      "Erzeuge ein neues vollstaendiges Arbeitsblatt-Konzept fuer den Folgebogen aus der unmittelbar vorherigen Aushandlung.",
      "Nutze das aktuelle Arbeitsblatt-Konzept nur als Projektkontext und thematische Anschlussstelle.",
      "Erhalte nicht automatisch Titel, Lesetexte, Aufgaben oder Bildmaterialien des bisherigen Bogens.",
      "Wenn der Gespraechskontext einen zweiten Arbeitsbogen, Folgebogen oder Projektbogen 1 nennt, muss der neue sichtbare Titel diesen Folgeschritt benennen.",
      "Baue die konkreten Marker-, Farbcode-, Bereichs-, Block- und Schildideen als sichtbare Inhalte, Aufgaben und Bildbedarf des neuen Konzepts ein.",
      "Der Fokus soll auf Planung, Abstecken und sauberem Uebertragen in Minecraft Education liegen, nicht auf direktem Bauen.",
      trimmed ? `Lehrkraftnachricht und Kontext: ${trimmed}` : ""
    ].filter(Boolean).join("\n");
  }
  if (kind === PROPOSAL_KINDS.CONTENT_MIRROR && input.revisionMode === "new_concept_from_context") {
    return [
      "Erzeuge ein neues vollstaendiges Arbeitsblatt-Konzept aus dem bisherigen Projekt- und Chatkontext.",
      "Nutze das aktuelle Arbeitsblatt-Konzept nur als Kontext, Anschlussstelle und Qualitaetsrahmen.",
      "Erhalte nicht automatisch Titel, Lesetexte, Aufgaben oder Bildmaterialien des bisherigen Konzepts.",
      input.contentRelationship === "independent_design_reference"
        ? "Der genannte Entwurf ist ausschliesslich eine spaetere Designreferenz. Uebernimm keinerlei Titel, Texte, Aufgaben, Antworten oder Bildmaterial-Inhalte daraus."
        : "",
      "Die neue Fassung soll als eigenstaendiger Konzeptvorschlag pruefbar sein.",
      "Wenn die Lehrkraft eine neue Version, einen Folgebogen, eine naechste Stunde oder eine abgewandelte Konzeptvariante meint, muss der sichtbare Titel diese neue Richtung benennen.",
      "Baue die unmittelbar ausgehandelten Ideen als sichtbare Inhalte, Aufgaben und Bildbedarf des neuen Konzepts ein.",
      trimmed ? `Lehrkraftnachricht und Kontext: ${trimmed}` : ""
    ].filter(Boolean).join("\n");
  }
  if (kind === PROPOSAL_KINDS.CONTENT_MIRROR && input.revisionMode === "patch") {
    if (usesContentDelta(kind, input)) {
      return [
        "Erzeuge nur die minimalen strukturierten Aenderungsoperationen fuer das bestehende Arbeitsblatt-Konzept.",
        input.basisProposalId
          ? `Nutze den offenen Konzeptvorschlag ${input.basisProposalId} als Bearbeitungsbasis.`
          : "Nutze currentContent als verbindliche Bearbeitungsbasis.",
        "Aendere ausschliesslich die von der Lehrkraft angesprochenen Felder und erhalte alle anderen Werte unveraendert.",
        input.revisionTarget ? `Revision target: ${JSON.stringify(input.revisionTarget)}` : "",
        trimmed ? `Lehrkraftnachricht: ${trimmed}` : ""
      ].filter(Boolean).join("\n");
    }
    return [
      "Fuehre eine gezielte Patch-Ueberarbeitung des bestehenden Arbeitsblatt-Konzepts aus.",
      input.basisProposalId
        ? `Nutze den offenen Konzeptvorschlag ${input.basisProposalId} als Bearbeitungsbasis, nicht automatisch die gespeicherte Konzeptversion.`
        : "",
      "Aendere nur die Teile, die durch die Lehrkraftnachricht betroffen sind.",
      "Lasse Titel, Texte, Aufgaben, Loesungshinweise, Bildmaterialien, Zielgruppe, Struktur und Umfang unveraendert, sofern sie nicht ausdruecklich angesprochen werden.",
      input.preserveUnmentionedConceptParts === false
        ? "Wenn eine groessere Neuformulierung wirklich noetig ist, darfst du sie knapp begruenden."
        : "Schreibe das Konzept nicht komplett neu und erfinde keine neuen Aufgaben oder Texte.",
      input.revisionTarget ? `Revision target: ${JSON.stringify(input.revisionTarget)}` : "",
      trimmed ? `Lehrkraftnachricht: ${trimmed}` : ""
    ].filter(Boolean).join("\n");
  }
  if (trimmed) {
    return trimmed;
  }
  if (kind === PROPOSAL_KINDS.LESSON_BRIEF) {
    return "Erzeuge einen Vorschlag fuer das Arbeitsblatt-Konzept aus dem aktuellen Projektstand.";
  }
  if (kind === PROPOSAL_KINDS.CONTENT_MIRROR) {
    return "Erzeuge Aufgaben, Material und Loesungshinweise fuer das Arbeitsblatt-Konzept.";
  }
  if (kind === PROPOSAL_KINDS.IMAGE_SPEC) {
    return "Leite intern die Bildplanung aus dem Arbeitsblatt-Konzept ab.";
  }
  return "Erzeuge internes Konzept-Feedback fuer das aktuelle Arbeitsblatt-Konzept.";
}

function parseStructuredResponse(response) {
  const text = extractOutputText(response);
  if (!text) {
    throw new Error("Structured response did not contain output text.");
  }
  return JSON.parse(text);
}

function sameConceptFrame(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function currentConceptFrame(context = {}, project = {}) {
  if (context.conceptFrame) {
    return normalizeConceptFrame(context.conceptFrame, project);
  }
  if (context.currentBrief) {
    return conceptFrameFromLegacy(context.currentBrief, project);
  }
  return null;
}

function resolveV2DeltaConceptFrame(raw = {}, context = {}, project = {}) {
  if (typeof raw.frameChanged !== "boolean") {
    throw new Error("Unified concept delta must declare frameChanged.");
  }
  const baseFrame = currentConceptFrame(context, project);
  if (!baseFrame) {
    throw new Error("Unified concept delta requires an existing concept frame.");
  }
  if (raw.frameChanged === false) {
    if (raw.conceptFrame !== null) {
      throw new Error("Unified concept delta with frameChanged=false must return conceptFrame=null.");
    }
    const teachingContextFrame = conceptFrameFromTeachingContext(
      context.teachingContext || {},
      baseFrame,
      project
    );
    if (!sameConceptFrame(baseFrame, teachingContextFrame)) {
      throw new Error("Unified concept delta cannot preserve a frame that conflicts with the current teaching context.");
    }
    return {
      frameChanged: false,
      conceptFrame: baseFrame
    };
  }
  if (!raw.conceptFrame || typeof raw.conceptFrame !== "object" || Array.isArray(raw.conceptFrame)) {
    throw new Error("Unified concept delta with frameChanged=true requires a complete conceptFrame.");
  }
  const nextFrame = conceptFrameFromTeachingContext(
    context.teachingContext || {},
    normalizeConceptFrame(raw.conceptFrame, project),
    project
  );
  if (sameConceptFrame(baseFrame, nextFrame)) {
    throw new Error("Unified concept delta declared a frame change but returned the existing frame.");
  }
  return {
    frameChanged: true,
    conceptFrame: nextFrame
  };
}

async function modelProposalData(kind, project, context, input, runtime, logContext = {}) {
  const requestConfig = getOpenAiRequestConfig();
  const contentDelta = usesContentDelta(kind, input);
  const v2Concept = usesV2ConceptFlow(kind, input);
  const generationMode = v2Concept
    ? contentDelta ? "unified_concept_delta" : "unified_concept"
    : contentDelta
      ? "content_delta"
      : "full_snapshot";
  const structured = schemaForKind(kind, input);
  const route = routeForPurpose(purposeForKind(kind, input), requestConfig);
  const baseModelContext = kind === PROPOSAL_KINDS.IMAGE_SPEC
    ? withDeterministicPagePlan(context)
    : contentDelta
      ? compactContextForContentDelta(context)
      : input.contentRelationship === "independent_design_reference"
        ? contextWithoutPreviousConceptContent(context)
        : context;
  const runtimeReferenceImages = normalizeReferenceImages(input.referenceImages || [], {});
  const ruleSelection = await selectRulesForProposal({
    kind,
    project,
    context,
    input,
    repoRoot: logContext.repoRoot
  });
  const modelContext = {
    ...baseModelContext,
    ...(String(input.planningHandoff || "").trim()
      ? { planningHandoff: String(input.planningHandoff).trim() }
      : {}),
    ...(runtimeReferenceImages.length ? { runtimeReferenceImages } : {}),
    ruleSelection: ruleSelectionSource(ruleSelection)
  };
  const selectedRulesPrompt = formatSelectedRulesForPrompt(ruleSelection);
  const startedAt = Date.now();
  const responseBody = {
    model: route.model || requestConfig.textModel,
    instructions: [
      await composePrompts(route.promptNames, { repoRoot: logContext.repoRoot }),
      selectedRulesPrompt
    ].filter(Boolean).join("\n\n---\n\n"),
    input: [
      {
        role: "developer",
        content: productionContextToPrompt({
          app: "SheetifyIMG",
          createdAt: input.now || logContext.now || new Date().toISOString(),
          uiEvent: input.uiEvent || "proposal_generation",
          route: {
            purpose: route.purpose,
            route: route.route,
            promptNames: route.promptNames
          },
          userMessage: String(input.message || "").trim() || null,
          canvasFocus: input.canvasFocus || null,
          revisionTarget: input.revisionTarget || null,
          revisionMode: input.revisionMode || null,
          contentRelationship: input.contentRelationship || null,
          basisProposalId: input.basisProposalId || null,
          preserveUnmentionedConceptParts: input.preserveUnmentionedConceptParts === true,
          projectState: modelContext
        })
      },
      {
        role: "user",
        content: userPromptForKind(kind, input.message, input)
      }
    ],
    text: {
      format: {
        type: "json_schema",
        name: structured.name,
        strict: true,
        schema: structured.schema
      }
    },
    store: false
  };
  if (route.reasoningEffort && route.reasoningEffort !== "none") {
    responseBody.reasoning = { effort: route.reasoningEffort };
  }
  const requestShape = measureModelRequest(responseBody, {
    contextSections: modelContext
  });

  let response;
  let parsedResult;
  try {
    response = await createResponse(responseBody, requestConfig);
    const raw = parseStructuredResponse(response);
    const rawContent = v2Concept
      ? contentDelta ? raw.changes : raw.content
      : raw;
    const deltaResult = contentDelta
      ? applyContentDelta(context.currentContent || {}, rawContent)
      : null;
    let data = kind === PROPOSAL_KINDS.LESSON_BRIEF
      ? validateLessonBrief(rawContent, project)
      : kind === PROPOSAL_KINDS.CONTENT_MIRROR
        ? validateContentMirror(deltaResult?.content || rawContent, project)
        : kind === PROPOSAL_KINDS.IMAGE_SPEC
          ? validateImageSpec(rawContent, project, modelContext, ruleSelection)
        : validateWarnings(rawContent);
    if (kind === PROPOSAL_KINDS.CONTENT_MIRROR) {
      data = normalizeContentMirrorForContext(data, context);
    }
    const deltaFrame = v2Concept && contentDelta
      ? resolveV2DeltaConceptFrame(raw, context, project)
      : null;
    const modelFrame = deltaFrame?.conceptFrame
      || (v2Concept ? normalizeConceptFrame(raw.conceptFrame, project) : context.conceptFrame || null);
    parsedResult = {
      data,
      conceptFrame: deltaFrame
        ? deltaFrame.conceptFrame
        : modelFrame
          ? conceptFrameFromTeachingContext(context.teachingContext, modelFrame, project)
          : null,
      frameChanged: deltaFrame?.frameChanged ?? null,
      changeSet: deltaResult?.changeSet || null,
      ruleSelection
    };
    const responseModel = response.model || route.model || requestConfig.textModel;
    const usage = response.usage || null;
    if (logContext.projectDir) {
      await logModelRun(logContext.projectDir, {
        status: "success",
        source: "proposal",
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
        metadata: {
          generationMode,
          flowVariant: input.conceptFlow || null,
          ...(parsedResult.frameChanged !== null ? { frameChanged: parsedResult.frameChanged } : {})
        },
        attribution: logContext.usageAttribution,
        uiEvent: input.uiEvent || "proposal_generation"
      }, { now: input.now || logContext.now });
    }
    return {
      ...parsedResult,
      provider: {
        name: "openai",
        responseId: response.id || null,
        model: responseModel,
        mode: runtime.mode,
        route: route.route,
        purpose: route.purpose
      }
    };
  } catch (error) {
    const responseModel = response?.model || route.model || requestConfig.textModel;
    const usage = response?.usage || null;
    if (logContext.projectDir) {
      await logModelRun(logContext.projectDir, {
        status: "error",
        source: "proposal",
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
        metadata: { generationMode, flowVariant: input.conceptFlow || null },
        attribution: logContext.usageAttribution,
        uiEvent: input.uiEvent || "proposal_generation",
        error
      }, { now: input.now || logContext.now });
    }
    throw error;
  }
}

function latestArtifactByVersion(index = {}, type) {
  return listArtifacts(index, { type })
    .sort((left, right) => (Number(right.version) || 0) - (Number(left.version) || 0))[0] || null;
}

async function currentArtifactData(projectDir, manifest = {}, index = {}, fieldName, type, fallbackPaths = []) {
  const currentId = manifest.currentArtifacts?.[fieldName] || null;
  const artifact = (currentId ? findArtifact(index, currentId) : null)
    || latestArtifactByVersion(index, type);
  if (artifact?.path) {
    const data = await readJsonIfExists(path.join(projectDir, artifact.path));
    if (data) {
      return data;
    }
  }
  for (const relativePath of fallbackPaths) {
    const data = await readJsonIfExists(path.join(projectDir, relativePath));
    if (data) {
      return data;
    }
  }
  return null;
}

async function readCurrentState(projectDir, options = {}) {
  const manifest = await readJsonIfExists(path.join(projectDir, "project-manifest.json")) || {};
  const index = await readArtifactIndex(projectDir);
  const events = await readEvents(projectDir);
  const currentBrief = await currentArtifactData(
    projectDir,
    manifest,
    index,
    "lessonbriefId",
    ARTIFACT_TYPES.LESSON_BRIEF,
    ["brief/draft.lessonbrief.json", "brief/approved.lessonbrief.json"]
  );
  const currentContent = await currentArtifactData(
    projectDir,
    manifest,
    index,
    "contentMirrorId",
    ARTIFACT_TYPES.CONTENT_MIRROR,
    ["content/draft.content-mirror.json", "content/approved.content-mirror.json"]
  );
  const teachingContext = await readTeachingContext(projectDir, {
    project: options.project || manifest,
    events,
    brief: currentBrief || {},
    content: currentContent || {}
  });
  return {
    currentBrief,
    currentContent,
    currentWarnings: await readJsonIfExists(path.join(projectDir, "qc", "content-warnings.json")),
    teachingContext,
    events
  };
}

async function saveProposal(projectDir, proposal) {
  const relativePath = path.join("proposals", `${proposal.proposalId}.${proposal.kind}.json`);
  proposal.path = relativePath.split(path.sep).join("/");
  await writeJson(path.join(projectDir, relativePath), proposal);
  return proposal;
}

async function updateProposalStatus(projectDir, proposal, status, options = {}) {
  const nextProposal = {
    ...proposal,
    status,
    adoptedAt: status === "adopted" ? (options.now || new Date().toISOString()) : proposal.adoptedAt || null,
    adoptedArtifactId: options.adoptedArtifactId || proposal.adoptedArtifactId || null
  };
  await saveProposal(projectDir, nextProposal);
  return nextProposal;
}

async function supersedeOpenSiblingProposals(projectDir, adoptedProposal, options = {}) {
  const now = options.now || new Date().toISOString();
  const kinds = new Set(options.kinds || [adoptedProposal.kind]);
  const proposals = await readProposals(projectDir);
  for (const proposal of proposals) {
    if (
      proposal.proposalId === adoptedProposal.proposalId
      || !kinds.has(proposal.kind)
      || proposal.status !== "proposed"
    ) {
      continue;
    }
    await saveProposal(projectDir, {
      ...proposal,
      status: "superseded",
      supersededAt: now,
      supersededBy: adoptedProposal.proposalId
    });
  }
}

function proposalSummaryText(kind, data) {
  if (kind === PROPOSAL_KINDS.LESSON_BRIEF) {
    return `Arbeitsblatt-Konzept zu "${data.topic}"`;
  }
  if (kind === PROPOSAL_KINDS.CONTENT_MIRROR) {
    return `Arbeitsblatt-Konzept mit ${data.tasks.length} Aufgaben und ${data.imageMaterials.length} Bildmaterialien`;
  }
  if (kind === PROPOSAL_KINDS.IMAGE_SPEC) {
    return `Bildplanung zu "${data.topic}"`;
  }
  return `Konzept-Feedback mit ${data.warnings.length} Hinweisen`;
}

function adoptCommandForKind(kind, context = {}) {
  if (kind === PROPOSAL_KINDS.LESSON_BRIEF) {
    return { command: "adopt_lessonbrief_proposal", label: "Arbeitsblatt-Konzept ausformulieren" };
  }
  if (kind === PROPOSAL_KINDS.CONTENT_MIRROR) {
    return {
      command: "adopt_content_mirror_proposal",
      label: "Mit diesem Konzept weiterarbeiten"
    };
  }
  if (kind === PROPOSAL_KINDS.IMAGE_SPEC) {
    return { command: "adopt_image_spec", label: "Bildplanung intern speichern" };
  }
  return { command: "adopt_content_warnings_proposal", label: "Konzept-Feedback intern speichern" };
}

function readyActionForKind(kind, context = {}) {
  if (kind === PROPOSAL_KINDS.CONTENT_MIRROR) {
    return {
      command: "generate_candidate_from_content_proposal",
      label: "Entwurf erstellen",
      requiresConfirmation: true,
      confirmationKind: "image_generation_provider"
    };
  }
  return adoptCommandForKind(kind, context);
}

function retryActionsForFailedProposal(kind, input = {}) {
  if (kind === PROPOSAL_KINDS.CONTENT_MIRROR) {
    if (input.unifiedConcept === true && input.conceptFlow === "v2") {
      return [{
        command: "generate_lessonbrief_proposal",
        label: "Konzept nochmal versuchen",
        payload: {
          completeConcept: true,
          planningFlow: "v2",
          message: String(input.message || "").trim(),
          ...(String(input.planningHandoff || "").trim()
            ? { planningHandoff: String(input.planningHandoff).trim() }
            : {}),
          ...(input.chainRequested === true ? { chainRequested: true } : {})
        }
      }];
    }
    return [
      {
        command: "generate_content_mirror_proposal",
        label: "Nochmal versuchen",
        payload: {
          message: String(input.message || "").trim(),
          ...(String(input.planningHandoff || "").trim()
            ? { planningHandoff: String(input.planningHandoff).trim() }
            : {}),
          ...(input.revisionMode ? { revisionMode: input.revisionMode } : {}),
          ...(input.basisProposalId ? { basisProposalId: input.basisProposalId } : {}),
          ...(input.conceptFlow ? { conceptFlow: input.conceptFlow } : {})
        }
      },
      { command: "create_content_draft", label: "Einfache Version anlegen", payload: {} }
    ];
  }
  if (kind === PROPOSAL_KINDS.LESSON_BRIEF) {
    return [
      { command: "generate_lessonbrief_proposal", label: "Nochmal versuchen", payload: {} },
      { command: "create_brief_draft", label: "Direkt anlegen", payload: {} }
    ];
  }
  return [{ command: kind === PROPOSAL_KINDS.IMAGE_SPEC ? "prepare_image_spec" : "generate_content_warnings_proposal", label: "Nochmal versuchen", payload: {} }];
}

function failedProposalMessage(kind, error) {
  const detail = sanitizeErrorMessage(error);
  if (kind === PROPOSAL_KINDS.CONTENT_MIRROR) {
    return `Der Aufgaben- und Materialvorschlag hat zu lange gedauert oder ist fehlgeschlagen. Soll ich es nochmal versuchen oder eine einfache Version aus dem Arbeitsblatt-Konzept anlegen? (${detail})`;
  }
  return `Der Vorschlag konnte nicht erstellt werden. Soll ich es nochmal versuchen? (${detail})`;
}

function referencePolicyMessage(referencePolicy = null) {
  if (!referencePolicy || referencePolicy.level === "none") {
    return "";
  }
  if (referencePolicy.level === "deterministic") {
    return ` ${referencePolicy.reason} Im normalen Ablauf sollte daraus kein scheinbar funktionsfähiges Element frei gezeichnet werden; arbeite mit Platzhalter oder nutze ein eigenes Referenzbild.`;
  }
  if (referencePolicy.level === "required") {
    return ` Für diese Visualisierung wäre eine Referenz sinnvoll: ${referencePolicy.reason} Du kannst eine passende Referenz anhängen oder trotzdem direkt einen ersten Entwurf erstellen.`;
  }
  if (referencePolicy.level === "recommended") {
    return ` Eine Referenz kann hier helfen: ${referencePolicy.reason} Ohne Referenz kann ich trotzdem einen ersten Entwurf versuchen.`;
  }
  return "";
}

function wordCount(value) {
  return String(value || "").split(/\s+/).map((word) => word.trim()).filter(Boolean).length;
}

function contentProposalStrength(content = {}) {
  const tasks = Array.isArray(content.tasks) ? content.tasks : [];
  const readingTexts = Array.isArray(content.readingTexts) ? content.readingTexts : [];
  const imageMaterials = Array.isArray(content.imageMaterials) ? content.imageMaterials : [];
  const tasksUseMaterial = tasks.some((task) => Array.isArray(task.materialRefs) && task.materialRefs.length > 0);

  if (imageMaterials.length && tasksUseMaterial) {
    return `Bildidee und Aufgaben sind miteinander verbunden; dadurch ist das Bild nicht nur Deko, sondern kann beim Bearbeiten wirklich helfen.`;
  }
  if (tasks.length >= 3) {
    return `Die Aufgabenfolge ist klar genug angelegt und bietet mit ${tasks.length} Aufgaben mehrere Zugriffspunkte auf das Thema.`;
  }
  if (readingTexts.length) {
    return `Der sichtbare Text gibt dem Blatt eine erkennbare Grundlage, auf die die Aufgaben aufbauen können.`;
  }
  return "Der Aufbau ist grundsätzlich übersichtlich und lässt sich als Arbeitsblatt-Konzept gut prüfen.";
}

function contentProposalConcern(content = {}, context = {}) {
  const tasks = Array.isArray(content.tasks) ? content.tasks : [];
  const readingTexts = Array.isArray(content.readingTexts) ? content.readingTexts : [];
  const imageMaterials = Array.isArray(content.imageMaterials) ? content.imageMaterials : [];
  const totalWords = readingTexts.reduce((sum, entry) => sum + wordCount(entry.body), 0);
  const plannedPages = Number(content.pageCount || content.outputPreference?.pages || context.currentBrief?.outputPreference?.pages || 0);
  const tasksUseMaterial = tasks.some((task) => Array.isArray(task.materialRefs) && task.materialRefs.length > 0);
  const tasksWithExpectedAnswer = tasks.filter((task) => String(task.expectedAnswer || "").trim()).length;

  if (plannedPages > 0 && plannedPages <= 1 && tasks.length >= 4) {
    return "Etwas eng könnte der Platz werden, weil mehrere Aufgaben auf eine Seite müssen; das kann Lesbarkeit und Arbeitsruhe schwächen.";
  }
  if (totalWords > 220) {
    return "Etwas unsicher ist die Textmenge: Der Leseteil ist relativ umfangreich und könnte auf dem Blatt schnell dominant werden.";
  }
  if (imageMaterials.length && !tasksUseMaterial) {
    return "Noch nicht ganz stark ist die Bildnutzung: Die Bildidee ist vorhanden, aber die Aufgaben greifen sie bisher nur schwach auf.";
  }
  if (!imageMaterials.length) {
    return "Noch offen ist die visuelle Stütze, weil im Konzept kein klares Bildmaterial vorgesehen ist.";
  }
  if (tasks.length && tasksWithExpectedAnswer < tasks.length) {
    return "Bei einzelnen Aufgaben könnte die Erwartung noch präziser sein, damit später klarer prüfbar ist, was eine gute Antwort wäre.";
  }
  return "Die größte offene Frage ist eher die Feinabstimmung: ob Niveau, Umfang und Bildgewicht genau zu deiner Lerngruppe passen.";
}

function contentProposalAssessmentFallback(proposal = {}, context = {}) {
  const content = proposal.data || {};
  const title = content.title || context.project?.title || "das Konzept";
  const revisionMode = proposal.source?.revisionMode || "";
  const isRevision = Boolean(revisionMode || proposal.source?.currentContentMirrorId);
  const intro = revisionMode === "followup_concept"
    ? `Ich habe daraus einen neuen Konzeptvorschlag für den Folgebogen vorbereitet:`
    : revisionMode === "new_concept_from_context"
      ? `Ich habe daraus einen neuen Konzeptvorschlag vorbereitet:`
    : isRevision
      ? `Ich habe daraus eine angepasste Konzeptfassung vorbereitet:`
      : `Ich sehe bei „${title}“ eine tragfähige Richtung:`;
  return [
    `${intro} ${contentProposalStrength(content)}`,
    contentProposalConcern(content, context),
    "Daraus kann direkt ein Entwurf entstehen, oder du passt den Vorschlag noch weiter an."
  ].join(" ");
}

async function appendAssistantProposalMessage(projectDir, proposal, now, context = {}) {
  const readyAction = readyActionForKind(proposal.kind, context);
  const nextCandidateReferenceImages = normalizeReferenceImages(
    proposal.source?.nextCandidateReferenceImages || [],
    {}
  );
  const actionPayload = proposal.kind === PROPOSAL_KINDS.CONTENT_MIRROR
    ? {
        proposalId: proposal.proposalId,
        approve: true,
        ...(nextCandidateReferenceImages.length ? { referenceImages: nextCandidateReferenceImages } : {})
      }
    : proposal.kind === PROPOSAL_KINDS.LESSON_BRIEF
      ? { proposalId: proposal.proposalId, continueToContent: true, silent: true }
      : { proposalId: proposal.proposalId };
  const suggestedActions = proposal.kind === PROPOSAL_KINDS.CONTENT_WARNINGS
    ? []
    : [{
      command: readyAction.command,
      label: readyAction.label,
      payload: actionPayload,
      ...(proposal.kind === PROPOSAL_KINDS.CONTENT_MIRROR && proposal.source?.chainRequested === true
        ? { autoOpenConfirmation: true }
        : {})
    }];
  const fallback = proposal.kind === PROPOSAL_KINDS.CONTENT_MIRROR
    ? [
        contentProposalAssessmentFallback(proposal, context),
        nextCandidateReferenceImages.length
          ? "Die gewünschte visuelle Referenz ist für den nächsten Entwurf vorgemerkt."
          : ""
      ].filter(Boolean).join(" ")
    : proposal.kind === PROPOSAL_KINDS.IMAGE_SPEC
      ? `Ich habe die Bildplanung aus dem Arbeitsblatt-Konzept abgeleitet.${referencePolicyMessage(proposal.data?.referencePolicy)} Wenn das passt, nutze ich sie intern für die Bildgenerierung.`
    : proposal.kind === PROPOSAL_KINDS.CONTENT_WARNINGS
        ? `${proposalSummaryText(proposal.kind, proposal.data)} ist notiert. Du kannst Änderungen frei im Chat beschreiben oder mit dem Arbeitsblatt-Konzept weiterarbeiten.`
      : `${proposalSummaryText(proposal.kind, proposal.data)} ist vorbereitet. Soll ich daraus weiterarbeiten?`;
  const message = await narrateChatMoment(projectDir, {
    kind: "proposal_ready",
    fallback,
    proposal: summarizeProposal(proposal),
    suggestedActions,
    workspace: {
      project: context.project,
      documents: {
        brief: { data: context.currentBrief || null },
        content: { data: context.currentContent || null },
        warnings: { data: context.currentWarnings || null }
      },
      chat: {
        messages: (context.recentMessages || []).map((entry) => ({
          role: entry.role,
          content: entry.message
        }))
      }
    }
  }, {
    now,
    uiEvent: "proposal_ready",
    usageAttribution: context.usageAttribution
  });
  await appendEvent(projectDir, {
    type: EVENT_TYPES.ASSISTANT_MESSAGE,
    createdAt: now,
    step: proposal.kind === PROPOSAL_KINDS.CONTENT_WARNINGS
      ? "pruefung"
      : proposal.kind === PROPOSAL_KINDS.IMAGE_SPEC
        ? "entwuerfe"
        : "content",
    payload: {
      mode: proposal.createdBy?.mode || "openai",
      message,
      suggestedActions,
      proposal: summarizeProposal(proposal)
    }
  }, { now });
}

async function generateProposal(projectId, kind, input = {}, options = {}) {
  const repoRoot = options.repoRoot || DEFAULT_REPO_ROOT;
  const projectsDir = options.projectsDir || DEFAULT_PROJECTS_DIR;
  const projectDir = path.join(projectsDir, projectId);
  const now = input.now || options.now || new Date().toISOString();
  const usageAttribution = createUsageAttribution(options.usageAttribution, {
    projectId,
    operationKind: "proposal_generation"
  });
  const project = await openProject(projectId, { projectsDir });
  if (project.projectType !== PROJECT_TYPES.SINGLE_WORKSHEET) {
    throw new Error("AI proposals are only supported for single worksheet projects.");
  }

  const runtime = getAiRuntimeStatus();
  const current = await readCurrentState(projectDir, { project });
  const existingProposals = await readProposals(projectDir);
  const basisProposal = contentProposalBasisFromInput(existingProposals, kind, input);
  const context = contextWithContentProposalBasis(
    projectContext({ project, ...current }),
    basisProposal
  );
  if (runtime.status !== "ready") {
    throw new Error(runtime.fallbackReason || "OpenAI is not configured.");
  }
  let proposalData;
  try {
    proposalData = await modelProposalData(kind, project, context, input, runtime, {
      repoRoot,
      projectDir,
      now,
      usageAttribution
    });
  } catch (error) {
    if (!input.silent) {
      await appendEvent(projectDir, {
        type: EVENT_TYPES.ASSISTANT_MESSAGE,
        createdAt: now,
        step: kind === PROPOSAL_KINDS.IMAGE_SPEC ? "entwuerfe" : "content",
        payload: {
          mode: "openai_error",
          message: failedProposalMessage(kind, error),
          suggestedActions: retryActionsForFailedProposal(kind, input)
        }
      }, { now });
    }
    throw error;
  }
  const proposals = await readProposals(projectDir);
  const proposalId = nextProposalId(proposals);
  const nextCandidateReferenceImages = normalizeReferenceImages(
    input.nextCandidateReferenceImages || [],
    {}
  );
  const proposal = await saveProposal(projectDir, {
    schemaVersion: PRODUCTION_SCHEMA_VERSION,
    proposalId,
    kind,
    status: "proposed",
    title: titleFromProposal({ kind, data: proposalData.data }),
    summary: proposalSummaryText(kind, proposalData.data),
    createdAt: now,
    adoptedAt: null,
    adoptedArtifactId: null,
    createdBy: proposalData.provider,
    ...(proposalData.conceptFrame ? { conceptFrame: proposalData.conceptFrame } : {}),
    source: {
      projectId,
      userMessage: String(input.message || "").trim() || null,
      revisionMode: input.revisionMode || null,
      contentRelationship: input.contentRelationship || null,
      revisionTarget: input.revisionTarget || null,
      basisProposalId: basisProposal?.proposalId || null,
      preserveUnmentionedConceptParts: input.preserveUnmentionedConceptParts === true,
      contentRevisionStrategy: proposalData.changeSet ? "delta" : (input.contentRevisionStrategy || "full_snapshot"),
      conceptFlow: input.conceptFlow || null,
      ...(typeof proposalData.frameChanged === "boolean" ? { frameChanged: proposalData.frameChanged } : {}),
      chainRequested: input.chainRequested === true,
      changeSet: proposalData.changeSet || null,
      currentLessonBriefId: project.manifest?.currentArtifacts?.lessonbriefId || null,
      currentContentMirrorId: project.manifest?.currentArtifacts?.contentMirrorId || null,
      ruleSelection: ruleSelectionSource(proposalData.ruleSelection),
      ...(nextCandidateReferenceImages.length ? { nextCandidateReferenceImages } : {})
    },
    data: proposalData.data
  });

  if (!input.silent) {
    await appendAssistantProposalMessage(projectDir, proposal, now, {
      project,
      ...current,
      ...context,
      usageAttribution
    });
  }
  await appendHistoryEvent(projectDir, {
    type: "ai_proposal_created",
    createdAt: now,
    proposalId,
    kind,
    model: proposal.createdBy.model
  });

  return {
    proposal,
    proposalState: await readProposalState(projectDir),
    paths: {
      projectDir: path.relative(repoRoot, projectDir).split(path.sep).join("/")
    }
  };
}

async function compatibilityBriefProjection(projectId, projectDir, proposal, options = {}) {
  if (!proposal.conceptFrame) {
    return null;
  }
  const project = await openProject(projectId, {
    projectsDir: options.projectsDir || DEFAULT_PROJECTS_DIR
  });
  const state = options.currentState || await readCurrentState(projectDir, { project });
  const frame = normalizeConceptFrame(proposal.conceptFrame, project);
  return {
    data: legacyLessonBriefFromConcept(frame, proposal.data || {}, project),
    frame,
    state
  };
}

async function ensureV2ConceptBrief(projectId, projectDir, proposal, options = {}) {
  const projection = options.projection || await compatibilityBriefProjection(
    projectId,
    projectDir,
    proposal,
    options
  );
  if (!projection) {
    return null;
  }
  const index = await readArtifactIndex(projectDir);
  const manifest = await readJsonIfExists(path.join(projectDir, "project-manifest.json")) || {};
  const existing = listArtifacts(index, { type: ARTIFACT_TYPES.LESSON_BRIEF })
    .find((artifact) => (artifact.createdFrom || []).includes(proposal.proposalId)) || null;
  if (existing) {
    const currentBriefId = manifest.currentArtifacts?.lessonbriefId || null;
    if (currentBriefId && currentBriefId !== existing.id) {
      throw new Error("Der zu diesem Konzept gehörende interne Planungsstand ist nicht mehr aktuell.");
    }
    const data = existing.status === ARTIFACT_STATUSES.APPROVED
      ? await readJsonIfExists(path.join(projectDir, existing.path))
      : await approveLessonBriefVersion(projectDir, existing.id, options);
    return {
      artifactId: existing.id,
      path: existing.path,
      data,
      reused: true
    };
  }
  const created = await createLessonBriefVersion(projectDir, projection.data, {
    ...options,
    createdFrom: [proposal.proposalId]
  });
  const approved = await approveLessonBriefVersion(projectDir, created.artifactId, options);
  return {
    ...created,
    data: approved,
    reused: false
  };
}

async function adoptProposal(projectId, kind, input = {}, options = {}) {
  const projectsDir = options.projectsDir || DEFAULT_PROJECTS_DIR;
  const projectDir = path.join(projectsDir, projectId);
  const now = input.now || options.now || new Date().toISOString();
  const proposals = await readProposals(projectDir);
  const latestProposal = latestByKind(proposals, kind);
  const proposalId = input.payload?.proposalId || input.proposalId || latestProposal?.proposalId;
  if (!proposalId) {
    throw new Error(`No ${kind} proposal is available.`);
  }
  const proposal = proposals.find((entry) => entry.proposalId === proposalId) || null;
  if (!proposal) {
    throw new Error(`Proposal does not exist: ${proposalId}`);
  }
  if (proposal.kind !== kind) {
    throw new Error(`Proposal ${proposalId} is ${proposal.kind}, not ${kind}.`);
  }
  if (proposal.status !== "proposed") {
    throw new Error(`Proposal ${proposalId} is not available for adoption.`);
  }
  if (latestProposal?.proposalId && latestProposal.proposalId !== proposalId) {
    throw new Error(`Proposal ${proposalId} wurde durch ${latestProposal.proposalId} ersetzt. Bitte den aktuellen Vorschlag verwenden.`);
  }

  const manifestBeforeAdoption = await readJsonIfExists(path.join(projectDir, "project-manifest.json")) || {};
  if (
    kind === PROPOSAL_KINDS.LESSON_BRIEF
    && (
      manifestBeforeAdoption.currentArtifacts?.lessonbriefId
      || manifestBeforeAdoption.currentArtifacts?.contentMirrorId
    )
  ) {
    throw new Error("Dieser frühe Planungsstand gehört zu einem älteren Projektzustand und kann nicht mehr übernommen werden.");
  }

  const currentState = kind === PROPOSAL_KINDS.CONTENT_MIRROR
    ? await readCurrentState(projectDir, {
        project: await openProject(projectId, { projectsDir })
      })
    : null;
  const briefProjection = kind === PROPOSAL_KINDS.CONTENT_MIRROR
    ? await compatibilityBriefProjection(projectId, projectDir, proposal, {
        ...options,
        currentState
      })
    : null;
  const requiresApprovalPreflight = kind === PROPOSAL_KINDS.CONTENT_MIRROR
    && (
      input.requireApproval === true
      || input.approve === true
      || input.payload?.approve === true
    );
  if (requiresApprovalPreflight) {
    if (!hasMeaningfulContent(proposal.data || {})) {
      throw new Error("Das Arbeitsblatt-Konzept enthält noch keine sinnvoll nutzbaren Inhalte.");
    }
    const readiness = contentReadinessForGeneration(proposal.data || {}, {
      events: currentState?.events || [],
      brief: briefProjection?.data || currentState?.currentBrief || {}
    });
    if (!readiness.ready) {
      throw new Error(contentReadinessMessage(readiness));
    }
  }

  let result;
  if (kind === PROPOSAL_KINDS.LESSON_BRIEF) {
    result = await createLessonBriefVersion(projectDir, proposal.data, {
      ...options,
      now,
      createdFrom: [proposalId]
    });
  } else if (kind === PROPOSAL_KINDS.CONTENT_MIRROR) {
    const compatibilityBrief = await ensureV2ConceptBrief(
      projectId,
      projectDir,
      proposal,
      { ...options, now, projection: briefProjection }
    );
    const revisionKind = proposal.source?.changeSet?.strategy === "delta"
      ? "delta"
      : ["new_concept_from_context", "followup_concept"].includes(proposal.source?.revisionMode)
        ? "new_concept"
        : "full_snapshot";
    const contentIndex = await readArtifactIndex(projectDir);
    const existingContent = listArtifacts(contentIndex, { type: ARTIFACT_TYPES.CONTENT_MIRROR })
      .find((artifact) => (artifact.createdFrom || []).includes(proposalId)) || null;
    if (existingContent) {
      const currentManifest = await readJsonIfExists(path.join(projectDir, "project-manifest.json")) || {};
      const currentContentId = currentManifest.currentArtifacts?.contentMirrorId || null;
      if (currentContentId && currentContentId !== existingContent.id) {
        throw new Error("Der zu diesem Vorschlag gehörende Konzeptstand ist nicht mehr aktuell.");
      }
      result = {
        artifactId: existingContent.id,
        path: existingContent.path,
        data: await readJsonIfExists(path.join(projectDir, existingContent.path)),
        reused: true
      };
    } else {
      result = await createContentMirrorVersion(projectDir, proposal.data, {
        ...options,
        now,
        createdFrom: [proposalId],
        parentContentMirrorId: proposal.source?.currentContentMirrorId || null,
        revisionKind,
        changeSummary: proposal.source?.changeSet?.summary || proposal.summary || null,
        imageSpecStrategy: proposal.source?.changeSet?.imageSpecStrategy || "regenerate"
      });
    }
    if (compatibilityBrief) {
      result.compatibilityBrief = compatibilityBrief;
    }
    if (
      revisionKind === "delta"
      && !proposal.source?.basisProposalId
      && proposal.source?.changeSet?.imageSpecStrategy === "reuse"
      && proposal.source?.currentContentMirrorId
    ) {
      result.imageSpecRebase = await rebaseAdoptedImageSpec(projectDir, {
        fromContentMirrorId: proposal.source.currentContentMirrorId,
        toContentMirrorId: result.artifactId,
        now
      });
    }
  } else if (kind === PROPOSAL_KINDS.IMAGE_SPEC) {
    result = {
      proposalId,
      kind,
      status: "adopted",
      imageSpec: proposal.data
    };
  } else {
    result = await createContentWarningsVersion(projectDir, proposal.data, {
      ...options,
      now,
      source: "ai_proposal",
      sourceProposalId: proposalId,
      createdFrom: [proposalId]
    });
  }

  const adoptedArtifactId = result.artifactId || proposalId;
  await updateProposalStatus(projectDir, proposal, "adopted", {
    now,
    adoptedArtifactId
  });
  await supersedeOpenSiblingProposals(projectDir, proposal, {
    now,
    kinds: kind === PROPOSAL_KINDS.CONTENT_MIRROR && proposal.conceptFrame
      ? [PROPOSAL_KINDS.CONTENT_MIRROR, PROPOSAL_KINDS.LESSON_BRIEF]
      : [kind]
  });
  if (!input.silent) {
    const fallback = kind === PROPOSAL_KINDS.IMAGE_SPEC
      ? "Die Bildplanung ist intern gespeichert. Daraus kann jetzt ein Bild-Entwurf entstehen."
      : kind === PROPOSAL_KINDS.CONTENT_WARNINGS
        ? `${proposalSummaryText(kind, proposal.data)} wurde intern gespeichert.`
        : `Mit ${proposalSummaryText(kind, proposal.data)} wird weitergearbeitet.`;
    const message = await narrateChatMoment(projectDir, {
      kind: "proposal_adopted",
      fallback,
      proposal: summarizeProposal(proposal),
      commandId: adoptCommandForKind(kind).command
    }, {
      now,
      uiEvent: "proposal_adopted",
      usageAttribution: options.usageAttribution
    });
    await appendEvent(projectDir, {
      type: EVENT_TYPES.ASSISTANT_MESSAGE,
      createdAt: now,
      step: kind === PROPOSAL_KINDS.CONTENT_WARNINGS
        ? "pruefung"
        : kind === PROPOSAL_KINDS.IMAGE_SPEC
          ? "entwuerfe"
          : "content",
      payload: {
        mode: "narration",
        message,
        suggestedActions: []
      }
    }, { now });
  }
  await appendHistoryEvent(projectDir, {
    type: "ai_proposal_adopted",
    createdAt: now,
    proposalId,
    kind,
    adoptedArtifactId
  });

  return {
    proposalId,
    kind,
    adoptedArtifactId,
    result,
    proposalState: await readProposalState(projectDir)
  };
}

async function readActiveImageSpec(projectDir, proposalId = null) {
  const proposals = await readProposals(projectDir);
  const proposal = proposalId
    ? proposals.find((entry) => entry.proposalId === proposalId && entry.kind === PROPOSAL_KINDS.IMAGE_SPEC) || null
    : latestByKind(proposals, PROPOSAL_KINDS.IMAGE_SPEC, "adopted");
  if (!proposal || proposal.status !== "adopted") {
    return null;
  }
  return summarizeProposal(proposal);
}

function persistentImageSpecReferences(references = []) {
  return (Array.isArray(references) ? references : []).filter((reference) => {
    const scope = String(reference?.scope || "").toLowerCase();
    const role = String(reference?.role || "").toLowerCase();
    return ["all_candidates", "every_candidate", "persistent"].includes(scope)
      || ["layout_reference", "style_reference", "style_layout_reference"].includes(role);
  });
}

async function readActiveImageSpecForContent(projectDir, contentMirrorId) {
  if (!contentMirrorId) {
    return null;
  }
  const proposals = await readProposals(projectDir);
  const proposal = proposals
    .filter((entry) => entry.kind === PROPOSAL_KINDS.IMAGE_SPEC && entry.status === "adopted")
    .filter((entry) => entry.source?.currentContentMirrorId === contentMirrorId)
    .sort((left, right) => String(right.createdAt || "").localeCompare(String(left.createdAt || ""))
      || String(right.proposalId || "").localeCompare(String(left.proposalId || "")))[0] || null;
  return summarizeProposal(proposal);
}

async function rebaseAdoptedImageSpec(projectDir, options = {}) {
  const source = await readActiveImageSpecForContent(projectDir, options.fromContentMirrorId);
  if (!source) {
    return null;
  }
  const proposals = await readProposals(projectDir);
  const proposalId = nextProposalId(proposals);
  const now = options.now || new Date().toISOString();
  const proposal = await saveProposal(projectDir, {
    schemaVersion: PRODUCTION_SCHEMA_VERSION,
    proposalId,
    kind: PROPOSAL_KINDS.IMAGE_SPEC,
    status: "adopted",
    title: source.title,
    summary: source.summary,
    createdAt: now,
    adoptedAt: now,
    adoptedArtifactId: proposalId,
    createdBy: {
      name: "deterministic",
      model: null,
      mode: "deterministic_rebase",
      route: "content_delta_rebase",
      purpose: ROUTE_PURPOSES.IMAGE_SPEC
    },
    source: {
      ...(source.source || {}),
      currentContentMirrorId: options.toContentMirrorId,
      rebasedFromProposalId: source.proposalId,
      rebasedFromContentMirrorId: options.fromContentMirrorId
    },
    data: {
      ...(source.data || {}),
      referenceImages: persistentImageSpecReferences(source.data?.referenceImages)
    }
  });
  await appendHistoryEvent(projectDir, {
    type: "image_spec_rebased_for_content_delta",
    createdAt: now,
    proposalId,
    rebasedFromProposalId: source.proposalId,
    fromContentMirrorId: options.fromContentMirrorId,
    toContentMirrorId: options.toContentMirrorId
  });
  return summarizeProposal(proposal);
}

module.exports = {
  PROPOSAL_KINDS,
  adoptProposal,
  generateProposal,
  readActiveImageSpec,
  readActiveImageSpecForContent,
  readProposalState,
  __testing: {
    budgetRecentMessages,
    compactContextRefs,
    contextWithoutPreviousConceptContent,
    inputAnalysesFromEvents,
    proposalContextEvents,
    projectContext,
    recentMessagesFromEvents,
    teacherInputMessagesFromEvents,
    applyContentDelta,
    contentDeltaSchema,
    contentMirrorSchema,
    unifiedConceptSchema,
    unifiedConceptDeltaSchema,
    readCurrentState,
    persistentImageSpecReferences,
    usesContentDelta,
    validateContentMirror,
    validateImageSpec
  }
};
