"use strict";

const fs = require("node:fs/promises");
const path = require("node:path");
const {
  PRODUCTION_SCHEMA_VERSION,
  PROJECT_TYPES,
  SOURCE_TYPES
} = require("../contracts");
const {
  createEmptyArtifactIndex,
} = require("../artifactManager");
const { appendEvent, projectCreatedEvent } = require("../eventLog");
const { getProjectStatus, projectTypeOf } = require("../projectStatus");
const { initialStatusSnapshot } = require("../statusSnapshot");
const { readJsonFile, writeJsonFile } = require("../jsonFile");
const { normalizeLocale } = require("../locale");

const DEFAULT_PROJECTS_DIR = path.resolve(__dirname, "..", "..", "projects");

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

async function writeJson(filePath, value) {
  await writeJsonFile(filePath, value);
}

async function appendJsonl(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.appendFile(filePath, `${JSON.stringify(value)}\n`, "utf8");
}

function slugify(value) {
  return String(value || "untitled")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/ß/g, "ss")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "untitled";
}

async function uniqueProjectId(projectsDir, title) {
  const base = slugify(title);
  let candidate = base;
  let index = 2;
  while (await pathExists(path.join(projectsDir, candidate))) {
    candidate = `${base}-${index}`;
    index += 1;
  }
  return candidate;
}

async function ensureDirs(dirs) {
  for (const dir of dirs) {
    await fs.mkdir(dir, { recursive: true });
  }
}

function publicProject(manifest, projectDir, status) {
  const projectType = projectTypeOf(manifest);
  return {
    projectId: manifest.projectId || path.basename(projectDir),
    projectType,
    title: manifest.title || manifest.projectId || path.basename(projectDir),
    subject: manifest.subject || null,
    topic: manifest.topic || null,
    targetGroup: manifest.targetGroup || null,
    conversationLocale: manifest.conversationLocale || null,
    sourceType: status.sourceType || "production",
    isLegacy: Boolean(status.isLegacy),
    status: status.status,
    productStage: status.productStage || "input",
    errors: status.errors || 0,
    warnings: status.warnings || 0,
    previewState: status.previewState || "no_preview",
    candidateState: status.candidateState || "none",
    selectionState: "none",
    runCount: status.runCount || 0,
    hasApprovedContent: Boolean(status.hasApprovedContent),
    hasEffectiveApprovedContent: Boolean(status.hasEffectiveApprovedContent),
    hasDraftContent: Boolean(status.hasDraftContent),
    hasExport: false,
    candidateGeneration: status.candidateGeneration || {
      isRunning: false,
      activeJob: null,
      latestCompletion: null,
      latestFailure: null,
      hasUnreadCompletion: false
    },
    hasUnreadCandidateCompletion: Boolean(status.hasUnreadCandidateCompletion),
    updatedAt: manifest.updatedAt || null,
    createdAt: manifest.createdAt || null,
    path: projectDir
  };
}

function buildWorkspaceEntry(project, manifest, status) {
  const latestRun = status.latestRun || null;

  return {
    projectId: project.projectId,
    projectType: project.projectType,
    title: project.title,
    subject: project.subject,
    topic: project.topic,
    sourceType: status.sourceType || "production",
    isLegacy: Boolean(status.isLegacy),
    status: project.status,
    productStage: project.productStage || status.productStage || "input",
    previewState: status.previewState || "no_preview",
    approval: {
      lessonBrief: status.workflow?.brief || "missing",
      contentMirror: status.workflow?.content || "missing",
      canGenerate: Boolean(status.canGenerate),
      canGenerateSource: status.canGenerateSource || "unknown",
      contentState: status.approvalState || "missing",
      lessonBriefSource: status.briefApprovalSource || "none",
      contentMirrorSource: status.contentApprovalSource || "none"
    },
    availability: {
      hasDraftBrief: Boolean(status.hasDraftBrief),
      hasApprovedBrief: Boolean(status.hasApprovedBrief),
      hasEffectiveApprovedBrief: Boolean(status.hasEffectiveApprovedBrief),
      hasDraftContent: Boolean(status.hasDraftContent),
      hasApprovedContent: Boolean(status.hasApprovedContent),
      hasEffectiveApprovedContent: Boolean(status.hasEffectiveApprovedContent),
      hasExport: false,
      candidateState: status.candidateState || "none",
      candidateGeneration: status.candidateGeneration || {
        isRunning: false,
        activeJob: null,
        latestCompletion: null,
        latestFailure: null,
        hasUnreadCompletion: false
      },
      hasUnreadCandidateCompletion: Boolean(status.hasUnreadCandidateCompletion),
      selectionState: "none"
    },
    counts: {
      runCount: status.runCount || 0,
      warningCount: status.warnings || 0,
      errorCount: status.errors || 0,
      plannedCandidateCount: latestRun?.plannedCandidateCount || 0,
      renderedCandidateCount: latestRun?.renderedCandidateCount || 0,
      selectedPageCount: 0,
      exportFileCount: 0
    },
    latestRun: latestRun ? {
      runId: latestRun.runId,
      promptCount: latestRun.promptCount || 0,
      plannedCandidateCount: latestRun.plannedCandidateCount || 0,
      renderedCandidateCount: latestRun.renderedCandidateCount || 0,
      fullyRenderedCandidateCount: latestRun.fullyRenderedCandidateCount || 0,
      plannedCandidatePageCount: latestRun.plannedCandidatePageCount || 0,
      renderedCandidatePageCount: latestRun.renderedCandidatePageCount || 0,
      selectedCandidate: null,
      selectedPageCount: 0,
      selectedPagePlanCount: 0,
      selectionStatus: null
    } : null,
    loadIntent: "open_worksheet_workspace",
    manifestPointers: {
      projectManifest: "project-manifest.json",
      draftBrief: "brief/draft.lessonbrief.json",
      approvedBrief: "brief/approved.lessonbrief.json",
      draftContent: "content/draft.content-mirror.json",
      approvedContent: "content/approved.content-mirror.json"
    },
    updatedAt: manifest.updatedAt || null
  };
}

async function readProjectManifest(projectDir) {
  return readJson(path.join(projectDir, "project-manifest.json"));
}

async function listProjects(options = {}) {
  const projectsDir = options.projectsDir || DEFAULT_PROJECTS_DIR;
  if (!(await pathExists(projectsDir))) {
    return [];
  }

  const entries = await fs.readdir(projectsDir, { withFileTypes: true });
  const projects = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }
    const projectDir = path.join(projectsDir, entry.name);
    const manifestPath = path.join(projectDir, "project-manifest.json");
    if (!(await pathExists(manifestPath))) {
      continue;
    }
    const manifest = await readJson(manifestPath);
    const status = await getProjectStatus(projectDir);
    projects.push(publicProject(manifest, projectDir, status));
  }

  return projects.sort((left, right) => {
    const leftTime = left.updatedAt || left.createdAt || "";
    const rightTime = right.updatedAt || right.createdAt || "";
    return rightTime.localeCompare(leftTime) || left.title.localeCompare(right.title);
  });
}

async function openProject(projectId, options = {}) {
  const projectsDir = options.projectsDir || DEFAULT_PROJECTS_DIR;
  const projectDir = path.join(projectsDir, projectId);
  const manifest = await readProjectManifest(projectDir);
  const status = await getProjectStatus(projectDir);
  const project = publicProject(manifest, projectDir, status);
  return {
    ...project,
    manifest,
    derivedStatus: status,
    workspaceEntry: buildWorkspaceEntry(project, manifest, status)
  };
}

async function createSingleWorksheetProject(input = {}, options = {}) {
  const projectsDir = options.projectsDir || DEFAULT_PROJECTS_DIR;
  const now = options.now || new Date().toISOString();
  const title = String(input.title || "").trim();
  if (!title) {
    throw new Error("title is required");
  }

  const projectId = input.projectId ? slugify(input.projectId) : await uniqueProjectId(projectsDir, title);
  const projectDir = path.join(projectsDir, projectId);
  if (await pathExists(projectDir)) {
    throw new Error(`Project already exists: ${projectId}`);
  }

  await ensureDirs([
    path.join(projectDir, "source", "uploads"),
    path.join(projectDir, "source", "references"),
    path.join(projectDir, "source", "notes"),
    path.join(projectDir, "brief"),
    path.join(projectDir, "content"),
    path.join(projectDir, "runs"),
    path.join(projectDir, "proposals"),
    path.join(projectDir, "history"),
    path.join(projectDir, "qc")
  ]);

  const manifest = {
    schemaVersion: PRODUCTION_SCHEMA_VERSION,
    projectId,
    ownerPassId: options.ownerPassId || null,
    projectType: PROJECT_TYPES.SINGLE_WORKSHEET,
    sourceType: SOURCE_TYPES.PRODUCTION,
    title,
    subject: input.subject || null,
    topic: input.topic || null,
    targetGroup: input.targetGroup || null,
    conversationLocale: normalizeLocale(input.conversationLocale),
    status: "draft",
    createdAt: now,
    updatedAt: now,
    currentArtifacts: {},
    approval: {
      lessonBrief: "missing",
      contentMirror: "missing",
      canGenerate: false,
      reason: "No approved.content-mirror.json exists."
    }
  };

  await writeJson(path.join(projectDir, "project-manifest.json"), manifest);
  await writeJson(path.join(projectDir, "artifact-index.json"), createEmptyArtifactIndex(now));
  await writeJson(path.join(projectDir, "status-snapshot.json"), initialStatusSnapshot({
    now,
    projectType: PROJECT_TYPES.SINGLE_WORKSHEET
  }));
  await writeJson(path.join(projectDir, "qc", "content-warnings.json"), {
    schemaVersion: PRODUCTION_SCHEMA_VERSION,
    warnings: []
  });
  await appendEvent(projectDir, projectCreatedEvent({
    now,
    projectId,
    projectType: PROJECT_TYPES.SINGLE_WORKSHEET,
    title
  }));
  await appendJsonl(path.join(projectDir, "history", "worksheet-history.jsonl"), {
    type: "project_created",
    projectType: PROJECT_TYPES.SINGLE_WORKSHEET,
    createdAt: now,
    projectId,
    title
  });

  return openProject(projectId, { projectsDir });
}

async function updateProjectManifest(projectId, patch = {}, options = {}) {
  const projectsDir = options.projectsDir || DEFAULT_PROJECTS_DIR;
  const projectDir = path.join(projectsDir, projectId);
  const manifestPath = path.join(projectDir, "project-manifest.json");
  const manifest = await readJson(manifestPath);
  const nextManifest = {
    ...manifest,
    ...patch,
    projectId: manifest.projectId,
    projectType: manifest.projectType,
    kind: manifest.kind,
    updatedAt: options.now || new Date().toISOString()
  };
  await writeJson(manifestPath, nextManifest);
  return openProject(projectId, { projectsDir });
}

async function renameProject(projectId, title, options = {}) {
  const nextTitle = String(title || "").trim();
  if (!nextTitle) {
    throw new Error("title is required");
  }
  return updateProjectManifest(projectId, { title: nextTitle }, options);
}

async function deleteProject(projectId, options = {}) {
  const projectsDir = options.projectsDir || DEFAULT_PROJECTS_DIR;
  const projectDir = path.join(projectsDir, projectId);
  if (!(await pathExists(path.join(projectDir, "project-manifest.json")))) {
    throw new Error(`Project does not exist: ${projectId}`);
  }
  await fs.rm(projectDir, { recursive: true, force: false });
  return {
    projectId,
    deleted: true
  };
}

module.exports = {
  DEFAULT_PROJECTS_DIR,
  createSingleWorksheetProject,
  deleteProject,
  listProjects,
  openProject,
  readProjectManifest,
  renameProject,
  updateProjectManifest
};
