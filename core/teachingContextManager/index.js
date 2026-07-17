"use strict";

const fs = require("node:fs/promises");
const path = require("node:path");
const { EVENT_TYPES } = require("../contracts");
const { readEvents } = require("../eventLog");
const { interpretTeachingContext } = require("../semanticInterpreterManager");

const TEACHING_CONTEXT_SCHEMA_VERSION = "sheetifyimg.teaching-context.v1";
const CONTEXT_FILE = "teaching-context.json";

const FIELD_DEFINITIONS = Object.freeze([
  {
    id: "subject",
    label: "Fach/Bereich",
    required: false,
    question: null
  },
  {
    id: "topic",
    label: "Thema",
    required: true,
    question: "Worum soll es im Arbeitsblatt gehen?"
  },
  {
    id: "targetGroup",
    label: "Zielgruppe",
    required: true,
    question: "Fuer welche Klasse oder Lerngruppe ist das Arbeitsblatt gedacht?"
  },
  {
    id: "lessonGoal",
    label: "Unterrichtsziel",
    required: true,
    question: "Was sollen die Kinder am Ende koennen oder verstanden haben?"
  },
  {
    id: "worksheetType",
    label: "Arbeitsblatt-Typ",
    required: false,
    question: "Soll es eher ein Uebungsblatt, Leseblatt, Zuordnungsblatt oder etwas anderes werden?"
  },
  {
    id: "specialRequirements",
    label: "Besonderheiten",
    required: false,
    question: "Gibt es etwas, worauf ich bei der Gestaltung besonders achten soll?"
  }
]);

const FIELD_IDS = FIELD_DEFINITIONS.map((field) => field.id);
const REQUIRED_FIELD_IDS = FIELD_DEFINITIONS.filter((field) => field.required).map((field) => field.id);

function contextPath(projectDir) {
  return path.join(projectDir, "context", CONTEXT_FILE);
}

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

function normalizeText(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/ß/g, "ss")
    .replace(/\s+/g, " ")
    .trim();
}

function cleanValue(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .replace(/^["'`]+|["'`]+$/g, "")
    .replace(/[.!?;:,\s]+$/g, "")
    .trim();
}

function emptyField(id) {
  const definition = FIELD_DEFINITIONS.find((field) => field.id === id);
  return {
    id,
    label: definition?.label || id,
    status: "missing",
    value: null,
    assumption: false,
    source: null,
    updatedAt: null
  };
}

function emptyContext() {
  return {
    schemaVersion: TEACHING_CONTEXT_SCHEMA_VERSION,
    phase: "teaching_context_collecting",
    forcedWithAssumptions: false,
    fields: Object.fromEntries(FIELD_IDS.map((id) => [id, emptyField(id)])),
    readiness: null,
    nextQuestion: null,
    updatedAt: null
  };
}

function normalizeField(id, value = {}) {
  const field = {
    ...emptyField(id),
    ...value,
    id
  };
  field.value = field.value ? cleanValue(field.value) : null;
  field.assumption = field.assumption === true;
  field.status = field.value
    ? field.assumption
      ? "assumed"
      : field.status === "partial"
        ? "partial"
        : "known"
    : "missing";
  return field;
}

function normalizeContext(input = {}) {
  const context = emptyContext();
  context.forcedWithAssumptions = input.forcedWithAssumptions === true;
  context.updatedAt = input.updatedAt || null;
  for (const id of FIELD_IDS) {
    context.fields[id] = normalizeField(id, input.fields?.[id]);
  }
  return evaluateReadiness(context);
}

function fieldReady(field) {
  return Boolean(field?.value && (field.status === "known" || field.status === "partial" || field.status === "assumed"));
}

function evaluateReadiness(inputContext = {}) {
  const context = {
    ...inputContext,
    fields: {
      ...emptyContext().fields,
      ...(inputContext.fields || {})
    }
  };
  const missingRequired = REQUIRED_FIELD_IDS.filter((id) => !fieldReady(context.fields[id]));
  const optionalMissing = FIELD_IDS.filter((id) => !REQUIRED_FIELD_IDS.includes(id) && !fieldReady(context.fields[id]));
  const ready = missingRequired.length === 0;
  const forced = context.forcedWithAssumptions === true && !ready;
  context.forcedWithAssumptions = forced;
  const nextFieldId = missingRequired[0] || optionalMissing[0] || null;
  const nextField = FIELD_DEFINITIONS.find((field) => field.id === nextFieldId) || null;
  context.phase = ready
    ? "teaching_context_ready"
    : forced
      ? "forced_with_assumptions"
      : "teaching_context_collecting";
  context.readiness = {
    status: context.phase,
    ready,
    forcedWithAssumptions: forced,
    conceptAllowed: ready || forced,
    missingRequired,
    optionalMissing
  };
  context.nextQuestion = nextField ? nextField.question : null;
  return context;
}

function setField(context, id, value, options = {}) {
  const cleaned = cleanValue(value);
  if (!cleaned || !FIELD_IDS.includes(id)) {
    return false;
  }
  const current = context.fields[id] || emptyField(id);
  if (current.value && options.onlyIfMissing) {
    return false;
  }
  context.fields[id] = normalizeField(id, {
    ...current,
    value: cleaned,
    status: options.status || "known",
    assumption: options.assumption === true,
    source: options.source || current.source || "inferred",
    updatedAt: options.now || current.updatedAt || null
  });
  return true;
}

function valueAfter(text, pattern) {
  const match = text.match(pattern);
  return cleanValue(match?.[1] || "");
}

function inferTopic(message, project = {}) {
  const raw = String(message || "");
  const topicByMarker = valueAfter(raw, /\bthema\s*(?:ist|:|sollte|soll|waere|wäre)?\s*([^.!?\n,;]+)/i);
  if (topicByMarker) {
    return topicByMarker;
  }
  const worksheetTopic = valueAfter(raw, /\b(?:arbeitsblatt|blatt|material)\s+(?:zu|zum|zur|ueber|über)\s+([^.!?\n,;]+?)(?:\s+(?:fuer|für)\b|$)/i);
  if (worksheetTopic) {
    return worksheetTopic;
  }
  if (project.topic) {
    return project.topic;
  }
  return null;
}

function weakTopicValue(value) {
  return /^(sollte|soll|waere|wäre)\s+/i.test(cleanValue(value));
}

function inferTargetGroup(message, project = {}) {
  const text = normalizeText(message);
  const parts = [];
  const classMatch = text.match(/\bkla+s+e\s*(\d{1,2})\b/)
    || text.match(/\b(\d{1,2})\s*\.?\s*kla+s+e\b/);
  if (classMatch) {
    parts.push(`Klasse ${classMatch[1] || classMatch[2]}`);
  }
  if (/\berstklaessler|erstklassler|erstklasser|1\.\s*klasse\b/.test(text) && !parts.some((part) => part.includes("1"))) {
    parts.push("Klasse 1");
  }
  if (/\bgrundschueler|grundschuler|grundschule\b/.test(text)) {
    parts.push("Grundschule");
  }
  if (/\bleseanfaenger|leseanfanger\b/.test(text)) {
    parts.push("Leseanfänger");
  }
  const projectTargetGroup = project.targetGroup || project.manifest?.targetGroup || null;
  if (projectTargetGroup && !parts.length) {
    parts.push(projectTargetGroup);
  }
  return parts.length ? [...new Set(parts)].join(" / ") : null;
}

function invalidLessonGoalValue(value) {
  const text = normalizeText(value);
  return !text
    || /^(also\s+)?(jetzt\s+)?(hinreichend\s+)?klar$/.test(text)
    || /^(ja|nein|okay|ok|passt|verstanden)$/.test(text)
    || /^ja\s+(passt|klar|genau)$/.test(text)
    || /^passt\s+(so|genau)$/.test(text)
    || /^klar\s+(genug|so)$/.test(text)
    || /^\d+\s+.*aufgaben?\b/.test(text);
}

function canonicalLessonGoal(value, message = "") {
  const cleaned = cleanValue(value);
  const text = normalizeText(`${message} ${cleaned}`);
  const phraseSignal = /\b(phras\w*|redemittel|formulierung\w*)\b/.test(text);
  const oralExamSignal = /\b(oral\W*exam|muend\w*|mund\w*|pruef\w*|pruf\w*)\b/.test(text);
  const refreshSignal = /\b(auffrisch\w*|wiederhol\w*|bekannt\w*|aktivier\w*|vorbereit\w*)\b/.test(text);
  const applySignal = /\b(anwend\w*|einsetz\w*|benutz\w*|sprech\w*|aktiv\w*|abruf\w*|schnell\w*)\b/.test(text);
  const matchSignal = /\b(zuordn\w*|verbind\w*|matching|matchen|links|rechts)\b/.test(text);

  if (phraseSignal && oralExamSignal && (refreshSignal || applySignal)) {
    return "Phrasen für die mündliche Prüfung auffrischen und aktiv anwenden";
  }
  if (phraseSignal && oralExamSignal && matchSignal) {
    return "Phrasen für die mündliche Prüfung wiederholen, zuordnen und anwenden";
  }
  if (phraseSignal && refreshSignal && applySignal) {
    return "bekannte Phrasen auffrischen und aktiv anwenden";
  }
  if (phraseSignal && matchSignal) {
    return "Phrasen Bedeutungen zuordnen und anschließend anwenden";
  }
  if (/\bwortschatz|vokabel\w*\b/.test(text) && (refreshSignal || applySignal)) {
    return "Wortschatz wiederholen und sicher anwenden";
  }
  return cleaned;
}

function lessonGoalCandidate(value, message = "") {
  if (!value || invalidLessonGoalValue(value)) {
    return null;
  }
  return canonicalLessonGoal(value, message);
}

function lessonGoalContextText(message, context = {}, project = {}) {
  return [
    message,
    context.fields?.topic?.value,
    context.fields?.worksheetType?.value,
    project.topic,
    project.subject,
    project.title
  ].filter(Boolean).join(" ");
}

function inferLessonGoal(message, context = {}, project = {}) {
  const raw = String(message || "");
  const contextText = lessonGoalContextText(raw, context, project);
  const text = normalizeText(contextText);
  const rawText = normalizeText(raw);
  if (/\b(?:unterrichtsziel|lernziel|ziel)\s+ist\s+(?:also\s+)?(?:jetzt\s+)?(?:hinreichend\s+)?klar\s*\?/i.test(raw)) {
    return null;
  }
  if (/\berstkontakt\b/.test(rawText) && /\binteresse\s+wecken\b/.test(rawText)) {
    return "Erstkontakt schaffen, Interesse wecken und erste Informationen verstehen";
  }
  if (/\binteresse\s+wecken\b/.test(rawText) || /\bmotivieren\b.{0,40}\bweiterlesen\b/.test(rawText)) {
    return "Interesse wecken und zum Weiterlesen motivieren";
  }
  const implicitPhraseGoal = lessonGoalCandidate(raw, contextText);
  if (implicitPhraseGoal && implicitPhraseGoal !== cleanValue(raw)) {
    return implicitPhraseGoal;
  }
  if (/\bmehr\s+wissen\b/.test(rawText)) {
    const topicMatch = raw.match(/\bmehr\s+wissen\s+(?:ueber|über|ber)\s+([^.!?\n;]+)/i);
    const topic = cleanValue(topicMatch?.[1] || "");
    return topic ? `mehr über ${topic} wissen` : "mehr über das Thema wissen";
  }
  const explicitGoal = valueAfter(raw, /\b(?:ziel|unterrichtsziel|lernziel|goal|aim|objective)\s*(?:(?:ist|is|sit|soll(?:te)?(?:\s+sein)?|:)\s*)?(?:dass\s+)?([^.!?\n;]+)/i);
  const canonicalExplicitGoal = lessonGoalCandidate(explicitGoal, contextText);
  if (canonicalExplicitGoal) {
    return canonicalExplicitGoal;
  }
  const endGoal = valueAfter(raw, /\b(?:am ende|danach)\s+(?:sollen|koennen|können)?\s*([^.!?\n;]+)/i);
  const canonicalEndGoal = lessonGoalCandidate(endGoal, contextText);
  if (canonicalEndGoal) {
    return canonicalEndGoal;
  }
  const sollenGoal = valueAfter(raw, /\b(?:die kinder|schueler|schüler|sie)\s+sollen\s+([^.!?\n;]+)/i);
  const canonicalSollenGoal = lessonGoalCandidate(sollenGoal, contextText);
  if (canonicalSollenGoal) {
    return canonicalSollenGoal;
  }
  const learnerGoalMatch = raw.match(/\b(?:die kinder|schueler|schüler|lernenden)\s+((?:koennen|können|sollen|lernen|ueben|üben|trainieren|bearbeiten|finden|ordnen|begr[uü]nden|markieren|untersuchen|lesen|verstehen|anwenden)\b[^.!?\n;]*)/i);
  const canonicalLearnerGoal = lessonGoalCandidate(learnerGoalMatch?.[1] || "", contextText);
  if (canonicalLearnerGoal) {
    return canonicalLearnerGoal;
  }
  const learnerActionGoalMatch = raw.match(/\b(?:die kinder|schueler|schüler|lernenden)\s+([^.!?\n;]*(?:finden|ordnen|begr[uü]nden|markieren|untersuchen|lesen|verstehen|anwenden)[^.!?\n;]*)/i);
  const canonicalLearnerActionGoal = lessonGoalCandidate(learnerActionGoalMatch?.[1] || "", contextText);
  if (canonicalLearnerActionGoal) {
    return canonicalLearnerActionGoal;
  }
  if (
    /\b(?:wichtige\s+infos?|wichtige\s+informationen|informationen|infos?)\b/.test(text)
    && /\b(?:entnehmen|enthnehmen|entnhemen|herausfinden|herausarbeiten|finden)\b/.test(text)
  ) {
    return "wichtige Infos aus dem Text entnehmen";
  }
  if (/\bdetail(?:lesen|lese|fragen|verstaendnis|verständnis)\b/.test(text)) {
    return "detailliert lesen und wichtige Infos entnehmen";
  }
  if (/\bsinngemaess|sinngemass|sinngemäß\b/.test(text) && /\b(?:text|lesen|verstehen)\b/.test(text)) {
    return "den Text sinngemaess verstehen";
  }
  if (/\bbild\b.*\bwort\b.*\bzuordn/.test(text) || /\bwort\b.*\bbild\b.*\bzuordn/.test(text)) {
    return "Bild und Wort zuordnen";
  }
  if (/\bwort\b.*\b(?:lesen|schreiben)\b/.test(text)) {
    return text.includes("schreib") ? "das Wort schreiben" : "das Wort lesen";
  }
  if (/\b(?:sachinfos?|infos?)\b.*\bverstehen\b/.test(text)) {
    return "einfache Sachinfos verstehen";
  }
  if (/\bbruch|bruche|bruchen|brueche|bruechen\b/.test(text) && /\b(?:vergleichen|kurzen|kuerzen|erweitern|rechnen|verstehen)\b/.test(text)) {
    return "Brüche verstehen und anwenden";
  }
  return null;
}

function inferWorksheetType(message) {
  const text = normalizeText(message);
  const types = [
    ["einstieg", "Einstiegsblatt"],
    ["uebung", "Uebungsblatt"],
    ["ubung", "Uebungsblatt"],
    ["ueben", "Uebungsblatt"],
    ["uben", "Uebungsblatt"],
    ["wiederholung", "Wiederholungsblatt"],
    ["sicherung", "Sicherungsblatt"],
    ["leseblatt", "Leseblatt"],
    ["lesen", "Leseblatt"],
    ["schreibblatt", "Schreibblatt"],
    ["schreiben", "Schreibblatt"],
    ["zuordnung", "Zuordnungsblatt"],
    ["zuordnen", "Zuordnungsblatt"],
    ["sachinfo", "Sachinfo-Blatt"],
    ["check", "Test-/Checkblatt"],
    ["test", "Test-/Checkblatt"],
    ["differenzierung", "Differenzierungsblatt"],
    ["kreativ", "Kreativblatt"],
    ["hausaufgabe", "Hausaufgabenblatt"]
  ];
  return types.find(([keyword]) => text.includes(keyword))?.[1] || null;
}

function inferSpecialRequirements(message) {
  const text = normalizeText(message);
  const requirements = [];
  if (/\bwenig text|sehr wenig text|kurze texte?\b/.test(text)) {
    requirements.push("wenig Text");
  }
  if (/\bgrosse schrift|große schrift|gross geschrieben|gut lesbar\b/.test(text)) {
    requirements.push("grosse, gut lesbare Schrift");
  }
  if (/\buebersichtlich|ubersichtlich|klar strukturiert\b/.test(text)) {
    requirements.push("besonders uebersichtlich");
  }
  if (/\bviel platz|platz zum schreiben\b/.test(text)) {
    requirements.push("viel Platz zum Schreiben");
  }
  if (/\beinfache sprache|leichte sprache\b/.test(text)) {
    requirements.push("einfache Sprache");
  }
  if (/\bschoene bilder|schöne bilder|ansprechend|huebsch|hübsch\b/.test(text)) {
    requirements.push("ansprechende Bilder");
  }
  if (/\bdifferenzier/.test(text)) {
    requirements.push("Differenzierung beachten");
  }
  return requirements.length ? [...new Set(requirements)].join(", ") : null;
}

function forceRequested(message) {
  const text = normalizeText(message);
  return /\b(mach|erstelle|erzeuge)\b.*\b(trotzdem|einfach)\b/.test(text)
    || /\b(trotzdem|einfach)\b.*\b(vorschlag|konzept)\b/.test(text)
    || /\bmit annahmen\b/.test(text);
}

function explicitConceptCreationRequested(message) {
  const text = normalizeText(message);
  return /\b(?:arbeitsblatt-?konzept|konzept|konzeptvorschlag)\b/.test(text)
    && /\b(?:anleg|angeleg|erstell|erstelle|entwickel|entwickeln|ausarbeit|ausarbeiten|ausformulier|formulier|vorschlag)\w*\b/.test(text);
}

function inferFromMessage(context, message, options = {}) {
  const project = options.project || {};
  const now = options.now || null;
  const source = options.source || "chat";
  const onlyFillMissing = options.onlyFillMissing === true;
  const topicSource = context.fields?.topic?.source || null;
  const topicOnlyIfMissing = onlyFillMissing || (topicSource === "chat" && !weakTopicValue(context.fields?.topic?.value));
  setField(context, "topic", inferTopic(message, project), { onlyIfMissing: topicOnlyIfMissing, source, now });
  setField(context, "targetGroup", inferTargetGroup(message, project), { onlyIfMissing: true, source, now });
  setField(context, "lessonGoal", inferLessonGoal(message, context, project), { onlyIfMissing: onlyFillMissing, source, now });
  setField(context, "worksheetType", inferWorksheetType(message), { onlyIfMissing: onlyFillMissing, source, now });
  setField(context, "specialRequirements", inferSpecialRequirements(message), { onlyIfMissing: onlyFillMissing, source, now });
  if (forceRequested(message) || explicitConceptCreationRequested(message)) {
    context.forcedWithAssumptions = true;
  }
  return evaluateReadiness(context);
}

function confidenceThresholdForField(id) {
  if (id === "lessonGoal") {
    return 0.6;
  }
  if (id === "topic" || id === "targetGroup") {
    return 0.55;
  }
  return 0.5;
}

function semanticStatusForField(field = {}) {
  return ["known", "partial", "assumed"].includes(field.status) ? field.status : null;
}

function acceptableSemanticValue(id, value, message = "") {
  const cleaned = cleanValue(value);
  if (!cleaned) {
    return null;
  }
  if (id === "topic" && weakTopicValue(cleaned)) {
    return null;
  }
  if (id === "lessonGoal") {
    return lessonGoalCandidate(cleaned, message);
  }
  return cleaned;
}

function applySemanticTeachingContext(context, interpretation, options = {}) {
  if (!interpretation?.fields) {
    return evaluateReadiness(context);
  }
  const now = options.now || null;
  const message = options.message || "";
  for (const id of FIELD_IDS) {
    const field = interpretation.fields[id] || {};
    const status = semanticStatusForField(field);
    const confidence = Number(field.confidence) || 0;
    const value = acceptableSemanticValue(id, field.value, message);
    if (!status || !value || confidence < confidenceThresholdForField(id)) {
      continue;
    }
    const current = context.fields?.[id] || emptyField(id);
    const onlyIfMissing = id === "targetGroup"
      && current.value
      && current.source !== "ai_semantic";
    setField(context, id, value, {
      onlyIfMissing,
      source: "ai_semantic",
      status,
      assumption: status === "assumed",
      now
    });
  }
  if (interpretation.forceWithAssumptions === true) {
    context.forcedWithAssumptions = true;
  }
  return evaluateReadiness(context);
}

function applyPlanningTeachingContextPatch(inputContext = {}, patch = {}, options = {}) {
  const context = normalizeContext(inputContext);
  const now = options.now || null;
  const fields = patch.fields && typeof patch.fields === "object" ? patch.fields : {};
  for (const id of FIELD_IDS) {
    const fieldPatch = fields[id] || {};
    if (fieldPatch.operation === "keep") {
      continue;
    }
    if (fieldPatch.operation === "clear") {
      context.fields[id] = emptyField(id);
      context.fields[id].source = "ai_planning";
      context.fields[id].updatedAt = now;
      continue;
    }
    if (fieldPatch.operation !== "set") {
      continue;
    }
    const value = acceptableSemanticValue(id, fieldPatch.value, options.message || "");
    const confidence = Number(fieldPatch.confidence) || 0;
    if (!value || confidence < confidenceThresholdForField(id)) {
      continue;
    }
    const status = semanticStatusForField(fieldPatch) || "known";
    context.fields[id] = normalizeField(id, {
      ...context.fields[id],
      value,
      status,
      assumption: status === "assumed",
      source: "ai_planning",
      updatedAt: now
    });
  }
  if (patch.forceWithAssumptions === true) {
    context.forcedWithAssumptions = true;
  }
  return evaluateReadiness(context);
}

function inferFromProjectAndDocuments(context, options = {}) {
  const project = options.project || {};
  const brief = options.brief || {};
  const content = options.content || {};
  const source = options.source || {};
  setField(context, "subject", brief.subject || project.subject, {
    onlyIfMissing: true,
    source: brief.subject ? "brief" : "project"
  });
  setField(context, "topic", brief.topic || content.title || project.topic, {
    onlyIfMissing: true,
    source: "project"
  });
  setField(context, "targetGroup", brief.targetGroup || project.targetGroup || project.manifest?.targetGroup, {
    onlyIfMissing: true,
    source: "project"
  });
  setField(context, "lessonGoal", brief.goal, {
    onlyIfMissing: true,
    source: "brief"
  });
  if (Array.isArray(brief.requirements) && brief.requirements.length) {
    setField(context, "specialRequirements", brief.requirements.slice(0, 3).join(", "), {
      onlyIfMissing: true,
      source: "brief"
    });
  }
  if (source.transferCard) {
    inferFromMessage(context, source.transferCard, {
      project,
      source: "input",
      now: options.now || null,
      onlyFillMissing: true
    });
  }
  return evaluateReadiness(context);
}

function inferFromEvents(context, events = [], options = {}) {
  for (const event of events || []) {
    if (event.type !== EVENT_TYPES.USER_MESSAGE) {
      continue;
    }
    inferFromMessage(context, event.payload?.message || event.payload?.content || "", {
      ...options,
      now: event.createdAt || options.now || null,
      source: "chat",
      onlyFillMissing: true
    });
  }
  return evaluateReadiness(context);
}

function isInputUploadAnalysisEvent(event = {}) {
  return event.type === EVENT_TYPES.ASSISTANT_MESSAGE
    && event.payload?.contextRefs?.kind === "input_upload_analysis";
}

function inferFromInputAnalyses(context, events = [], options = {}) {
  for (const event of events || []) {
    if (!isInputUploadAnalysisEvent(event)) {
      continue;
    }
    inferFromMessage(context, event.payload?.message || "", {
      ...options,
      now: event.createdAt || options.now || null,
      source: "input_analysis",
      onlyFillMissing: true
    });
  }
  return evaluateReadiness(context);
}

async function readTeachingContext(projectDir, options = {}) {
  const stored = normalizeContext(await readJsonIfExists(contextPath(projectDir)) || {});
  let context = inferFromProjectAndDocuments(stored, options);
  context = inferFromEvents(context, options.events || [], options);
  context = inferFromInputAnalyses(context, options.events || [], options);
  return evaluateReadiness(context);
}

async function writeTeachingContext(projectDir, context, options = {}) {
  const normalized = evaluateReadiness({
    ...normalizeContext(context),
    updatedAt: options.now || context.updatedAt || new Date().toISOString()
  });
  await writeJson(contextPath(projectDir), normalized);
  return normalized;
}

async function updateTeachingContextFromMessage(projectDir, message, options = {}) {
  const project = options.project || await readJsonIfExists(path.join(projectDir, "project-manifest.json")) || {};
  const events = options.events || await readEvents(projectDir);
  const current = await readTeachingContext(projectDir, {
    ...options,
    project,
    events
  });
  const now = options.now || new Date().toISOString();
  const interpretation = await interpretTeachingContext(projectDir, {
    context: current,
    message,
    project,
    events
  }, {
    ...options,
    now
  });
  const next = interpretation
    ? inferFromMessage(
      applySemanticTeachingContext(current, interpretation, {
        now,
        message
      }),
      message,
      {
        ...options,
        project,
        source: "chat",
        now,
        onlyFillMissing: true
      }
    )
    : inferFromMessage(current, message, {
      ...options,
      project,
      source: "chat",
      now
    });
  return writeTeachingContext(projectDir, next, options);
}

module.exports = {
  FIELD_DEFINITIONS,
  REQUIRED_FIELD_IDS,
  applyPlanningTeachingContextPatch,
  applySemanticTeachingContext,
  evaluateReadiness,
  readTeachingContext,
  updateTeachingContextFromMessage,
  writeTeachingContext
};
