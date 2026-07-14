"use strict";

const fs = require("node:fs/promises");
const path = require("node:path");
const { ARTIFACT_TYPES, EVENT_TYPES } = require("../contracts");
const {
  currentArtifact,
  findArtifact,
  listArtifacts,
  readArtifactIndex
} = require("../artifactManager");
const { readEvents } = require("../eventLog");
const { inputReadiness } = require("../inputReadiness");
const { listProjects, openProject } = require("../projectManager");
const { normalizeConceptReference } = require("../conceptReference");
const { listProjectWorksheets } = require("../worksheetLibraryManager");
const { readJsonFileIfExists, writeJsonFile } = require("../jsonFile");

const DEFAULT_REPO_ROOT = path.resolve(__dirname, "..", "..");
const DEFAULT_PROJECTS_DIR = path.join(DEFAULT_REPO_ROOT, "projects");
const LIBRARY_STATE_FILE = "library-state.json";
const LIBRARY_STATE_SCHEMA_VERSION = "sheetifyimg.library-state.v1";
const PROJECTS_ROOT_ID = "folder:projects";
const ROOT_FOLDERS = [
  { id: PROJECTS_ROOT_ID, label: "Projekte" }
];

async function pathExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function readJsonIfExists(filePath) {
  return readJsonFileIfExists(filePath);
}

async function writeJson(filePath, value) {
  await writeJsonFile(filePath, value);
}

async function readUtf8IfExists(filePath) {
  if (!(await pathExists(filePath))) {
    return null;
  }
  return fs.readFile(filePath, "utf8");
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

function assetUrl(repoRoot, filePath) {
  return `/files/${encodeURI(toPosix(path.relative(repoRoot, filePath)))}`;
}

function projectToTreeItem(project, previewType = "project_status") {
  return {
    id: `project:${project.projectId}`,
    type: "worksheet",
    label: project.title,
    projectId: project.projectId,
    status: project.status,
    productStage: project.productStage || "input",
    previewType,
    warnings: project.warnings,
    errors: project.errors,
    candidateGeneration: project.candidateGeneration || {
      isRunning: false,
      activeJob: null,
      latestCompletion: null,
      latestFailure: null,
      hasUnreadCompletion: false
    },
    hasUnreadCandidateCompletion: Boolean(project.hasUnreadCandidateCompletion),
    draggable: true,
    canRename: true,
    canDelete: true,
    actions: actionsForProject(project, previewType)
  };
}

function normalizeSearchText(value) {
  return String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function tokenizeQuery(query) {
  return normalizeSearchText(query)
    .split(/[^a-z0-9]+/g)
    .map((token) => token.trim())
    .filter(Boolean);
}

async function searchWorksheetProject(project, options = {}) {
  if (project.projectType !== "single_worksheet") {
    return null;
  }

  const tokens = tokenizeQuery(options.query);
  if (tokens.length === 0) {
    return null;
  }

  const projectsDir = options.projectsDir || DEFAULT_PROJECTS_DIR;
  const projectDir = path.join(projectsDir, project.projectId);
  const manifest = await readJsonIfExists(path.join(projectDir, "project-manifest.json"));
  const draftBrief = await readJsonIfExists(path.join(projectDir, "brief", "draft.lessonbrief.json"));
  const approvedBrief = await readJsonIfExists(path.join(projectDir, "brief", "approved.lessonbrief.json"));
  const draftContent = await readJsonIfExists(path.join(projectDir, "content", "draft.content-mirror.json"));
  const approvedContent = await readJsonIfExists(path.join(projectDir, "content", "approved.content-mirror.json"));
  const transferCard = await readUtf8IfExists(path.join(projectDir, "source", "transfer-card.md"));

  const titleText = normalizeSearchText([
    project.title,
    project.subject,
    project.topic,
    manifest?.title,
    manifest?.subject,
    manifest?.topic
  ].filter(Boolean).join(" "));
  const contentText = normalizeSearchText([
    JSON.stringify(draftBrief || {}),
    JSON.stringify(approvedBrief || {}),
    JSON.stringify(draftContent || {}),
    JSON.stringify(approvedContent || {}),
    transferCard || ""
  ].join(" "));
  const searchText = `${titleText} ${contentText}`.trim();

  if (!tokens.every((token) => searchText.includes(token))) {
    return null;
  }

  let score = 0;
  for (const token of tokens) {
    if (titleText.includes(token)) {
      score += 12;
    }
    if (contentText.includes(token)) {
      score += 4;
    }
  }
  if (titleText.includes(normalizeSearchText(project.title))) {
    score += 3;
  }

  return {
    project,
    score
  };
}

function actionsForProject(project, previewType = "project_status") {
  return ["open", "preview", "show_in_finder"];
}

function emptyFolder(id, label) {
  return {
    id,
    type: "folder",
    label,
    locked: ROOT_FOLDERS.some((folder) => folder.id === id),
    draggable: !ROOT_FOLDERS.some((folder) => folder.id === id),
    canRename: !ROOT_FOLDERS.some((folder) => folder.id === id),
    canDelete: !ROOT_FOLDERS.some((folder) => folder.id === id),
    children: []
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

function createEmptyLibraryState(now = new Date().toISOString()) {
  return {
    schemaVersion: LIBRARY_STATE_SCHEMA_VERSION,
    updatedAt: now,
    rootChildren: Object.fromEntries(ROOT_FOLDERS.map((folder) => [folder.id, []])),
    folderColors: {},
    folders: {}
  };
}

function libraryStatePath(projectsDir) {
  return path.join(projectsDir, LIBRARY_STATE_FILE);
}

function appendUniqueItemIds(target, itemIds = []) {
  const existing = new Set(target);
  for (const itemId of itemIds) {
    if (!itemId || existing.has(itemId)) {
      continue;
    }
    target.push(itemId);
    existing.add(itemId);
  }
}

async function readLibraryState(options = {}) {
  const projectsDir = options.projectsDir || DEFAULT_PROJECTS_DIR;
  const existing = await readJsonIfExists(libraryStatePath(projectsDir));
  const state = {
    ...createEmptyLibraryState(),
    ...(existing || {})
  };
  state.rootChildren = {
    ...createEmptyLibraryState().rootChildren,
    ...(state.rootChildren || {})
  };
  state.rootChildren[PROJECTS_ROOT_ID] = Array.isArray(state.rootChildren[PROJECTS_ROOT_ID])
    ? state.rootChildren[PROJECTS_ROOT_ID]
    : [];
  state.folderColors = state.folderColors && typeof state.folderColors === "object" ? state.folderColors : {};
  const currentRootIds = new Set(ROOT_FOLDERS.map((folder) => folder.id));
  for (const rootId of Object.keys(state.rootChildren)) {
    if (!currentRootIds.has(rootId)) {
      const childIds = Array.isArray(state.rootChildren[rootId]) ? state.rootChildren[rootId] : [];
      appendUniqueItemIds(state.rootChildren[PROJECTS_ROOT_ID], childIds);
      delete state.rootChildren[rootId];
    }
  }
  state.folders = state.folders && typeof state.folders === "object" ? state.folders : {};
  for (const folder of Object.values(state.folders)) {
    if (folder?.parentId && !currentRootIds.has(folder.parentId) && /^folder:(work-in-progress|finished-single-worksheets|series)$/.test(folder.parentId)) {
      folder.parentId = PROJECTS_ROOT_ID;
    }
  }
  return state;
}

async function writeLibraryState(state, options = {}) {
  const projectsDir = options.projectsDir || DEFAULT_PROJECTS_DIR;
  const nextState = {
    ...state,
    schemaVersion: LIBRARY_STATE_SCHEMA_VERSION,
    updatedAt: options.now || new Date().toISOString()
  };
  await writeJson(libraryStatePath(projectsDir), nextState);
  return nextState;
}

function defaultRootIdForProject() {
  return PROJECTS_ROOT_ID;
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

function removeItemFromLibraryState(state, itemId) {
  for (const rootId of Object.keys(state.rootChildren || {})) {
    state.rootChildren[rootId] = (state.rootChildren[rootId] || []).filter((id) => id !== itemId);
  }
  for (const folder of Object.values(state.folders || {})) {
    folder.children = (folder.children || []).filter((id) => id !== itemId);
  }
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

function folderRecord(state, folderId) {
  if (ROOT_FOLDERS.some((folder) => folder.id === folderId)) {
    return {
      id: folderId,
      children: state.rootChildren[folderId] || []
    };
  }
  return state.folders[folderId] || null;
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

function cleanLibraryState(state, projectItemIds) {
  const knownProjectItems = new Set(projectItemIds);
  const knownFolders = new Set(Object.keys(state.folders || {}));
  const rootIds = new Set(ROOT_FOLDERS.map((folder) => folder.id));
  for (const [folderId, folder] of Object.entries(state.folders || {})) {
    if (!folder?.label || !folder?.parentId || (!rootIds.has(folder.parentId) && !knownFolders.has(folder.parentId))) {
      delete state.folders[folderId];
    }
  }
  const allowedIds = () => new Set([...knownProjectItems, ...Object.keys(state.folders || {})]);
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
      state.rootChildren[PROJECTS_ROOT_ID].push(folderId);
      state.folders[folderId].parentId = PROJECTS_ROOT_ID;
    }
  }
  for (const folderId of Object.keys(state.folderColors || {})) {
    if (!rootIds.has(folderId) && !state.folders?.[folderId]) {
      delete state.folderColors[folderId];
    }
  }
}

async function buildProjectTreeItems(projects, options = {}) {
  const repoRoot = options.repoRoot || DEFAULT_REPO_ROOT;
  const projectsDir = options.projectsDir || DEFAULT_PROJECTS_DIR;
  const items = new Map();
  for (const project of projects) {
    const projectDir = path.join(projectsDir, project.projectId);
    const preview = project.projectType === "bundle"
      ? await buildBundlePreview({ repoRoot, projectDir, project })
      : await buildWorksheetPreview({ repoRoot, projectDir, project });
    items.set(`project:${project.projectId}`, projectToTreeItem(project, preview.previewType));
  }
  return items;
}

function appendMissingProjectsToState(state, projects) {
  for (const project of projects) {
    const itemId = `project:${project.projectId}`;
    if (findParentFolderId(state, itemId)) {
      continue;
    }
    state.rootChildren[defaultRootIdForProject(project)].push(itemId);
  }
}

function normalizeLibraryStateForProjects(state, projects) {
  cleanLibraryState(state, projects.map((project) => `project:${project.projectId}`));
  appendMissingProjectsToState(state, projects);
  return state;
}

async function readNormalizedLibraryState(options = {}) {
  const projectsDir = options.projectsDir || DEFAULT_PROJECTS_DIR;
  const [state, projects] = await Promise.all([
    readLibraryState({ projectsDir }),
    listProjects({ projectsDir })
  ]);
  return normalizeLibraryStateForProjects(state, projects);
}

function inflateTreeChildren(state, childIds, projectItems) {
  return childIds.map((childId) => {
    if (projectItems.has(childId)) {
      return projectItems.get(childId);
    }
    const folder = state.folders[childId];
    if (!folder) {
      return null;
    }
    const treeFolder = customFolderToTreeFolder(folder);
    treeFolder.children = inflateTreeChildren(state, folder.children || [], projectItems);
    return treeFolder;
  }).filter(Boolean);
}

function inflateLibraryTree(state, projectItems) {
  return ROOT_FOLDERS.map((root) => {
    const folder = emptyFolder(root.id, root.label);
    folder.color = state.folderColors?.[root.id] || null;
    folder.children = inflateTreeChildren(state, state.rootChildren[root.id] || [], projectItems);
    return folder;
  });
}

async function buildLibraryTree(options = {}) {
  const repoRoot = options.repoRoot || DEFAULT_REPO_ROOT;
  const projectsDir = options.projectsDir || DEFAULT_PROJECTS_DIR;
  const query = String(options.query || "").trim();
  const projects = await listProjects({ projectsDir });

  if (query) {
    const matches = [];
    for (const project of projects) {
      const match = await searchWorksheetProject(project, { projectsDir, query });
      if (!match) {
        continue;
      }
      const projectDir = path.join(projectsDir, project.projectId);
      const preview = await buildWorksheetPreview({ repoRoot, projectDir, project });
      matches.push({
        item: projectToTreeItem(project, preview.previewType),
        score: match.score
      });
    }

    matches.sort((left, right) => {
      return right.score - left.score
        || left.item.label.localeCompare(right.item.label);
    });

    return {
      id: "library:search",
      type: "root",
      label: "SheetifyIMG Suche",
      searchQuery: query,
      children: [{
        id: "folder:search-results",
        type: "folder",
        label: "Suchtreffer",
        children: matches.map((entry) => entry.item)
      }]
    };
  }

  const libraryState = await readLibraryState({ projectsDir });
  const projectItems = await buildProjectTreeItems(projects, { repoRoot, projectsDir });
  normalizeLibraryStateForProjects(libraryState, projects);

  return {
    id: "library:root",
    type: "root",
    label: "SheetifyIMG Projekte",
    children: inflateLibraryTree(libraryState, projectItems)
  };
}

async function createLibraryFolder(input = {}, options = {}) {
  const projectsDir = options.projectsDir || DEFAULT_PROJECTS_DIR;
  const state = await readNormalizedLibraryState({ projectsDir });
  const parentId = input.parentId || PROJECTS_ROOT_ID;
  if (!folderRecord(state, parentId)) {
    throw new Error("Zielordner wurde nicht gefunden.");
  }
  const label = String(input.label || "").trim();
  if (!label) {
    throw new Error("Ordnername ist erforderlich.");
  }
  const folderId = `folder:custom:${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  state.folders[folderId] = {
    id: folderId,
    label,
    parentId,
    color: normalizeFolderColor(input.color),
    children: []
  };
  folderRecord(state, parentId).children.push(folderId);
  await writeLibraryState(state, { projectsDir });
  return state.folders[folderId];
}

async function renameLibraryFolder(folderId, label, options = {}) {
  return updateLibraryFolder(folderId, { label }, options);
}

async function updateLibraryFolder(folderId, input = {}, options = {}) {
  const projectsDir = options.projectsDir || DEFAULT_PROJECTS_DIR;
  const isRootFolder = ROOT_FOLDERS.some((folder) => folder.id === folderId);
  const state = await readNormalizedLibraryState({ projectsDir });
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

  await writeLibraryState(state, { projectsDir });
  if (isRootFolder) {
    return {
      id: folderId,
      label: folder.label,
      color: state.folderColors[folderId] || null
    };
  }
  return state.folders[folderId];
}

async function deleteLibraryFolder(folderId, options = {}) {
  const projectsDir = options.projectsDir || DEFAULT_PROJECTS_DIR;
  if (ROOT_FOLDERS.some((folder) => folder.id === folderId)) {
    throw new Error("Dieser Hauptordner kann nicht geloescht werden.");
  }
  const state = await readNormalizedLibraryState({ projectsDir });
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
  await writeLibraryState(state, { projectsDir });
  return { folderId, deleted: true };
}

async function moveLibraryItem(input = {}, options = {}) {
  const projectsDir = options.projectsDir || DEFAULT_PROJECTS_DIR;
  const state = await readNormalizedLibraryState({ projectsDir });
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
  removeItemFromLibraryState(state, itemId);
  const insertAt = beforeId ? targetFolder.children.indexOf(beforeId) : -1;
  if (insertAt >= 0) {
    targetFolder.children.splice(insertAt, 0, itemId);
  } else {
    targetFolder.children.push(itemId);
  }
  if (state.folders[itemId]) {
    state.folders[itemId].parentId = targetFolderId;
  }
  await writeLibraryState(state, { projectsDir });
  return { itemId, targetFolderId, beforeId, moved: true };
}

async function removeProjectFromLibrary(projectId, options = {}) {
  const projectsDir = options.projectsDir || DEFAULT_PROJECTS_DIR;
  const state = await readNormalizedLibraryState({ projectsDir });
  removeItemFromLibraryState(state, `project:${projectId}`);
  await writeLibraryState(state, { projectsDir });
}

async function findAllRuns(projectDir) {
  return listDirs(path.join(projectDir, "runs"));
}

async function previewFromCandidates({ repoRoot, runDir }) {
  const manifest = await readJsonIfExists(path.join(runDir, "run-manifest.json"));
  const runId = manifest?.runId || path.basename(runDir);
  const candidates = [];

  for (const candidate of manifest?.candidates || []) {
    const concept = normalizeConceptReference(candidate.concept || manifest.concept || {}, manifest.sourceArtifacts || {});
    const qc = await readJsonIfExists(path.join(runDir, "qc", `${candidate.id}.technical-qc.json`));
    const pages = [];
    for (const page of candidate.pages || []) {
      const filePath = path.join(runDir, page.path);
      const assetManifest = page.path
        ? await readJsonIfExists(path.join(runDir, page.path.replace(/\.[^.]+$/, ".asset.json")))
        : null;
      pages.push({
        page: page.page,
        role: page.role,
        path: toPosix(path.relative(repoRoot, filePath)),
        url: (await pathExists(filePath)) ? assetUrl(repoRoot, filePath) : null,
        missing: !(await pathExists(filePath)),
        prompt: page.prompt || null,
        assetId: page.assetId || assetManifest?.assetId || null,
        format: page.format || assetManifest?.format || null,
        metadata: assetManifest?.metadata || null
      });
    }
    candidates.push({
      id: candidate.id,
      runId,
      status: candidate.status,
      createdAt: candidate.createdAt || manifest?.createdAt || null,
      concept,
      basedOnConceptId: candidate.basedOnConceptId || concept.conceptId,
      basedOnConceptVersion: candidate.basedOnConceptVersion || concept.conceptVersion,
      generation: candidate.generation || null,
      qc: qc?.formatContract ? {
        status: qc.status || null,
        errorCount: qc.errorCount || 0,
        warningCount: qc.warningCount || 0,
        path: `runs/${runId}/qc/${candidate.id}.technical-qc.json`
      } : candidate.qc || null,
      notes: Array.isArray(candidate.notes) ? candidate.notes : [],
      pages
    });
  }

  return candidates;
}

async function previewFromAllCandidates({ repoRoot, projectDir }) {
  const runDirs = await findAllRuns(projectDir);
  const candidates = [];
  for (const runDir of runDirs) {
    candidates.push(...await previewFromCandidates({ repoRoot, runDir }));
  }
  return candidates.sort((left, right) => {
    return String(right.createdAt || "").localeCompare(String(left.createdAt || ""))
      || String(right.runId || "").localeCompare(String(left.runId || ""))
      || String(right.id || "").localeCompare(String(left.id || ""));
  });
}

function candidateWorksheetDepositKey(runId = "", candidateId = "") {
  const normalizedRunId = String(runId || "").trim();
  const normalizedCandidateId = String(candidateId || "").trim();
  return normalizedRunId && normalizedCandidateId ? `${normalizedRunId}::${normalizedCandidateId}` : "";
}

function annotateCandidatesWithWorksheetDeposits(candidates = [], worksheets = []) {
  const depositsByKey = new Map();
  for (const worksheet of worksheets) {
    const source = worksheet.source || {};
    const runId = String(source.runId || "").trim();
    const candidateIds = new Set([
      source.candidateId,
      ...(Array.isArray(source.candidateIds) ? source.candidateIds : []),
      ...(worksheet.pages || []).map((page) => page.sourceCandidateId || null)
    ].filter(Boolean));
    for (const candidateId of candidateIds) {
      const key = candidateWorksheetDepositKey(runId, candidateId);
      if (!key) {
        continue;
      }
      if (!depositsByKey.has(key)) {
        depositsByKey.set(key, []);
      }
      depositsByKey.get(key).push({
        worksheetId: worksheet.worksheetId,
        title: worksheet.title || worksheet.worksheetId,
        kind: worksheet.kind || null,
        pageCount: Number(worksheet.pageCount || worksheet.pages?.length || 0) || 0
      });
    }
  }
  return candidates.map((candidate) => {
    const key = candidateWorksheetDepositKey(candidate.runId, candidate.id);
    const candidateDeposits = key ? (depositsByKey.get(key) || []) : [];
    return {
      ...candidate,
      worksheetDeposited: candidateDeposits.length > 0,
      worksheetDeposits: candidateDeposits
    };
  });
}

function summarizeCandidatePreview(candidates) {
  const plannedCandidateCount = candidates.length;
  const renderedCandidates = candidates.filter((candidate) => {
    return (candidate.pages || []).some((page) => Boolean(page.url));
  });
  const renderedCandidateCount = renderedCandidates.length;
  const plannedCandidatePageCount = candidates.reduce((sum, candidate) => {
    return sum + (candidate.pages || []).length;
  }, 0);
  const renderedCandidatePageCount = candidates.reduce((sum, candidate) => {
    return sum + (candidate.pages || []).filter((page) => page.url).length;
  }, 0);

  return {
    plannedCandidateCount,
    renderedCandidateCount,
    plannedCandidatePageCount,
    renderedCandidatePageCount,
    renderedCandidates
  };
}

function artifactVersionLabel(version) {
  const number = Number(version);
  return Number.isFinite(number) && number > 0 ? `v${number}` : null;
}

function sortArtifactsByVersionAsc(left, right) {
  return (Number(left.version) || 0) - (Number(right.version) || 0)
    || String(left.id || "").localeCompare(String(right.id || ""));
}

function conceptSummaryFromContent(data = {}) {
  return {
    title: data.title || data.topic || null,
    taskCount: Array.isArray(data.tasks) ? data.tasks.length : 0,
    readingTextCount: Array.isArray(data.readingTexts) ? data.readingTexts.length : 0,
    imageMaterialCount: Array.isArray(data.imageMaterials) ? data.imageMaterials.length : 0
  };
}

async function conceptArtifactsFromIndex(projectDir, index, documents = {}) {
  const artifacts = listArtifacts(index, { type: ARTIFACT_TYPES.CONTENT_MIRROR })
    .sort(sortArtifactsByVersionAsc);
  const current = currentArtifact(index, ARTIFACT_TYPES.CONTENT_MIRROR);
  const currentId = documents.content?.data?.artifactId || current?.id || null;
  const concepts = [];

  for (const artifact of artifacts) {
    const version = Number(artifact.version) || null;
    const data = artifact.path ? await readJsonIfExists(path.join(projectDir, artifact.path)) : null;
    const summary = conceptSummaryFromContent(data || {});
    concepts.push({
      id: artifact.id,
      version,
      label: artifactVersionLabel(version) || "Konzept",
      status: artifact.status || null,
      current: Boolean(currentId && artifact.id === currentId),
      createdAt: artifact.createdAt || null,
      updatedAt: artifact.updatedAt || null,
      title: summary.title,
      taskCount: summary.taskCount,
      readingTextCount: summary.readingTextCount,
      imageMaterialCount: summary.imageMaterialCount,
      data
    });
  }

  if (!concepts.length && documents.content?.data) {
    const version = Number(documents.content.data.version) || null;
    const summary = conceptSummaryFromContent(documents.content.data || {});
    concepts.push({
      id: documents.content.data.artifactId || "current_content",
      version,
      label: artifactVersionLabel(version) || "Konzept",
      status: documents.content.status || null,
      current: true,
      createdAt: documents.content.data.createdAt || null,
      updatedAt: documents.content.data.updatedAt || null,
      title: summary.title,
      taskCount: summary.taskCount,
      readingTextCount: summary.readingTextCount,
      imageMaterialCount: summary.imageMaterialCount,
      data: documents.content.data
    });
  }

  return concepts;
}

function candidateConceptReference(manifest = {}, candidate = {}) {
  const concept = normalizeConceptReference(candidate.concept || manifest.concept || {}, manifest.sourceArtifacts || {});
  return {
    concept,
    conceptId: candidate.basedOnConceptId || concept.contentMirrorId || concept.conceptId || null,
    conceptVersion: Number(candidate.basedOnConceptVersion || concept.conceptVersion) || null
  };
}

async function candidateArtifactsFromRuns(projectDir) {
  const runDirs = await listDirs(path.join(projectDir, "runs"));
  const candidates = [];

  for (const runDir of runDirs) {
    const manifest = await readJsonIfExists(path.join(runDir, "run-manifest.json"));
    const runId = manifest?.runId || path.basename(runDir);
    for (const candidate of manifest?.candidates || []) {
      const reference = candidateConceptReference(manifest, candidate);
      candidates.push({
        id: candidate.id,
        runId,
        artifactId: `${runId}_${candidate.id}`,
        status: candidate.status || manifest?.status || null,
        conceptId: reference.conceptId,
        conceptVersion: reference.conceptVersion,
        conceptLabel: artifactVersionLabel(reference.conceptVersion) || reference.concept.label || "Konzept",
        pageCount: (candidate.pages || []).length,
        createdAt: candidate.createdAt || manifest?.createdAt || null
      });
    }
  }

  return candidates.sort((left, right) => {
    return String(right.createdAt || "").localeCompare(String(left.createdAt || ""))
      || String(right.runId || "").localeCompare(String(left.runId || ""))
      || String(right.id || "").localeCompare(String(left.id || ""));
  });
}

function groupCandidatesByConcept(concepts = [], candidates = []) {
  const conceptsById = new Map(concepts.map((concept) => [concept.id, concept]));
  const conceptsByVersion = new Map(concepts
    .filter((concept) => concept.version)
    .map((concept) => [Number(concept.version), concept]));
  const groups = new Map();

  for (const candidate of candidates) {
    const matchingConcept = (candidate.conceptId && conceptsById.get(candidate.conceptId))
      || (candidate.conceptVersion && conceptsByVersion.get(Number(candidate.conceptVersion)))
      || null;
    const conceptVersion = candidate.conceptVersion || matchingConcept?.version || null;
    const key = candidate.conceptId || (conceptVersion ? `version:${conceptVersion}` : "unknown");
    if (!groups.has(key)) {
      const label = artifactVersionLabel(conceptVersion)
        || matchingConcept?.label
        || candidate.conceptLabel
        || "ohne Version";
      groups.set(key, {
        conceptId: candidate.conceptId || matchingConcept?.id || null,
        conceptVersion,
        label,
        candidateCount: 0,
        pageCount: 0,
        current: Boolean(matchingConcept?.current)
      });
    }
    const group = groups.get(key);
    group.candidateCount += 1;
    group.pageCount += Number(candidate.pageCount || 0);
  }

  return Array.from(groups.values()).sort((left, right) => {
    const leftVersion = Number(left.conceptVersion) || Number.MAX_SAFE_INTEGER;
    const rightVersion = Number(right.conceptVersion) || Number.MAX_SAFE_INTEGER;
    return leftVersion - rightVersion || String(left.label || "").localeCompare(String(right.label || ""));
  });
}

async function buildWorksheetArtifactOverview(projectDir, documents = {}) {
  const index = await readArtifactIndex(projectDir);
  const concepts = await conceptArtifactsFromIndex(projectDir, index, documents);
  const candidates = await candidateArtifactsFromRuns(projectDir);
  const currentConcept = concepts.find((concept) => concept.current) || concepts[concepts.length - 1] || null;
  const candidateGroups = groupCandidatesByConcept(concepts, candidates);

  return {
    concepts,
    candidates,
    summary: {
      conceptCount: concepts.length,
      currentConceptId: currentConcept?.id || null,
      currentConceptVersion: currentConcept?.version || null,
      currentConceptLabel: currentConcept?.label || null,
      candidateCount: candidates.length,
      candidateGroups
    }
  };
}

async function buildWorksheetPreview({ repoRoot, projectDir, project }) {
  const rawCandidates = await previewFromAllCandidates({ repoRoot, projectDir });
  const projectWorksheets = await listProjectWorksheets(project.projectId || path.basename(projectDir), { repoRoot });
  const candidates = annotateCandidatesWithWorksheetDeposits(rawCandidates, projectWorksheets);
  const candidateSummary = summarizeCandidatePreview(candidates);

  if (candidateSummary.renderedCandidateCount > 0) {
    return {
      previewType: "candidates",
      title: project.title,
      pdfs: [],
      pages: [],
      candidates,
      previewMeta: candidateSummary
    };
  }

  return {
    previewType: "project_status",
    title: project.title,
    pdfs: [],
    pages: [],
    candidates: [],
    previewMeta: candidateSummary
  };
}

async function buildProjectDocuments(projectDir) {
  const manifest = await readJsonIfExists(path.join(projectDir, "project-manifest.json")) || {};
  const index = await readArtifactIndex(projectDir);
  const currentBriefArtifact = manifest.currentArtifacts?.lessonbriefId
    ? findArtifact(index, manifest.currentArtifacts.lessonbriefId)
    : currentArtifact(index, ARTIFACT_TYPES.LESSON_BRIEF);
  const currentContentArtifact = manifest.currentArtifacts?.contentMirrorId
    ? findArtifact(index, manifest.currentArtifacts.contentMirrorId)
    : currentArtifact(index, ARTIFACT_TYPES.CONTENT_MIRROR);
  const currentBrief = currentBriefArtifact?.path
    ? await readJsonIfExists(path.join(projectDir, currentBriefArtifact.path))
    : null;
  const currentContent = currentContentArtifact?.path
    ? await readJsonIfExists(path.join(projectDir, currentContentArtifact.path))
    : null;
  const draftBrief = await readJsonIfExists(path.join(projectDir, "brief", "draft.lessonbrief.json"));
  const approvedBrief = await readJsonIfExists(path.join(projectDir, "brief", "approved.lessonbrief.json"));
  const draftContent = await readJsonIfExists(path.join(projectDir, "content", "draft.content-mirror.json"));
  const approvedContent = await readJsonIfExists(path.join(projectDir, "content", "approved.content-mirror.json"));
  const sourceManifest = await readJsonIfExists(path.join(projectDir, "source", "source-manifest.json"));
  const transferCard = await readUtf8IfExists(path.join(projectDir, "source", "transfer-card.md"));
  const contentWarnings = await readJsonIfExists(path.join(projectDir, "qc", "content-warnings.json"));

  return {
    source: {
      manifest: sourceManifest,
      transferCard
    },
    brief: {
      status: currentBriefArtifact?.status || (approvedBrief ? "approved" : draftBrief ? "draft" : "missing"),
      data: currentBrief || approvedBrief || draftBrief
    },
    content: {
      status: currentContentArtifact?.status || (approvedContent ? "approved" : draftContent ? "draft" : "missing"),
      data: currentContent || approvedContent || draftContent
    },
    warnings: contentWarnings || null
  };
}

function chatInputMessagesFromEvents(events = []) {
  return events
    .filter((event) => event.type === EVENT_TYPES.USER_MESSAGE)
    .map((event) => ({
      id: event.id,
      role: "user",
      createdAt: event.createdAt,
      content: event.payload?.message || event.payload?.content || "",
      attachments: Array.isArray(event.payload?.attachments) ? event.payload.attachments : []
    }))
    .filter((message) => String(message.content || "").trim() || message.attachments.length);
}

async function buildBundlePreview({ repoRoot, projectDir, project }) {
  return {
    previewType: "project_status",
    title: project.title,
    pdfs: [],
    pages: [],
    candidates: [],
    previewMeta: {
      plannedCandidateCount: 0,
      renderedCandidateCount: 0,
      plannedCandidatePageCount: 0,
      renderedCandidatePageCount: 0,
      renderedCandidates: []
    }
  };
}

async function getLibraryItem(itemId, options = {}) {
  const repoRoot = options.repoRoot || DEFAULT_REPO_ROOT;
  const projectsDir = options.projectsDir || DEFAULT_PROJECTS_DIR;
  const match = String(itemId || "").match(/^project:(.+)$/);
  if (!match) {
    throw new Error(`Unsupported library item id: ${itemId}`);
  }

  const projectId = match[1];
  const projectDir = path.join(projectsDir, projectId);
  const project = await openProject(projectId, { projectsDir });
  const preview = project.projectType === "bundle"
    ? await buildBundlePreview({ repoRoot, projectDir, project })
    : await buildWorksheetPreview({ repoRoot, projectDir, project });
  const documents = await buildProjectDocuments(projectDir);
  const events = await readEvents(projectDir);
  const inputState = inputReadiness({
    source: documents.source || {},
    events
  });
  const artifacts = project.projectType === "bundle"
    ? null
    : await buildWorksheetArtifactOverview(projectDir, documents);

  return {
    id: itemId,
    type: "worksheet",
    project,
    documents,
    inputReadiness: inputState,
    chat: {
      messages: chatInputMessagesFromEvents(events)
    },
    preview,
    artifacts,
    actions: actionsForProject(project, preview.previewType)
  };
}

module.exports = {
  buildLibraryTree,
  createLibraryFolder,
  deleteLibraryFolder,
  getLibraryItem,
  moveLibraryItem,
  removeProjectFromLibrary,
  renameLibraryFolder,
  updateLibraryFolder
};
