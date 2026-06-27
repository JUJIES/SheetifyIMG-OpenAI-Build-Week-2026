"use strict";

const fs = require("node:fs/promises");
const path = require("node:path");
const { EVENT_TYPES, PROJECT_TYPES, PRODUCTION_SCHEMA_VERSION } = require("../contracts");
const { appendEvent, readEvents } = require("../eventLog");
const { appendHistoryEvent } = require("../historyManager");
const { getAiRuntimeStatus, getOpenAiRequestConfig } = require("../aiConfig");
const { createResponse, extractOutputText } = require("../openaiClient");
const { createLessonBriefVersion } = require("../briefManager");
const { createContentMirrorVersion } = require("../contentMirrorManager");
const { createContentWarningsVersion, normalizeWarnings } = require("../contentWarningManager");
const { logModelRun, sanitizeErrorMessage } = require("../modelRunLogger");
const { estimateOpenAiTextCost } = require("../imageCostManager");
const { ROUTE_PURPOSES, routeForPurpose } = require("../modelRouter");
const { composePrompts } = require("../promptRegistry");
const { productionContextToPrompt } = require("../productionContext");
const { openProject } = require("../projectManager");
const { requestedConstraints } = require("../contentReadiness");
const { narrateChatMoment } = require("../chatNarrationManager");
const { inferReferencePolicy, mergeReferencePolicies } = require("../referencePolicy");
const { pagePlanForImageSpec } = require("../pagePlanManager");
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
    .sort((left, right) => String(right.createdAt || "").localeCompare(String(left.createdAt || "")))[0] || null;
}

async function readProposalState(projectDir) {
  const proposals = await readProposals(projectDir);
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
    activeImageSpec: summarizeProposal(latestByKind(proposals, PROPOSAL_KINDS.IMAGE_SPEC, "adopted"))
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
    data: proposal.data || null,
    source: proposal.source || null,
    model: proposal.createdBy?.model || null,
    path: proposal.path || null
  };
}

function titleFromProposal(proposal) {
  if (proposal.kind === PROPOSAL_KINDS.LESSON_BRIEF) {
    return proposal.data?.topic || "Konzept-Vorschlag";
  }
  if (proposal.kind === PROPOSAL_KINDS.CONTENT_MIRROR) {
    return proposal.data?.title || "Konzept-Vorschlag";
  }
  if (proposal.kind === PROPOSAL_KINDS.IMAGE_SPEC) {
    return proposal.data?.purpose || "Entwurfsvorbereitung";
  }
  return proposal.data?.summary || "Prüfhinweise";
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

function validateContentMirror(data = {}, project) {
  const readingTexts = (Array.isArray(data.readingTexts) ? data.readingTexts : []).map((entry, index) => ({
    id: stringOrNull(entry.id) || `text_${index + 1}`,
    title: stringOrNull(entry.title) || `Material ${index + 1}`,
    body: stringOrNull(entry.body) || ""
  })).filter((entry) => entry.body);
  const tasks = (Array.isArray(data.tasks) ? data.tasks : []).map((task, index) => ({
    id: stringOrNull(task.id) || `task_${index + 1}`,
    prompt: stringOrNull(task.prompt) || stringOrNull(task.text) || "Bearbeite die Aufgabe.",
    expectedAnswer: stringOrNull(task.expectedAnswer) || "",
    materialRefs: arrayOfStrings(task.materialRefs),
    difficulty: stringOrNull(task.difficulty) || "mittel"
  })).filter((task) => task.prompt);
  const imageMaterials = (Array.isArray(data.imageMaterials) ? data.imageMaterials : []).map((material, index) => ({
    id: stringOrNull(material.id) || `image_${index + 1}`,
    prompt: stringOrNull(material.prompt) || stringOrNull(material.description) || "",
    purpose: stringOrNull(material.purpose) || "Arbeitsblatt-Material",
    placement: stringOrNull(material.placement) || "auto"
  })).filter((material) => material.prompt);
  const content = {
    title: stringOrNull(data.title) || project.title,
    readingTexts,
    tasks: tasks.length ? tasks : [{
      id: "task_1",
      prompt: "Bearbeite die Aufgabe anhand des Materials.",
      expectedAnswer: "",
      materialRefs: [],
      difficulty: "mittel"
    }],
    imageMaterials,
    solutionNotes: arrayOfStrings(data.solutionNotes)
  };
  if (!content.title || content.tasks.length === 0) {
    throw new Error("Content mirror proposal is missing title or tasks.");
  }
  return content;
}

function proposalContextEvents(context = {}) {
  return (context.teacherInput?.messages || []).map((entry) => ({
    type: EVENT_TYPES.USER_MESSAGE,
    payload: {
      message: entry.message || ""
    }
  }));
}

function normalizeContentMirrorForContext(content, context = {}) {
  const constraints = requestedConstraints({
    events: proposalContextEvents(context),
    brief: context.currentBrief || {}
  });
  if (constraints.requiresSolution) {
    return content;
  }
  return {
    ...content,
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
  const purpose = visibleImageSpecText(data.purpose, "Arbeitsblattseite aus freigegebenem Konzept");
  const placement = visibleImageSpecText(data.placement, "DIN-A4-Arbeitsblattseite");
  const visualBrief = safeImageSpecIntentText(
    data.visualBrief || data.finalPrompt,
    `Visuelle Umsetzung einer vollstaendigen DIN-A4-Arbeitsblattseite zum Thema ${topic}.`
  );
  const layoutIntent = safeImageSpecIntentText(
    data.layoutIntent,
    "Klare A4-Arbeitsblattseite mit Titelbereich, Material-/Bildbereich, Aufgabenbereich und gut scanbarer Hierarchie."
  );
  const styleNotes = safeImageSpecIntentText(
    data.styleNotes,
    "Ruhig, druckfreundlich, gut lesbar, schulisch, ohne dekorative Ueberladung."
  );
  const mustShow = visibleImageSpecStrings(data.mustShow);
  const avoid = visibleImageSpecStrings(data.avoid);
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
    learningFunction: stringOrNull(data.learningFunction) || "Material veranschaulichen",
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

function contentMirrorSchema() {
  return {
    type: "object",
    additionalProperties: false,
    required: ["title", "readingTexts", "tasks", "imageMaterials", "solutionNotes"],
    properties: {
      title: { type: "string" },
      readingTexts: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["id", "title", "body"],
          properties: {
            id: { type: "string" },
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
          required: ["id", "prompt", "expectedAnswer", "materialRefs", "difficulty"],
          properties: {
            id: { type: "string" },
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
          required: ["id", "prompt", "purpose", "placement"],
          properties: {
            id: { type: "string" },
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
              "user_upload_or_reference_search",
              "app_template",
              "app_template_or_user_upload"
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

function schemaForKind(kind) {
  if (kind === PROPOSAL_KINDS.LESSON_BRIEF) {
    return { name: "sheetifyimg_lessonbrief_proposal", schema: lessonBriefSchema() };
  }
  if (kind === PROPOSAL_KINDS.CONTENT_MIRROR) {
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
      path: attachment.path || null,
      source: attachment.source || null
    }));
}

function recentMessagesFromEvents(events = []) {
  return events
    .filter((event) => event.type === EVENT_TYPES.USER_MESSAGE || event.type === EVENT_TYPES.ASSISTANT_MESSAGE)
    .map((event) => ({
      role: event.type === EVENT_TYPES.ASSISTANT_MESSAGE ? "assistant" : "user",
      createdAt: event.createdAt || null,
      message: String(event.payload?.message || "").trim(),
      attachments: compactAttachments(event.payload?.attachments || [])
    }))
    .filter((entry) => entry.message || entry.attachments.length)
    .slice(-16);
}

function inputMessagesFromEvents(events = []) {
  return events
    .filter((event) => event.type === EVENT_TYPES.USER_MESSAGE)
    .map((event) => ({
      createdAt: event.createdAt || null,
      message: String(event.payload?.message || "").trim(),
      attachments: compactAttachments(event.payload?.attachments || [])
    }))
    .filter((entry) => entry.message || entry.attachments.length);
}

function projectContext({ project, currentBrief, currentContent, currentWarnings, events = [] }) {
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
      messages: inputMessagesFromEvents(events)
    },
    recentMessages: recentMessagesFromEvents(events),
    currentBrief,
    currentContent,
    currentWarnings
  };
}

function withDeterministicPagePlan(context = {}) {
  const pagePlan = pagePlanForImageSpec(context.currentContent || {}, context.currentBrief || {}, null);
  return {
    ...context,
    deterministicPagePlan: pagePlan
  };
}

function purposeForKind(kind) {
  if (kind === PROPOSAL_KINDS.LESSON_BRIEF) {
    return ROUTE_PURPOSES.LESSON_BRIEF;
  }
  if (kind === PROPOSAL_KINDS.CONTENT_MIRROR) {
    return ROUTE_PURPOSES.CONTENT_MIRROR;
  }
  if (kind === PROPOSAL_KINDS.IMAGE_SPEC) {
    return ROUTE_PURPOSES.IMAGE_SPEC;
  }
  return ROUTE_PURPOSES.CONTENT_WARNINGS;
}

function userPromptForKind(kind, message) {
  const trimmed = String(message || "").trim();
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
    return "Leite intern die Entwurfsvorbereitung aus dem freigegebenen Arbeitsblatt-Konzept ab.";
  }
  return "Erzeuge Pruefhinweise fuer das aktuelle Arbeitsblatt-Konzept.";
}

function parseStructuredResponse(response) {
  const text = extractOutputText(response);
  if (!text) {
    throw new Error("Structured response did not contain output text.");
  }
  return JSON.parse(text);
}

async function modelProposalData(kind, project, context, input, runtime, logContext = {}) {
  const requestConfig = getOpenAiRequestConfig();
  const structured = schemaForKind(kind);
  const route = routeForPurpose(purposeForKind(kind), requestConfig);
  const baseModelContext = kind === PROPOSAL_KINDS.IMAGE_SPEC
    ? withDeterministicPagePlan(context)
    : context;
  const ruleSelection = await selectRulesForProposal({
    kind,
    project,
    context: baseModelContext,
    input,
    repoRoot: logContext.repoRoot
  });
  const modelContext = {
    ...baseModelContext,
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
          projectState: modelContext
        })
      },
      {
        role: "user",
        content: userPromptForKind(kind, input.message)
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

  let response;
  try {
    response = await createResponse(responseBody, requestConfig);
  } catch (error) {
    if (logContext.projectDir) {
      await logModelRun(logContext.projectDir, {
        status: "error",
        source: "proposal",
        purpose: route.purpose,
        route: route.route,
        promptNames: route.promptNames,
        model: route.model || requestConfig.textModel,
        durationMs: Date.now() - startedAt,
        uiEvent: input.uiEvent || "proposal_generation",
        error
      }, { now: input.now || logContext.now });
    }
    throw error;
  }
  const responseModel = response.model || route.model || requestConfig.textModel;
  const usage = response.usage || null;
  const costEstimate = estimateOpenAiTextCost({
    usage,
    model: responseModel
  });
  const raw = parseStructuredResponse(response);
  let data = kind === PROPOSAL_KINDS.LESSON_BRIEF
    ? validateLessonBrief(raw, project)
    : kind === PROPOSAL_KINDS.CONTENT_MIRROR
      ? validateContentMirror(raw, project)
      : kind === PROPOSAL_KINDS.IMAGE_SPEC
        ? validateImageSpec(raw, project, modelContext, ruleSelection)
      : validateWarnings(raw);
  if (kind === PROPOSAL_KINDS.CONTENT_MIRROR) {
    data = normalizeContentMirrorForContext(data, context);
  }

  if (logContext.projectDir) {
    await logModelRun(logContext.projectDir, {
      status: "success",
      source: "proposal",
      purpose: route.purpose,
      route: route.route,
      promptNames: route.promptNames,
      model: responseModel,
      responseId: response.id || null,
      durationMs: Date.now() - startedAt,
      usage,
      costEstimate,
      uiEvent: input.uiEvent || "proposal_generation"
    }, { now: input.now || logContext.now });
  }

  return {
    data,
    ruleSelection,
    provider: {
      name: "openai",
      responseId: response.id || null,
      model: responseModel,
      mode: runtime.mode,
      route: route.route,
      purpose: route.purpose
    }
  };
}

async function readCurrentState(projectDir) {
  return {
    currentBrief: await readJsonIfExists(path.join(projectDir, "brief", "draft.lessonbrief.json")),
    currentContent: await readJsonIfExists(path.join(projectDir, "content", "draft.content-mirror.json")),
    currentWarnings: await readJsonIfExists(path.join(projectDir, "qc", "content-warnings.json")),
    events: await readEvents(projectDir)
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
  const proposals = await readProposals(projectDir);
  for (const proposal of proposals) {
    if (
      proposal.proposalId === adoptedProposal.proposalId
      || proposal.kind !== adoptedProposal.kind
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
    return `Konzept-Vorschlag zu "${data.topic}"`;
  }
  if (kind === PROPOSAL_KINDS.CONTENT_MIRROR) {
    return `Arbeitsblatt-Konzept mit ${data.tasks.length} Aufgaben und ${data.imageMaterials.length} Bildmaterialien`;
  }
  if (kind === PROPOSAL_KINDS.IMAGE_SPEC) {
    return `Entwurfsvorbereitung zu "${data.topic}"`;
  }
  return `Pruefvorschlag mit ${data.warnings.length} Hinweisen`;
}

function adoptCommandForKind(kind, context = {}) {
  if (kind === PROPOSAL_KINDS.LESSON_BRIEF) {
    return { command: "adopt_lessonbrief_proposal", label: "Konzept übernehmen" };
  }
  if (kind === PROPOSAL_KINDS.CONTENT_MIRROR) {
    return {
      command: "adopt_content_mirror_proposal",
      label: context.currentContent ? "Konzept aktualisieren" : "Konzept übernehmen"
    };
  }
  if (kind === PROPOSAL_KINDS.IMAGE_SPEC) {
    return { command: "adopt_image_spec", label: "Entwurf vorbereiten" };
  }
  return { command: "adopt_content_warnings_proposal", label: "Prüfhinweise übernehmen" };
}

function retryActionsForFailedProposal(kind) {
  if (kind === PROPOSAL_KINDS.CONTENT_MIRROR) {
    return [
      { command: "generate_content_mirror_proposal", label: "Nochmal versuchen", payload: {} },
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
    return ` ${referencePolicy.reason} Dafür sollte die App eine feste Vorlage oder ein festes Asset nutzen, nicht das Bildmodell frei zeichnen lassen.`;
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
  return [
    `Ich sehe bei „${title}“ eine tragfähige Richtung: ${contentProposalStrength(content)}`,
    contentProposalConcern(content, context),
    "Möchtest du dieses Arbeitsblatt-Konzept übernehmen oder noch etwas anpassen?"
  ].join(" ");
}

async function appendAssistantProposalMessage(projectDir, proposal, now, context = {}) {
  const adoptCommand = adoptCommandForKind(proposal.kind, context);
  const actionPayload = proposal.kind === PROPOSAL_KINDS.CONTENT_MIRROR
    ? { proposalId: proposal.proposalId, approve: true }
    : { proposalId: proposal.proposalId };
  const suggestedActions = [{
    command: adoptCommand.command,
    label: adoptCommand.label,
    payload: actionPayload
  }];
  const fallback = proposal.kind === PROPOSAL_KINDS.CONTENT_MIRROR
    ? contentProposalAssessmentFallback(proposal, context)
    : proposal.kind === PROPOSAL_KINDS.IMAGE_SPEC
      ? `Ich habe die Entwurfsvorbereitung aus dem freigegebenen Arbeitsblatt-Konzept abgeleitet.${referencePolicyMessage(proposal.data?.referencePolicy)} Wenn das passt, übernehme ich sie als Grundlage für die Bildgenerierung.`
      : `${proposalSummaryText(proposal.kind, proposal.data)} ist vorbereitet. Soll ich das übernehmen?`;
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
    uiEvent: "proposal_ready"
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
  const project = await openProject(projectId, { projectsDir });
  if (project.projectType !== PROJECT_TYPES.SINGLE_WORKSHEET) {
    throw new Error("AI proposals are only supported for single worksheet projects.");
  }

  const runtime = getAiRuntimeStatus();
  const current = await readCurrentState(projectDir);
  const context = projectContext({ project, ...current });
  if (runtime.status !== "ready") {
    throw new Error(runtime.fallbackReason || "OpenAI is not configured.");
  }
  let proposalData;
  try {
    proposalData = await modelProposalData(kind, project, context, input, runtime, {
      repoRoot,
      projectDir,
      now
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
          suggestedActions: retryActionsForFailedProposal(kind)
        }
      }, { now });
    }
    throw error;
  }
  const proposals = await readProposals(projectDir);
  const proposalId = nextProposalId(proposals);
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
    source: {
      projectId,
      userMessage: String(input.message || "").trim() || null,
      currentLessonBriefId: project.manifest?.currentArtifacts?.lessonbriefId || null,
      currentContentMirrorId: project.manifest?.currentArtifacts?.contentMirrorId || null,
      ruleSelection: ruleSelectionSource(proposalData.ruleSelection)
    },
    data: proposalData.data
  });

  if (!input.silent) {
    await appendAssistantProposalMessage(projectDir, proposal, now, {
      project,
      ...current,
      ...context
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

  let result;
  if (kind === PROPOSAL_KINDS.LESSON_BRIEF) {
    result = await createLessonBriefVersion(projectDir, proposal.data, {
      ...options,
      now,
      createdFrom: [proposalId]
    });
  } else if (kind === PROPOSAL_KINDS.CONTENT_MIRROR) {
    result = await createContentMirrorVersion(projectDir, proposal.data, {
      ...options,
      now,
      createdFrom: [proposalId]
    });
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
  await supersedeOpenSiblingProposals(projectDir, proposal, { now });
  if (!input.silent) {
    const fallback = kind === PROPOSAL_KINDS.IMAGE_SPEC
      ? "Die Entwurfsvorbereitung ist übernommen. Daraus kann jetzt ein Bild-Entwurf erzeugt werden."
      : `${proposalSummaryText(kind, proposal.data)} wurde als ${kind === PROPOSAL_KINDS.CONTENT_WARNINGS ? "Prüfstand" : "Arbeitsblatt-Konzept"} übernommen.`;
    const message = await narrateChatMoment(projectDir, {
      kind: "proposal_adopted",
      fallback,
      proposal: summarizeProposal(proposal),
      commandId: adoptCommandForKind(kind).command
    }, {
      now,
      uiEvent: "proposal_adopted"
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

module.exports = {
  PROPOSAL_KINDS,
  adoptProposal,
  generateProposal,
  readActiveImageSpec,
  readProposalState
};
