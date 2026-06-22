"use strict";

const fs = require("node:fs/promises");
const path = require("node:path");
const {
  EVENT_TYPES,
  PROJECT_TYPES,
  PRODUCTION_SCHEMA_VERSION
} = require("../contracts");
const { appendEvent } = require("../eventLog");
const { appendHistoryEvent } = require("../historyManager");
const { projectTypeFromManifest } = require("../legacy");

async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, "utf8"));
}

async function writeJson(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function toPosix(value) {
  return String(value).split(path.sep).join("/");
}

function relativePath(fromDir, toDir) {
  return toPosix(path.relative(fromDir, toDir));
}

function nextPosition(worksheets) {
  const positions = worksheets.map((worksheet) => Number(worksheet.position) || 0);
  return Math.max(0, ...positions) + 1;
}

function sortWorksheets(worksheets) {
  return worksheets.sort((left, right) => {
    const leftPosition = Number(left.position) || 0;
    const rightPosition = Number(right.position) || 0;
    return leftPosition - rightPosition || String(left.title || "").localeCompare(String(right.title || ""));
  });
}

function assertSeriesManifest(manifest) {
  if (projectTypeFromManifest(manifest) !== PROJECT_TYPES.SERIES) {
    throw new Error("Target project is not a series.");
  }
}

function assertWorksheetManifest(manifest) {
  if (projectTypeFromManifest(manifest) !== PROJECT_TYPES.SINGLE_WORKSHEET) {
    throw new Error("Worksheet project must be a single worksheet.");
  }
}

async function addWorksheetToSeries({
  seriesDir,
  worksheetDir,
  position,
  includedInSeriesExport = true,
  now = new Date().toISOString()
}) {
  const seriesProjectPath = path.join(seriesDir, "project-manifest.json");
  const seriesManifestPath = path.join(seriesDir, "series-manifest.json");
  const worksheetProjectPath = path.join(worksheetDir, "project-manifest.json");
  const seriesProject = await readJson(seriesProjectPath);
  const seriesManifest = await readJson(seriesManifestPath);
  const worksheetManifest = await readJson(worksheetProjectPath);

  assertSeriesManifest(seriesProject);
  assertWorksheetManifest(worksheetManifest);

  const worksheets = Array.isArray(seriesManifest.worksheets)
    ? [...seriesManifest.worksheets]
    : [];
  const existingIndex = worksheets.findIndex((worksheet) => worksheet.projectId === worksheetManifest.projectId);
  const nextEntry = {
    ...(existingIndex >= 0 ? worksheets[existingIndex] : {}),
    projectId: worksheetManifest.projectId,
    title: worksheetManifest.title || worksheetManifest.projectId,
    path: relativePath(seriesDir, worksheetDir),
    position: position ?? (existingIndex >= 0 ? worksheets[existingIndex].position : nextPosition(worksheets)),
    includedInSeriesExport: Boolean(includedInSeriesExport),
    addedAt: existingIndex >= 0 ? worksheets[existingIndex].addedAt : now,
    updatedAt: now
  };

  if (existingIndex >= 0) {
    worksheets[existingIndex] = nextEntry;
  } else {
    worksheets.push(nextEntry);
  }

  const nextSeriesManifest = {
    ...seriesManifest,
    schemaVersion: seriesManifest.schemaVersion || PRODUCTION_SCHEMA_VERSION,
    seriesId: seriesManifest.seriesId || seriesProject.projectId,
    worksheets: sortWorksheets(worksheets),
    updatedAt: now
  };
  const nextSeriesProject = {
    ...seriesProject,
    status: "in_progress",
    updatedAt: now
  };
  const nextWorksheetManifest = {
    ...worksheetManifest,
    seriesMembership: {
      seriesId: seriesManifest.seriesId || seriesProject.projectId,
      seriesTitle: seriesManifest.title || seriesProject.title || null,
      role: "worksheet",
      position: nextEntry.position,
      includedInSeriesExport: nextEntry.includedInSeriesExport,
      updatedAt: now
    },
    updatedAt: now
  };

  await writeJson(seriesManifestPath, nextSeriesManifest);
  await writeJson(seriesProjectPath, nextSeriesProject);
  await writeJson(worksheetProjectPath, nextWorksheetManifest);

  await appendEvent(seriesDir, {
    type: EVENT_TYPES.ARTIFACT_UPDATED,
    createdAt: now,
    step: "auftrag",
    payload: {
      action: existingIndex >= 0 ? "worksheet_membership_updated" : "worksheet_added_to_series",
      worksheetProjectId: worksheetManifest.projectId,
      position: nextEntry.position,
      includedInSeriesExport: nextEntry.includedInSeriesExport
    }
  });
  await appendHistoryEvent(seriesDir, {
    type: existingIndex >= 0 ? "worksheet_membership_updated" : "worksheet_added_to_series",
    createdAt: now,
    worksheetProjectId: worksheetManifest.projectId,
    position: nextEntry.position,
    includedInSeriesExport: nextEntry.includedInSeriesExport
  });
  await appendHistoryEvent(worksheetDir, {
    type: "series_membership_updated",
    createdAt: now,
    seriesId: nextWorksheetManifest.seriesMembership.seriesId,
    position: nextEntry.position,
    includedInSeriesExport: nextEntry.includedInSeriesExport
  });

  return nextEntry;
}

module.exports = {
  addWorksheetToSeries
};
