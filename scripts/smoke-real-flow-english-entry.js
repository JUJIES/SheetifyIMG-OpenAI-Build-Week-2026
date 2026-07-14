"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const { createSingleWorksheetProject } = require("../core/projectManager");
const { appendEvent } = require("../core/eventLog");
const { EVENT_TYPES } = require("../core/contracts");
const { approveLessonBriefVersion, createLessonBriefVersion } = require("../core/briefManager");
const { approveContentMirrorVersion, createContentMirrorVersion } = require("../core/contentMirrorManager");
const { buildWorkspace } = require("../core/workspaceManager");
  const { classifyChatIntent, EXECUTION_POLICIES, INTENTS } = require("../core/chatIntentInterpreter");
const { resolveChatActionOffer, resolveChatActionOfferFromIntent } = require("../core/chatCommandResolver");

const repoRoot = path.resolve(__dirname, "..");
const smokeRoot = path.join(repoRoot, "tmp", "real-flow-english-entry-smoke");

function summerSnapshotContentV1() {
  return {
    title: "Summer Snapshot: Meet Jamie",
    readingTexts: [{
      id: "rt1",
      title: "Seite 1: Summer Snapshot: Meet Jamie",
      body: "Hi, I'm Jamie. My summer holidays were not very far away, but they were really nice."
    }],
    tasks: [
      {
        id: "t1",
        prompt: "Seite 1: Read Jamie's Summer Snapshot. Then talk about the questions in class.",
        expectedAnswer: "The learners read the text and answer text-based questions.",
        materialRefs: ["rt1", "img1"],
        difficulty: "easy"
      },
      {
        id: "t2",
        prompt: "Name three things Jamie did during the summer holidays.",
        expectedAnswer: "Example: visited cousins, ate ice cream, played basketball.",
        materialRefs: ["rt1"],
        difficulty: "easy"
      },
      {
        id: "t3",
        prompt: "Where did Jamie visit his cousins?",
        expectedAnswer: "In Hamburg.",
        materialRefs: ["rt1"],
        difficulty: "easy"
      },
      {
        id: "t4",
        prompt: "What did Jamie do with friends?",
        expectedAnswer: "He met friends and played basketball.",
        materialRefs: ["rt1"],
        difficulty: "easy"
      },
      {
        id: "t5",
        prompt: "What was Jamie's favourite moment? Why?",
        expectedAnswer: "A barbecue, because everyone was relaxed and happy.",
        materialRefs: ["rt1"],
        difficulty: "easy"
      },
      {
        id: "t6",
        prompt: "What does Jamie want to do this school year?",
        expectedAnswer: "Speak more English and try a new club.",
        materialRefs: ["rt1"],
        difficulty: "easy"
      },
      {
        id: "t8",
        prompt: "Seite 2: My Summer Snapshot. Complete the boxes with short notes or sentences.",
        expectedAnswer: "Individual learner notes.",
        materialRefs: ["img2"],
        difficulty: "easy"
      },
      ...["One thing I did this summer: This summer, I ...",
        "My favourite moment: My favourite moment was ... because ...",
        "A place I visited or stayed at: I visited / stayed at ...",
        "A person I spent time with: I spent time with ...",
        "One thing I want to try this school year: This school year, I want to ..."
      ].map((prompt, index) => ({
        id: `t${index + 9}`,
        prompt,
        expectedAnswer: "Individual learner answer.",
        materialRefs: ["img2"],
        difficulty: "easy"
      }))
    ],
    imageMaterials: [{
      id: "img1",
      prompt: "Friendly Jamie summer illustration.",
      purpose: "Supports the reading text.",
      placement: "Page 1"
    }, {
      id: "img2",
      prompt: "Small summer icons for writing boxes.",
      purpose: "Supports the writing template.",
      placement: "Page 2"
    }],
    solutionNotes: []
  };
}

function summerSnapshotContentV2() {
  return {
    title: "Summer Snapshot: Meet Jamie",
    readingTexts: [{
      id: "rt1",
      title: "Seite 1: Summer Snapshot: Meet Jamie",
      body: "Hi, I'm Jamie. My summer holidays were not very far away, but they were really nice."
    }],
    tasks: [
      {
        id: "t1",
        prompt: [
          "Seite 1: Read Jamie's Summer Snapshot. Then talk about these five questions in class: Name three things Jamie did during the summer holidays.",
          "Where did Jamie visit his cousins?",
          "What did Jamie do with friends?",
          "What was Jamie's favourite moment? Why?",
          "What does Jamie want to do this school year?"
        ].join("\n"),
        expectedAnswer: "Five short text-based oral answers.",
        materialRefs: ["rt1", "img1"],
        difficulty: "easy"
      },
      {
        id: "t2",
        prompt: [
          "Seite 2: My Summer Snapshot. Complete the boxes with short notes or sentences. One thing I did this summer: This summer, I ...",
          "My favourite moment: My favourite moment was ... because ...",
          "A place I visited or stayed at: I visited / stayed at ...",
          "A person I spent time with: I spent time with ...",
          "One thing I want to try this school year: This school year, I want to ..."
        ].join("\n"),
        expectedAnswer: "Individual learner notes or short sentences.",
        materialRefs: ["img2"],
        difficulty: "easy"
      }
    ],
    imageMaterials: [{
      id: "img1",
      prompt: "Friendly Jamie summer illustration.",
      purpose: "Supports the reading text.",
      placement: "Page 1"
    }, {
      id: "img2",
      prompt: "Small summer icons for writing boxes.",
      purpose: "Supports the writing template.",
      placement: "Page 2"
    }],
    solutionNotes: []
  };
}

async function writeJson(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function commandById(workspace, commandId) {
  return (workspace.commands || []).find((command) => command.id === commandId) || null;
}

async function main() {
  await fs.rm(smokeRoot, { recursive: true, force: true });
  await fs.mkdir(smokeRoot, { recursive: true });

  const options = {
    repoRoot,
    projectsDir: smokeRoot,
    now: "2026-07-03T14:35:10.572Z"
  };
  const project = await createSingleWorksheetProject({
    title: "Einstieg Englisch",
    subject: "Englisch",
    topic: "Summer Snapshot",
    targetGroup: "Klasse 7"
  }, options);
  const projectDir = path.join(smokeRoot, project.projectId);

  for (const message of [
    "Ich brauche Ideen fuer das erste Kennenlernen nach den Sommerferien in Englisch.",
    "Summer Snapshot waere gut: erst ein fiktiver Lesetext mit Bild, danach ein paar Fragen zum Text und auf Seite 2 etwas fuer die Schueler selbst.",
    "Es sind ein bisschen viele Fragen am Anfang. Ich wuerde es auf fuenf Fragen begrenzen.",
    "Wir muessen das Aufgabenkonzept ueberarbeiten: Seite 1 Lesetext und die Aufgaben dazu, und zwar fuenf Stueck. Seite 2 geht nur um den Schueler."
  ]) {
    await appendEvent(projectDir, {
      type: EVENT_TYPES.USER_MESSAGE,
      createdAt: options.now,
      step: "auftrag",
      payload: { message }
    }, options);
  }

  const brief = await createLessonBriefVersion(projectDir, {
    subject: "Englisch",
    topic: "Summer Snapshot",
    targetGroup: "Klasse 7",
    goal: "Die Lernenden entnehmen einem kurzen Ferienbericht Informationen und sprechen danach ueber eigene Sommererlebnisse.",
    requirements: [
      "Fiktiver Bericht ueber Jamie",
      "Seite 1 mit Lesetext und genau fuenf Fragen zum Text",
      "Seite 2 als eigener Summer Snapshot"
    ],
    outputPreference: {
      format: "A4",
      pages: 2,
      layout: "image_first",
      style: "klar"
    }
  }, { ...options, now: "2026-07-03T14:51:51.995Z" });
  await approveLessonBriefVersion(projectDir, brief.artifactId, {
    ...options,
    now: "2026-07-03T14:52:00.000Z"
  });

  const oldContent = await createContentMirrorVersion(projectDir, summerSnapshotContentV1(), {
    ...options,
    now: "2026-07-03T15:03:48.838Z"
  });
  await approveContentMirrorVersion(projectDir, oldContent.artifactId, {
    ...options,
    now: "2026-07-03T15:04:00.000Z"
  });

  await createContentMirrorVersion(projectDir, summerSnapshotContentV2(), {
    ...options,
    now: "2026-07-03T15:10:27.109Z"
  });

  const proposal = {
    schemaVersion: 2,
    proposalId: "proposal_008",
    kind: "content_mirror",
    status: "proposed",
    title: "Summer Snapshot: Meet Jamie",
    summary: "Arbeitsblatt-Konzept mit 2 Aufgaben und 2 Bildmaterialien",
    createdAt: "2026-07-03T15:15:40.534Z",
    createdBy: { provider: "test", model: "fixture" },
    source: {
      projectId: project.projectId,
      currentLessonBriefId: brief.artifactId,
      currentContentMirrorId: "content_mirror_v002",
      revisionMode: "patch",
      preserveUnmentionedConceptParts: true
    },
    data: summerSnapshotContentV2(),
    path: "proposals/proposal_008.content_mirror.json"
  };
  await writeJson(path.join(projectDir, proposal.path), proposal);

  let workspace = await buildWorkspace(project.projectId, options);
  const visibleIds = (workspace.visibleCommands || []).map((command) => command.id);
  assert.deepEqual(visibleIds, ["generate_candidate_from_content_proposal"]);
  const candidateCommand = commandById(workspace, "generate_candidate_from_content_proposal");
  assert.equal(candidateCommand.enabled, true);
  assert.deepEqual(candidateCommand.defaultPayload.proposalId, "proposal_008");
  assert.equal(candidateCommand.defaultPayload.approve, true);
  assert.equal(commandById(workspace, "adopt_content_mirror_proposal").enabled, true);

  const draftOffer = resolveChatActionOffer(workspace, "Kannst du daraus einen Entwurf erstellen?");
  assert.equal(draftOffer.suggestedActions[0].command, "generate_candidate_from_content_proposal");
  assert.equal(draftOffer.suggestedActions[0].payload.proposalId, "proposal_008");
  assert.equal(draftOffer.suggestedActions[0].payload.approve, true);
  assert.equal(draftOffer.suggestedActions[0].requiresConfirmation, true);

  workspace = {
    ...workspace,
    chat: {
      messages: [
        ...(workspace.chat?.messages || []),
        {
          role: "assistant",
          content: draftOffer.message,
          suggestedActions: draftOffer.suggestedActions
        }
      ]
    }
  };
  const localIntent = classifyChatIntent("mach das", workspace);
  assert.equal(localIntent.intent, INTENTS.NONE);
  assert.equal(localIntent.target.kind, "none");
  assert.equal(localIntent.executionPolicy, EXECUTION_POLICIES.NONE);

  const modelIntent = {
    intent: INTENTS.CONTENT_PROPOSAL_ADOPTION_CANDIDATE_CHAIN,
    confidence: "high",
    source: "model",
    target: {
      kind: "content_proposal",
      proposalId: "proposal_008"
    },
    wantsCandidate: true,
    wantsAdoption: true,
    wantsContentChange: false,
    executionPolicy: EXECUTION_POLICIES.AUTO_EXECUTE_THEN_CONFIRMATION,
    sourceMessage: "mach das"
  };
  const confirmationOffer = resolveChatActionOfferFromIntent(workspace, modelIntent, "mach das");
  assert.equal(confirmationOffer.suggestedActions[0].command, "generate_candidate_from_content_proposal");
  assert.equal(confirmationOffer.suggestedActions[0].autoOpenConfirmation, true);

  console.log(JSON.stringify({
    ok: true,
    projectId: project.projectId,
    visibleAction: visibleIds[0],
    proposalId: candidateCommand.defaultPayload.proposalId,
    localShortReplyIntent: localIntent.intent,
    modelShortReplyIntent: modelIntent.intent
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
