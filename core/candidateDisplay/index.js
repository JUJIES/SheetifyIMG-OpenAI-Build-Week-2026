"use strict";

const fs = require("node:fs/promises");
const path = require("node:path");
const { readJsonFileIfExists } = require("../jsonFile");

async function pathExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function listDirs(dirPath) {
  if (!(await pathExists(dirPath))) {
    return [];
  }
  const entries = await fs.readdir(dirPath, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(dirPath, entry.name))
    .sort();
}

function candidateKey(candidate = {}) {
  return `${candidate.runId || ""}:${candidate.id || ""}`;
}

function candidateCreatedAtValue(candidate = {}) {
  return candidate.createdAt
    || candidate.generation?.createdAt
    || candidate.pages?.[0]?.metadata?.createdAt
    || "";
}

function draftLabelFromNumber(value = 1) {
  const number = Number(value || 0) || 1;
  return `Entwurf ${String(number).padStart(2, "0")}`;
}

function draftNumberFromValue(value = "") {
  const match = String(value || "").match(/candidate(?:_bundle)?_0*(\d+)/i);
  return match ? Number(match[1]) : null;
}

function draftDisplayLabel(candidate = {}, fallbackNumber = 1) {
  const existing = String(candidate.displayLabel || "").trim();
  if (/^Entwurf\s+\d+/i.test(existing)) {
    return existing;
  }
  const number = Number(candidate.displayNumber || 0)
    || draftNumberFromValue(candidate.id)
    || draftNumberFromValue(candidate.rawCandidateId)
    || draftNumberFromValue(existing)
    || fallbackNumber;
  return draftLabelFromNumber(number);
}

function candidateDisplaySortEntries(candidates = []) {
  return candidates
    .map((candidate, index) => ({ candidate, index }))
    .sort((left, right) => {
      return String(candidateCreatedAtValue(left.candidate)).localeCompare(String(candidateCreatedAtValue(right.candidate)))
        || String(left.candidate.runId || "").localeCompare(String(right.candidate.runId || ""))
        || String(left.candidate.id || "").localeCompare(String(right.candidate.id || ""))
        || left.index - right.index;
    });
}

function annotateCandidateDisplayList(candidates = []) {
  if (!Array.isArray(candidates) || !candidates.length) {
    return [];
  }
  const displayNumbersByInputIndex = new Map();
  candidateDisplaySortEntries(candidates)
    .forEach((entry, sortedIndex) => {
      displayNumbersByInputIndex.set(entry.index, sortedIndex + 1);
    });
  return candidates.map((candidate, index) => {
    const displayNumber = displayNumbersByInputIndex.get(index) || index + 1;
    return {
      ...candidate,
      displayNumber,
      displayLabel: draftLabelFromNumber(displayNumber),
      rawCandidateId: candidate.rawCandidateId || candidate.id || null
    };
  });
}

function candidateDisplayLabelMap(candidates = []) {
  return Object.fromEntries(
    annotateCandidateDisplayList(candidates)
      .filter((candidate) => candidate.runId && candidate.id && candidate.displayLabel)
      .map((candidate) => [candidateKey(candidate), candidate.displayLabel])
  );
}

async function listProjectCandidates(projectDir) {
  const runDirs = await listDirs(path.join(projectDir, "runs"));
  const candidates = [];
  for (const runDir of runDirs) {
    const manifest = await readJsonFileIfExists(path.join(runDir, "run-manifest.json"));
    const runId = manifest?.runId || path.basename(runDir);
    for (const candidate of manifest?.candidates || []) {
      candidates.push({
        ...candidate,
        runId
      });
    }
  }
  return candidates;
}

async function candidateDisplayLabelForProject(projectDir, runId, candidateId) {
  const candidates = await listProjectCandidates(projectDir);
  const labels = candidateDisplayLabelMap(candidates);
  return labels[`${runId || ""}:${candidateId || ""}`] || draftDisplayLabel({ id: candidateId });
}

module.exports = {
  annotateCandidateDisplayList,
  candidateDisplayLabelForProject,
  candidateDisplayLabelMap,
  candidateKey,
  draftDisplayLabel,
  draftLabelFromNumber,
  listProjectCandidates
};
