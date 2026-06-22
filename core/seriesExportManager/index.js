"use strict";

const fs = require("node:fs/promises");
const path = require("node:path");
const {
  ARTIFACT_STATUSES,
  ARTIFACT_TYPES,
  EVENT_TYPES,
  PROJECT_TYPES,
  PRODUCTION_SCHEMA_VERSION
} = require("../contracts");
const { registerArtifact } = require("../artifactManager");
const { appendEvent } = require("../eventLog");
const { appendHistoryEvent } = require("../historyManager");
const { projectTypeFromManifest } = require("../legacy");

async function pathExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, "utf8"));
}

async function readJsonIfExists(filePath) {
  if (!(await pathExists(filePath))) {
    return null;
  }
  return readJson(filePath);
}

async function writeJson(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
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

function toPosix(value) {
  return String(value).split(path.sep).join("/");
}

async function nextSeriesExportId(seriesDir) {
  const exportDirs = await listDirs(path.join(seriesDir, "export"));
  const numbers = exportDirs
    .map((dir) => Number(path.basename(dir).match(/^export_series_(\d+)$/)?.[1] || 0))
    .filter(Boolean);
  return `export_series_${String(Math.max(0, ...numbers) + 1).padStart(3, "0")}`;
}

async function latestWorksheetExport(worksheetDir) {
  const exportDirs = await listDirs(path.join(worksheetDir, "export"));
  for (const exportDir of exportDirs.reverse()) {
    const manifest = await readJsonIfExists(path.join(exportDir, "export-manifest.json"));
    if (manifest) {
      return {
        exportDir,
        manifest
      };
    }
  }
  return null;
}

async function copyWorksheetExportPages({ worksheetDir, worksheetEntry, worksheetExport, targetDir }) {
  const pages = [];
  for (const page of worksheetExport?.manifest?.pages || []) {
    const sourceRelative = page.exportPath || page.sourcePath;
    if (!sourceRelative) {
      continue;
    }
    const sourcePath = path.join(worksheetDir, sourceRelative.replace(/^export\//, "export/"));
    if (!(await pathExists(sourcePath))) {
      continue;
    }

    const targetRelative = path.join(
      "worksheets",
      `${String(Number(worksheetEntry.position) || 0).padStart(2, "0")}_${worksheetEntry.projectId}`,
      path.basename(sourcePath)
    );
    await fs.mkdir(path.join(targetDir, path.dirname(targetRelative)), { recursive: true });
    await fs.copyFile(sourcePath, path.join(targetDir, targetRelative));
    pages.push({
      page: page.page,
      role: page.role,
      sourcePath: toPosix(path.relative(targetDir, sourcePath)),
      exportPath: toPosix(targetRelative)
    });
  }
  return pages;
}

async function prepareSeriesExport(seriesDir, options = {}) {
  const now = options.now || new Date().toISOString();
  const seriesProject = await readJson(path.join(seriesDir, "project-manifest.json"));
  if (projectTypeFromManifest(seriesProject) !== PROJECT_TYPES.SERIES) {
    throw new Error("Project is not a series.");
  }

  const seriesManifest = await readJson(path.join(seriesDir, "series-manifest.json"));
  const worksheets = (seriesManifest.worksheets || [])
    .filter((worksheet) => worksheet.includedInSeriesExport !== false);
  if (worksheets.length === 0) {
    throw new Error("Series has no worksheets included in export.");
  }

  const exportId = options.exportId || await nextSeriesExportId(seriesDir);
  const exportDir = path.join(seriesDir, "export", exportId);
  const worksheetEntries = [];

  for (const worksheet of worksheets) {
    const worksheetDir = path.resolve(seriesDir, worksheet.path || "");
    const worksheetManifest = await readJsonIfExists(path.join(worksheetDir, "project-manifest.json"));
    const worksheetExport = worksheetManifest ? await latestWorksheetExport(worksheetDir) : null;
    const pages = worksheetExport
      ? await copyWorksheetExportPages({
        worksheetDir,
        worksheetEntry: worksheet,
        worksheetExport,
        targetDir: exportDir
      })
      : [];

    worksheetEntries.push({
      projectId: worksheet.projectId,
      title: worksheet.title,
      position: worksheet.position,
      status: worksheetManifest ? pages.length > 0 ? "included" : "missing_pages" : "missing_project",
      sourceProjectPath: worksheet.path,
      sourceExportId: worksheetExport?.manifest?.exportId || null,
      pages
    });
  }

  const exportManifest = {
    schemaVersion: PRODUCTION_SCHEMA_VERSION,
    exportId,
    seriesId: seriesManifest.seriesId || seriesProject.projectId,
    status: "ready_for_bundle_render",
    createdAt: now,
    worksheets: worksheetEntries,
    pdf: null,
    note: "PDF rendering is intentionally separate from Phase 3 series export preparation."
  };

  await writeJson(path.join(exportDir, "series-export-manifest.json"), exportManifest);
  await writeJson(path.join(exportDir, "bundle-manifest.json"), {
    schemaVersion: PRODUCTION_SCHEMA_VERSION,
    exportId,
    seriesId: exportManifest.seriesId,
    worksheets: worksheetEntries,
    pdf: null,
    createdAt: now
  });

  await registerArtifact(seriesDir, {
    id: exportId,
    type: ARTIFACT_TYPES.EXPORT,
    path: `export/${exportId}/series-export-manifest.json`,
    status: ARTIFACT_STATUSES.EXPORTED,
    step: "export",
    createdAt: now,
    createdFrom: worksheets.map((worksheet) => worksheet.projectId)
  }, { now });

  seriesProject.status = "exported";
  seriesProject.updatedAt = now;
  await writeJson(path.join(seriesDir, "project-manifest.json"), seriesProject);

  await appendEvent(seriesDir, {
    type: EVENT_TYPES.EXPORT_CREATED,
    createdAt: now,
    step: "export",
    artifactId: exportId,
    payload: {
      exportId,
      worksheetCount: worksheetEntries.length,
      includedPageCount: worksheetEntries.reduce((sum, worksheet) => sum + worksheet.pages.length, 0)
    }
  });
  await appendHistoryEvent(seriesDir, {
    type: "series_export_prepared",
    createdAt: now,
    exportId,
    worksheetCount: worksheetEntries.length
  });

  return exportManifest;
}

module.exports = {
  prepareSeriesExport
};
