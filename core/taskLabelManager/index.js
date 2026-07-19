"use strict";

const TASK_GROUP_LABEL_RE = /^\s*((?:(?:Stufe|Station|Teil|Block|Gruppe|Abschnitt|Niveau|Level|Phase)\s+[A-Z0-9][^\r\n:]{0,40})|(?:leicht|mittel|schwer))\s*(?::|\r?\n|[-–—]\s*\r?\n)\s*([\s\S]+)$/i;
const TASK_NUMBER_LABEL_RE = /^\s*(?:(?:aufgabe|task|exercise)\s*(\d+)|(\d+)\s*(?:[.):-]\s*)?(?:aufgabe|task|exercise))\s*(?:[.):-]\s*)?$/i;
const STATION_GROUP_RE = /^station\s+[a-z0-9]+\b/i;
const MATCHING_SECOND_HEADING_RE = /^\s*(Bedeutungen|Bedeutung|Erklaerungen|Erklärungen|Meaning|Meanings|Definitions?)\s*:\s*/i;
const MATCHING_PAIR_SEPARATOR_RE = /\s*(?:->|→|–|-|:)\s*/;

function stringOrNull(value) {
  const text = String(value || "").trim();
  return text || null;
}

function normalizeLabel(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/ß/g, "ss")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[-–—:()[\].,;]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function stripLeadingPageMarker(value) {
  const text = String(value || "").trim();
  if (/^(?:page|sheet|seite|blatt)\s*[1-4]\s*$/i.test(text)) {
    return "";
  }
  return text.replace(/^\s*(?:page|sheet|seite|blatt)\s*[1-4]\s*[:\-–—]\s*/i, "").trim();
}

function normalizeGroupLabel(value) {
  const text = stripLeadingPageMarker(value);
  const key = normalizeLabel(text);
  if (!text || TASK_NUMBER_LABEL_RE.test(text) || /^(?:aufgaben|aufgabe|tasks?|exercises?|aufgabenseite|aufgabenblatt|task page|tasks page|worksheet page)$/.test(key)) {
    return "";
  }
  return text;
}

function taskNumberFromLabel(value) {
  const match = String(value || "").trim().match(TASK_NUMBER_LABEL_RE);
  const number = Number(match?.[1] || match?.[2] || 0);
  return Number.isInteger(number) && number > 0 ? number : null;
}

function leadingTaskNumber(value) {
  const text = String(value || "").trim();
  const named = text.match(/^\s*(?:aufgabe|task|exercise)\s*[a-z]?\s*(\d+)\b/i);
  const numbered = text.match(/^\s*(\d+)\s*(?:[.):-]\s*|\s+(?=(?:aufgabe|task|exercise)\b))/i);
  const number = Number(named?.[1] || numbered?.[1] || 0);
  return Number.isInteger(number) && number > 0 ? number : null;
}

function sameLabel(left, right) {
  return normalizeLabel(left) === normalizeLabel(right);
}

function stripLeadingTaskNumbering(value) {
  let text = String(value || "").trim();
  for (let pass = 0; pass < 4; pass += 1) {
    const previous = text;
    text = text
      .replace(/^\s*(?:aufgabe|task|exercise)\s*[a-z]?\s*\d+\s*(?:[-–—:.)]\s*)?/i, "")
      .replace(/^\s*(?:[a-z]\s*)?\d+\s*(?:[-–—:.)]\s*)/i, "")
      .replace(/^\s*[a-z]\d+\s*(?:[-–—:.)]\s*)/i, "");
    if (text === previous) {
      break;
    }
  }
  return text.trim() || String(value || "").trim();
}

function splitLeadingTaskGroupLabel(value) {
  const text = String(value || "").trim();
  const match = text.match(TASK_GROUP_LABEL_RE);
  if (!match) {
    return { groupLabel: "", text };
  }
  const groupLabel = String(match[1] || "").trim();
  const rest = String(match[2] || "").trim();
  return groupLabel && rest
    ? { groupLabel, text: rest }
    : { groupLabel: "", text };
}

function stripRepeatedTaskGroupLabel(value, groupLabel) {
  const text = String(value || "").trim();
  const label = String(groupLabel || "").trim();
  if (!text || !label) {
    return text;
  }
  const split = splitLeadingTaskGroupLabel(text);
  if (split.groupLabel && sameLabel(split.groupLabel, label)) {
    return split.text;
  }
  return text;
}

function normalizeInlineListHeadings(value) {
  const text = String(value || "").trim();
  const hasListStructure = /\n\s*(?:[-*•]\s+|\d+[.)]\s+|[A-Z]\)\s+)\S/.test(text)
    || /:\s*\n\s*\S/.test(text);
  if (!hasListStructure) {
    return text;
  }
  return text.replace(
    /([^\n])\s+((?:Bedeutungen|Bedeutung|Erklaerungen|Erklärungen|Meaning|Meanings|Definitions?)\s*:)/g,
    "$1\n$2"
  );
}

function textTokens(value) {
  return normalizeLabel(value)
    .split(" ")
    .filter((token) => token.length > 3);
}

function relevantOverlap(left, right) {
  const leftTokens = textTokens(left);
  const rightTokens = new Set(textTokens(right));
  if (!leftTokens.length || !rightTokens.size) {
    return 0;
  }
  const matches = leftTokens.filter((token) => rightTokens.has(token)).length;
  return matches / leftTokens.length;
}

function parseExpectedPairs(value) {
  return String(value || "")
    .split(";")
    .map((part) => {
      const pieces = part.split(MATCHING_PAIR_SEPARATOR_RE);
      if (pieces.length < 2) {
        return null;
      }
      return {
        left: String(pieces[0] || "").trim(),
        right: pieces.slice(1).join(" - ").trim()
      };
    })
    .filter((pair) => pair?.left && pair?.right);
}

function nonEmptyLines(value) {
  return String(value || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function rotateLines(lines = []) {
  return lines.length > 1 ? [...lines.slice(1), lines[0]] : lines;
}

function matchingListParts(prompt) {
  const text = normalizeInlineListHeadings(prompt);
  const lines = text.split(/\r?\n/);
  const secondHeadingIndex = lines.findIndex((line) => MATCHING_SECOND_HEADING_RE.test(line));
  if (secondHeadingIndex < 1) {
    return null;
  }
  const beforeSecond = lines.slice(0, secondHeadingIndex).join("\n");
  const secondHeading = lines[secondHeadingIndex].replace(MATCHING_SECOND_HEADING_RE, "$1:").trim();
  const rightLines = nonEmptyLines(lines.slice(secondHeadingIndex + 1).join("\n"));
  const firstHeadingEnd = beforeSecond.lastIndexOf(":");
  if (firstHeadingEnd < 0) {
    return null;
  }
  const beforeHeading = beforeSecond.slice(0, firstHeadingEnd + 1).trimEnd();
  const leftLines = nonEmptyLines(beforeSecond.slice(firstHeadingEnd + 1));
  if (!beforeHeading || leftLines.length < 2 || rightLines.length < 2) {
    return null;
  }
  return {
    beforeHeading,
    leftLines,
    secondHeading,
    rightLines
  };
}

function linesMatchExpectedOrder(lines, expectedItems, threshold = 0.55) {
  if (lines.length !== expectedItems.length) {
    return false;
  }
  return lines.every((line, index) => {
    const lineKey = normalizeLabel(line);
    const expectedKey = normalizeLabel(expectedItems[index]);
    return lineKey === expectedKey
      || lineKey.includes(expectedKey)
      || expectedKey.includes(lineKey)
      || relevantOverlap(expectedItems[index], line) >= threshold;
  });
}

function normalizeMatchingTaskPrompt(prompt, expectedAnswer) {
  const pairs = parseExpectedPairs(expectedAnswer);
  if (pairs.length < 2) {
    return normalizeInlineListHeadings(prompt);
  }
  const parts = matchingListParts(prompt);
  if (!parts || parts.leftLines.length !== pairs.length || parts.rightLines.length !== pairs.length) {
    return normalizeInlineListHeadings(prompt);
  }
  const lefts = pairs.map((pair) => pair.left);
  const rights = pairs.map((pair) => pair.right);
  const leftMatches = linesMatchExpectedOrder(parts.leftLines, lefts, 0.75);
  const rightLeaksOrder = linesMatchExpectedOrder(parts.rightLines, rights, 0.45);
  if (!leftMatches || !rightLeaksOrder) {
    return normalizeInlineListHeadings(prompt);
  }
  return [
    parts.beforeHeading,
    ...parts.leftLines,
    parts.secondHeading,
    ...rotateLines(parts.rightLines)
  ].join("\n");
}

function normalizeTaskLabelFields(task = {}, index = 0, options = {}) {
  const cleanText = typeof options.cleanText === "function"
    ? options.cleanText
    : stringOrNull;
  const preprocessPrompt = typeof options.preprocessPrompt === "function"
    ? options.preprocessPrompt
    : (value) => value;
  const fallbackPrompt = options.fallbackPrompt || "Bearbeite die Aufgabe.";
  const id = stringOrNull(task.id) || `task_${index + 1}`;
  const rawPrompt = cleanText(task.prompt) || cleanText(task.text) || cleanText(task.label) || fallbackPrompt;
  const expectedAnswer = cleanText(task.expectedAnswer) || "";
  const rawGroupLabelText = cleanText(task.groupLabel) || "";
  const displayNumber = taskNumberFromLabel(rawGroupLabelText) || leadingTaskNumber(rawPrompt);
  const rawGroupLabel = normalizeGroupLabel(rawGroupLabelText);
  const source = stripLeadingPageMarker(preprocessPrompt(rawPrompt));
  const unnumbered = stripLeadingTaskNumbering(source);
  const split = splitLeadingTaskGroupLabel(unnumbered);
  const groupLabel = normalizeGroupLabel(rawGroupLabel || split.groupLabel || "");
  let prompt = split.groupLabel ? split.text : unnumbered;
  prompt = stripRepeatedTaskGroupLabel(prompt, groupLabel);
  prompt = stripLeadingTaskNumbering(prompt);
  prompt = normalizeMatchingTaskPrompt(prompt, expectedAnswer);
  return {
    id,
    groupLabel,
    prompt: prompt || rawPrompt,
    ...(displayNumber ? { displayNumber } : {})
  };
}

function visibleTaskEntries(tasks = [], options = {}) {
  const canonicalNumbers = new Map(
    (Array.isArray(options.allTasks) ? options.allTasks : [])
      .map((task, index) => [stringOrNull(task?.id), index + 1])
      .filter(([id]) => id)
  );
  return (Array.isArray(tasks) ? tasks : [])
    .map((task, index) => {
      const normalized = normalizeTaskLabelFields(task, index, {
        cleanText: stringOrNull,
        preprocessPrompt: options.preprocessPrompt,
        fallbackPrompt: task.id || `task_${index + 1}`
      });
      return {
        task,
        groupLabel: normalized.groupLabel,
        text: normalized.prompt,
        displayNumber: canonicalNumbers.get(normalized.id) || normalized.displayNumber || null
      };
    })
    .filter((entry) => entry.text);
}

function stationGroupWithSingleTask(entry, groupEntries = []) {
  return STATION_GROUP_RE.test(entry.groupLabel || "") && groupEntries.length === 1;
}

function singleGroupTaskLine(entry, taskNumber, options = {}) {
  const label = String(entry.groupLabel || "").trim();
  const text = String(entry.text || "").trim();
  if (!label) {
    return `${taskNumber}. ${text}`;
  }
  if (stationGroupWithSingleTask(entry, [entry])) {
    return `${label}: ${text}`;
  }
  if (options.numberSingleGroup === false) {
    return `${label}: ${text}`;
  }
  return `${taskNumber}. ${label}: ${text}`;
}

function consecutiveTaskGroups(entries = []) {
  const groups = [];
  let index = 0;
  while (index < entries.length) {
    const entry = entries[index];
    if (!entry.groupLabel) {
      groups.push({
        groupLabel: "",
        entries: [entry]
      });
      index += 1;
      continue;
    }
    const groupEntries = [];
    while (index < entries.length && entries[index].groupLabel === entry.groupLabel) {
      groupEntries.push(entries[index]);
      index += 1;
    }
    groups.push({
      groupLabel: entry.groupLabel,
      entries: groupEntries
    });
  }
  return groups;
}

function allGroupsAreSingleNumberedCategories(groups = []) {
  return groups.length > 0 && groups.every((group) => {
    const entry = group.entries?.[0] || {};
    return group.groupLabel
      && group.entries.length === 1
      && !stationGroupWithSingleTask(entry, group.entries);
  });
}

function visibleTaskLines(entries = []) {
  if (!entries.some((entry) => entry.groupLabel)) {
    return entries.map((entry, index) => `${entry.displayNumber || index + 1}. ${entry.text}`);
  }
  const groups = consecutiveTaskGroups(entries);
  const numberSingleGroups = allGroupsAreSingleNumberedCategories(groups);
  const lines = [];
  let taskNumber = 1;
  for (const group of groups) {
    const entry = group.entries[0];
    if (!group.groupLabel) {
      lines.push(`${taskNumber}. ${entry.text}`);
      taskNumber += 1;
      continue;
    }
    const groupEntries = group.entries;
    if (groupEntries.length === 1) {
      lines.push(singleGroupTaskLine(groupEntries[0], taskNumber, {
        numberSingleGroup: numberSingleGroups
      }));
      if (numberSingleGroups) {
        taskNumber += 1;
      }
      continue;
    }
    lines.push(group.groupLabel);
    groupEntries.forEach((groupEntry, groupIndex) => {
      lines.push(`${groupIndex + 1}. ${groupEntry.text}`);
    });
  }
  return lines;
}

module.exports = {
  normalizeInlineListHeadings,
  normalizeMatchingTaskPrompt,
  normalizeTaskLabelFields,
  sameLabel,
  splitLeadingTaskGroupLabel,
  stripLeadingTaskNumbering,
  stripRepeatedTaskGroupLabel,
  visibleTaskEntries,
  visibleTaskLines
};
