"use strict";

const EXPECTED_ANSWER_CHAR_LIMIT = 220;
const SOLUTION_NOTE_CHAR_LIMIT = 260;
const MAX_SOLUTION_NOTES = 12;

function stringOrNull(value) {
  const text = String(value || "").trim().replace(/\s+/g, " ");
  return text || null;
}

function truncateAtWord(value, maxChars) {
  const text = stringOrNull(value);
  if (!text || text.length <= maxChars) {
    return text || "";
  }
  const limit = Math.max(1, maxChars - 4);
  const clipped = text.slice(0, limit).replace(/\s+\S*$/, "").trim();
  return `${clipped || text.slice(0, limit).trim()} ...`;
}

function normalizeSolutionAnchor(value, maxChars, options = {}) {
  const cleaned = typeof options.cleanText === "function"
    ? options.cleanText(value)
    : value;
  return truncateAtWord(cleaned, maxChars);
}

function normalizeExpectedAnswer(value, options = {}) {
  return normalizeSolutionAnchor(value, options.maxChars || EXPECTED_ANSWER_CHAR_LIMIT, options);
}

function normalizeSolutionNotes(values, options = {}) {
  const maxItems = Number(options.maxItems || 0) > 0 ? Number(options.maxItems) : MAX_SOLUTION_NOTES;
  const maxChars = Number(options.maxChars || 0) > 0 ? Number(options.maxChars) : SOLUTION_NOTE_CHAR_LIMIT;
  return (Array.isArray(values) ? values : [])
    .map((value) => normalizeSolutionAnchor(value, maxChars, options))
    .filter(Boolean)
    .slice(0, maxItems);
}

function normalizeContentSolutionAnchors(content = {}, options = {}) {
  const tasks = (Array.isArray(content.tasks) ? content.tasks : []).map((task) => ({
    ...task,
    expectedAnswer: normalizeExpectedAnswer(task.expectedAnswer, options)
  }));
  return {
    ...content,
    tasks,
    solutionNotes: normalizeSolutionNotes(content.solutionNotes, options)
  };
}

module.exports = {
  EXPECTED_ANSWER_CHAR_LIMIT,
  SOLUTION_NOTE_CHAR_LIMIT,
  MAX_SOLUTION_NOTES,
  normalizeContentSolutionAnchors,
  normalizeExpectedAnswer,
  normalizeSolutionNotes
};
