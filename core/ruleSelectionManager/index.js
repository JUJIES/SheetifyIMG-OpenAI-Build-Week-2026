"use strict";

const fs = require("node:fs/promises");
const path = require("node:path");

const DEFAULT_REPO_ROOT = path.resolve(__dirname, "..", "..");
const RULES_DIR = "rules";
const MAX_SELECTED_RULES = 12;

function normalizeText(value) {
  return String(value || "")
    .toLowerCase()
    .replaceAll("ä", "ae")
    .replaceAll("ö", "oe")
    .replaceAll("ü", "ue")
    .replaceAll("ß", "ss")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "");
}

async function pathExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function listJsonFiles(dirPath) {
  if (!(await pathExists(dirPath))) {
    return [];
  }
  const entries = await fs.readdir(dirPath, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const entryPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      files.push(...await listJsonFiles(entryPath));
    } else if (entry.isFile() && entry.name.endsWith(".json")) {
      files.push(entryPath);
    }
  }
  return files.sort();
}

function arrayOfStrings(values) {
  return (Array.isArray(values) ? values : [])
    .map((value) => String(value || "").trim())
    .filter(Boolean);
}

function validateRule(rawRule = {}, filePath = "") {
  const id = String(rawRule.id || "").trim();
  const scope = String(rawRule.scope || "").trim();
  const stages = arrayOfStrings(rawRule.stages);
  const title = String(rawRule.title || id).trim();
  if (!id || !scope || stages.length === 0) {
    throw new Error(`Rule is missing id, scope or stages: ${filePath}`);
  }
  return {
    ...rawRule,
    id,
    scope,
    stages,
    priority: Number(rawRule.priority) || 0,
    title,
    instructions: arrayOfStrings(rawRule.instructions),
    contentInstructions: arrayOfStrings(rawRule.contentInstructions),
    imageSpecInstructions: arrayOfStrings(rawRule.imageSpecInstructions),
    appliesWhen: rawRule.appliesWhen || {}
  };
}

async function loadRuleCatalog(options = {}) {
  const repoRoot = options.repoRoot || DEFAULT_REPO_ROOT;
  const rulesDir = path.join(repoRoot, RULES_DIR);
  const files = await listJsonFiles(rulesDir);
  const rules = [];
  for (const filePath of files) {
    const rawRule = JSON.parse(await fs.readFile(filePath, "utf8"));
    rules.push(validateRule(rawRule, filePath));
  }
  return rules.sort((left, right) => {
    return (right.priority - left.priority) || left.id.localeCompare(right.id);
  });
}

function stageForProposalKind(kind) {
  if (kind === "content_mirror") {
    return "content_mirror";
  }
  if (kind === "image_spec") {
    return "image_spec";
  }
  if (kind === "lessonbrief") {
    return "lessonbrief";
  }
  return String(kind || "unknown");
}

function contextTexts({ project = {}, context = {}, input = {} } = {}) {
  const brief = context.currentBrief || {};
  const content = context.currentContent || {};
  return [
    project.title,
    project.subject,
    project.topic,
    project.manifest?.targetGroup,
    context.project?.title,
    context.project?.subject,
    context.project?.topic,
    context.project?.targetGroup,
    brief.subject,
    brief.topic,
    brief.targetGroup,
    brief.goal,
    ...(brief.requirements || []),
    brief.outputPreference?.layout,
    brief.outputPreference?.style,
    content.title,
    ...(content.readingTexts || []).flatMap((entry) => [entry.title, entry.body]),
    ...(content.tasks || []).flatMap((entry) => [entry.id, entry.prompt, entry.expectedAnswer, ...(entry.materialRefs || [])]),
    ...(content.imageMaterials || []).flatMap((entry) => [entry.id, entry.prompt, entry.purpose, entry.placement]),
    ...(context.recentMessages || []).flatMap((entry) => [entry.message]),
    ...(context.teacherInput?.messages || []).flatMap((entry) => [entry.message]),
    input.message,
    input.variantInstruction,
    input.uiEvent
  ].filter(Boolean);
}

function inferTaskTypes(text) {
  const taskTypes = new Set();
  if (/\b(zuordn|verbinde|matching|match|draw lines|linien|phrase pairs|phrasenpaare)\b/.test(text)) {
    taskTypes.add("matching");
  }
  if (/\b(multiple choice|single choice|kreuze an|ankreuzen|waehle aus|choose the correct|tick the correct|antwortmoeglichkeiten)\b/.test(text)) {
    taskTypes.add("multiple_choice");
  }
  if (/\b(lesetext|leseverstehen|reading comprehension|textverstaendnis|detaillesen|informationen entnehmen)\b/.test(text)) {
    taskTypes.add("reading_comprehension");
  }
  if (/\b(oral exam|sprechpruefung|speaking|picture description|bildbeschreibung|discussion phrases)\b/.test(text)) {
    taskTypes.add("speaking_exam_prep");
  }
  if (/\b(mathe|mathematik|bruch|koordinatensystem|gleichung|geometry|algebra)\b/.test(text)) {
    taskTypes.add("math_practice");
  }
  return [...taskTypes];
}

function includesAnyTerm(text, terms = []) {
  return arrayOfStrings(terms)
    .map(normalizeText)
    .some((term) => term && text.includes(term));
}

function forcedRuleIds(input = {}) {
  const values = [
    process.env.SHEETIFYIMG_FORCE_RULES,
    input.forceRuleIds,
    input.ruleIds
  ];
  return new Set(values.flatMap((value) => {
    if (Array.isArray(value)) {
      return value;
    }
    return String(value || "").split(",");
  }).map((value) => String(value || "").trim()).filter(Boolean));
}

function ruleMatchReason(rule, stage, signals, forcedIds) {
  if (!rule.stages.includes(stage)) {
    return null;
  }
  if (forcedIds.has(rule.id)) {
    return "forced";
  }

  const appliesWhen = rule.appliesWhen || {};
  const taskTypes = arrayOfStrings(appliesWhen.taskTypes);
  const textTerms = arrayOfStrings(appliesWhen.textTerms);
  const hasTaskTypeMatch = taskTypes.some((type) => signals.taskTypes.includes(type));
  const hasTextMatch = includesAnyTerm(signals.text, textTerms);

  if (appliesWhen.always === true) {
    return rule.testOnly ? null : "always";
  }
  if (hasTaskTypeMatch) {
    return "task_type";
  }
  if (hasTextMatch) {
    return rule.testOnly ? "explicit_test_trigger" : "text_signal";
  }
  return null;
}

function promptInstructionsForRule(rule, stage) {
  const stageSpecific = stage === "image_spec"
    ? rule.imageSpecInstructions
    : stage === "content_mirror"
      ? rule.contentInstructions
      : [];
  return [...rule.instructions, ...stageSpecific]
    .map((line) => String(line || "").trim())
    .filter(Boolean);
}

function selectedRuleSummary(rule, stage, reason) {
  return {
    id: rule.id,
    version: rule.version || 1,
    scope: rule.scope,
    title: rule.title,
    priority: rule.priority,
    reason,
    testOnly: rule.testOnly === true,
    instructions: promptInstructionsForRule(rule, stage)
  };
}

async function selectRulesForProposal({ kind, project = {}, context = {}, input = {}, repoRoot = DEFAULT_REPO_ROOT } = {}) {
  const stage = stageForProposalKind(kind);
  const catalog = await loadRuleCatalog({ repoRoot });
  const text = normalizeText(contextTexts({ project, context, input }).join("\n"));
  const signals = {
    stage,
    text,
    taskTypes: inferTaskTypes(text)
  };
  const forcedIds = forcedRuleIds(input);
  const selected = [];
  for (const rule of catalog) {
    const reason = ruleMatchReason(rule, stage, signals, forcedIds);
    if (!reason) {
      continue;
    }
    selected.push(selectedRuleSummary(rule, stage, reason));
  }
  selected.sort((left, right) => {
    return (right.priority - left.priority) || left.id.localeCompare(right.id);
  });
  return {
    stage,
    selected: selected.slice(0, MAX_SELECTED_RULES),
    signals: {
      taskTypes: signals.taskTypes
    }
  };
}

function formatSelectedRulesForPrompt(selection = {}) {
  const rules = Array.isArray(selection.selected) ? selection.selected : [];
  if (!rules.length) {
    return "";
  }
  const lines = [
    "Zusaetzlich anzuwendende SheetifyIMG-Regeln:",
    "Nutze nur die folgenden, fuer diesen Schritt ausgewaehlten Regeln. Sie ergaenzen die allgemeinen Prompts und duerfen harte Nutzerangaben nicht ueberschreiben."
  ];
  for (const rule of rules) {
    lines.push("");
    lines.push(`- ${rule.id} (${rule.scope}): ${rule.title}`);
    for (const instruction of rule.instructions || []) {
      lines.push(`  - ${instruction}`);
    }
  }
  return lines.join("\n");
}

function appliedRulesForImageSpec(selection = {}) {
  return (Array.isArray(selection.selected) ? selection.selected : [])
    .filter((rule) => rule.instructions?.length)
    .map((rule) => ({
      id: rule.id,
      scope: rule.scope,
      title: rule.title,
      instructions: rule.instructions
    }));
}

function ruleSelectionSource(selection = {}) {
  return {
    stage: selection.stage || null,
    rules: (selection.selected || []).map((rule) => ({
      id: rule.id,
      scope: rule.scope,
      reason: rule.reason,
      testOnly: rule.testOnly === true
    })),
    signals: selection.signals || {}
  };
}

module.exports = {
  appliedRulesForImageSpec,
  formatSelectedRulesForPrompt,
  loadRuleCatalog,
  ruleSelectionSource,
  selectRulesForProposal,
  stageForProposalKind
};
