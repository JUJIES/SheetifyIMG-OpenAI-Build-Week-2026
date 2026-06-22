"use strict";

const fs = require("node:fs/promises");
const path = require("node:path");
const { ARTIFACT_STATUSES, ARTIFACT_TYPES, PROJECT_TYPES } = require("../contracts");
const {
  findArtifact,
  listArtifacts,
  readArtifactIndex
} = require("../artifactManager");
const { approveLessonBriefVersion, createLessonBriefVersion } = require("../briefManager");
const { approveContentMirrorVersion, createContentMirrorVersion } = require("../contentMirrorManager");
const { PROPOSAL_KINDS, adoptProposal, generateProposal } = require("../aiProposalManager");
const { prepareWorksheetExport } = require("../exportManager");
const { generateImageCandidate } = require("../imageGenerationManager");
const { openProject } = require("../projectManager");
const { prepareReferenceAsset, prepareWebReferenceAsset } = require("../referenceAssetManager");
const { createRun } = require("../runManager");
const { selectCandidate } = require("../selectionManager");
const { prepareSeriesExport } = require("../seriesExportManager");
const { buildCopyContext, buildWorkspace } = require("../workspaceManager");
const { readEvents } = require("../eventLog");
const { requestedConstraints } = require("../contentReadiness");
const { refreshStatusSnapshot } = require("../statusSnapshot");

const DEFAULT_REPO_ROOT = path.resolve(__dirname, "..", "..");
const DEFAULT_PROJECTS_DIR = path.join(DEFAULT_REPO_ROOT, "projects");

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

async function readProposalById(projectDir, proposalId) {
  if (!proposalId) {
    return null;
  }
  const proposalsDir = path.join(projectDir, "proposals");
  if (!(await pathExists(proposalsDir))) {
    return null;
  }
  const files = await fs.readdir(proposalsDir);
  const fileName = files.find((entry) => entry.startsWith(`${proposalId}.`) && entry.endsWith(".json"));
  return fileName ? readJson(path.join(proposalsDir, fileName)) : null;
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

function projectDirFor(projectId, options = {}) {
  const projectsDir = options.projectsDir || DEFAULT_PROJECTS_DIR;
  return path.join(projectsDir, projectId);
}

async function currentOrLatestArtifact(projectDir, fieldName, type, preferredStatus = null) {
  const manifest = await readJson(path.join(projectDir, "project-manifest.json"));
  const index = await readArtifactIndex(projectDir);
  const currentId = manifest.currentArtifacts?.[fieldName] || null;
  const current = currentId ? findArtifact(index, currentId) : null;
  if (current && (!preferredStatus || current.status === preferredStatus)) {
    return current;
  }
  const matches = listArtifacts(index, {
    type,
    ...(preferredStatus ? { status: preferredStatus } : {})
  }).sort((left, right) => (Number(right.version) || 0) - (Number(left.version) || 0));
  return matches[0] || current || null;
}

async function latestRunId(projectDir) {
  const runDirs = await listDirs(path.join(projectDir, "runs"));
  if (runDirs.length === 0) {
    return null;
  }
  const runDir = runDirs[runDirs.length - 1];
  const manifest = await readJson(path.join(runDir, "run-manifest.json"));
  return manifest.runId || path.basename(runDir);
}

async function latestRunManifest(projectDir, runId = null) {
  const id = runId || await latestRunId(projectDir);
  if (!id) {
    return null;
  }
  return readJson(path.join(projectDir, "runs", id, "run-manifest.json"));
}

async function ensureImageSpecForCandidate(projectId, payload, input, options) {
  if (payload.imageSpecProposalId) {
    return payload;
  }
  const proposal = await generateProposal(projectId, PROPOSAL_KINDS.IMAGE_SPEC, {
    ...payload,
    message: payload.message || input.message || "Leite die interne ImageSpec aus dem freigegebenen Arbeitsblatt-Konzept ab.",
    uiEvent: payload.uiEvent || input.uiEvent || "generate_image",
    canvasFocus: payload.canvasFocus || input.canvasFocus || null,
    silent: true,
    now: options.now
  }, options);
  await adoptProposal(projectId, PROPOSAL_KINDS.IMAGE_SPEC, {
    payload: {
      proposalId: proposal.proposal.proposalId
    },
    silent: true,
    now: options.now
  }, options);
  return {
    ...payload,
    imageSpecProposalId: proposal.proposal.proposalId
  };
}

async function generateCompleteConceptProposal(projectId, payload, input, options) {
  const sharedInput = {
    ...payload,
    message: payload.message || input.message || "Formuliere ein vollständiges Arbeitsblatt-Konzept mit Text, Aufgaben und Bildidee.",
    now: options.now
  };
  const lesson = await generateProposal(projectId, PROPOSAL_KINDS.LESSON_BRIEF, {
    ...sharedInput,
    silent: true
  }, options);
  await adoptProposal(projectId, PROPOSAL_KINDS.LESSON_BRIEF, {
    payload: {
      proposalId: lesson.proposal.proposalId
    },
    silent: true,
    now: options.now
  }, options);
  return generateProposal(projectId, PROPOSAL_KINDS.CONTENT_MIRROR, {
    ...sharedInput,
    message: payload.message || input.message || "Formuliere daraus jetzt das vollständige sichtbare Arbeitsblatt-Konzept.",
    silent: false
  }, options);
}

function defaultBrief(project, payload = {}) {
  return {
    subject: payload.subject || project.subject || null,
    topic: payload.topic || project.topic || project.title,
    targetGroup: payload.targetGroup || project.manifest?.targetGroup || null,
    goal: payload.goal || "Unterrichtsmaterial sauber als Bild-Arbeitsblatt vorbereiten.",
    requirements: payload.requirements || [],
    outputPreference: {
      format: "A4",
      pages: payload.pages || 1,
      layout: "auto",
      style: "klar"
    }
  };
}

function normalizedText(value) {
  return String(value || "")
    .toLowerCase()
    .replaceAll("ä", "ae")
    .replaceAll("ö", "oe")
    .replaceAll("ü", "ue")
    .replaceAll("ß", "ss");
}

function contextText(project = {}, brief = {}, events = []) {
  return normalizedText([
    project.title,
    project.subject,
    project.topic,
    project.manifest?.targetGroup,
    brief.subject,
    brief.topic,
    brief.targetGroup,
    brief.goal,
    ...(brief.requirements || []),
    brief.outputPreference?.layout,
    brief.outputPreference?.style,
    ...(events || []).filter((event) => event.type === "user_message").map((event) => event.payload?.message)
  ].filter(Boolean).join("\n"));
}

function isReadingWorksheet(project = {}, brief = {}, events = []) {
  const text = contextText(project, brief, events);
  return /\b(leseblatt|leseseite|lesetext|leseverstaendnis|leseverstandnis|lesen|sachtext)\b/.test(text);
}

function defaultReadingText(topic, brief = {}) {
  const target = brief.targetGroup ? ` für ${brief.targetGroup}` : "";
  return [
    `${topic} ist ein spannendes Thema${target}.`,
    "Der Text erklärt die wichtigsten Informationen in kurzen, gut lesbaren Sätzen.",
    "Die Kinder können danach zentrale Informationen wiederfinden und einfache Fragen beantworten."
  ].join(" ");
}

function readingTaskTemplates(topic) {
  return [
    {
      prompt: `Kreuze an: Welche Aussage passt zum Text über ${topic}?`,
      expectedAnswer: "Die richtige Aussage wird aus dem Lesetext entnommen."
    },
    {
      prompt: `Richtig oder falsch? Prüfe drei Aussagen zum Text über ${topic}.`,
      expectedAnswer: "Die Antworten werden direkt mit Informationen aus dem Text begründet."
    },
    {
      prompt: `Verbinde passende Wörter oder Satzteile aus dem Text zu ${topic}.`,
      expectedAnswer: "Zusammengehörige Informationen werden richtig zugeordnet."
    },
    {
      prompt: `Beantworte kurz: Was erfährst du im Text über ${topic}?`,
      expectedAnswer: "Die Antwort nennt eine wichtige Information aus dem Lesetext."
    },
    {
      prompt: `Markiere oder male: Welche Stelle im Text findest du besonders interessant?`,
      expectedAnswer: "Die Auswahl passt zum Text und kann kurz erklärt werden."
    },
    {
      prompt: `Schreibe einen Satz: Das habe ich über ${topic} gelernt.`,
      expectedAnswer: "Der Satz nennt eine passende Information aus dem Text."
    }
  ];
}

function defaultTasksForConcept(project, brief = {}, payload = {}, events = []) {
  const constraints = requestedConstraints({ events, brief });
  const requestedCount = constraints.exactTasks || constraints.minTasks || (constraints.mentionsAfb ? 3 : 1);
  const taskCount = Math.max(1, Math.min(Number(payload.taskCount) || requestedCount, 8));
  const topic = brief.topic || project.topic || project.title;
  const templates = isReadingWorksheet(project, brief, events) ? readingTaskTemplates(topic) : [
    {
      prompt: `Beschreibe die wichtigsten Beobachtungen zum Material "${topic}".`,
      expectedAnswer: "Die Antwort nennt zentrale sichtbare Merkmale aus dem Material sachlich und genau."
    },
    {
      prompt: `Erklaere den biologischen Zusammenhang von ${topic}.`,
      expectedAnswer: "Die Antwort verbindet Beobachtung und Fachbegriff in einer nachvollziehbaren Erklaerung."
    },
    {
      prompt: `Deute ${topic} als fachlichen Hinweis und begruende deine Einschaetzung.`,
      expectedAnswer: "Die Antwort nutzt die Fachbegriffe und begruendet die Deutung mit Bezug auf das Material."
    },
    {
      prompt: `Bewerte, welche Aussagekraft das Material zu ${topic} hat und wo Grenzen liegen.`,
      expectedAnswer: "Die Antwort nennt eine sinnvolle Aussage und eine fachliche Grenze der Deutung."
    }
  ];
  while (templates.length < taskCount) {
    templates.push({
      prompt: `Bearbeite eine weitere passende Aufgabe zum Text über ${topic}.`,
      expectedAnswer: "Die Antwort nutzt eine Information aus dem Text."
    });
  }
  return templates.slice(0, taskCount).map((task, index) => ({
    id: `task_${index + 1}`,
    prompt: task.prompt,
    expectedAnswer: task.expectedAnswer,
    materialRefs: ["material_1"],
    difficulty: index === 0 ? "AFB I" : index === 1 ? "AFB II" : "AFB III"
  }));
}

function defaultContent(project, payload = {}, brief = {}, events = []) {
  const topic = brief.topic || project.topic || project.title;
  const constraints = requestedConstraints({ events, brief });
  const tasks = defaultTasksForConcept(project, brief, payload, events);
  const readingWorksheet = isReadingWorksheet(project, brief, events);
  return {
    title: payload.title || project.title,
    readingTexts: payload.readingTexts || [{
      id: "text_1",
      title: readingWorksheet ? "Lesetext" : "Material",
      body: brief.goal || (readingWorksheet ? defaultReadingText(topic, brief) : `Kurzer Materialimpuls zu ${topic}.`)
    }],
    tasks: payload.tasks || tasks,
    imageMaterials: payload.imageMaterials || [{
      id: "material_1",
      prompt: readingWorksheet
        ? `Freundliche, motivierende Bilder zu ${topic}, passend zu einem kindgerechten Leseblatt.`
        : `Sachliche, ruhige A4-Arbeitsblatt-Abbildung zu ${topic}, passend zum bestaetigten Arbeitsblatt-Konzept.`,
      purpose: readingWorksheet ? "Bilder motivieren zum Lesen und unterstützen das Textverständnis." : "Material fuer die Aufgaben",
      placement: readingWorksheet ? "auf der Leseseite und dezent auf der Aufgabenseite" : "zentral auf der Arbeitsblattseite"
    }],
    solutionNotes: payload.solutionNotes || (constraints.requiresSolution || constraints.mentionsAfb
      ? tasks.map((task) => `${task.id}: ${task.expectedAnswer}`)
      : [])
  };
}

async function approveCurrentBrief(projectDir, options = {}) {
  const artifact = await currentOrLatestArtifact(
    projectDir,
    "lessonbriefId",
    ARTIFACT_TYPES.LESSON_BRIEF,
    ARTIFACT_STATUSES.DRAFT
  );
  if (!artifact) {
    throw new Error("No draft lesson brief exists.");
  }
  return approveLessonBriefVersion(projectDir, artifact.id, options);
}

async function approveCurrentContent(projectDir, options = {}) {
  const artifact = await currentOrLatestArtifact(
    projectDir,
    "contentMirrorId",
    ARTIFACT_TYPES.CONTENT_MIRROR,
    ARTIFACT_STATUSES.DRAFT
  );
  if (!artifact) {
    throw new Error("No draft content mirror exists.");
  }
  return approveContentMirrorVersion(projectDir, artifact.id, options);
}

async function selectDefaultCandidate(projectDir, payload = {}, options = {}) {
  const runId = payload.runId || await latestRunId(projectDir);
  if (!runId) {
    throw new Error("No run exists.");
  }
  const manifest = await latestRunManifest(projectDir, runId);
  const projectManifest = await readJson(path.join(projectDir, "project-manifest.json"));
  const currentContentMirrorId = projectManifest.currentArtifacts?.contentMirrorId || null;
  const candidate = payload.candidateId
    ? (manifest.candidates || []).find((entry) => entry.id === payload.candidateId)
    : (manifest.candidates || []).find((entry) => (entry.pages || []).length > 0);
  if (!candidate) {
    throw new Error("No selectable candidate exists.");
  }
  const candidateContentMirrorId = candidate.sourceArtifacts?.contentMirrorId || manifest.sourceArtifacts?.contentMirrorId || null;
  if (currentContentMirrorId && candidateContentMirrorId && candidateContentMirrorId !== currentContentMirrorId) {
    throw new Error("Dieser Kandidat gehört zu einem älteren Konzeptstand. Erzeuge zuerst einen neuen Kandidaten aus dem aktuellen Konzept.");
  }
  return selectCandidate({
    projectDir,
    runId,
    candidateId: candidate.id,
    pages: payload.pages,
    merge: payload.merge === true,
    now: options.now
  });
}

async function assertProposalMatchesCurrentState(projectDir, proposalId, kind) {
  const proposal = await readProposalById(projectDir, proposalId);
  if (!proposal) {
    return;
  }
  const manifest = await readJson(path.join(projectDir, "project-manifest.json"));
  if (proposal.kind !== kind) {
    throw new Error(`Proposal ${proposalId} is ${proposal.kind}, not ${kind}.`);
  }
  if (kind === PROPOSAL_KINDS.CONTENT_MIRROR) {
    const sourceBriefId = proposal.source?.currentLessonBriefId || null;
    const currentBriefId = manifest.currentArtifacts?.lessonbriefId || null;
    if (sourceBriefId && currentBriefId && sourceBriefId !== currentBriefId) {
      throw new Error("Dieser Konzeptvorschlag gehört zu einem älteren Planungsstand. Bitte den aktuellen Vorschlag verwenden.");
    }
  }
  if (kind === PROPOSAL_KINDS.IMAGE_SPEC) {
    const sourceContentId = proposal.source?.currentContentMirrorId || null;
    const currentContentId = manifest.currentArtifacts?.contentMirrorId || null;
    if (sourceContentId && currentContentId && sourceContentId !== currentContentId) {
      throw new Error("Diese Kandidatenvorbereitung gehört zu einem älteren Konzeptstand. Bitte aus dem aktuellen Konzept neu vorbereiten.");
    }
  }
}

async function prepareLatestExport(projectDir, payload = {}, options = {}) {
  const runId = payload.runId || await latestRunId(projectDir);
  if (!runId) {
    throw new Error("No run exists.");
  }
  return prepareWorksheetExport(projectDir, runId, {
    ...options,
    includeSolutionSheet: payload.includeSolutionSheet === true
  });
}

async function runWorkspaceCommand(projectId, input = {}, options = {}) {
  const repoRoot = options.repoRoot || DEFAULT_REPO_ROOT;
  const projectsDir = options.projectsDir || DEFAULT_PROJECTS_DIR;
  const projectDir = projectDirFor(projectId, { projectsDir });
  const project = await openProject(projectId, { projectsDir });
  const command = input.command || input.id;
  const payload = input.payload || {};
  const nowOptions = {
    ...options,
    now: input.now || options.now || new Date().toISOString()
  };

  let result;
  if (command === "copy_context") {
    result = await buildCopyContext(projectId, {
      repoRoot,
      projectsDir,
      worksheetIds: payload.worksheetIds || []
    });
  } else if (project.projectType === PROJECT_TYPES.SERIES) {
    if (command !== "prepare_series_export") {
      throw new Error(`Unsupported series command: ${command}`);
    }
    result = await prepareSeriesExport(projectDir, nowOptions);
  } else if (command === "generate_lessonbrief_proposal") {
    if (payload.completeConcept === true) {
      result = await generateCompleteConceptProposal(projectId, payload, input, {
        repoRoot,
        projectsDir,
        now: nowOptions.now
      });
    } else {
      result = await generateProposal(projectId, PROPOSAL_KINDS.LESSON_BRIEF, {
        ...payload,
        message: payload.message || input.message,
        now: nowOptions.now
      }, {
        repoRoot,
        projectsDir,
        now: nowOptions.now
      });
    }
  } else if (command === "adopt_lessonbrief_proposal") {
    result = await adoptProposal(projectId, PROPOSAL_KINDS.LESSON_BRIEF, {
      payload,
      silent: payload.silent === true || input.silent === true,
      now: nowOptions.now
    }, {
      repoRoot,
      projectsDir,
      now: nowOptions.now
    });
  } else if (command === "generate_content_mirror_proposal") {
    result = await generateProposal(projectId, PROPOSAL_KINDS.CONTENT_MIRROR, {
      ...payload,
      message: payload.message || input.message,
      now: nowOptions.now
    }, {
      repoRoot,
      projectsDir,
      now: nowOptions.now
    });
  } else if (command === "adopt_content_mirror_proposal") {
    await assertProposalMatchesCurrentState(projectDir, payload.proposalId, PROPOSAL_KINDS.CONTENT_MIRROR);
    result = await adoptProposal(projectId, PROPOSAL_KINDS.CONTENT_MIRROR, {
      payload,
      silent: payload.silent === true || input.silent === true,
      now: nowOptions.now
    }, {
      repoRoot,
      projectsDir,
      now: nowOptions.now
    });
    if (payload.approve === true) {
      const approvedContent = await approveCurrentContent(projectDir, nowOptions);
      result = {
        ...result,
        approved: true,
        approvedContent
      };
    }
  } else if (command === "generate_candidate_from_content_proposal") {
    await assertProposalMatchesCurrentState(projectDir, payload.proposalId, PROPOSAL_KINDS.CONTENT_MIRROR);
    const adopted = await adoptProposal(projectId, PROPOSAL_KINDS.CONTENT_MIRROR, {
      payload,
      silent: true,
      now: nowOptions.now
    }, {
      repoRoot,
      projectsDir,
      now: nowOptions.now
    });
    const approvedContent = await approveCurrentContent(projectDir, nowOptions);
    const candidatePayload = await ensureImageSpecForCandidate(projectId, payload, input, {
      repoRoot,
      projectsDir,
      now: nowOptions.now
    });
    const candidate = await generateImageCandidate(projectDir, {
      ...candidatePayload,
      now: nowOptions.now
    }, nowOptions);
    result = {
      adopted,
      approved: true,
      approvedContent,
      candidate
    };
  } else if (command === "generate_content_warnings_proposal") {
    result = await generateProposal(projectId, PROPOSAL_KINDS.CONTENT_WARNINGS, {
      ...payload,
      message: payload.message || input.message,
      now: nowOptions.now
    }, {
      repoRoot,
      projectsDir,
      now: nowOptions.now
    });
  } else if (command === "adopt_content_warnings_proposal") {
    result = await adoptProposal(projectId, PROPOSAL_KINDS.CONTENT_WARNINGS, {
      payload,
      now: nowOptions.now
    }, {
      repoRoot,
      projectsDir,
      now: nowOptions.now
    });
  } else if (command === "prepare_image_spec") {
    result = await generateProposal(projectId, PROPOSAL_KINDS.IMAGE_SPEC, {
      ...payload,
      message: payload.message || input.message,
      uiEvent: payload.uiEvent || input.uiEvent || "generate_image",
      canvasFocus: payload.canvasFocus || input.canvasFocus || null,
      now: nowOptions.now
    }, {
      repoRoot,
      projectsDir,
      now: nowOptions.now
    });
  } else if (command === "adopt_image_spec") {
    await assertProposalMatchesCurrentState(projectDir, payload.proposalId, PROPOSAL_KINDS.IMAGE_SPEC);
    result = await adoptProposal(projectId, PROPOSAL_KINDS.IMAGE_SPEC, {
      payload,
      now: nowOptions.now
    }, {
      repoRoot,
      projectsDir,
      now: nowOptions.now
    });
  } else if (command === "prepare_reference_asset") {
    result = await prepareReferenceAsset(projectDir, {
      ...payload,
      now: nowOptions.now
    }, {
      repoRoot,
      projectsDir,
      now: nowOptions.now
    });
  } else if (command === "prepare_web_reference_asset") {
    result = await prepareWebReferenceAsset(projectDir, {
      ...payload,
      now: nowOptions.now
    }, {
      repoRoot,
      projectsDir,
      now: nowOptions.now
    });
  } else if (command === "create_brief_draft") {
    result = await createLessonBriefVersion(projectDir, payload.brief || defaultBrief(project, payload), nowOptions);
  } else if (command === "approve_current_brief") {
    result = await approveCurrentBrief(projectDir, nowOptions);
  } else if (command === "create_content_draft") {
    const briefArtifact = await currentOrLatestArtifact(projectDir, "lessonbriefId", ARTIFACT_TYPES.LESSON_BRIEF);
    const brief = briefArtifact ? await readJson(path.join(projectDir, briefArtifact.path)) : {};
    const events = await readEvents(projectDir);
    result = await createContentMirrorVersion(projectDir, payload.content || defaultContent(project, payload, brief, events), nowOptions);
  } else if (command === "approve_current_content") {
    result = await approveCurrentContent(projectDir, nowOptions);
  } else if (command === "create_run") {
    result = await createRun(projectDir, nowOptions);
  } else if (command === "generate_image_candidate") {
    const candidatePayload = await ensureImageSpecForCandidate(projectId, payload, input, {
      repoRoot,
      projectsDir,
      now: nowOptions.now
    });
    await assertProposalMatchesCurrentState(projectDir, candidatePayload.imageSpecProposalId, PROPOSAL_KINDS.IMAGE_SPEC);
    result = await generateImageCandidate(projectDir, {
      ...candidatePayload,
      now: nowOptions.now
    }, nowOptions);
  } else if (command === "select_candidate") {
    result = await selectDefaultCandidate(projectDir, payload, nowOptions);
  } else if (command === "prepare_export") {
    result = await prepareLatestExport(projectDir, payload, nowOptions);
  } else {
    throw new Error(`Unsupported workspace command: ${command}`);
  }

  if (command !== "copy_context") {
    await refreshStatusSnapshot(projectDir, {
      now: nowOptions.now,
      source: `workspace_command:${command}`
    });
  }

  return {
    command,
    result,
    workspace: await buildWorkspace(projectId, { repoRoot, projectsDir })
  };
}

module.exports = {
  runWorkspaceCommand
};
