"use strict";

const assert = require("node:assert/strict");
const { promptForPage } = require("../core/imageGenerationManager");
const {
  normalizeInlineListHeadings,
  normalizeMatchingTaskPrompt,
  normalizeTaskLabelFields,
  visibleTaskEntries,
  visibleTaskLines
} = require("../core/taskLabelManager");
const { __testing: aiProposalTesting } = require("../core/aiProposalManager");

function approvedVisibleTextFromPrompt(prompt) {
  const marker = "Freigegebener sichtbarer Arbeitsblatttext - exakt diese Inhalte verwenden:\n";
  const start = prompt.indexOf(marker);
  assert.notEqual(start, -1, "final image prompt must include approved visible text");
  const afterMarker = prompt.slice(start + marker.length);
  const end = afterMarker.search(/\n(?:Freigegebener Bildbedarf|Interne visuelle Ableitung|Komposition:|Grundstil:)/);
  return (end >= 0 ? afterMarker.slice(0, end) : afterMarker).trim();
}

function assertCentralTaskNormalization() {
  const normalized = normalizeTaskLabelFields({
    id: "task_dirty",
    groupLabel: "Station A",
    prompt: "1. Station A: Ordne die Samen der passenden Verbreitungsart zu."
  });
  assert.deepEqual(normalized, {
    id: "task_dirty",
    groupLabel: "Station A",
    prompt: "Ordne die Samen der passenden Verbreitungsart zu."
  });

  const inferred = normalizeTaskLabelFields({
    id: "task_level",
    prompt: "3. Stufe 2 - mittel: Berechne die Geschwindigkeit des Busses."
  });
  assert.equal(inferred.groupLabel, "Stufe 2 - mittel");
  assert.equal(inferred.prompt, "Berechne die Geschwindigkeit des Busses.");

  const pageTaskLabel = normalizeTaskLabelFields({
    id: "task_page_label",
    groupLabel: "Seite 2: Aufgaben",
    prompt: "1. Beschreibe das Verhalten."
  });
  assert.equal(pageTaskLabel.groupLabel, "");
  assert.equal(pageTaskLabel.prompt, "Beschreibe das Verhalten.");

  const matchingPrompt = normalizeInlineListHeadings(
    "Verbinde die sichtbaren Bräuche. Sichtbare Bräuche:\n- Schabbatkerzen\n- Kippa\n- koscher essen Bedeutungen:\n- Ruhetag beginnt\n- Erinnerung an Gott\n- Speiseregeln"
  );
  assert.match(matchingPrompt, /koscher essen\nBedeutungen:/);

  const plainMatchingPrompt = normalizeInlineListHeadings(
    "Verbinde die sichtbaren Zeichen. Sichtbare Zeichen:\nKippa\nMesusa\nKoscheres Essen Bedeutungen:\nRespekt vor Gott\nGottes Gebote\nSpeiseregeln"
  );
  assert.match(plainMatchingPrompt, /Koscheres Essen\nBedeutungen:/);

  const normalizedMatching = normalizeMatchingTaskPrompt(
    "Verbinde die sichtbaren Zeichen mit ihrer Bedeutung. Sichtbare Zeichen:\nKippa\nSchabbatkerzen\nMesusa\nBedeutungen:\nErinnert daran, dass Gott im Alltag wichtig ist.\nMarkiert den Beginn einer besonderen Ruhezeit.\nErinnert am Türpfosten an Gottes Gebote und Schutz.",
    "Kippa: Gott ist im Alltag wichtig; Schabbatkerzen: Beginn einer besonderen Ruhezeit; Mesusa: Erinnerung an Gottes Gebote und Schutz."
  );
  assert.match(normalizedMatching, /Bedeutungen:\nMarkiert den Beginn/);
  assert.doesNotMatch(normalizedMatching, /Bedeutungen:\nErinnert daran, dass Gott im Alltag wichtig ist\.\nMarkiert/);
}

function assertConceptValidationUsesNormalizer() {
  const content = aiProposalTesting.validateContentMirror({
    title: "Geschwindigkeit: Aufgaben in Stufen",
    outputPreference: {
      pages: 1,
      layout: "single_task_sheet",
      hierarchy: "minimal"
    },
    readingTexts: [],
    tasks: [
      {
        id: "task_1",
        groupLabel: "Stufe 1 - leicht",
        prompt: "1. Stufe 1 - leicht: Berechne die Geschwindigkeit eines Fahrrads.",
        expectedAnswer: "v = s / t"
      },
      {
        id: "task_2",
        prompt: "2. Station A: Ordne zwei Samenformen zu.",
        expectedAnswer: "Plausible Zuordnung"
      }
    ],
    imageMaterials: []
  }, {
    title: "Fallback"
  });
  assert.equal(content.tasks[0].groupLabel, "Stufe 1 - leicht");
  assert.equal(content.tasks[0].prompt, "Berechne die Geschwindigkeit eines Fahrrads.");
  assert.equal(content.tasks[1].groupLabel, "Station A");
  assert.equal(content.tasks[1].prompt, "Ordne zwei Samenformen zu.");
}

function assertVisibleTextUsesNormalizer() {
  const tasks = [
    {
      id: "task_1",
      prompt: "1. Stufe 1 - leicht: Berechne die Geschwindigkeit eines Fahrrads."
    },
    {
      id: "task_2",
      prompt: "2. Stufe 1 - leicht: Vergleiche zwei Bewegungen."
    },
    {
      id: "task_3",
      prompt: "3. Stufe 2 - mittel: Erklaere den Unterschied zwischen Weg und Zeit."
    },
    {
      id: "task_4",
      prompt: "4. Station A: Ordne zwei Samenformen zu."
    },
    {
      id: "task_5",
      groupLabel: "Seite 2: Aufgaben",
      prompt: "5. Beschreibe das Verhalten."
    }
  ];
  const visibleLines = visibleTaskLines(visibleTaskEntries(tasks)).join("\n");
  assert.match(visibleLines, /Stufe 1 - leicht\n1\. Berechne[\s\S]*\n2\. Vergleiche/i);
  assert.match(visibleLines, /\nStufe 2 - mittel: Erklaere/i);
  assert.match(visibleLines, /Station A: Ordne/i);
  assert.match(visibleLines, /\n1\. Beschreibe das Verhalten\./i);
  assert.doesNotMatch(visibleLines, /Seite\s*2:\s*Aufgaben/i);
  assert.doesNotMatch(visibleLines, /\n\d+\.\s*Station\s+[A-Z]\b/i);
  assert.doesNotMatch(visibleLines, /\n\d+\.\s*Stufe\s*2/i);

  const singleActionGroups = visibleTaskLines(visibleTaskEntries([
    {
      id: "task_observe",
      groupLabel: "Beobachten",
      prompt: "Betrachte die Bildkarten."
    },
    {
      id: "task_match",
      groupLabel: "Zuordnen",
      prompt: "Verbinde die Begriffe."
    },
    {
      id: "task_explain",
      groupLabel: "Erklaeren",
      prompt: "Erklaere den Unterschied."
    }
  ])).join("\n");
  assert.match(singleActionGroups, /^1\. Beobachten: Betrachte/m);
  assert.match(singleActionGroups, /\n2\. Zuordnen: Verbinde/m);
  assert.match(singleActionGroups, /\n3\. Erklaeren: Erklaere/m);
  assert.doesNotMatch(singleActionGroups, /Beobachten\n1\./);
  assert.doesNotMatch(singleActionGroups, /Zuordnen\n1\./);

  const stationSingles = visibleTaskLines(visibleTaskEntries([
    {
      id: "task_station_a",
      groupLabel: "Station A",
      prompt: "Ordne zwei Samenformen zu."
    },
    {
      id: "task_station_b",
      groupLabel: "Station B",
      prompt: "Begruende eine Zuordnung."
    }
  ])).join("\n");
  assert.match(stationSingles, /^Station A: Ordne/m);
  assert.match(stationSingles, /\nStation B: Begruende/m);
  assert.doesNotMatch(stationSingles, /\n?\d+\.\s*Station\s+[A-Z]/);
}

function assertFinalPromptIsCleanBeforeImageModel() {
  const finalPrompt = promptForPage({
    imageSheetBrief: {
      lessonBrief: {
        subject: "Physik",
        targetGroup: "Klasse 8",
        topic: "Geschwindigkeit"
      },
      contentMirror: {
        title: "Geschwindigkeit: Aufgaben in Stufen",
        outputPreference: {
          pages: 1,
          layout: "single_task_sheet",
          hierarchy: "minimal"
        },
        readingTexts: [],
        tasks: [
          {
            id: "task_1",
            prompt: "1. Stufe 1 - leicht: Berechne die Geschwindigkeit eines Fahrrads."
          },
          {
            id: "task_2",
            prompt: "2. Stufe 1 - leicht: Vergleiche zwei Bewegungen."
          },
          {
            id: "task_3",
            prompt: "3. Stufe 2 - mittel: Erklaere den Unterschied zwischen Weg und Zeit."
          },
          {
            id: "task_4",
            prompt: "4. Station A: Ordne zwei Samenformen zu."
          },
          {
            id: "task_5",
            groupLabel: "Seite 2: Aufgaben",
            prompt: "5. Beschreibe das Verhalten."
          }
        ],
        imageMaterials: [],
        solutionNotes: []
      }
    },
    pageNumber: 1,
    pageCount: 1,
    role: "worksheet"
  });
  const approvedText = approvedVisibleTextFromPrompt(finalPrompt);
  assert.match(approvedText, /Stufe 1 - leicht\n1\. Berechne[\s\S]*\n2\. Vergleiche/i);
  assert.match(approvedText, /\nStufe 2 - mittel: Erklaere/i);
  assert.match(approvedText, /Station A: Ordne/i);
  assert.match(approvedText, /\n1\. Beschreibe das Verhalten\./i);
  assert.doesNotMatch(approvedText, /Seite\s*2:\s*Aufgaben/i);
  assert.doesNotMatch(approvedText, /\n\d+\.\s*Station\s+[A-Z]\b/i);
  assert.doesNotMatch(approvedText, /\n\d+\.\s*Stufe\s*2/i);
}

assertCentralTaskNormalization();
assertConceptValidationUsesNormalizer();
assertVisibleTextUsesNormalizer();
assertFinalPromptIsCleanBeforeImageModel();

console.log(JSON.stringify({
  ok: true,
  centralTaskNormalization: true,
  conceptValidationUsesNormalizer: true,
  finalPromptCleanBeforeImageModel: true
}, null, 2));
