"use strict";

const fs = require("node:fs/promises");
const path = require("node:path");
const { assertCanGenerate } = require("../approvalManager");
const { registerCandidate } = require("../candidateManager");
const {
  createCandidatePdf,
  recordCandidatePdfError
} = require("../candidatePdfManager");
const { getImageRequestConfig, getImageRuntimeStatus } = require("../aiConfig");
const { runCodexImageJob } = require("../codexImageWorker");
const { createImageEdit, createImageGeneration } = require("../openaiClient");
const { createRun } = require("../runManager");
const { writeImageAsset, writeImageFileAsset } = require("../imageAssetManager");
const { runCandidateTechnicalQc } = require("../imageQcManager");
const { readActiveImageSpec } = require("../aiProposalManager");
const { logModelRun } = require("../modelRunLogger");
const { narrateChatMoment } = require("../chatNarrationManager");
const { readEvents } = require("../eventLog");
const { referencePolicyPromptLines } = require("../referencePolicy");
const {
  buildPagePlans,
  clampPageCount,
  pageCountFromContent,
  pageRole,
  sheetNumbersMentioned
} = require("../pagePlanManager");
const {
  contentReadinessForGeneration,
  contentReadinessMessage
} = require("../contentReadiness");

async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, "utf8"));
}

async function listDirs(dirPath) {
  try {
    const entries = await fs.readdir(dirPath, { withFileTypes: true });
    return entries.filter((entry) => entry.isDirectory()).map((entry) => path.join(dirPath, entry.name)).sort();
  } catch {
    return [];
  }
}

async function latestRunId(projectDir) {
  const runDirs = await listDirs(path.join(projectDir, "runs"));
  if (runDirs.length === 0) {
    return null;
  }
  const manifest = await readJson(path.join(runDirs[runDirs.length - 1], "run-manifest.json"));
  return manifest.runId || path.basename(runDirs[runDirs.length - 1]);
}

function nextCandidateId(manifest) {
  const numbers = (manifest.candidates || [])
    .map((candidate) => Number(String(candidate.id || "").match(/^candidate_(\d+)$/)?.[1] || 0))
    .filter(Boolean);
  return `candidate_${String(Math.max(0, ...numbers) + 1).padStart(2, "0")}`;
}

function taskLines(contentMirror) {
  return (contentMirror.tasks || [])
    .slice(0, 6)
    .map((task, index) => `${index + 1}. ${task.prompt || task.text || task.id}`)
    .join("\n");
}

function materialLines(contentMirror) {
  return (contentMirror.imageMaterials || [])
    .slice(0, 6)
    .map((material, index) => `${index + 1}. ${material.prompt || material.description || material.purpose}`)
    .join("\n");
}

function materialLinesForPage(contentMirror, pagePlan = null) {
  const materials = Array.isArray(contentMirror.imageMaterials) ? contentMirror.imageMaterials : [];
  const explicitMaterialIds = new Set(pagePlan?.imageMaterialIds || []);
  const relevantMaterials = explicitMaterialIds.size
    ? materials.filter((material) => explicitMaterialIds.has(material.id))
    : pagePlan?.kind === "sheet"
    ? materials.filter((material) => {
        const mentioned = sheetNumbersMentioned([
          material.id,
          material.prompt,
          material.description,
          material.purpose,
          material.placement
        ].filter(Boolean).join("\n"));
        return mentioned.size === 0 || mentioned.has(pagePlan.sheetNumber);
      })
    : materials;
  return relevantMaterials
    .slice(0, 6)
    .map((material, index) => `${index + 1}. ${material.prompt || material.description || material.purpose}`)
    .join("\n");
}

function isSolutionText(value) {
  return /\b(lösung|loesung|lösungsteil|loesungsteil|solution|antwort|answers?)\b/i.test(String(value || ""));
}

function visibleSpecItems(items = []) {
  return items
    .map((item) => String(item || "").trim())
    .filter((item) => item && !isSolutionText(item));
}

function itemAppliesToPagePlan(item, pagePlan = null) {
  if (!pagePlan) {
    return true;
  }
  const mentioned = sheetNumbersMentioned(item);
  return mentioned.size === 0 || mentioned.has(pagePlan.sheetNumber) || mentioned.has(pagePlan.pageNumber);
}

function appliedRuleLines(imageSpec = {}) {
  const rules = Array.isArray(imageSpec.appliedRules) ? imageSpec.appliedRules : [];
  if (!rules.length) {
    return "";
  }
  const lines = ["Angewendete SheetifyIMG-Regeln fuer diese Kandidatenerzeugung:"];
  for (const rule of rules.slice(0, 12)) {
    lines.push(`- ${rule.id || rule.title}: ${rule.title || "Regel"}`);
    for (const instruction of (rule.instructions || []).slice(0, 6)) {
      lines.push(`  - ${instruction}`);
    }
  }
  return lines.join("\n");
}

function imageSpecLines(imageSpec, pagePlan = null) {
  const spec = imageSpec?.data || imageSpec || null;
  if (!spec) {
    return [];
  }
  const mustShow = visibleSpecItems(spec.mustShow)
    .filter((item) => itemAppliesToPagePlan(item, pagePlan));
  const avoid = visibleSpecItems(spec.avoid);
  const references = spec.referenceImages || [];
  return [
    "Interne visuelle Ableitung aus dem freigegebenen Arbeitsblatt-Konzept:",
    isSolutionText(spec.purpose) ? "" : `Zweck: ${spec.purpose || "Arbeitsblatt-Bildmaterial"}`,
    `Lernfunktion: ${spec.learningFunction || "Material veranschaulichen"}`,
    `Stil: ${spec.style || "clean_scientific"}`,
    isSolutionText(spec.placement) ? "" : `Platzierung: ${spec.placement || "auto"}`,
    `Muss zeigen: ${mustShow.join(", ") || spec.topic || ""}`,
    `Vermeiden: ${avoid.join(", ") || "Logos, Wasserzeichen, dekorative Unruhe"}`,
    appliedRuleLines(spec),
    ...referencePolicyPromptLines(spec.referencePolicy, references),
    referenceImageLines(spec),
    "Textregel: sichtbarer Text ist erlaubt und gewuenscht, aber ausschliesslich aus dem freigegebenen Arbeitsblatttext."
  ].filter(Boolean);
}

function referenceImageLines(imageSpec = {}) {
  const references = Array.isArray(imageSpec.referenceImages) ? imageSpec.referenceImages : [];
  if (!references.length) {
    return "";
  }
  return [
    "Direkte Bildreferenzen fuer das Bildmodell:",
    ...references.map((reference, index) => {
      const role = reference.role || "style_reference";
      const purpose = reference.purpose || "Referenzbild";
      const qrRule = /qr|barcode|code_asset|exact_qr/i.test(`${role} ${purpose}`)
        ? " QR-Code exakt als scharfes quadratisches Muster uebernehmen, nicht stilisieren, nicht perspektivisch verzerren, nicht neu erfinden. Scanbarkeit ist wichtiger als Dekoration."
        : "";
      const factualRule = /content|factual|map|coordinate|template/i.test(role)
        ? " Uebernimm die fachliche Struktur, Geometrie oder Positionen aus der Referenz moeglichst stabil; erfinde keine abweichenden Fakten."
        : "";
      return `${index + 1}. ${role}: ${purpose}. Nutze die Referenz nur fuer den beschriebenen Zweck; uebernimm keine Texte, Ortsnamen, Hausnummern, Schildaufschriften, Bildbeschriftungen oder Aufgaben daraus. Wenn die Referenz Text enthaelt, neutralisiere ihn visuell oder ersetze ihn ausschliesslich durch freigegebenen Arbeitsblatttext.${factualRule}${qrRule}`;
    })
  ].join("\n");
}

function readingTextLines(contentMirror) {
  return (contentMirror.readingTexts || [])
    .slice(0, 6)
    .map((text, index) => `${index + 1}. ${text.title ? `${text.title}: ` : ""}${text.body}`)
    .join("\n");
}

function solutionLines(contentMirror) {
  const taskAnswers = (contentMirror.tasks || [])
    .filter((task) => task.expectedAnswer)
    .map((task) => `${task.id || "Aufgabe"}: ${task.expectedAnswer}`);
  return taskAnswers.join("\n");
}

function normalizeText(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/ß/g, "ss")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "");
}

function worksheetLanguage(contentMirror = {}, lessonBrief = {}) {
  const visibleText = [
    contentMirror.title,
    ...(contentMirror.readingTexts || []).flatMap((entry) => [entry.title, entry.body]),
    ...(contentMirror.tasks || []).flatMap((entry) => [entry.prompt, entry.text]),
    ...(contentMirror.imageMaterials || []).flatMap((entry) => [entry.prompt, entry.purpose, entry.placement]),
    lessonBrief.outputPreference?.language,
    lessonBrief.outputPreference?.worksheetLanguage
  ].filter(Boolean).join("\n");
  const text = normalizeText(visibleText);

  if (/\b(no german|english[- ]only|only english|simple english|english instructions|no german text)\b/.test(text)) {
    return "en";
  }

  const englishSignals = [
    /\bmatch\b/g,
    /\bwrite\b/g,
    /\btalk to a partner\b/g,
    /\bword list\b/g,
    /\bi can see\b/g,
    /\bwhat can you see\b/g,
    /\bpartner a\b/g,
    /\bpartner b\b/g,
    /\bgrade\b/g,
    /\bworksheet\b/g
  ].reduce((sum, regex) => sum + (text.match(regex) || []).length, 0);
  const germanSignals = [
    /\baufgabe\b/g,
    /\baufgaben\b/g,
    /\bbeschrifte\b/g,
    /\berklaere\b/g,
    /\bkreuze\b/g,
    /\blies\b/g,
    /\bverbinde\b/g,
    /\bschreibe\b/g,
    /\barbeitsblatt\b/g,
    /\bklasse\b/g
  ].reduce((sum, regex) => sum + (text.match(regex) || []).length, 0);

  return englishSignals >= 3 && englishSignals > germanSignals ? "en" : "de";
}

function sectionHeadings(language = "de") {
  if (language === "en") {
    return {
      titlePrefix: "Title",
      sectionPrefix: "Section heading",
      material: "Material",
      tasks: "Tasks",
      worksheetLanguageLabel: "englischsprachiges",
      visibleLanguageRule: "Sichtbare Sprache: Englisch. Sichtbare Abschnittsueberschriften muessen Englisch sein, insbesondere Material und Tasks. Verwende keine deutschen sichtbaren Labels oder deutschen Arbeitsblatt-Anweisungen."
    };
  }
  return {
    titlePrefix: "Titel",
    sectionPrefix: "Abschnittsueberschrift",
    material: "Material",
    tasks: "Aufgaben",
    worksheetLanguageLabel: "deutschsprachiges",
    visibleLanguageRule: "Sichtbare Sprache: Deutsch. Sichtbare Abschnittsueberschriften sind Material und Aufgaben."
  };
}

function stripLeadingTaskNumbering(value) {
  let text = String(value || "").trim();
  for (let pass = 0; pass < 4; pass += 1) {
    const previous = text;
    text = text
      .replace(/^\s*(?:aufgabe|task|exercise)\s*[a-z]?\s*\d+\s*(?:[-–—:.)]\s*)?/i, "")
      .replace(/^\s*(?:[a-z]\s*)?\d+\s*(?:[-–—:.)]\s*)/i, "")
      .replace(/^\s*[a-z]\d+\s*(?:[-–—:.)]\s*)/i, "");
    if (text === previous) {
      break;
    }
  }
  return text.trim() || String(value || "").trim();
}

function stripLeadingSheetBlock(value) {
  const text = String(value || "").trim();
  const firstLineMatch = text.match(/^\s*(?:sheet|seite|blatt)\s*[1-4]\s*[:\-–—]\s*[^\r\n]*/i);
  if (!firstLineMatch) {
    return text;
  }
  const afterTitle = text.slice(firstLineMatch[0].length).trim();
  const taskStart = afterTitle.search(/\b(?:task|aufgabe)\s*\d+\s*[:\-–—]/i);
  return taskStart >= 0 ? afterTitle.slice(taskStart).trim() : afterTitle;
}

function taskPromptForVisibleText(task = {}, options = {}) {
  const source = options.omitSheetBlock
    ? stripLeadingSheetBlock(task.prompt || task.text || task.id)
    : task.prompt || task.text || task.id;
  return stripLeadingTaskNumbering(source);
}

function visibleWorksheetText(contentMirror, lessonBrief = {}) {
  const headings = sectionHeadings(worksheetLanguage(contentMirror, lessonBrief));
  const lines = [];
  if (contentMirror.title) {
    lines.push(`${headings.titlePrefix}: ${contentMirror.title}`);
  }
  const readingTexts = contentMirror.readingTexts || [];
  if (readingTexts.length) {
    lines.push(`${headings.sectionPrefix}: ${headings.material}`);
    readingTexts.slice(0, 6).forEach((text) => {
      if (text.title && String(text.title).trim().toLowerCase() !== headings.material.toLowerCase()) {
        lines.push(`${text.title}: ${text.body || ""}`);
      } else {
        lines.push(text.body || "");
      }
    });
  }
  const tasks = contentMirror.tasks || [];
  if (tasks.length) {
    lines.push(`${headings.sectionPrefix}: ${headings.tasks}`);
    tasks.slice(0, 8).forEach((task, index) => {
      lines.push(`${index + 1}. ${taskPromptForVisibleText(task)}`);
    });
  }
  return lines.filter(Boolean).join("\n");
}

function visibleWorksheetTextForPage(contentMirror, lessonBrief = {}, pageNumber = 1, pageCount = 1) {
  const plannedPageCount = Math.max(clampPageCount(pageCount), pageCountFromContent(contentMirror, null, lessonBrief));
  const pagePlan = buildPagePlans(contentMirror, lessonBrief, plannedPageCount)
    .find((plan) => plan.pageNumber === pageNumber) || null;
  if (pagePlan && pagePlan.kind !== "default") {
    const headings = sectionHeadings(worksheetLanguage(contentMirror, lessonBrief));
    const lines = [];
    if (contentMirror.title) {
      lines.push(`${headings.titlePrefix}: ${contentMirror.title}`);
    }
    if (pagePlan.title) {
      lines.push(`${headings.sectionPrefix}: ${pagePlan.title}`);
    }
    if (pagePlan.intro) {
      lines.push(pagePlan.intro);
    }
    if (pagePlan.readingTexts?.length) {
      lines.push(`${headings.sectionPrefix}: ${headings.material}`);
      pagePlan.readingTexts.forEach((text) => {
        if (text.title && String(text.title).trim().toLowerCase() !== headings.material.toLowerCase()) {
          lines.push(`${text.title}: ${text.body || ""}`);
        } else {
          lines.push(text.body || "");
        }
      });
    }
    if (pagePlan.tasks?.length) {
      lines.push(`${headings.sectionPrefix}: ${headings.tasks}`);
      pagePlan.tasks.forEach((task, index) => {
        lines.push(`${index + 1}. ${taskPromptForVisibleText(task, { omitSheetBlock: true })}`);
      });
    }
    return lines.filter(Boolean).join("\n");
  }
  if (plannedPageCount <= 1) {
    return visibleWorksheetText(contentMirror, lessonBrief);
  }
  const headings = sectionHeadings(worksheetLanguage(contentMirror, lessonBrief));
  const lines = [];
  if (contentMirror.title) {
    lines.push(`${headings.titlePrefix}: ${contentMirror.title}`);
  }
  if (pageNumber === 1) {
    const readingTexts = contentMirror.readingTexts || [];
    if (readingTexts.length) {
      lines.push(`${headings.sectionPrefix}: ${headings.material}`);
      readingTexts.slice(0, 4).forEach((text) => {
        if (text.title && String(text.title).trim().toLowerCase() !== headings.material.toLowerCase()) {
          lines.push(`${text.title}: ${text.body || ""}`);
        } else {
          lines.push(text.body || "");
        }
      });
    }
    return lines.filter(Boolean).join("\n");
  }
  const tasks = contentMirror.tasks || [];
  if (tasks.length) {
    lines.push(`${headings.sectionPrefix}: ${headings.tasks}`);
    tasks.slice(0, 8).forEach((task, index) => {
      lines.push(`${index + 1}. ${taskPromptForVisibleText(task)}`);
    });
  }
  return lines.filter(Boolean).join("\n");
}

function compositionInstruction({ role, pageNumber, pageCount, language = "de", pagePlan = null }) {
  const headings = sectionHeadings(language);
  if (pagePlan?.kind === "sheet") {
    return [
      `Komposition: SEITE ${pageNumber} VON ${pageCount}, eigenstaendige Arbeitsblattseite fuer ${pagePlan.title || `Sheet ${pagePlan.sheetNumber}`}.`,
      "Keine Deckblatt- oder reine Ueberblicksseite.",
      `Zeige nur die Inhalte dieses Sheets; presse keine weiteren Sheets auf dieselbe Seite.`,
      `Setze ${headings.tasks}, Tabellen/Zuordnungen und Sprechaufgaben mit viel lesbarem Abstand.`
    ].join(" ");
  }
  if (pagePlan?.kind === "material") {
    return [
      `Komposition: SEITE ${pageNumber} VON ${pageCount}, Material- oder Leseseite.`,
      "Zeige nur den freigegebenen Materialtext dieser Seite und passende Visualisierung.",
      `Keine ${headings.tasks}-Liste, keine Aufgaben anderer Seiten, kein Deckblatt ohne Inhalt.`
    ].join(" ");
  }
  if (pagePlan?.kind === "task_group") {
    return [
      `Komposition: SEITE ${pageNumber} VON ${pageCount}, Aufgabenseite fuer genau die unten freigegebenen Aufgaben.`,
      "Wiederhole nicht die Materialseite und uebernimm keine Aufgaben anderer Seiten.",
      `Setze ${headings.tasks}, Nummerierung und ausreichend Schreib-/Bearbeitungsraum.`
    ].join(" ");
  }
  if (pagePlan?.kind === "extension") {
    return [
      `Komposition: SEITE ${pageNumber} VON ${pageCount}, Zusatz- oder Weiterfuehrungsseite.`,
      "Nur freigegebene Inhalte dieser Seite verwenden; keine Aufgaben anderer Seiten wiederholen."
    ].join(" ");
  }
  if (pageCount > 1 && pageNumber === 1) {
    return [
      `Komposition: SEITE 1 VON ${pageCount}, reine Überblicksseite.`,
      "Zeige Titel, großes klares Diagramm oder Hauptbild, kurzen Erklärungstext und Merkkasten.",
      `Keine ${headings.tasks}-Liste, keine langen Schreiblinien und keine zweite Aufgabensektion auf Seite 1.`
    ].join(" ");
  }
  if (pageCount > 1 && pageNumber === 2) {
    return [
      `Komposition: SEITE 2 VON ${pageCount}, reine Aufgabenseite.`,
      `Zeige ${headings.tasks}, Nummerierung und viel Schreibraum.`,
      "Nur ein kleines Referenzdiagramm ist erlaubt.",
      "Wiederhole nicht den langen Materialtext und erzeuge kein zweites vollständiges Übersichtsblatt."
    ].join(" ");
  }
  if (pageCount > 1) {
    return `Komposition: SEITE ${pageNumber} VON ${pageCount}, Erweiterungsseite mit Aufgaben oder Zusatzmaterial. Keine Wiederholung der vorherigen Seiten.`;
  }
  return role === "worksheet"
    ? `Komposition: vollstaendige A4-Arbeitsblattseite mit Titel oben, ${headings.material}-Bereich, fachlicher Illustration, ${headings.tasks}-Bereich und Schreiblinien.`
    : "Komposition: zentrale fachliche Materialillustration mit ruhigem Rand.";
}

function promptForPage({ imageSheetBrief, pageNumber, role, imageSpec = null, variantInstruction = "", pageCount = 1, pagePlan = null }) {
  const contentMirror = imageSheetBrief.contentMirror || {};
  const lessonBrief = imageSheetBrief.lessonBrief || {};
  const language = worksheetLanguage(contentMirror, lessonBrief);
  const headings = sectionHeadings(language);
  const inferredPageCount = Math.max(clampPageCount(pageCount), pageCountFromContent(contentMirror, imageSpec, lessonBrief));
  const currentPagePlan = pagePlan || buildPagePlans(contentMirror, lessonBrief, inferredPageCount)
    .find((plan) => plan.pageNumber === pageNumber) || null;
  const actualPageCount = Math.max(inferredPageCount, currentPagePlan?.pageNumber || 1);
  const actualRole = role || pageRole(pageNumber, currentPagePlan);
  const approvedVisibleText = visibleWorksheetTextForPage(contentMirror, lessonBrief, pageNumber, actualPageCount);
  const hiddenSolutions = solutionLines(contentMirror);
  const visualVariantInstruction = String(variantInstruction || "").trim();
  const pageMaterialLines = materialLinesForPage(contentMirror, currentPagePlan);
  return [
    `Erzeuge ein vollstaendiges ${headings.worksheetLanguageLabel} Arbeitsblatt als ein einziges Image-First-Bild.`,
    "NICHT VERHANDELBAR: DIN A4 portrait, Seitenverhaeltnis 1:sqrt(2) bzw. 210:297. Keine 16:9-Komposition, kein Querformat, kein quadratisches Poster, kein 2:3-Posterformat.",
    `Image-First: Das Bild ist das Arbeitsblatt. Setze Titel, passende Abschnittsueberschriften, ${headings.material}, ${headings.tasks}, Illustration und Schreiblinien direkt im Bild.`,
    headings.visibleLanguageRule,
    "Nummerierungsregel: Nummeriere jede Aufgabe genau einmal. Wenn der freigegebene Aufgabentext schon Nummern oder Labels enthielt, sind diese im sichtbaren Text bereits bereinigt. Erzeuge niemals doppelte Nummern wie '1. 1.' oder '1. Aufgabe 1'.",
    "Content-Control: Teacher controls content. Verwende sichtbar nur den freigegebenen Text unten. Erfinde keine weiteren Aufgaben, Labels, Quellen, Antworten, Fussnoten oder Erklaertexte.",
    "Keine Umgebungs-Texte: Tafel, Whiteboard, Poster, Bildschirm, Buchseiten, Handy-Displays und Dekoelemente muessen leer, unscharf oder unlesbar bleiben, ausser ihr Text steht explizit im freigegebenen sichtbaren Arbeitsblatttext.",
    "Texttreue: Uebernimm den freigegebenen sichtbaren Arbeitsblatttext moeglichst wortgetreu. Bei Unsicherheit lieber weniger Zusatzgestaltung statt neuen Text erfinden.",
    "Loesungen duerfen auf der Arbeitsblattseite nicht sichtbar sein. Nutze Loesungserwartungen nur als unsichtbaren Kontext fuer die Aufgabenpassung.",
    "Stil: klar, schulisch, sachlich, gut druckbar, hochwertige Arbeitsblattseite, keine dekorativen Logos.",
    "Fachkontext fuer die Illustration:",
    `Thema: ${contentMirror.title || lessonBrief.topic || "Arbeitsblatt"}`,
    `Fach/Zielgruppe: ${lessonBrief.subject || "Unterricht"} ${lessonBrief.targetGroup || ""}`.trim(),
    `Illustrationsrolle: ${actualRole}, Seite ${pageNumber} von ${actualPageCount}`,
    approvedVisibleText ? `Freigegebener sichtbarer Arbeitsblatttext - exakt diese Inhalte verwenden:\n${approvedVisibleText}` : "",
    hiddenSolutions ? `Nicht sichtbar setzen, nur fuer interne Passungspruefung:\n${hiddenSolutions}` : "",
    pageMaterialLines ? `Freigegebener Bildbedarf fuer diese Seite:\n${pageMaterialLines}` : "",
    ...imageSpecLines(imageSpec, currentPagePlan),
    visualVariantInstruction
      ? `Variantenwunsch fuer diesen Kandidaten: ${visualVariantInstruction}. Wichtig: Nutze das nur fuer Layout, Stil, Bildkomposition, Lesbarkeit und visuelle Gewichtung. Aendere keine freigegebenen Aufgaben, Texte oder fachlichen Inhalte.`
      : "",
    compositionInstruction({ role: actualRole, pageNumber, pageCount: actualPageCount, language, pagePlan: currentPagePlan }),
    "Das Bild soll wie ein fertiges, hochwertiges Arbeitsblatt wirken."
  ].filter(Boolean).join("\n");
}

function assertPaidConfirmation(runtime, input) {
  if (input.confirmPaidRun !== true) {
    throw new Error("Paid image generation requires explicit confirmation.");
  }
}

function toPosix(value) {
  return String(value || "").split(path.sep).join("/");
}

function normalizeReferenceImage(reference = {}, index = 0) {
  const refPath = String(reference.path || reference.sourcePath || "").trim().replaceAll("\\", "/").replace(/^\/+/, "");
  if (!refPath) {
    return null;
  }
  return {
    id: reference.id || `ref_${String(index + 1).padStart(2, "0")}`,
    role: reference.role || "style_reference",
    path: refPath,
    purpose: reference.purpose || "Referenzbild",
    scope: reference.scope || "next_candidate",
    source: reference.source || null
  };
}

function mergeRuntimeReferenceImages(imageSpec = {}, extraReferences = [], options = {}) {
  const currentData = imageSpec.data || {};
  const existingReferences = options.includeImageSpecReferenceImages
    ? currentData.referenceImages || imageSpec.referenceImages || []
    : [];
  const references = [...existingReferences, ...(Array.isArray(extraReferences) ? extraReferences : [])]
    .map((reference, index) => normalizeReferenceImage(reference, index))
    .filter(Boolean);
  const seen = new Set();
  const mergedReferences = references
    .filter((reference) => {
      if (seen.has(reference.path)) {
        return false;
      }
      seen.add(reference.path);
      return true;
    })
    .slice(-4)
    .map((reference, index) => ({
      ...reference,
      id: reference.id || `ref_${String(index + 1).padStart(2, "0")}`
    }));

  return {
    ...imageSpec,
    data: {
      ...currentData,
      referenceImages: mergedReferences
    }
  };
}

function isInsideRoot(rootDir, filePath) {
  const relative = path.relative(rootDir, filePath);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

async function pathExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function resolveReferenceImages(projectDir, references = []) {
  const resolved = [];
  const seen = new Set();
  for (const reference of (Array.isArray(references) ? references : []).slice(0, 4)) {
    const refPath = String(reference.path || "").trim();
    if (!refPath) {
      continue;
    }
    const absolutePath = path.resolve(projectDir, refPath);
    if (!isInsideRoot(projectDir, absolutePath) || seen.has(absolutePath)) {
      continue;
    }
    if (!(await pathExists(absolutePath))) {
      continue;
    }
    seen.add(absolutePath);
    resolved.push({
      id: reference.id || `ref_${resolved.length + 1}`,
      role: reference.role || "style_reference",
      purpose: reference.purpose || "Referenzbild",
      path: toPosix(path.relative(projectDir, absolutePath)),
      absolutePath
    });
  }
  return resolved;
}

async function ensureRun(projectDir, input, options, approvalState) {
  if (input.runId) {
    return input.runId;
  }
  const runId = await latestRunId(projectDir);
  if (runId) {
    const manifest = await readJson(path.join(projectDir, "runs", runId, "run-manifest.json"));
    const sameContent = manifest.sourceArtifacts?.contentMirrorId === approvalState.approvedContentMirror?.id;
    const lessonBriefArtifact = approvalState.approvedLessonBrief || approvalState.currentLessonBrief || null;
    const sameBrief = (manifest.sourceArtifacts?.lessonbriefId || null) === (lessonBriefArtifact?.id || null);
    if (sameContent && sameBrief) {
      return runId;
    }
  }
  const run = await createRun(projectDir, options);
  return run.runId;
}

function requestedPageNumbers(input = {}) {
  const values = Array.isArray(input.pages) && input.pages.length
    ? input.pages.map((entry) => typeof entry === "number" ? entry : entry?.page)
    : input.pageNumber || input.page
      ? [input.pageNumber || input.page]
      : [];
  return [...new Set(values.map((value) => Number(value)).filter((value) => Number.isInteger(value) && value > 0))].sort((a, b) => a - b);
}

function filterPagePlans(pagePlans = [], pageNumbers = []) {
  if (!pageNumbers.length) {
    return pagePlans;
  }
  const wanted = new Set(pageNumbers);
  return pagePlans.filter((pagePlan) => wanted.has(Number(pagePlan.pageNumber)));
}

async function generateOpenAiAssets({ projectDir, runDir, candidateId, imageSheetBrief, imageSpec, pageCount, pageNumbers = [], requestConfig, now, variantInstruction = "" }) {
  const assets = [];
  const referenceImages = await resolveReferenceImages(projectDir, imageSpec?.data?.referenceImages || imageSpec?.referenceImages || []);
  const usesReferenceImages = referenceImages.length > 0;
  const allPagePlans = buildPagePlans(imageSheetBrief.contentMirror || {}, imageSheetBrief.lessonBrief || {}, pageCount, imageSpec);
  const pagePlans = filterPagePlans(allPagePlans, pageNumbers);
  if (!pagePlans.length) {
    throw new Error(`No matching page plan found for pages: ${pageNumbers.join(", ") || "all"}`);
  }
  for (const pagePlan of pagePlans) {
    const pageNumber = pagePlan.pageNumber;
    const role = pageRole(pageNumber, pagePlan);
    const prompt = promptForPage({
      imageSheetBrief,
      pageNumber,
      role,
      imageSpec,
      variantInstruction,
      pageCount: allPagePlans.length,
      pagePlan
    });
    const body = {
      model: requestConfig.imageModel,
      prompt,
      n: 1,
      size: requestConfig.imageSize,
      quality: requestConfig.imageQuality,
      output_format: requestConfig.imageOutputFormat,
      background: requestConfig.imageBackground,
      moderation: requestConfig.imageModeration
    };
    const imageBody = usesReferenceImages
      ? {
          ...body,
          imagePaths: referenceImages.map((reference) => reference.absolutePath)
        }
      : body;
    const startedAt = Date.now();
    let response;
    try {
      response = usesReferenceImages
        ? await createImageEdit(imageBody, requestConfig)
        : await createImageGeneration(imageBody, requestConfig);
    } catch (error) {
      await logModelRun(projectDir, {
        status: "error",
        source: "image_generation",
        purpose: "image_generation",
        route: "image_generation",
        model: requestConfig.imageModel,
        proposalId: imageSpec?.proposalId || null,
        durationMs: Date.now() - startedAt,
        error
      }, { now });
      throw error;
    }
    const image = response.data?.[0] || {};
    if (!image.b64_json) {
      throw new Error("OpenAI image response did not include base64 image data.");
    }
    const durationMs = Date.now() - startedAt;
    const asset = await writeImageAsset({
      runDir,
      candidateId,
      pageNumber,
      role,
      base64: image.b64_json,
      format: response.output_format || requestConfig.imageOutputFormat,
      metadata: {
        provider: "openai",
        model: requestConfig.imageModel,
        generationMode: usesReferenceImages ? "image_edit_with_references" : "image_generation",
        qualityPreset: requestConfig.imageQualityPreset,
        quality: requestConfig.imageQuality,
        size: requestConfig.imageSize,
        durationMs,
        responseCreated: response.created || null,
        revisedPrompt: image.revised_prompt || null,
        usage: response.usage || null,
        referencePolicy: imageSpec?.data?.referencePolicy || imageSpec?.referencePolicy || null,
        referenceImages: referenceImages.map(({ absolutePath, ...reference }) => reference)
      },
      now
    });
    assets.push({
      ...asset,
      prompt
    });
    await logModelRun(projectDir, {
      status: "success",
      source: "image_generation",
      purpose: "image_generation",
      route: "image_generation",
      model: requestConfig.imageModel,
      proposalId: imageSpec?.proposalId || null,
      responseId: response.id || null,
      durationMs,
      metadata: {
        generationMode: usesReferenceImages ? "image_edit_with_references" : "image_generation",
        referenceImageCount: referenceImages.length
      }
    }, { now });
  }
  return assets;
}

async function generateCodexAssets({ projectDir, runDir, candidateId, imageSheetBrief, imageSpec, pageCount, pageNumbers = [], requestConfig, now, variantInstruction = "" }) {
  const assets = [];
  const referenceImages = await resolveReferenceImages(projectDir, imageSpec?.data?.referenceImages || imageSpec?.referenceImages || []);
  const allPagePlans = buildPagePlans(imageSheetBrief.contentMirror || {}, imageSheetBrief.lessonBrief || {}, pageCount, imageSpec);
  const pagePlans = filterPagePlans(allPagePlans, pageNumbers);
  if (!pagePlans.length) {
    throw new Error(`No matching page plan found for pages: ${pageNumbers.join(", ") || "all"}`);
  }
  for (const pagePlan of pagePlans) {
    const pageNumber = pagePlan.pageNumber;
    const role = pageRole(pageNumber, pagePlan);
    const prompt = promptForPage({
      imageSheetBrief,
      pageNumber,
      role,
      imageSpec,
      variantInstruction,
      pageCount: allPagePlans.length,
      pagePlan
    });
    const startedAt = Date.now();
    let codexResult;
    try {
      codexResult = await runCodexImageJob({
        projectDir,
        runDir,
        candidateId,
        pageNumber,
        prompt,
        referenceImages,
        requestConfig,
        now
      });
    } catch (error) {
      await logModelRun(projectDir, {
        status: "error",
        source: "image_generation",
        purpose: "image_generation",
        route: "codex_image_generation",
        model: requestConfig.codexModel,
        provider: "codex_cli",
        proposalId: imageSpec?.proposalId || null,
        durationMs: Date.now() - startedAt,
        error
      }, { now });
      throw error;
    }
    const asset = await writeImageFileAsset({
      runDir,
      candidateId,
      pageNumber,
      role,
      sourcePath: codexResult.imagePath,
      format: "png",
      metadata: {
        provider: "codex_cli",
        model: requestConfig.codexModel,
        generationMode: "codex_builtin_image_generation",
        qualityPreset: requestConfig.imageQualityPreset,
        quality: requestConfig.imageQuality,
        requestedSize: requestConfig.imageSize,
        durationMs: codexResult.durationMs,
        codexSessionId: codexResult.sessionId,
        codexJobPath: codexResult.jobPath,
        codexFinalMessage: codexResult.finalMessage,
        codexStdoutPath: codexResult.stdoutPath,
        codexStderrPath: codexResult.stderrPath,
        referencePolicy: imageSpec?.data?.referencePolicy || imageSpec?.referencePolicy || null,
        referenceImages: referenceImages.map(({ absolutePath, ...reference }) => reference)
      },
      now
    });
    assets.push({
      ...asset,
      prompt
    });
    await logModelRun(projectDir, {
      status: "success",
      source: "image_generation",
      purpose: "image_generation",
      route: "codex_image_generation",
      model: requestConfig.codexModel,
      provider: "codex_cli",
      proposalId: imageSpec?.proposalId || null,
      responseId: codexResult.sessionId || null,
      durationMs: codexResult.durationMs,
      metadata: {
        generationMode: "codex_builtin_image_generation",
        referenceImageCount: referenceImages.length,
        codexJobPath: codexResult.jobPath
      }
    }, { now });
  }
  return assets;
}

async function generateImageCandidate(projectDir, input = {}, options = {}) {
  const now = input.now || options.now || new Date().toISOString();
  const approvalState = await assertCanGenerate(projectDir);
  const approvedContent = await readJson(path.join(projectDir, approvalState.approvedContentMirror.path));
  const lessonBriefArtifact = approvalState.approvedLessonBrief || approvalState.currentLessonBrief || null;
  const approvedBrief = lessonBriefArtifact
    ? await readJson(path.join(projectDir, lessonBriefArtifact.path))
    : {};
  const events = await readEvents(projectDir);
  const readiness = contentReadinessForGeneration(approvedContent, { events, brief: approvedBrief });
  if (!readiness.ready) {
    throw new Error(contentReadinessMessage(readiness));
  }
  const requestedProvider = input.imageProvider || input.provider || process.env.SHEETIFYIMG_IMAGE_PROVIDER;
  const runtime = getImageRuntimeStatus(process.env, {
    imageProvider: requestedProvider,
    imageQualityPreset: input.imageQualityPreset || input.imagePreset,
    imageQuality: input.imageQuality
  });
  if (runtime.status !== "ready") {
    throw new Error(runtime.fallbackReason || "Image generation is not configured.");
  }
  if (runtime.mode === "openai") {
    assertPaidConfirmation(runtime, input);
  }
  const imageSpec = await readActiveImageSpec(projectDir, input.imageSpecProposalId);
  if (!imageSpec) {
    throw new Error("Image generation requires an adopted ImageSpec.");
  }
  const runtimeImageSpec = mergeRuntimeReferenceImages(imageSpec, input.referenceImages, {
    includeImageSpecReferenceImages: input.useImageSpecReferenceImages === true
  });

  const runId = await ensureRun(projectDir, input, { ...options, now }, approvalState);
  const runDir = path.join(projectDir, "runs", runId);
  const runManifest = await readJson(path.join(runDir, "run-manifest.json"));
  const imageSheetBrief = await readJson(path.join(runDir, "brief.imagesheet.json"));
  const candidateId = input.candidateId || nextCandidateId(runManifest);
  const pageCount = clampPageCount(Number(input.pageCount) || runtimeImageSpec.data?.pageCount || runtimeImageSpec.pageCount || pageCountFromContent(imageSheetBrief.contentMirror || {}, runtimeImageSpec, imageSheetBrief.lessonBrief || {}));
  const pageNumbers = requestedPageNumbers(input);
  const variantInstruction = String(input.variantInstruction || input.message || "").trim();
  const requestConfig = getImageRequestConfig(process.env, {
    imageProvider: runtime.mode,
    imageQualityPreset: input.imageQualityPreset || input.imagePreset,
    imageQuality: input.imageQuality
  });
  const assets = requestConfig.mode === "codex_cli"
    ? await generateCodexAssets({ projectDir, runDir, candidateId, imageSheetBrief, imageSpec: runtimeImageSpec, pageCount, pageNumbers, requestConfig, now, variantInstruction })
    : await generateOpenAiAssets({ projectDir, runDir, candidateId, imageSheetBrief, imageSpec: runtimeImageSpec, pageCount, pageNumbers, requestConfig, now, variantInstruction });
  const generationMode = requestConfig.mode === "codex_cli"
    ? "codex_builtin_image_generation"
    : assets.some((asset) => asset.metadata?.generationMode === "image_edit_with_references")
      ? "image_edit_with_references"
      : "image_generation";
  const candidateReferenceImages = (runtimeImageSpec.data?.referenceImages || runtimeImageSpec.referenceImages || []).map((reference) => ({
    id: reference.id || null,
    role: reference.role || "style_reference",
    path: reference.path || null,
    purpose: reference.purpose || null,
    scope: reference.scope || "next_candidate"
  }));
  const chatMessage = await narrateChatMoment(projectDir, {
    kind: "candidate_created",
    fallback: assets.length < pageCount
      ? `${candidateId} ist als Seitenvariante fertig gerendert (${assets.map((asset) => `Seite ${asset.page}`).join(", ")}). Du kannst das PDF herunterladen, eine weitere Variante erzeugen oder das Konzept im Chat nachschärfen.`
      : `${candidateId} ist fertig gerendert. Du kannst das PDF herunterladen, eine weitere Variante erzeugen oder das Konzept im Chat nachschärfen.`,
    userMessage: variantInstruction,
    candidate: {
      id: candidateId,
      pageCount: assets.length,
      generation: {
        provider: requestConfig.mode === "codex_cli" ? "codex_cli" : "openai",
        model: requestConfig.mode === "codex_cli" ? requestConfig.codexModel : requestConfig.imageModel,
        generationMode,
        qualityLabel: requestConfig.imageQualityLabel,
        referenceImages: candidateReferenceImages,
        variantInstruction: variantInstruction || null,
        plannedPageCount: pageCount,
        generatedPages: assets.map((asset) => asset.page)
      }
    },
    workspace: {
      documents: {
        brief: { data: approvedBrief },
        content: { data: approvedContent }
      },
      latestRun: {
        runId,
        candidates: runManifest.candidates || []
      },
      chat: {
        messages: events
          .filter((event) => event.type === "user_message" || event.type === "assistant_message")
          .map((event) => ({
            role: event.type === "assistant_message" ? "assistant" : "user",
            content: event.payload?.message || ""
          }))
      }
    }
  }, {
    now,
    uiEvent: "candidate_created"
  });

  let candidate = await registerCandidate(projectDir, runId, {
    id: candidateId,
    status: "reviewable",
    pages: assets.map((asset) => ({
      page: asset.page,
      role: asset.role,
      path: asset.path,
      assetId: asset.assetId,
      prompt: asset.prompt,
      format: asset.format,
      width: null,
      height: null
    })),
    generation: {
      provider: requestConfig.mode === "codex_cli" ? "codex_cli" : "openai",
      model: requestConfig.mode === "codex_cli" ? requestConfig.codexModel : requestConfig.imageModel,
      generationMode,
      size: requestConfig.imageSize,
      qualityPreset: requestConfig.imageQualityPreset,
      qualityLabel: requestConfig.imageQualityLabel,
      quality: requestConfig.imageQuality,
      outputFormat: requestConfig.imageOutputFormat,
      pageCount,
      plannedPageCount: pageCount,
      generatedPageCount: assets.length,
      generatedPages: assets.map((asset) => asset.page),
      confirmedPaidRun: requestConfig.mode === "openai" && input.confirmPaidRun === true,
      confirmedCodexRun: requestConfig.mode === "codex_cli",
      imageSpecProposalId: runtimeImageSpec.proposalId,
      imageSpecSummary: runtimeImageSpec.summary || runtimeImageSpec.title || null,
      referencePolicy: runtimeImageSpec.data?.referencePolicy || runtimeImageSpec.referencePolicy || null,
      referenceImages: candidateReferenceImages,
      variantInstruction: variantInstruction || null
    },
    chatMessage,
    notes: [
      requestConfig.mode === "codex_cli"
        ? "Generated with Codex built-in image generation after explicit confirmation."
        : "Generated with OpenAI Image API after explicit confirmation.",
      ...(variantInstruction ? [`Variant instruction: ${variantInstruction}`] : [])
    ]
  }, { ...options, now });

  try {
    const pdf = await createCandidatePdf(projectDir, runId, candidateId, { ...options, now });
    candidate = {
      ...candidate,
      pdf
    };
  } catch (error) {
    candidate = await recordCandidatePdfError(projectDir, runId, candidateId, error, { ...options, now });
  }

  const qc = await runCandidateTechnicalQc(projectDir, runId, candidateId, { ...options, now });
  return {
    runId,
    candidate,
    assets,
    qc
  };
}

module.exports = {
  generateImageCandidate,
  promptForPage,
  pageCountFromContent,
  buildPagePlans
};
