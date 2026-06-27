"use strict";

const { referencePolicyPromptLines } = require("../referencePolicy");
const {
  buildPagePlans,
  clampPageCount,
  pageCountFromContent,
  pageRole,
  sheetNumbersMentioned
} = require("../pagePlanManager");

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
  const lines = ["Angewendete SheetifyIMG-Regeln fuer diese Entwurfserstellung:"];
  for (const rule of rules.slice(0, 12)) {
    lines.push(`- ${rule.id || rule.title}: ${rule.title || "Regel"}`);
    for (const instruction of (rule.instructions || []).slice(0, 6)) {
      lines.push(`  - ${instruction}`);
    }
  }
  return lines.join("\n");
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

function imageSpecLines(imageSpec, pagePlan = null) {
  const spec = imageSpec?.data || imageSpec || null;
  if (!spec) {
    return [];
  }
  const mustShow = visibleSpecItems(spec.mustShow)
    .filter((item) => itemAppliesToPagePlan(item, pagePlan));
  const avoid = visibleSpecItems(spec.avoid);
  const references = spec.referenceImages || [];
  const style = [
    spec.style || "clean_scientific",
    spec.styleNotes
  ].filter(Boolean).join("; ");
  return [
    "Interne visuelle Ableitung aus dem freigegebenen Arbeitsblatt-Konzept:",
    isSolutionText(spec.visualBrief) ? "" : `Bildabsicht: ${spec.visualBrief || spec.purpose || "vollstaendige Arbeitsblattseite"}`,
    isSolutionText(spec.layoutIntent) ? "" : `Layoutabsicht: ${spec.layoutIntent || spec.placement || "klare DIN-A4-Arbeitsblattseite"}`,
    isSolutionText(spec.purpose) ? "" : `Zweck: ${spec.purpose || "Arbeitsblatt-Bildmaterial"}`,
    `Lernfunktion: ${spec.learningFunction || "Material veranschaulichen"}`,
    `Stil: ${style}`,
    isSolutionText(spec.placement) ? "" : `Platzierung: ${spec.placement || "auto"}`,
    `Muss zeigen: ${mustShow.join(", ") || spec.topic || ""}`,
    `Vermeiden: ${avoid.join(", ") || "Logos, Wasserzeichen, dekorative Unruhe"}`,
    appliedRuleLines(spec),
    ...referencePolicyPromptLines(spec.referencePolicy, references),
    referenceImageLines(spec),
    "Textregel: sichtbarer Text ist erlaubt und gewuenscht, aber ausschliesslich aus dem freigegebenen Arbeitsblatttext."
  ].filter(Boolean);
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

function explicitLanguageHint(value) {
  const text = normalizeText(value);
  if (!text) {
    return null;
  }
  if (/\b(no german|english[- ]only|only english|simple english|english instructions|no german text|english visible text|visible text only english)\b/.test(text)
    || /\b(sichtbare sprache|sichtbarer text|sichtbare labels|abschnittsueberschriften)\b.{0,60}\b(englisch|english)\b/.test(text)
    || /\b(englischsprachig|keine deutschen sichtbaren labels|keine deutschen labels)\b/.test(text)) {
    return "en";
  }
  if (/\b(no english|german[- ]only|only german|german visible text|visible text only german)\b/.test(text)
    || /\b(sichtbare sprache|sichtbarer text|sichtbare labels|abschnittsueberschriften)\b.{0,60}\b(deutsch|german)\b/.test(text)
    || /\b(deutschsprachig|keine englischen sichtbaren labels|keine englischen labels)\b/.test(text)) {
    return "de";
  }
  return null;
}

function worksheetLanguage(contentMirror = {}, lessonBrief = {}) {
  const visibleText = [
    contentMirror.title,
    ...(contentMirror.readingTexts || []).flatMap((entry) => [entry.title, entry.body]),
    ...(contentMirror.tasks || []).flatMap((entry) => [entry.prompt, entry.text])
  ].filter(Boolean).join("\n");
  const explicitVisibleHint = explicitLanguageHint(visibleText);
  if (explicitVisibleHint) {
    return explicitVisibleHint;
  }
  const text = normalizeText(visibleText);

  const englishSignals = [
    /\bexam information\b/g,
    /\bintroduce yourself\b/g,
    /\bdescribe the picture\b/g,
    /\bdiscussion\b/g,
    /\bstate your opinion\b/g,
    /\bpros and cons\b/g,
    /\bshould\b/g,
    /\bwith a partner\b/g,
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

  if (englishSignals >= 3 && englishSignals > germanSignals) {
    return "en";
  }
  if (germanSignals >= 2 && germanSignals > englishSignals) {
    return "de";
  }

  const fallbackHint = explicitLanguageHint([
    lessonBrief.outputPreference?.language,
    lessonBrief.outputPreference?.worksheetLanguage,
    ...(Array.isArray(lessonBrief.requirements) ? lessonBrief.requirements : [])
  ].filter(Boolean).join("\n"));
  return fallbackHint || "de";
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
    if (pagePlan.kind !== "worksheet" && pagePlan.title) {
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
      "Zeige nur die Inhalte dieses Sheets; presse keine weiteren Sheets auf dieselbe Seite.",
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

function normalizeContentChangePolicy(value) {
  const policy = String(value || "preserve_approved_text").trim().toLowerCase();
  if (["preserve_approved_text", "approved_text_only", "text_lock"].includes(policy)) {
    return "preserve_approved_text";
  }
  return "preserve_approved_text";
}

function normalizeChangeScope(value, variantInstruction = "") {
  const scope = String(value || "").trim().toLowerCase();
  if (scope === "visual_only") {
    return "visual_only";
  }
  return String(variantInstruction || "").trim()
    ? "visual_only"
    : "candidate_from_concept";
}

function textLockInstruction({ contentChangePolicy = "preserve_approved_text", changeScope = "candidate_from_concept" } = {}) {
  if (normalizeContentChangePolicy(contentChangePolicy) !== "preserve_approved_text") {
    return "";
  }
  if (normalizeChangeScope(changeScope) === "visual_only") {
    return [
      "VISUELLE NACHBEARBEITUNG MIT TEXT-LOCK:",
      "Aendere nur Bildmotiv, Layout, Stil, Lesbarkeit, Abstaende, Farben, Bildausschnitt oder Referenznaehe.",
      "Titel, Abschnittsueberschriften, Aufgaben, Materialtexte, Hinweise und Standardformulierungen muessen aus dem freigegebenen sichtbaren Arbeitsblatttext kommen.",
      "Lasse diese Haupttexte nicht weg und formuliere sie nicht um.",
      "Wenn ein Referenzbild oder alter Entwurf anderen Text zeigt, ignoriere diesen Text; die freigegebene Konzeptfassung hat Vorrang."
    ].join(" ");
  }
  return "TEXT-LOCK: Sichtbarer Haupttext kommt aus dem freigegebenen Arbeitsblatt-Konzept. Text- oder Aufgabenänderungen brauchen zuerst eine Konzeptänderung, nicht nur eine Bildgenerierung.";
}

function promptForPage({
  imageSheetBrief,
  pageNumber,
  role,
  imageSpec = null,
  variantInstruction = "",
  pageCount = 1,
  pagePlan = null,
  requestedSize = "",
  contentChangePolicy = "preserve_approved_text",
  changeScope = "candidate_from_concept"
}) {
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
  const pixelInstruction = requestedSize
    ? `Zielcanvas: exakt ${requestedSize} Pixel, Hochformat. Wenn das Bildsystem Pixelmaße akzeptiert, muss die komplette PNG-Ausgabe genau ${requestedSize} groß sein.`
    : "";
  return [
    `Erzeuge ein vollstaendiges ${headings.worksheetLanguageLabel} Arbeitsblatt als ein einziges Image-First-Bild.`,
    "NICHT VERHANDELBAR: DIN A4 portrait, Seitenverhaeltnis 1:sqrt(2) bzw. 210:297. Keine 16:9-Komposition, kein Querformat, kein quadratisches Poster, kein 2:3-Posterformat.",
    pixelInstruction,
    `Image-First: Das Bild ist das Arbeitsblatt. Setze Titel, passende Abschnittsueberschriften, ${headings.material}, ${headings.tasks}, Illustration und Schreiblinien direkt im Bild.`,
    "Fachkontext fuer die Illustration:",
    `Thema: ${contentMirror.title || lessonBrief.topic || "Arbeitsblatt"}`,
    `Fach/Zielgruppe: ${lessonBrief.subject || "Unterricht"} ${lessonBrief.targetGroup || ""}`.trim(),
    `Illustrationsrolle: ${actualRole}, Seite ${pageNumber} von ${actualPageCount}`,
    approvedVisibleText ? `Freigegebener sichtbarer Arbeitsblatttext - exakt diese Inhalte verwenden:\n${approvedVisibleText}` : "",
    hiddenSolutions ? `Nicht sichtbar setzen, nur fuer interne Passungspruefung:\n${hiddenSolutions}` : "",
    pageMaterialLines ? `Freigegebener Bildbedarf fuer diese Seite:\n${pageMaterialLines}` : "",
    ...imageSpecLines(imageSpec, currentPagePlan),
    compositionInstruction({ role: actualRole, pageNumber, pageCount: actualPageCount, language, pagePlan: currentPagePlan }),
    "Grundstil: klar, schulisch, sachlich, gut druckbar, hochwertige Arbeitsblattseite, keine dekorativen Logos.",
    headings.visibleLanguageRule,
    "Nummerierungsregel: Nummeriere jede Aufgabe genau einmal. Wenn der freigegebene Aufgabentext schon Nummern oder Labels enthielt, sind diese im sichtbaren Text bereits bereinigt. Erzeuge niemals doppelte Nummern wie '1. 1.' oder '1. Aufgabe 1'.",
    "Content-Control: Teacher controls content. Verwende sichtbar nur den freigegebenen Text oben. Erfinde keine weiteren Aufgaben, Labels, Quellen, Antworten, Fussnoten oder Erklaertexte.",
    textLockInstruction({ contentChangePolicy, changeScope }),
    "Keine Umgebungs-Texte: Tafel, Whiteboard, Poster, Bildschirm, Buchseiten, Handy-Displays und Dekoelemente muessen leer, unscharf oder unlesbar bleiben, ausser ihr Text steht explizit im freigegebenen sichtbaren Arbeitsblatttext.",
    "Texttreue: Uebernimm den freigegebenen sichtbaren Arbeitsblatttext moeglichst wortgetreu. Bei Unsicherheit lieber weniger Zusatzgestaltung statt neuen Text erfinden.",
    "Loesungen duerfen auf der Arbeitsblattseite nicht sichtbar sein. Nutze Loesungserwartungen nur als unsichtbaren Kontext fuer die Aufgabenpassung.",
    visualVariantInstruction
      ? `Variantenwunsch fuer diesen Entwurf: ${visualVariantInstruction}. Wichtig: Nutze das nur fuer Layout, Stil, Bildkomposition, Lesbarkeit und visuelle Gewichtung. Aendere keine freigegebenen Aufgaben, Texte oder fachlichen Inhalte. Wenn der Wunsch doch eine Text- oder Aufgabenänderung verlangt, setze sie nicht im Bild um.`
      : "",
    "Das Bild soll wie ein fertiges, hochwertiges Arbeitsblatt wirken."
  ].filter(Boolean).join("\n");
}

module.exports = {
  buildPagePlans,
  clampPageCount,
  normalizeChangeScope,
  normalizeContentChangePolicy,
  pageCountFromContent,
  pageRole,
  promptForPage
};
