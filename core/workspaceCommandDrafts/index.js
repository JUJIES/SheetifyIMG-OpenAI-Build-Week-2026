"use strict";

const { requestedConstraints } = require("../contentReadiness");

function defaultBriefDraft(project, payload = {}) {
  return {
    subject: payload.subject || project.subject || null,
    topic: payload.topic || project.topic || project.title,
    targetGroup: payload.targetGroup || project.manifest?.targetGroup || null,
    goal: payload.goal || "Unterrichtsmaterial sauber als Bild-Arbeitsblatt vorbereiten.",
    requirements: payload.requirements || [],
    outputPreference: {
      format: "A4",
      pages: payload.pages || 1,
      layout: "auto",
      style: "klar"
    }
  };
}

function normalizedText(value) {
  return String(value || "")
    .toLowerCase()
    .replaceAll("ä", "ae")
    .replaceAll("ö", "oe")
    .replaceAll("ü", "ue")
    .replaceAll("ß", "ss");
}

function contextText(project = {}, brief = {}, events = []) {
  return normalizedText([
    project.title,
    project.subject,
    project.topic,
    project.manifest?.targetGroup,
    brief.subject,
    brief.topic,
    brief.targetGroup,
    brief.goal,
    ...(brief.requirements || []),
    brief.outputPreference?.layout,
    brief.outputPreference?.style,
    ...(events || []).filter((event) => event.type === "user_message").map((event) => event.payload?.message)
  ].filter(Boolean).join("\n"));
}

function isReadingWorksheet(project = {}, brief = {}, events = []) {
  const text = contextText(project, brief, events);
  return /\b(leseblatt|leseseite|lesetext|leseverstaendnis|leseverstandnis|lesen|sachtext)\b/.test(text);
}

function defaultReadingText(topic, brief = {}) {
  const target = brief.targetGroup ? ` für ${brief.targetGroup}` : "";
  return [
    `${topic} ist ein spannendes Thema${target}.`,
    "Der Text erklärt die wichtigsten Informationen in kurzen, gut lesbaren Sätzen.",
    "Die Kinder können danach zentrale Informationen wiederfinden und einfache Fragen beantworten."
  ].join(" ");
}

function readingTaskTemplates(topic) {
  return [
    {
      prompt: `Kreuze an: Welche Aussage passt zum Text über ${topic}?`,
      expectedAnswer: "Die richtige Aussage wird aus dem Lesetext entnommen."
    },
    {
      prompt: `Richtig oder falsch? Prüfe drei Aussagen zum Text über ${topic}.`,
      expectedAnswer: "Die Antworten werden direkt mit Informationen aus dem Text begründet."
    },
    {
      prompt: `Verbinde passende Wörter oder Satzteile aus dem Text zu ${topic}.`,
      expectedAnswer: "Zusammengehörige Informationen werden richtig zugeordnet."
    },
    {
      prompt: `Beantworte kurz: Was erfährst du im Text über ${topic}?`,
      expectedAnswer: "Die Antwort nennt eine wichtige Information aus dem Lesetext."
    },
    {
      prompt: `Markiere oder male: Welche Stelle im Text findest du besonders interessant?`,
      expectedAnswer: "Die Auswahl passt zum Text und kann kurz erklärt werden."
    },
    {
      prompt: `Schreibe einen Satz: Das habe ich über ${topic} gelernt.`,
      expectedAnswer: "Der Satz nennt eine passende Information aus dem Text."
    }
  ];
}

function defaultTasksForConcept(project, brief = {}, payload = {}, events = []) {
  const constraints = requestedConstraints({ events, brief });
  const requestedCount = constraints.exactTasks || constraints.minTasks || (constraints.mentionsAfb ? 3 : 1);
  const taskCount = Math.max(1, Math.min(Number(payload.taskCount) || requestedCount, 8));
  const topic = brief.topic || project.topic || project.title;
  const templates = isReadingWorksheet(project, brief, events) ? readingTaskTemplates(topic) : [
    {
      prompt: `Beschreibe die wichtigsten Beobachtungen zum Material "${topic}".`,
      expectedAnswer: "Die Antwort nennt zentrale sichtbare Merkmale aus dem Material sachlich und genau."
    },
    {
      prompt: `Erklaere den biologischen Zusammenhang von ${topic}.`,
      expectedAnswer: "Die Antwort verbindet Beobachtung und Fachbegriff in einer nachvollziehbaren Erklaerung."
    },
    {
      prompt: `Deute ${topic} als fachlichen Hinweis und begruende deine Einschaetzung.`,
      expectedAnswer: "Die Antwort nutzt die Fachbegriffe und begruendet die Deutung mit Bezug auf das Material."
    },
    {
      prompt: `Bewerte, welche Aussagekraft das Material zu ${topic} hat und wo Grenzen liegen.`,
      expectedAnswer: "Die Antwort nennt eine sinnvolle Aussage und eine fachliche Grenze der Deutung."
    }
  ];
  while (templates.length < taskCount) {
    templates.push({
      prompt: `Bearbeite eine weitere passende Aufgabe zum Text über ${topic}.`,
      expectedAnswer: "Die Antwort nutzt eine Information aus dem Text."
    });
  }
  return templates.slice(0, taskCount).map((task, index) => ({
    id: `task_${index + 1}`,
    page: 1,
    groupLabel: "",
    prompt: task.prompt,
    expectedAnswer: task.expectedAnswer,
    materialRefs: ["material_1"],
    difficulty: index === 0 ? "AFB I" : index === 1 ? "AFB II" : "AFB III"
  }));
}

function defaultDidacticThread(tasks = [], readingTexts = [], imageMaterials = []) {
  const supportingRefs = [
    ...readingTexts.map((entry) => entry.id),
    ...imageMaterials.map((entry) => entry.id)
  ].filter(Boolean);
  const actions = [
    "Material erschließen",
    "Zusammenhänge erklären",
    "Erkenntnisse anwenden",
    "Ergebnis reflektieren"
  ];
  const purposes = [
    "Die Lernenden gewinnen eine gemeinsame fachliche Ausgangsbasis.",
    "Die Ausgangsinformationen werden zu einer nachvollziehbaren Erklärung verbunden.",
    "Die erarbeiteten Zusammenhänge werden auf die nächste Anforderung übertragen.",
    "Das Ergebnis wird fachlich begründet und gesichert."
  ];
  return {
    path: tasks.length > 1
      ? "Vom Erschließen des Materials zur begründeten fachlichen Anwendung"
      : "Material erschließen und fachlich gesichert bearbeiten",
    steps: tasks.map((task, index) => ({
      id: `step_${index + 1}`,
      action: actions[Math.min(index, actions.length - 1)],
      purpose: purposes[Math.min(index, purposes.length - 1)],
      after: index > 0 ? `step_${index}` : null,
      refs: [...(index === 0 ? supportingRefs : []), task.id].filter(Boolean)
    }))
  };
}

function defaultContentDraft(project, payload = {}, brief = {}, events = []) {
  const topic = brief.topic || project.topic || project.title;
  const constraints = requestedConstraints({ events, brief });
  const tasks = defaultTasksForConcept(project, brief, payload, events);
  const readingWorksheet = isReadingWorksheet(project, brief, events);
  const readingTexts = payload.readingTexts || [{
    id: "text_1",
    page: 1,
    role: readingWorksheet ? "reading_text" : "source_text",
    title: topic,
    body: brief.goal || (readingWorksheet ? defaultReadingText(topic, brief) : `Kurzer Materialimpuls zu ${topic}.`)
  }];
  const imageMaterials = payload.imageMaterials || [{
    id: "material_1",
    page: 1,
    prompt: readingWorksheet
      ? `Freundliche, motivierende Bilder zu ${topic}, passend zu einem kindgerechten Leseblatt.`
      : `Sachliche, ruhige A4-Arbeitsblatt-Abbildung zu ${topic}, passend zum bestaetigten Arbeitsblatt-Konzept.`,
    purpose: readingWorksheet ? "Bilder motivieren zum Lesen und unterstützen das Textverständnis." : "Material fuer die Aufgaben",
    placement: readingWorksheet ? "bei Lesetext und Aufgaben dezent unterstuetzend" : "zentral auf der Arbeitsblattseite"
  }];
  return {
    title: payload.title || project.title,
    outputPreference: payload.outputPreference || brief.outputPreference || {
      pages: 1,
      layout: "auto",
      hierarchy: "auto"
    },
    readingTexts,
    tasks: payload.tasks || tasks,
    imageMaterials,
    didacticThread: payload.didacticThread || defaultDidacticThread(payload.tasks || tasks, readingTexts, imageMaterials),
    solutionNotes: payload.solutionNotes || (constraints.requiresSolution || constraints.mentionsAfb
      ? tasks.map((task) => `${task.id}: ${task.expectedAnswer}`)
      : [])
  };
}

module.exports = {
  defaultBriefDraft,
  defaultContentDraft
};
