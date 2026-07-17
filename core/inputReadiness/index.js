"use strict";

const { EVENT_TYPES } = require("../contracts");

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
  return Boolean(message);
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
    "Sag mir kurz, was für ein Blatt entstehen soll, oder hänge Material dazu an.",
    "Du kannst frei anfangen; offene Details können wir im Chat klären oder im ersten Konzept als Annahmen sichtbar machen."
  ].join(" ");
}

module.exports = {
  inputReadiness,
  isMeaningfulTeacherMessage,
  missingInputAssistantMessage
};
