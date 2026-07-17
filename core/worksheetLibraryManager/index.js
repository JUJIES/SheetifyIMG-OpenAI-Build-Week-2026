"use strict";

const fs = require("node:fs/promises");
const path = require("node:path");
const { DEFAULT_PRINT_SAFE_MARGIN_MM, renderImagesToPdf } = require("../pdfRenderer");
const { openProject } = require("../projectManager");
const { readJsonFile, readJsonFileIfExists, writeJsonFile } = require("../jsonFile");
const { runCandidateTechnicalQc } = require("../imageQcManager");
const { updateRunAnalysisReport } = require("../runAnalysisManager");

const DEFAULT_REPO_ROOT = path.resolve(__dirname, "..", "..");
const DEFAULT_PROJECTS_DIR = path.join(DEFAULT_REPO_ROOT, "projects");
const DEFAULT_WORKSHEETS_DIR = path.join(DEFAULT_REPO_ROOT, "worksheets");
const WORKSHEET_LIBRARY_STATE_FILE = "worksheet-library-state.json";
const WORKSHEET_LIBRARY_SCHEMA_VERSION = 1;
const WORKSHEETS_ROOT_ID = "folder:worksheets";
const ROOT_FOLDERS = Object.freeze([
  { id: WORKSHEETS_ROOT_ID, label: "Arbeitsblätter" }
]);

async function pathExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function readJson(filePath) {
  return readJsonFile(filePath);
}

async function readJsonIfExists(filePath) {
  return readJsonFileIfExists(filePath);
}

async function writeJson(filePath, value) {
  await writeJsonFile(filePath, value);
}

async function listDirs(dirPath) {
  if (!(await pathExists(dirPath))) {
    return [];
  }
  const entries = await fs.readdir(dirPath, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right));
}

function toPosix(value) {
  return String(value || "").split(path.sep).join("/");
}

function assetUrl(repoRoot, filePath) {
  const reference = Buffer.from(toPosix(path.relative(repoRoot, filePath)), "utf8").toString("base64url");
  return `/api/files/${reference}`;
}

function safeFileName(value) {
  return String(value || "arbeitsblatt")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/ß/g, "ss")
    .replace(/[^a-zA-Z0-9._ -]+/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 96)
    || "arbeitsblatt";
}

function slugify(value) {
  return String(value || "arbeitsblatt")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/ß/g, "ss")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80)
    || "arbeitsblatt";
}

function worksheetStatePath(worksheetsDir) {
  return path.join(worksheetsDir, WORKSHEET_LIBRARY_STATE_FILE);
}

function worksheetItemsDir(worksheetsDir) {
  return path.join(worksheetsDir, "items");
}

function worksheetDirFor(worksheetsDir, worksheetId) {
  return path.join(worksheetItemsDir(worksheetsDir), worksheetId);
}

function worksheetManifestPath(worksheetsDir, worksheetId) {
  return path.join(worksheetDirFor(worksheetsDir, worksheetId), "worksheet-manifest.json");
}

function createEmptyWorksheetState(now = new Date().toISOString()) {
  return {
    schemaVersion: WORKSHEET_LIBRARY_SCHEMA_VERSION,
    updatedAt: now,
    rootChildren: Object.fromEntries(ROOT_FOLDERS.map((folder) => [folder.id, []])),
    folderColors: {},
    folders: {}
  };
}

function normalizeFolderColor(value) {
  const color = String(value || "").trim();
  if (!color) {
    return null;
  }
  if (!/^#[0-9a-f]{6}$/i.test(color)) {
    throw new Error("Ordnerfarbe ist ungültig.");
  }
  return color.toLowerCase();
}

async function readWorksheetState(options = {}) {
  const worksheetsDir = options.worksheetsDir || DEFAULT_WORKSHEETS_DIR;
  const existing = await readJsonIfExists(worksheetStatePath(worksheetsDir));
  const state = {
    ...createEmptyWorksheetState(),
    ...(existing || {})
  };
  state.rootChildren = {
    ...createEmptyWorksheetState().rootChildren,
    ...(state.rootChildren || {})
  };
  state.rootChildren[WORKSHEETS_ROOT_ID] = Array.isArray(state.rootChildren[WORKSHEETS_ROOT_ID])
    ? state.rootChildren[WORKSHEETS_ROOT_ID]
    : [];
  state.folderColors = state.folderColors && typeof state.folderColors === "object" ? state.folderColors : {};
  state.folders = state.folders && typeof state.folders === "object" ? state.folders : {};
  return state;
}

async function writeWorksheetState(state, options = {}) {
  const worksheetsDir = options.worksheetsDir || DEFAULT_WORKSHEETS_DIR;
  const nextState = {
    ...state,
    schemaVersion: WORKSHEET_LIBRARY_SCHEMA_VERSION,
    updatedAt: options.now || new Date().toISOString()
  };
  await writeJson(worksheetStatePath(worksheetsDir), nextState);
  return nextState;
}

function emptyFolder(id, label) {
  return {
    id,
    type: "folder",
    label,
    locked: true,
    draggable: false,
    canRename: false,
    canDelete: false,
    children: []
  };
}

function customFolderToTreeFolder(folder) {
  return {
    id: folder.id,
    type: "folder",
    label: folder.label,
    color: folder.color || null,
    locked: false,
    draggable: true,
    canRename: true,
    canDelete: true,
    children: []
  };
}

function folderRecord(state, folderId) {
  if (ROOT_FOLDERS.some((folder) => folder.id === folderId)) {
    return {
      id: folderId,
      children: state.rootChildren[folderId] || []
    };
  }
  return state.folders[folderId] || null;
}

function findParentFolderId(state, itemId) {
  for (const [rootId, children] of Object.entries(state.rootChildren || {})) {
    if ((children || []).includes(itemId)) {
      return rootId;
    }
  }
  for (const folder of Object.values(state.folders || {})) {
    if ((folder.children || []).includes(itemId)) {
      return folder.id;
    }
  }
  return null;
}

function removeItemFromWorksheetState(state, itemId) {
  for (const rootId of Object.keys(state.rootChildren || {})) {
    state.rootChildren[rootId] = (state.rootChildren[rootId] || []).filter((id) => id !== itemId);
  }
  for (const folder of Object.values(state.folders || {})) {
    folder.children = (folder.children || []).filter((id) => id !== itemId);
  }
}

function isDescendantFolder(state, possibleDescendantId, folderId) {
  const folder = state.folders[folderId];
  if (!folder) {
    return false;
  }
  if (folder.parentId === possibleDescendantId) {
    return true;
  }
  return isDescendantFolder(state, possibleDescendantId, folder.parentId);
}

function cleanWorksheetState(state, worksheetItemIds) {
  const knownItems = new Set(worksheetItemIds);
  const knownFolders = new Set(Object.keys(state.folders || {}));
  const rootIds = new Set(ROOT_FOLDERS.map((folder) => folder.id));

  for (const [folderId, folder] of Object.entries(state.folders || {})) {
    if (!folder?.label || !folder?.parentId || (!rootIds.has(folder.parentId) && !knownFolders.has(folder.parentId))) {
      delete state.folders[folderId];
    }
  }

  const allowedIds = () => new Set([...knownItems, ...Object.keys(state.folders || {})]);
  for (const rootId of Object.keys(state.rootChildren || {})) {
    const seen = new Set();
    state.rootChildren[rootId] = (state.rootChildren[rootId] || []).filter((itemId) => {
      if (!allowedIds().has(itemId) || seen.has(itemId)) {
        return false;
      }
      seen.add(itemId);
      return true;
    });
  }
  for (const folder of Object.values(state.folders || {})) {
    const seen = new Set();
    folder.children = (folder.children || []).filter((itemId) => {
      if (!allowedIds().has(itemId) || seen.has(itemId)) {
        return false;
      }
      seen.add(itemId);
      return true;
    });
  }
  for (const folderId of Object.keys(state.folders || {})) {
    if (!findParentFolderId(state, folderId)) {
      state.rootChildren[WORKSHEETS_ROOT_ID].push(folderId);
      state.folders[folderId].parentId = WORKSHEETS_ROOT_ID;
    }
  }
  for (const folderId of Object.keys(state.folderColors || {})) {
    if (!rootIds.has(folderId) && !state.folders?.[folderId]) {
      delete state.folderColors[folderId];
    }
  }
}

function worksheetKindForPageCount(pageCount) {
  return Number(pageCount || 0) > 1 ? "worksheet_bundle" : "worksheet";
}

function worksheetKindLabel(kind) {
  return kind === "worksheet_bundle" ? "Arbeitsblatt-Bundle" : "Arbeitsblatt";
}

function worksheetToTreeItem(manifest = {}) {
  const kind = manifest.kind || worksheetKindForPageCount(manifest.pageCount);
  return {
    id: `worksheet:${manifest.worksheetId}`,
    type: kind,
    itemType: "worksheet",
    worksheetId: manifest.worksheetId,
    label: manifest.title || manifest.worksheetId,
    kind,
    kindLabel: worksheetKindLabel(kind),
    pageCount: Number(manifest.pageCount || manifest.pages?.length || 0),
    sourceProjectId: manifest.source?.projectId || null,
    sourceProjectTitle: manifest.source?.projectTitle || null,
    unseen: !manifest.seenAt,
    draggable: true,
    createdAt: manifest.createdAt || null,
    updatedAt: manifest.updatedAt || null
  };
}

function publicWorksheet(manifest = {}, options = {}) {
  const repoRoot = options.repoRoot || DEFAULT_REPO_ROOT;
  const worksheetsDir = options.worksheetsDir || DEFAULT_WORKSHEETS_DIR;
  const itemDir = worksheetDirFor(worksheetsDir, manifest.worksheetId);
  const pdfPath = manifest.pdf?.path ? path.join(itemDir, manifest.pdf.path) : null;
  const pdfAvailable = pdfPath ? true : false;
  const pages = (manifest.pages || []).map((page) => {
    const filePath = page.path ? path.join(itemDir, page.path) : null;
    return {
      ...page,
      url: filePath ? assetUrl(repoRoot, filePath) : null,
      path: filePath ? toPosix(path.relative(repoRoot, filePath)) : page.path || null
    };
  });
  return {
    ...manifest,
    kind: manifest.kind || worksheetKindForPageCount(manifest.pageCount),
    kindLabel: worksheetKindLabel(manifest.kind || worksheetKindForPageCount(manifest.pageCount)),
    pageCount: Number(manifest.pageCount || pages.length || 0),
    pdf: manifest.pdf ? {
      ...manifest.pdf,
      url: pdfAvailable ? assetUrl(repoRoot, pdfPath) : null,
      path: pdfPath ? toPosix(path.relative(repoRoot, pdfPath)) : manifest.pdf.path || null
    } : null,
    pages
  };
}

async function listWorksheetManifests(options = {}) {
  const worksheetsDir = options.worksheetsDir || DEFAULT_WORKSHEETS_DIR;
  const manifests = [];
  for (const worksheetId of await listDirs(worksheetItemsDir(worksheetsDir))) {
    const manifest = await readJsonIfExists(worksheetManifestPath(worksheetsDir, worksheetId));
    if (manifest?.worksheetId) {
      manifests.push(manifest);
    }
  }
  return manifests.sort((left, right) => {
    return String(right.createdAt || "").localeCompare(String(left.createdAt || ""))
      || String(left.title || "").localeCompare(String(right.title || ""));
  });
}

async function listProjectWorksheets(projectId, options = {}) {
  const repoRoot = options.repoRoot || DEFAULT_REPO_ROOT;
  const worksheetsDir = options.worksheetsDir || DEFAULT_WORKSHEETS_DIR;
  const targetProjectId = String(projectId || "").trim();
  if (!targetProjectId) {
    return [];
  }
  const manifests = await listProjectWorksheetManifests(targetProjectId, { worksheetsDir });
  return manifests
    .map((manifest) => publicWorksheet(manifest, { repoRoot, worksheetsDir }));
}

async function listProjectWorksheetManifests(projectId, options = {}) {
  const worksheetsDir = options.worksheetsDir || DEFAULT_WORKSHEETS_DIR;
  const targetProjectId = String(projectId || "").trim();
  if (!targetProjectId) {
    return [];
  }
  const manifests = await listWorksheetManifests({ worksheetsDir });
  return manifests.filter((manifest) => {
    return String(manifest?.source?.projectId || "").trim() === targetProjectId;
  });
}

function appendMissingWorksheetsToState(state, worksheetItemIds) {
  for (const itemId of worksheetItemIds) {
    if (!findParentFolderId(state, itemId)) {
      state.rootChildren[WORKSHEETS_ROOT_ID].push(itemId);
    }
  }
}

function normalizeWorksheetStateForItems(state, worksheetItemIds) {
  cleanWorksheetState(state, worksheetItemIds);
  appendMissingWorksheetsToState(state, worksheetItemIds);
  return state;
}

async function readNormalizedWorksheetState(options = {}) {
  const worksheetsDir = options.worksheetsDir || DEFAULT_WORKSHEETS_DIR;
  const [state, manifests] = await Promise.all([
    readWorksheetState({ worksheetsDir }),
    listWorksheetManifests({ worksheetsDir })
  ]);
  return normalizeWorksheetStateForItems(
    state,
    manifests.map((manifest) => `worksheet:${manifest.worksheetId}`)
  );
}

function inflateTreeChildren(state, childIds, worksheetItems) {
  return childIds.map((childId) => {
    if (worksheetItems.has(childId)) {
      return worksheetItems.get(childId);
    }
    const folder = state.folders[childId];
    if (!folder) {
      return null;
    }
    const treeFolder = customFolderToTreeFolder(folder);
    treeFolder.children = inflateTreeChildren(state, folder.children || [], worksheetItems);
    return treeFolder;
  }).filter(Boolean);
}

function inflateWorksheetTree(state, worksheetItems) {
  return ROOT_FOLDERS.map((root) => {
    const folder = emptyFolder(root.id, root.label);
    folder.color = state.folderColors?.[root.id] || null;
    folder.children = inflateTreeChildren(state, state.rootChildren[root.id] || [], worksheetItems);
    return folder;
  });
}

function normalizeSearchText(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/ß/g, "ss");
}

function worksheetMatchesQuery(manifest, query) {
  const tokens = normalizeSearchText(query).split(/\s+/).filter(Boolean);
  if (!tokens.length) {
    return true;
  }
  const haystack = normalizeSearchText([
    manifest.title,
    manifest.kindLabel,
    manifest.source?.projectTitle,
    manifest.source?.projectId,
    ...(manifest.tags || [])
  ].filter(Boolean).join(" "));
  return tokens.every((token) => haystack.includes(token));
}

async function buildWorksheetTree(options = {}) {
  const repoRoot = options.repoRoot || DEFAULT_REPO_ROOT;
  const worksheetsDir = options.worksheetsDir || DEFAULT_WORKSHEETS_DIR;
  const query = String(options.query || "").trim();
  const manifests = await listWorksheetManifests({ worksheetsDir });
  const worksheetItems = new Map(manifests.map((manifest) => [
    `worksheet:${manifest.worksheetId}`,
    worksheetToTreeItem(publicWorksheet(manifest, { repoRoot, worksheetsDir }))
  ]));

  if (query) {
    const matches = manifests
      .filter((manifest) => worksheetMatchesQuery(manifest, query))
      .map((manifest) => worksheetToTreeItem(publicWorksheet(manifest, { repoRoot, worksheetsDir })));
    return {
      id: "worksheets:search",
      type: "root",
      label: "Arbeitsblatt-Suche",
      searchQuery: query,
      children: [{
        id: "folder:worksheet-search-results",
        type: "folder",
        label: "Suchtreffer",
        children: matches
      }]
    };
  }

  const state = await readWorksheetState({ worksheetsDir });
  normalizeWorksheetStateForItems(state, [...worksheetItems.keys()]);

  return {
    id: "worksheets:root",
    type: "root",
    label: "SheetifyIMG Arbeitsblätter",
    children: inflateWorksheetTree(state, worksheetItems)
  };
}

async function createWorksheetFolder(input = {}, options = {}) {
  const worksheetsDir = options.worksheetsDir || DEFAULT_WORKSHEETS_DIR;
  const state = await readNormalizedWorksheetState({ worksheetsDir });
  const parentId = input.parentId || WORKSHEETS_ROOT_ID;
  if (!folderRecord(state, parentId)) {
    throw new Error("Zielordner wurde nicht gefunden.");
  }
  const label = String(input.label || "").trim();
  if (!label) {
    throw new Error("Ordnername ist erforderlich.");
  }
  const folderId = `folder:worksheets:${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  state.folders[folderId] = {
    id: folderId,
    label,
    parentId,
    color: normalizeFolderColor(input.color),
    children: []
  };
  folderRecord(state, parentId).children.push(folderId);
  await writeWorksheetState(state, { worksheetsDir });
  return state.folders[folderId];
}

async function renameWorksheetFolder(folderId, label, options = {}) {
  return updateWorksheetFolder(folderId, { label }, options);
}

async function updateWorksheetFolder(folderId, input = {}, options = {}) {
  const worksheetsDir = options.worksheetsDir || DEFAULT_WORKSHEETS_DIR;
  const isRootFolder = ROOT_FOLDERS.some((folder) => folder.id === folderId);
  const state = await readNormalizedWorksheetState({ worksheetsDir });
  const folder = isRootFolder
    ? ROOT_FOLDERS.find((entry) => entry.id === folderId)
    : state.folders[folderId];
  if (!folder) {
    throw new Error("Ordner wurde nicht gefunden.");
  }

  if (Object.prototype.hasOwnProperty.call(input, "label")) {
    if (isRootFolder) {
      throw new Error("Dieser Hauptordner kann nicht umbenannt werden.");
    }
    const nextLabel = String(input.label || "").trim();
    if (!nextLabel) {
      throw new Error("Ordnername ist erforderlich.");
    }
    state.folders[folderId].label = nextLabel;
  }

  if (Object.prototype.hasOwnProperty.call(input, "color")) {
    const color = normalizeFolderColor(input.color);
    if (isRootFolder) {
      if (color) {
        state.folderColors[folderId] = color;
      } else {
        delete state.folderColors[folderId];
      }
    } else if (color) {
      state.folders[folderId].color = color;
    } else {
      delete state.folders[folderId].color;
    }
  }

  await writeWorksheetState(state, { worksheetsDir });
  if (isRootFolder) {
    return {
      id: folderId,
      label: folder.label,
      color: state.folderColors[folderId] || null
    };
  }
  return state.folders[folderId];
}

async function deleteWorksheetFolder(folderId, options = {}) {
  const worksheetsDir = options.worksheetsDir || DEFAULT_WORKSHEETS_DIR;
  if (ROOT_FOLDERS.some((folder) => folder.id === folderId)) {
    throw new Error("Dieser Hauptordner kann nicht geloescht werden.");
  }
  const state = await readNormalizedWorksheetState({ worksheetsDir });
  const folder = state.folders[folderId];
  if (!folder) {
    throw new Error("Ordner wurde nicht gefunden.");
  }
  const parent = folderRecord(state, folder.parentId);
  if (!parent) {
    throw new Error("Uebergeordneter Ordner wurde nicht gefunden.");
  }
  const index = parent.children.indexOf(folderId);
  if (index >= 0) {
    parent.children.splice(index, 1, ...(folder.children || []));
  }
  for (const childId of folder.children || []) {
    if (state.folders[childId]) {
      state.folders[childId].parentId = folder.parentId;
    }
  }
  delete state.folders[folderId];
  await writeWorksheetState(state, { worksheetsDir });
  return { folderId, deleted: true };
}

async function moveWorksheetItem(input = {}, options = {}) {
  const worksheetsDir = options.worksheetsDir || DEFAULT_WORKSHEETS_DIR;
  const state = await readNormalizedWorksheetState({ worksheetsDir });
  const itemId = String(input.itemId || "");
  const targetFolderId = String(input.targetFolderId || "");
  const beforeId = input.beforeId ? String(input.beforeId) : null;
  if (!itemId || !targetFolderId) {
    throw new Error("itemId and targetFolderId are required.");
  }
  if (ROOT_FOLDERS.some((folder) => folder.id === itemId)) {
    throw new Error("Hauptordner koennen nicht verschoben werden.");
  }
  const targetFolder = folderRecord(state, targetFolderId);
  if (!targetFolder) {
    throw new Error("Zielordner wurde nicht gefunden.");
  }
  if (itemId === targetFolderId || (itemId.startsWith("folder:") && isDescendantFolder(state, itemId, targetFolderId))) {
    throw new Error("Ein Ordner kann nicht in sich selbst verschoben werden.");
  }
  if (beforeId && beforeId === itemId) {
    return { moved: false };
  }
  removeItemFromWorksheetState(state, itemId);
  const insertAt = beforeId ? targetFolder.children.indexOf(beforeId) : -1;
  if (insertAt >= 0) {
    targetFolder.children.splice(insertAt, 0, itemId);
  } else {
    targetFolder.children.push(itemId);
  }
  if (state.folders[itemId]) {
    state.folders[itemId].parentId = targetFolderId;
  }
  await writeWorksheetState(state, { worksheetsDir });
  return { itemId, targetFolderId, beforeId, moved: true };
}

async function latestRunId(projectDir) {
  const runDirs = await listDirs(path.join(projectDir, "runs"));
  return runDirs.at(-1) || null;
}

function sourceFingerprint(input = {}) {
  return JSON.stringify({
    projectId: input.projectId || null,
    outputMode: input.outputMode || "bundle_pdf",
    pages: (input.pages || []).map((page) => ({
      runId: page.runId || input.runId || null,
      candidateId: page.candidateId || page.sourceCandidateId || input.candidateId || null,
      page: Number(page.page || 0)
    }))
  });
}

async function findDuplicateByFingerprint(fingerprint, options = {}) {
  if (!fingerprint) {
    return null;
  }
  const manifests = await listWorksheetManifests(options);
  return manifests.find((manifest) => manifest.sourceFingerprint === fingerprint) || null;
}

async function uniqueWorksheetId(worksheetsDir, title) {
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const base = `${slugify(title)}-${date}`;
  let candidate = base;
  let index = 2;
  while (await pathExists(worksheetDirFor(worksheetsDir, candidate))) {
    candidate = `${base}-${index}`;
    index += 1;
  }
  return candidate;
}

function titleFromContent(content = {}) {
  return content.title || content.topic || content.subject || null;
}

async function deriveWorksheetTitle({ projectDir, project, manifest, candidate, explicitTitle }) {
  const title = String(explicitTitle || "").trim();
  if (title) {
    return title;
  }
  const approvedContent = await readJsonIfExists(path.join(projectDir, "content", "approved.content-mirror.json"));
  const draftContent = await readJsonIfExists(path.join(projectDir, "content", "draft.content-mirror.json"));
  return titleFromContent(approvedContent || {})
    || titleFromContent(draftContent || {})
    || candidate?.concept?.title
    || manifest?.concept?.title
    || project?.topic
    || "Arbeitsblatt";
}

function runPageSourcePath(page = {}) {
  return page.path || page.sourcePath || "";
}

function userFacingCandidateId(candidateId = "") {
  const match = String(candidateId || "").match(/^candidate_0*(\d+)$/i);
  return match ? `Entwurf ${String(Number(match[1])).padStart(2, "0")}` : String(candidateId || "Entwurf");
}

function resolveCandidatePages({ manifest, runId, candidateId, pages }) {
  const defaultCandidate = (manifest.candidates || []).find((candidate) => candidate.id === candidateId) || null;
  if (!defaultCandidate) {
    throw new Error(`Entwurf wurde nicht gefunden: ${userFacingCandidateId(candidateId)}`);
  }
  const requested = Array.isArray(pages) && pages.length ? pages : defaultCandidate.pages || [];
  return requested.map((entry) => {
    const pageNumber = Number(typeof entry === "number" ? entry : entry.page);
    const sourceCandidateId = typeof entry === "object"
      ? entry.candidateId || entry.sourceCandidateId || candidateId
      : candidateId;
    const sourceCandidate = (manifest.candidates || []).find((candidate) => candidate.id === sourceCandidateId);
    if (!sourceCandidate) {
      throw new Error(`Entwurf wurde nicht gefunden: ${userFacingCandidateId(sourceCandidateId)}`);
    }
    const candidatePage = (sourceCandidate.pages || []).find((page) => Number(page.page) === pageNumber);
    if (!candidatePage) {
      throw new Error(`Seite ${pageNumber} wurde in ${userFacingCandidateId(sourceCandidateId)} nicht gefunden.`);
    }
    return {
      runId,
      candidateId: sourceCandidate.id,
      page: candidatePage.page,
      role: candidatePage.role || null,
      sourcePath: runPageSourcePath(candidatePage),
      format: candidatePage.format || null
    };
  });
}

async function candidateTechnicalQc(projectDir, runId, candidateId, now) {
  const runDir = path.join(projectDir, "runs", runId);
  const qcPath = path.join(runDir, "qc", `${candidateId}.technical-qc.json`);
  const existing = await readJsonIfExists(qcPath);
  return existing?.formatContract ? existing : runCandidateTechnicalQc(projectDir, runId, candidateId, { now });
}

async function assertCandidateCanBeDeposited(projectDir, runId, candidateId, now) {
  const qc = await candidateTechnicalQc(projectDir, runId, candidateId, now);
  if (qc.status !== "error") {
    return qc;
  }
  const formatError = (qc.pages || [])
    .flatMap((page) => page.errors || [])
    .find((error) => String(error.code || "").startsWith("worksheet_page_"));
  throw new Error(formatError?.message || "Dieser Entwurf hat technische Fehler und kann nicht als Arbeitsblatt abgelegt werden.");
}

async function materializeWorksheetSnapshot({ projectDir, runDir, itemDir, resolvedPages, title, printSafeMarginMm }) {
  const storedPages = [];
  const pdfPages = [];
  await fs.mkdir(path.join(itemDir, "pages"), { recursive: true });
  for (const [index, page] of resolvedPages.entries()) {
    const sourcePath = path.join(runDir, page.sourcePath);
    if (!(await pathExists(sourcePath))) {
      throw new Error(`Entwurfsseite fehlt: ${page.sourcePath}`);
    }
    const extension = path.extname(sourcePath) || ".png";
    const targetPath = path.join("pages", `page_${String(index + 1).padStart(3, "0")}${extension}`);
    await fs.copyFile(sourcePath, path.join(itemDir, targetPath));
    storedPages.push({
      page: index + 1,
      sourcePage: page.page,
      role: page.role,
      sourceRunId: page.runId,
      sourceCandidateId: page.candidateId,
      sourcePath: `runs/${page.runId}/${page.sourcePath}`,
      path: targetPath
    });
    pdfPages.push({
      path: path.join(itemDir, targetPath),
      role: page.role
    });
  }

  const pdfFileName = `${safeFileName(title)}.pdf`;
  const pdfResult = await renderImagesToPdf({
    pages: pdfPages,
    outputPath: path.join(itemDir, pdfFileName),
    title,
    printSafeMarginMm
  });
  return {
    pages: storedPages,
    pdf: {
      path: pdfFileName,
      pageCount: pdfResult.pageCount,
      size: pdfResult.size,
      printSafeMarginMm: pdfResult.printSafeMarginMm
    }
  };
}

async function createWorksheetSnapshot(input = {}, options = {}) {
  const repoRoot = options.repoRoot || DEFAULT_REPO_ROOT;
  const projectsDir = options.projectsDir || DEFAULT_PROJECTS_DIR;
  const worksheetsDir = options.worksheetsDir || DEFAULT_WORKSHEETS_DIR;
  const now = options.now || input.now || new Date().toISOString();
  const projectId = String(input.projectId || "").trim();
  if (!projectId) {
    throw new Error("Projekt ist erforderlich.");
  }
  const projectDir = path.join(projectsDir, projectId);
  const project = await openProject(projectId, { projectsDir });
  const runId = input.runId || await latestRunId(projectDir);
  if (!runId) {
    throw new Error("Es gibt noch keinen Entwurfslauf.");
  }
  const runDir = path.join(projectDir, "runs", runId);
  const runManifest = await readJson(path.join(runDir, "run-manifest.json"));
  const candidateId = input.candidateId || runManifest.candidates?.at(-1)?.id || null;
  if (!candidateId) {
    throw new Error("Entwurf ist erforderlich.");
  }
  const candidate = (runManifest.candidates || []).find((entry) => entry.id === candidateId) || null;
  if (!candidate) {
    throw new Error(`Entwurf wurde nicht gefunden: ${userFacingCandidateId(candidateId)}`);
  }
  await assertCandidateCanBeDeposited(projectDir, runId, candidateId, now);
  const resolvedPages = resolveCandidatePages({
    manifest: runManifest,
    runId,
    candidateId,
    pages: input.pages
  });
  const title = await deriveWorksheetTitle({
    projectDir,
    project,
    manifest: runManifest,
    candidate,
    explicitTitle: input.title
  });
  const fingerprint = sourceFingerprint({
    projectId,
    runId,
    candidateId,
    pages: resolvedPages
  });
  const duplicate = input.forceDuplicate === true
    ? null
    : await findDuplicateByFingerprint(fingerprint, { worksheetsDir });
  if (duplicate) {
    await updateRunAnalysisReport(projectDir, runId, { now, worksheetsDir });
    return {
      duplicate: true,
      existing: publicWorksheet(duplicate, { repoRoot, worksheetsDir })
    };
  }

  const worksheetId = await uniqueWorksheetId(worksheetsDir, title);
  const itemDir = worksheetDirFor(worksheetsDir, worksheetId);
  const materialized = await materializeWorksheetSnapshot({
    projectDir,
    runDir,
    itemDir,
    resolvedPages,
    title,
    printSafeMarginMm: input.printSafeMarginMm ?? DEFAULT_PRINT_SAFE_MARGIN_MM
  });
  const pageCount = materialized.pages.length;
  const kind = worksheetKindForPageCount(pageCount);
  const manifest = {
    schemaVersion: WORKSHEET_LIBRARY_SCHEMA_VERSION,
    worksheetId,
    ownerPassId: options.ownerPassId || project.manifest?.ownerPassId || null,
    kind,
    title,
    status: "stored",
    createdAt: now,
    updatedAt: now,
    seenAt: null,
    pageCount,
    tags: Array.isArray(input.tags) ? input.tags.filter(Boolean).map(String) : [],
    sourceFingerprint: fingerprint,
    source: {
      projectId,
      projectTitle: project.title || null,
      runId,
      candidateId,
      candidateIds: [...new Set(resolvedPages.map((page) => page.candidateId).filter(Boolean))],
      basedOnConceptId: candidate.basedOnConceptId || runManifest.sourceArtifacts?.contentMirrorId || null,
      basedOnConceptVersion: candidate.basedOnConceptVersion || runManifest.concept?.conceptVersion || null,
      concept: candidate.concept || runManifest.concept || null
    },
    pages: materialized.pages,
    pdf: materialized.pdf
  };
  await writeJson(worksheetManifestPath(worksheetsDir, worksheetId), manifest);

  const state = await readWorksheetState({ worksheetsDir });
  const targetFolderId = input.targetFolderId || WORKSHEETS_ROOT_ID;
  const targetFolder = folderRecord(state, targetFolderId) || folderRecord(state, WORKSHEETS_ROOT_ID);
  removeItemFromWorksheetState(state, `worksheet:${worksheetId}`);
  targetFolder.children.push(`worksheet:${worksheetId}`);
  await writeWorksheetState(state, { worksheetsDir, now });
  await updateRunAnalysisReport(projectDir, runId, { now, worksheetsDir });

  return {
    duplicate: false,
    item: publicWorksheet(manifest, { repoRoot, worksheetsDir })
  };
}

async function depositCandidateAsWorksheet(input = {}, options = {}) {
  if (input.outputMode === "single_pdfs") {
    let pages = Array.isArray(input.pages) && input.pages.length ? input.pages : null;
    if (!pages) {
      const projectsDir = options.projectsDir || DEFAULT_PROJECTS_DIR;
      const projectId = String(input.projectId || "").trim();
      const projectDir = path.join(projectsDir, projectId);
      const runId = input.runId || await latestRunId(projectDir);
      if (!runId) {
        throw new Error("Es gibt noch keinen Entwurfslauf.");
      }
      const runManifest = await readJson(path.join(projectDir, "runs", runId, "run-manifest.json"));
      const candidateId = input.candidateId || runManifest.candidates?.at(-1)?.id || null;
      const candidate = (runManifest.candidates || []).find((entry) => entry.id === candidateId) || null;
      pages = (candidate?.pages || []).map((page) => ({
        candidateId,
        page: page.page
      }));
    }
    const items = [];
    for (const page of pages) {
      const result = await createWorksheetSnapshot({
        ...input,
        outputMode: "bundle_pdf",
        title: input.title,
        pages: [page]
      }, options);
      items.push(result.item || result.existing);
    }
    return { items, outputMode: "single_pdfs" };
  }
  return createWorksheetSnapshot(input, options);
}

async function markWorksheetSeen(manifest, options = {}) {
  if (manifest.seenAt) {
    return manifest;
  }
  const worksheetsDir = options.worksheetsDir || DEFAULT_WORKSHEETS_DIR;
  const now = options.now || new Date().toISOString();
  const next = {
    ...manifest,
    seenAt: now,
    updatedAt: now
  };
  await writeJson(worksheetManifestPath(worksheetsDir, manifest.worksheetId), next);
  return next;
}

async function getWorksheetItem(itemId, options = {}) {
  const repoRoot = options.repoRoot || DEFAULT_REPO_ROOT;
  const worksheetsDir = options.worksheetsDir || DEFAULT_WORKSHEETS_DIR;
  const match = String(itemId || "").match(/^worksheet:(.+)$/);
  if (!match) {
    throw new Error(`Unsupported worksheet item id: ${itemId}`);
  }
  const worksheetId = match[1];
  const manifest = await readJsonIfExists(worksheetManifestPath(worksheetsDir, worksheetId));
  if (!manifest) {
    throw new Error("Arbeitsblatt wurde nicht gefunden.");
  }
  const nextManifest = options.markSeen === true ? await markWorksheetSeen(manifest, { worksheetsDir, now: options.now }) : manifest;
  return {
    worksheet: publicWorksheet(nextManifest, { repoRoot, worksheetsDir }),
    actions: ["download_pdf", "open_source_project", "rename_worksheet", "delete_worksheet"]
  };
}

async function markWorksheetItemSeen(itemId, options = {}) {
  const repoRoot = options.repoRoot || DEFAULT_REPO_ROOT;
  const worksheetsDir = options.worksheetsDir || DEFAULT_WORKSHEETS_DIR;
  const match = String(itemId || "").match(/^worksheet:(.+)$/);
  if (!match) {
    throw new Error(`Unsupported worksheet item id: ${itemId}`);
  }
  const worksheetId = match[1];
  const manifest = await readJsonIfExists(worksheetManifestPath(worksheetsDir, worksheetId));
  if (!manifest) {
    throw new Error("Arbeitsblatt wurde nicht gefunden.");
  }
  const nextManifest = await markWorksheetSeen(manifest, { worksheetsDir, now: options.now });
  return publicWorksheet(nextManifest, { repoRoot, worksheetsDir });
}

async function renameWorksheet(itemId, title, options = {}) {
  const worksheetsDir = options.worksheetsDir || DEFAULT_WORKSHEETS_DIR;
  const worksheetId = String(itemId || "").replace(/^worksheet:/, "");
  const nextTitle = String(title || "").trim();
  if (!worksheetId || !nextTitle) {
    throw new Error("Titel ist erforderlich.");
  }
  const manifest = await readJsonIfExists(worksheetManifestPath(worksheetsDir, worksheetId));
  if (!manifest) {
    throw new Error("Arbeitsblatt wurde nicht gefunden.");
  }
  const next = {
    ...manifest,
    title: nextTitle,
    updatedAt: options.now || new Date().toISOString()
  };
  await writeJson(worksheetManifestPath(worksheetsDir, worksheetId), next);
  return next;
}

async function deleteWorksheet(itemId, options = {}) {
  const worksheetsDir = options.worksheetsDir || DEFAULT_WORKSHEETS_DIR;
  const worksheetId = String(itemId || "").replace(/^worksheet:/, "");
  if (!worksheetId) {
    throw new Error("Arbeitsblatt ist erforderlich.");
  }
  const state = await readNormalizedWorksheetState({ worksheetsDir });
  removeItemFromWorksheetState(state, `worksheet:${worksheetId}`);
  await writeWorksheetState(state, { worksheetsDir });
  await fs.rm(worksheetDirFor(worksheetsDir, worksheetId), { recursive: true, force: true });
  return { worksheetId, deleted: true };
}

async function deleteProjectWorksheets(projectId, options = {}) {
  const worksheetsDir = options.worksheetsDir || DEFAULT_WORKSHEETS_DIR;
  const targetProjectId = String(projectId || "").trim();
  if (!targetProjectId) {
    return { projectId: targetProjectId, deletedCount: 0, worksheets: [] };
  }
  const manifests = await listProjectWorksheetManifests(targetProjectId, { worksheetsDir });
  if (!manifests.length) {
    return { projectId: targetProjectId, deletedCount: 0, worksheets: [] };
  }

  const state = await readNormalizedWorksheetState({ worksheetsDir });
  for (const manifest of manifests) {
    removeItemFromWorksheetState(state, `worksheet:${manifest.worksheetId}`);
  }
  await writeWorksheetState(state, { worksheetsDir, now: options.now });
  for (const manifest of manifests) {
    await fs.rm(worksheetDirFor(worksheetsDir, manifest.worksheetId), { recursive: true, force: true });
  }

  return {
    projectId: targetProjectId,
    deletedCount: manifests.length,
    worksheets: manifests.map((manifest) => ({
      worksheetId: manifest.worksheetId,
      title: manifest.title || manifest.worksheetId
    }))
  };
}

module.exports = {
  WORKSHEETS_ROOT_ID,
  buildWorksheetTree,
  createWorksheetFolder,
  deleteWorksheet,
  deleteWorksheetFolder,
  deleteProjectWorksheets,
  depositCandidateAsWorksheet,
  getWorksheetItem,
  markWorksheetItemSeen,
  listProjectWorksheets,
  moveWorksheetItem,
  renameWorksheet,
  renameWorksheetFolder,
  updateWorksheetFolder
};
