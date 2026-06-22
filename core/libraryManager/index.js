"use strict";

const fs = require("node:fs/promises");
const path = require("node:path");
const { listProjects, openProject } = require("../projectManager");
const { normalizeConceptReference } = require("../conceptReference");

const DEFAULT_REPO_ROOT = path.resolve(__dirname, "..", "..");
const DEFAULT_PROJECTS_DIR = path.join(DEFAULT_REPO_ROOT, "projects");
const LIBRARY_STATE_FILE = "library-state.json";
const LIBRARY_STATE_SCHEMA_VERSION = "sheetifyimg.library-state.v1";
const ROOT_FOLDERS = [
  { id: "folder:work-in-progress", label: "Work in Progress" },
  { id: "folder:finished-single-worksheets", label: "Fertige Einzelblätter" },
  { id: "folder:series", label: "Reihen" }
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
  if (!(await pathExists(filePath))) {
    return null;
  }
  return JSON.parse(await fs.readFile(filePath, "utf8"));
}

async function writeJson(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
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

async function listFilesRecursive(dirPath) {
  if (!(await pathExists(dirPath))) {
    return [];
  }

  const files = [];
  async function walk(current) {
    const entries = await fs.readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        await walk(fullPath);
      } else {
        files.push(fullPath);
      }
    }
  }
  await walk(dirPath);
  return files.sort();
}

function toPosix(value) {
  return String(value).split(path.sep).join("/");
}

function assetUrl(repoRoot, filePath) {
  return `/files/${encodeURI(toPosix(path.relative(repoRoot, filePath)))}`;
}

function projectToTreeItem(project, previewType = "project_status") {
  const type = project.projectType === "series" || project.projectType === "bundle" ? "series" : "worksheet";
  return {
    id: `project:${project.projectId}`,
    type,
    label: project.title,
    projectId: project.projectId,
    status: project.status,
    productStage: project.productStage || "input",
    previewType,
    warnings: project.warnings,
    errors: project.errors,
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
  const actions = ["open", "preview", "show_in_finder"];
  if (project.projectType === "single_worksheet") {
    actions.push("copy_content_mirror");
  }
  if (project.projectType === "series" || project.projectType === "bundle") {
    actions.push("copy_series_context");
  }
  if (project.status === "selected" || project.status === "exported" || previewType === "selected_pages" || previewType === "pdf") {
    actions.push("export_pdf");
  }
  return actions;
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

function createEmptyLibraryState(now = new Date().toISOString()) {
  return {
    schemaVersion: LIBRARY_STATE_SCHEMA_VERSION,
    updatedAt: now,
    rootChildren: Object.fromEntries(ROOT_FOLDERS.map((folder) => [folder.id, []])),
    folders: {}
  };
}

function libraryStatePath(projectsDir) {
  return path.join(projectsDir, LIBRARY_STATE_FILE);
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
  state.folders = state.folders && typeof state.folders === "object" ? state.folders : {};
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

function defaultRootIdForProject(project) {
  if (project.projectType === "series" || project.projectType === "bundle") {
    return "folder:series";
  }
  if (project.status === "exported") {
    return "folder:finished-single-worksheets";
  }
  return "folder:work-in-progress";
}

function customFolderToTreeFolder(folder) {
  return {
    id: folder.id,
    type: "folder",
    label: folder.label,
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
      state.rootChildren["folder:work-in-progress"].push(folderId);
      state.folders[folderId].parentId = "folder:work-in-progress";
    }
  }
}

async function buildProjectTreeItems(projects, options = {}) {
  const repoRoot = options.repoRoot || DEFAULT_REPO_ROOT;
  const projectsDir = options.projectsDir || DEFAULT_PROJECTS_DIR;
  const items = new Map();
  for (const project of projects) {
    const projectDir = path.join(projectsDir, project.projectId);
    const preview = project.projectType === "bundle" || project.projectType === "series"
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
      label: "SheetifyIMG Search",
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
  cleanLibraryState(libraryState, [...projectItems.keys()]);
  appendMissingProjectsToState(libraryState, projects);
  await writeLibraryState(libraryState, { projectsDir });

  return {
    id: "library:root",
    type: "root",
    label: "SheetifyIMG Library",
    children: inflateLibraryTree(libraryState, projectItems)
  };
}

async function createLibraryFolder(input = {}, options = {}) {
  const projectsDir = options.projectsDir || DEFAULT_PROJECTS_DIR;
  const state = await readLibraryState({ projectsDir });
  const parentId = input.parentId || "folder:work-in-progress";
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
    children: []
  };
  folderRecord(state, parentId).children.push(folderId);
  await writeLibraryState(state, { projectsDir });
  return state.folders[folderId];
}

async function renameLibraryFolder(folderId, label, options = {}) {
  const projectsDir = options.projectsDir || DEFAULT_PROJECTS_DIR;
  if (ROOT_FOLDERS.some((folder) => folder.id === folderId)) {
    throw new Error("Dieser Hauptordner kann nicht umbenannt werden.");
  }
  const state = await readLibraryState({ projectsDir });
  const folder = state.folders[folderId];
  const nextLabel = String(label || "").trim();
  if (!folder) {
    throw new Error("Ordner wurde nicht gefunden.");
  }
  if (!nextLabel) {
    throw new Error("Ordnername ist erforderlich.");
  }
  folder.label = nextLabel;
  await writeLibraryState(state, { projectsDir });
  return folder;
}

async function deleteLibraryFolder(folderId, options = {}) {
  const projectsDir = options.projectsDir || DEFAULT_PROJECTS_DIR;
  if (ROOT_FOLDERS.some((folder) => folder.id === folderId)) {
    throw new Error("Dieser Hauptordner kann nicht geloescht werden.");
  }
  const state = await readLibraryState({ projectsDir });
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
  const state = await readLibraryState({ projectsDir });
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
  const state = await readLibraryState({ projectsDir });
  removeItemFromLibraryState(state, `project:${projectId}`);
  await writeLibraryState(state, { projectsDir });
}

async function findLatestRun(projectDir) {
  const runDirs = await listDirs(path.join(projectDir, "runs"));
  if (runDirs.length === 0) {
    return null;
  }
  return runDirs[runDirs.length - 1];
}

async function previewFromSelection({ repoRoot, runDir }) {
  const selection = await readJsonIfExists(path.join(runDir, "selected", "selection.json"));
  const pages = Array.isArray(selection?.pages) ? selection.pages : [];
  const existingPages = [];

  for (const page of pages) {
    if (!page.selectedPath) {
      continue;
    }
    const filePath = path.join(runDir, page.selectedPath);
    if (await pathExists(filePath)) {
      existingPages.push({
        page: page.page,
        role: page.role,
        sourceCandidateId: page.sourceCandidateId || null,
        source: "selected",
        path: toPosix(path.relative(repoRoot, filePath)),
        url: assetUrl(repoRoot, filePath)
      });
    }
  }

  return existingPages;
}

async function previewFromCandidates({ repoRoot, runDir }) {
  const manifest = await readJsonIfExists(path.join(runDir, "run-manifest.json"));
  const runId = manifest?.runId || path.basename(runDir);
  const candidates = [];

  for (const candidate of manifest?.candidates || []) {
    const concept = normalizeConceptReference(candidate.concept || manifest.concept || {}, manifest.sourceArtifacts || {});
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
    const pdfFilePath = candidate.pdf?.path ? path.join(runDir, candidate.pdf.path) : null;
    const pdfAvailable = pdfFilePath ? await pathExists(pdfFilePath) : false;
    candidates.push({
      id: candidate.id,
      runId,
      status: candidate.status,
      concept,
      basedOnConceptId: candidate.basedOnConceptId || concept.conceptId,
      basedOnConceptVersion: candidate.basedOnConceptVersion || concept.conceptVersion,
      generation: candidate.generation || null,
      notes: Array.isArray(candidate.notes) ? candidate.notes : [],
      pdf: candidate.pdf ? {
        ...candidate.pdf,
        runPath: candidate.pdf.path || null,
        path: pdfFilePath ? toPosix(path.relative(repoRoot, pdfFilePath)) : candidate.pdf.path || null,
        url: pdfAvailable ? assetUrl(repoRoot, pdfFilePath) : null,
        missing: Boolean(candidate.pdf.path && !pdfAvailable)
      } : null,
      pages
    });
  }

  return candidates;
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

async function findProjectPdfs({ repoRoot, projectDir }) {
  const knownPaths = new Set();
  const manifestPdfs = [];
  for (const exportDir of await listDirs(path.join(projectDir, "export"))) {
    const manifest = await readJsonIfExists(path.join(exportDir, "export-manifest.json"));
    const pdfPath = manifest?.pdf?.path || null;
    if (!pdfPath) {
      continue;
    }
    const filePath = path.join(projectDir, pdfPath);
    if (!(await pathExists(filePath))) {
      continue;
    }
    knownPaths.add(filePath);
    manifestPdfs.push({
      path: toPosix(path.relative(repoRoot, filePath)),
      url: assetUrl(repoRoot, filePath),
      exportId: manifest.exportId || path.basename(exportDir),
      createdAt: manifest.createdAt || null,
      pageCount: manifest.pdf?.pageCount || manifest.pages?.length || null,
      solutionSheet: manifest.solutionSheet || null,
      selectedCandidate: manifest.selectedCandidate || null,
      basedOnCandidateId: manifest.basedOnCandidateId || null,
      basedOnConceptId: manifest.basedOnConceptId || null,
      basedOnConceptVersion: manifest.basedOnConceptVersion || null,
      concept: normalizeConceptReference(manifest.concept || {}, {
        conceptId: manifest.basedOnConceptId || null,
        conceptVersion: manifest.basedOnConceptVersion || null
      })
    });
  }

  if (manifestPdfs.length > 0) {
    return manifestPdfs.sort((left, right) => {
      const leftTime = left.createdAt || "";
      const rightTime = right.createdAt || "";
      return rightTime.localeCompare(leftTime) || String(right.exportId || "").localeCompare(String(left.exportId || ""));
    }).slice(0, 1);
  }

  const files = await listFilesRecursive(path.join(projectDir, "export"));
  const filePdfs = files
    .filter((filePath) => /\.pdf$/i.test(filePath))
    .filter((filePath) => !knownPaths.has(filePath))
    .map((filePath) => ({
      path: toPosix(path.relative(repoRoot, filePath)),
      url: assetUrl(repoRoot, filePath)
    }));
  return [...manifestPdfs, ...filePdfs];
}

async function buildWorksheetPreview({ repoRoot, projectDir, project }) {
  const runDir = await findLatestRun(projectDir);
  const pdfs = await findProjectPdfs({ repoRoot, projectDir });
  const selectedPages = runDir ? await previewFromSelection({ repoRoot, runDir }) : [];
  const candidates = runDir ? await previewFromCandidates({ repoRoot, runDir }) : [];
  const candidateSummary = summarizeCandidatePreview(candidates);

  if (pdfs.length > 0) {
    return {
      previewType: "pdf",
      title: project.title,
      pdfs,
      pages: selectedPages,
      candidates,
      previewMeta: candidateSummary
    };
  }

  if (selectedPages.length > 0) {
    return {
      previewType: "selected_pages",
      title: project.title,
      pdfs: [],
      pages: selectedPages,
      candidates,
      previewMeta: candidateSummary
    };
  }

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
      status: approvedBrief ? "approved" : draftBrief ? "draft" : "missing",
      data: approvedBrief || draftBrief
    },
    content: {
      status: approvedContent ? "approved" : draftContent ? "draft" : "missing",
      data: approvedContent || draftContent
    },
    warnings: contentWarnings || null
  };
}

async function buildBundlePreview({ repoRoot, projectDir, project }) {
  const pdfs = await findProjectPdfs({ repoRoot, projectDir });
  return {
    previewType: pdfs.length > 0 ? "pdf" : "project_status",
    title: project.title,
    pdfs,
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
  const preview = project.projectType === "bundle" || project.projectType === "series"
    ? await buildBundlePreview({ repoRoot, projectDir, project })
    : await buildWorksheetPreview({ repoRoot, projectDir, project });

  return {
    id: itemId,
    type: project.projectType === "bundle" ? "series" : project.projectType,
    project,
    documents: await buildProjectDocuments(projectDir),
    preview,
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
  renameLibraryFolder
};
