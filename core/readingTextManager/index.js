"use strict";

const READING_TEXT_ROLES = new Set([
  "reading_text",
  "info_box",
  "source_text",
  "work_instruction"
]);

const GENERIC_READING_TITLE_RE = /^(?:material(?:\s*\d+)?|materialseite|materialteil|materialtext|lesetext|leseseite|kurzinfo|infotext|sachtext|quelle|text|info|aufgabenblatt)$/i;
const PREFIXED_READING_TITLE_RE = /^(?:material|materialtext|lesetext|kurzinfo|infotext|sachtext|quelle|text|info)\s*[:\-–—]\s*(.{2,90})$/i;
const NON_TITLE_INLINE_HEADING_RE = /^(?:aufgabe|task|exercise|beispiel|example|hinweis|note|frage|question|nominativ|genitiv|dativ|akkusativ|station|stufe)\b/i;

function stringOrNull(value) {
  const text = String(value || "").trim();
  return text || null;
}

function normalizeText(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/ß/g, "ss")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "");
}

function stripLeadingPageMarker(value) {
  const text = String(value || "").trim();
  if (/^(?:page|sheet|seite|blatt)\s*[1-4]\s*$/i.test(text)) {
    return "";
  }
  return text.replace(/^\s*(?:page|sheet|seite|blatt)\s*[1-4]\s*[:\-–—]\s*/i, "").trim();
}

function isGenericReadingTitle(value) {
  return GENERIC_READING_TITLE_RE.test(String(value || "").trim());
}

function prefixedReadingTitle(value) {
  const match = String(value || "").trim().match(PREFIXED_READING_TITLE_RE);
  return match ? stringOrNull(match[1]) : null;
}

function normalizeReadingTextRole(value, fallbackText = "") {
  const text = normalizeText(`${value || ""}\n${fallbackText || ""}`);
  if (/\b(work_instruction|arbeitsauftrag|auftrag|bearbeitungshinweis|hinweis|instructions?)\b/.test(text)) {
    return "work_instruction";
  }
  if (/\b(info_box|infobox|kurzinfo|infotext|info)\b/.test(text)) {
    return "info_box";
  }
  if (/\b(source_text|quelle|quellentext|source|material)\b/.test(text)) {
    return "source_text";
  }
  return "reading_text";
}

function splitInlineReadingHeading(value) {
  const text = String(value || "").trim();
  const match = text.match(/^([A-ZÄÖÜ][^:\r\n]{2,55})\s*:\s+([\s\S]+)$/);
  if (!match) {
    return null;
  }
  const title = stringOrNull(match[1]);
  const body = stringOrNull(match[2]);
  if (!title || !body || /[.!?]/.test(title) || NON_TITLE_INLINE_HEADING_RE.test(title)) {
    return null;
  }
  const normalizedBody = normalizeText(body);
  const looksLikeProse = /^(im|in|am|an|auf|bei|waehrend|wahrend|seit|vor|nach|die|der|das|ein|eine|wales?|wale|pflanzen|kaufleute|many|the|during|students|teenagers|pupils)\b/.test(normalizedBody)
    || (body.split(/\s+/).length >= 8 && /[.!?]/.test(body.slice(0, 180)));
  return looksLikeProse ? { title, body } : null;
}

function sameText(left, right) {
  return normalizeText(left) === normalizeText(right);
}

function normalizeReadingText(entry = {}, index = 0, options = {}) {
  const cleanText = typeof options.cleanText === "function"
    ? options.cleanText
    : stringOrNull;
  const id = stringOrNull(entry.id) || `text_${index + 1}`;
  const rawTitle = cleanText(entry.title) || "";
  let title = stripLeadingPageMarker(rawTitle);
  let body = stripLeadingPageMarker(cleanText(entry.body) || cleanText(entry.text) || "");
  const prefixedTitle = prefixedReadingTitle(title);
  if (prefixedTitle) {
    title = prefixedTitle;
  }
  if (isGenericReadingTitle(title)) {
    title = "";
  }
  const inlineHeading = splitInlineReadingHeading(body);
  if (inlineHeading && (!title || sameText(inlineHeading.title, title))) {
    title = title || inlineHeading.title;
    body = inlineHeading.body;
  }
  const role = READING_TEXT_ROLES.has(String(entry.role || "").trim())
    ? String(entry.role).trim()
    : normalizeReadingTextRole(entry.role, `${rawTitle}\n${body}`);
  return {
    id,
    role,
    title: stringOrNull(title) || "",
    body
  };
}

function normalizeReadingTexts(entries = [], options = {}) {
  return (Array.isArray(entries) ? entries : [])
    .map((entry, index) => normalizeReadingText(entry, index, options))
    .filter((entry) => entry.body);
}

module.exports = {
  isGenericReadingTitle,
  normalizeReadingText,
  normalizeReadingTexts,
  normalizeReadingTextRole,
  splitInlineReadingHeading
};
