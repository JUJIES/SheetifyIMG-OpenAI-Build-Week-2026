"use strict";

const { EVENT_TYPES } = require("../contracts");

const MIN_MEANINGFUL_CHARS = 32;
const MEANINGFUL_TERMS = [
  "arbeitsblatt",
  "aufgabe",
  "aufgaben",
  "bildbeschreibung",
  "diagramm",
  "einordnung",
  "erklaer",
  "erklär",
  "evolution",
  "fach",
  "klasse",
  "lernziel",
  "material",
  "picture",
  "schueler",
  "schüler",
  "stunde",
  "thema",
  "unterricht",
  "ziel"
];

const LOW_SIGNAL_MESSAGES = new Set([
  "test",
  "okay",
  "ok",
  "ja",
  "nein",
  "weiter",
  "mach",
  "bitte",
  "prüfen",
  "pruefen"
]);

function normalizeText(value) {
  return String(value || "")
    .normalize("NFKC")
    .trim()
    .toLowerCase()
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/ß/g, "ss");
}

function sourceFilesFrom(source = {}) {
  return Array.isArray(source.manifest?.files) ? source.manifest.files : [];
}

function isCanvasFeedbackMessage(event = {}) {
  const message = normalizeText(event.payload?.message);
  return event.payload?.uiEvent === "canvas_feedback"
    || message.startsWith("bitte pruefe den aktuellen canvas-bereich");
}

function isMeaningfulTeacherMessage(event = {}) {
  if (event.type !== EVENT_TYPES.USER_MESSAGE || isCanvasFeedbackMessage(event)) {
    return false;
  }
  const message = normalizeText(event.payload?.message);
  if (!message || LOW_SIGNAL_MESSAGES.has(message)) {
    return false;
  }
  if (message.length >= MIN_MEANINGFUL_CHARS && /\s/.test(message)) {
    return true;
  }
  return MEANINGFUL_TERMS.some((term) => message.includes(normalizeText(term)));
}

function inputReadiness({ source = {}, events = [] } = {}) {
  const files = sourceFilesFrom(source);
  const hasFiles = files.length > 0;
  const hasTransferCard = Boolean(String(source.transferCard || "").trim());
  const userMessages = events.filter((event) => event.type === EVENT_TYPES.USER_MESSAGE);
  const meaningfulMessages = userMessages.filter(isMeaningfulTeacherMessage);
  const ready = hasFiles || hasTransferCard || meaningfulMessages.length > 0;

  return {
    ready,
    state: ready ? "ready" : "needs_input",
    reason: ready
      ? "Es gibt verwertbaren Arbeitsblatt-Input."
      : "Es fehlt noch ein verwertbarer Arbeitsblatt-Auftrag.",
    evidence: {
      fileCount: files.length,
      hasTransferCard,
      userMessageCount: userMessages.length,
      meaningfulUserMessageCount: meaningfulMessages.length
    }
  };
}

function missingInputAssistantMessage() {
  return [
    "Ich brauche noch den eigentlichen Arbeitsblatt-Auftrag, bevor ich ein Konzept vorschlage.",
    "Schreib mir kurz: Thema, Zielgruppe/Klasse und was die Lernenden auf dem Blatt tun sollen. Optional: gewünschte Bildart oder Material."
  ].join(" ");
}

module.exports = {
  inputReadiness,
  isMeaningfulTeacherMessage,
  missingInputAssistantMessage
};
