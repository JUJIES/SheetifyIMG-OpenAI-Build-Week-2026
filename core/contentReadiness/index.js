"use strict";

const NUMBER_WORDS = new Map([
  ["ein", 1],
  ["eine", 1],
  ["einen", 1],
  ["eins", 1],
  ["zwei", 2],
  ["drei", 3],
  ["vier", 4],
  ["fuenf", 5],
  ["funf", 5],
  ["fünf", 5]
]);

const GENERIC_TASK_PATTERNS = [
  /^bearbeite die aufgabe(?: anhand des materials)?\.?$/i,
  /^bearbeite die aufgaben?\.?$/i,
  /^arbeite mit dem material\.?$/i,
  /^beschreibe die wichtigsten beobachtungen zum material\b/i,
  /^erklaere den .* zusammenhang von\b/i,
  /^erkläre den .* zusammenhang von\b/i,
  /^deute .* als fachlichen hinweis\b/i,
  /^bewerte, welche aussagekraft das material\b/i
];

const GENERIC_MATERIAL_PATTERNS = [
  /^klares arbeitsblatt-material zu\b/i,
  /^arbeitsblatt-material zu\b/i
];

function normalize(value) {
  return String(value || "")
    .toLowerCase()
    .replaceAll("ä", "ae")
    .replaceAll("ö", "oe")
    .replaceAll("ü", "ue")
    .replaceAll("ß", "ss")
    .trim();
}

function compactText(values = []) {
  return values
    .flat()
    .map((value) => String(value || "").trim())
    .filter(Boolean)
    .join("\n");
}

function userMessageText(events = []) {
  return compactText(
    events
      .filter((event) => event.type === "user_message")
      .map((event) => event.payload?.message)
  );
}

function briefText(brief = {}) {
  return compactText([
    brief.goal,
    brief.topic,
    brief.requirements,
    brief.teacherNotes,
    brief.outputPreference?.layout,
    brief.outputPreference?.style
  ]);
}

function numberFromToken(token) {
  const normalized = normalize(token);
  const numeric = Number(normalized);
  if (Number.isFinite(numeric) && numeric > 0) {
    return numeric;
  }
  return NUMBER_WORDS.get(normalized) || null;
}

function requestedTaskConstraint(text) {
  const normalized = normalize(text);
  const matches = [];
  const maximumSpans = [];
  const regexes = [
    {
      regex: /\b(maximal|hoechstens|höchstens|bis zu)\s+(\d+|ein|eine|einen|eins|zwei|drei|vier|fuenf|funf|fünf)\s+(?:kurze\s+|verschiedene\s+)?aufgaben?\b/g,
      kind: "max"
    },
    {
      regex: /\b(genau|exakt)\s+(\d+|ein|eine|einen|eins|zwei|drei|vier|fuenf|funf|fünf)\s+(?:kurze\s+|verschiedene\s+)?aufgaben?\b/g,
      kind: "exact"
    },
    {
      regex: /\b(mindestens|wenigstens)\s+(\d+|ein|eine|einen|eins|zwei|drei|vier|fuenf|funf|fünf)\s+(?:kurze\s+|verschiedene\s+)?aufgaben?\b/g,
      kind: "min"
    },
    {
      regex: /\b(\d+|ein|eine|einen|eins|zwei|drei|vier|fuenf|funf|fünf)\s+(?:kurze\s+|verschiedene\s+)?aufgaben?\b/g,
      kind: "min"
    },
    {
      regex: /\baufgaben?\s*(?:anzahl|:)?\s*(\d+)\b/g,
      kind: "min"
    }
  ];

  for (const { regex, kind } of regexes) {
    let match;
    while ((match = regex.exec(normalized))) {
      if (kind === "min" && maximumSpans.some((span) => match.index >= span.start && match.index < span.end)) {
        continue;
      }
      const number = numberFromToken(kind === "min" && match.length === 2 ? match[1] : match[2]);
      if (number) {
        matches.push({ count: number, kind });
        if (kind === "max") {
          maximumSpans.push({ start: match.index, end: match.index + match[0].length });
        }
      }
    }
  }
  const exactMatches = matches.filter((match) => match.kind === "exact").map((match) => match.count);
  const minMatches = matches.filter((match) => match.kind === "min").map((match) => match.count);
  const maxMatches = matches.filter((match) => match.kind === "max").map((match) => match.count);
  const exactTasks = exactMatches.length ? Math.max(...exactMatches) : null;
  const minTasks = minMatches.length ? Math.max(...minMatches) : null;
  const maxTasks = maxMatches.length ? Math.min(...maxMatches) : null;
  return { minTasks, exactTasks, maxTasks };
}

function requestedConstraints({ events = [], brief = {} } = {}) {
  const text = normalize(compactText([userMessageText(events), briefText(brief)]));
  const taskConstraint = requestedTaskConstraint(text);
  const mentionsSolution = /\b(loesung|loesungsteil|musterloesung|antwort|erwartungshorizont)\b/.test(text);
  const excludesSolution = /\b(kein|keine|keinen|ohne|nicht)\b.{0,40}\b(loesung|loesungsteil|musterloesung|erwartungshorizont)\b/.test(text)
    || /\b(loesung|loesungsteil|musterloesung|erwartungshorizont)\b.{0,20}\bnicht\b/.test(text);
  return {
    minTasks: taskConstraint.minTasks,
    exactTasks: taskConstraint.exactTasks,
    maxTasks: taskConstraint.maxTasks,
    requiresSolution: mentionsSolution && !excludesSolution,
    requiresMaterial: /\b(materialseite|materialbezug|material|quelle|bild|abbildung|grafik)\b/.test(text),
    mentionsAfb: /\bafb\b|anforderungsbereich/.test(text)
  };
}

function textValue(entry = {}) {
  return String(entry.prompt || entry.text || entry.body || entry.description || entry.purpose || "").trim();
}

function splitTaskPromptUnits(prompt = "") {
  const text = String(prompt || "").trim();
  if (!text) {
    return [];
  }
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (lines.length <= 1) {
    return [text];
  }
  const firstLine = lines[0] || "";
  const firstLineUnit = firstLine.match(/\b(?:questions?|fragen|boxes|felder|prompts?)\b[^:]*:\s*(.+)$/i)?.[1]?.trim() || "";
  if (!firstLineUnit) {
    return [text];
  }
  const tail = firstLineUnit ? lines.slice(1) : lines;
  const units = [
    firstLineUnit,
    ...tail
  ].map((line) => line.trim()).filter(Boolean);
  return units.length ? units : [text];
}

function visibleTaskUnitCount(tasks = []) {
  return (Array.isArray(tasks) ? tasks : []).reduce((sum, task) => {
    const units = splitTaskPromptUnits(textValue(task));
    return sum + Math.max(1, units.length);
  }, 0);
}

function isGenericTask(task = {}) {
  const text = normalize(textValue(task));
  return GENERIC_TASK_PATTERNS.some((pattern) => pattern.test(text));
}

function isGenericMaterial(material = {}) {
  const text = normalize(textValue(material));
  return GENERIC_MATERIAL_PATTERNS.some((pattern) => pattern.test(text));
}

function hasSolutionContent(content = {}) {
  const solutionNotes = Array.isArray(content.solutionNotes) ? content.solutionNotes : [];
  const tasks = Array.isArray(content.tasks) ? content.tasks : [];
  return solutionNotes.some((note) => String(note || "").trim())
    || tasks.some((task) => String(task.expectedAnswer || task.solution || "").trim());
}

function contentReadinessForGeneration(content = {}, context = {}) {
  const tasks = Array.isArray(content.tasks) ? content.tasks : [];
  const effectiveTaskCount = visibleTaskUnitCount(tasks);
  const readingTexts = Array.isArray(content.readingTexts) ? content.readingTexts : [];
  const imageMaterials = Array.isArray(content.imageMaterials) ? content.imageMaterials : [];
  const constraints = requestedConstraints(context);
  const reasons = [];

  if (tasks.length === 0) {
    reasons.push("Es gibt noch keine bestätigten Aufgaben.");
  }
  if (tasks.some(isGenericTask)) {
    reasons.push("Mindestens eine Aufgabe ist noch eine generische Platzhalteraufgabe.");
  }
  if (imageMaterials.some(isGenericMaterial)) {
    reasons.push("Mindestens ein Bildmaterial ist noch ein generischer Platzhalter.");
  }
  if (constraints.exactTasks && effectiveTaskCount !== constraints.exactTasks) {
    reasons.push(`Der Auftrag verlangt genau ${constraints.exactTasks} Aufgaben, bestätigt sind bisher ${effectiveTaskCount}.`);
  } else if (constraints.minTasks && effectiveTaskCount < constraints.minTasks) {
    reasons.push(`Der Auftrag verlangt ${constraints.minTasks} Aufgaben, bestätigt sind bisher ${effectiveTaskCount}.`);
  } else if (constraints.maxTasks && tasks.length > constraints.maxTasks) {
    reasons.push(`Der Auftrag verlangt maximal ${constraints.maxTasks} Aufgaben, bestätigt sind bisher ${tasks.length}.`);
  }
  if (constraints.requiresSolution && !hasSolutionContent(content)) {
    reasons.push("Der Auftrag verlangt einen Lösungsteil, aber bestätigte Lösungshinweise fehlen.");
  }
  if (constraints.requiresMaterial && readingTexts.length === 0 && imageMaterials.length === 0) {
    reasons.push("Der Auftrag verlangt Materialbezug, aber bestätigtes Material fehlt.");
  }
  if (constraints.mentionsAfb && tasks.length < 3) {
    reasons.push("AFB I bis III braucht mindestens drei klar unterscheidbare Aufgaben.");
  }

  return {
    ready: reasons.length === 0,
    reasons,
    constraints,
    summary: reasons[0] || "Arbeitsblatt-Konzept ist konkret genug für Entwürfe."
  };
}

function contentReadinessMessage(readiness = {}) {
  if (readiness.ready) {
    return readiness.summary || "Arbeitsblatt-Konzept ist konkret genug für Entwürfe.";
  }
  return `Arbeitsblatt-Konzept ist noch nicht bereit für Entwürfe: ${(readiness.reasons || []).join(" ")}`;
}

module.exports = {
  contentReadinessForGeneration,
  contentReadinessMessage,
  requestedConstraints,
  splitTaskPromptUnits,
  userMessageText
};
