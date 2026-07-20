"use strict";

const { referencePolicyPromptLines } = require("../referencePolicy");
const {
  buildPagePlans,
  clampPageCount,
  pageCountFromContent,
  pageVisualContract,
  pageRole,
  sheetNumbersMentioned
} = require("../pagePlanManager");
const { normalizeReadingTexts } = require("../readingTextManager");
const { visibleTaskEntries, visibleTaskLines } = require("../taskLabelManager");
const {
  REFERENCE_ROLES,
  effectiveReferenceRole,
  referenceRoleInstruction,
  referenceTextBoundaryInstruction,
  referenceTargetLine
} = require("./referenceRoles");

const MAX_APPLIED_RULES_IN_FINAL_PROMPT = 10;
const MAX_IMAGE_SPEC_ITEM_COUNT = 5;

function materialLinesForPage(contentMirror, pagePlan = null) {
  const visualContract = pagePlan ? activeVisualContract(pagePlan) : null;
  if (visualContract?.pageRole === "tasks_only") {
    return "";
  }
  const materials = Array.isArray(contentMirror.imageMaterials) ? contentMirror.imageMaterials : [];
  const explicitMaterialIds = new Set(pagePlan?.imageMaterialIds || []);
  const relevantMaterials = explicitMaterialIds.size
    ? materials.filter((material) => explicitMaterialIds.has(material.id))
    : pagePlan?.explicitPageContract
    ? []
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
    .map((material, index) => `${index + 1}. ${sanitizeInternalLabelText(material.prompt || material.description || material.purpose)}`)
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

function compactUniqueItems(items = []) {
  const seen = new Set();
  const result = [];
  for (const item of items) {
    const text = String(item || "").trim();
    const key = normalizeText(text);
    if (!text || seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push(text);
  }
  return result;
}

function sanitizeAvoidSpecItem(item) {
  const text = String(item || "").trim();
  const normalized = normalizeText(text);
  if (/\b(name|klasse|datum|punkte|note|noten|standardfeld|kopfzeile|bewertungsfeld|verwaltungsfeld)\b/.test(normalized)) {
    return "keine nicht angeforderten Kopfzeilen-, Bewertungs- oder Verwaltungsfelder";
  }
  if (/\b(materialseite|aufgabenseite|aufgabenteil|seitenlabel|bereichslabel|rollenlabel|generische(?:n|r|s)?\s+(?:titel|labels?|rollenlabels?)|lesetext|kurzinfo|infotext|sachtext|quelle)\b/.test(normalized)
    || (/\bmaterial\b/.test(normalized) && /\b(label|titel|ueberschrift|redundant|sichtbar)\b/.test(normalized))) {
    return "keine nicht freigegebenen Rollen-, Bereichs- oder Seitenlabels";
  }
  return text;
}

function sanitizeInternalLabelText(value) {
  return String(value || "")
    .trim()
    .replace(/\bMaterialseite\b/gi, "Seite mit Lesetext")
    .replace(/\bAufgabenseite\b/gi, "Seite mit Aufgaben")
    .replace(/\bMaterial-\s*oder\s*Leseseite\b/gi, "Seite mit Lesetext")
    .replace(/\bMaterial-\s*und\s*Aufgabenhierarchie\b/gi, "Text- und Aufgabenhierarchie")
    .replace(/\bMaterial-\/Aufgabenhierarchie\b/gi, "Text- und Aufgabenhierarchie");
}

function itemAppliesToPagePlan(item, pagePlan = null) {
  if (!pagePlan) {
    return true;
  }
  const mentioned = sheetNumbersMentioned(item);
  return mentioned.size === 0 || mentioned.has(pagePlan.sheetNumber) || mentioned.has(pagePlan.pageNumber);
}

function compactRuleInstructionText(value) {
  return String(value || "").trim().replace(/\s*\n+\s*/g, " / ").replace(/\s{2,}/g, " ");
}

function compactForPrompt(value, maxChars = 260) {
  const text = compactRuleInstructionText(sanitizeInternalLabelText(value));
  if (!text || text.length <= maxChars) {
    return text;
  }
  const shortened = text.slice(0, maxChars).replace(/\s+\S*$/, "").trim();
  return shortened ? `${shortened} ...` : text.slice(0, maxChars);
}

function compactPromptItems(items = [], maxItems = MAX_IMAGE_SPEC_ITEM_COUNT, maxChars = 160) {
  return compactUniqueItems(items)
    .slice(0, maxItems)
    .map((item) => compactForPrompt(item, maxChars))
    .filter(Boolean);
}

function didacticControlInstruction(lessonBrief = {}) {
  const goal = compactForPrompt(lessonBrief.goal, 240);
  const requirements = compactPromptItems(
    (Array.isArray(lessonBrief.requirements) ? lessonBrief.requirements : [])
      .filter((item) => !isSolutionText(item)),
    4,
    150
  );
  if (!goal && !requirements.length) {
    return "";
  }
  return [
    "Didaktischer Steuerungskontext (nur intern; nicht als zusaetzlichen sichtbaren Text setzen):",
    goal ? `Lernziel: ${goal}` : "",
    requirements.length ? `Wichtige Anforderungen: ${requirements.join("; ")}` : ""
  ].filter(Boolean).join("\n");
}

function canonicalRuleDirective(rule = {}) {
  const id = String(rule.id || "").trim();
  const known = {
    "worksheet_design.no_visible_solutions": "Loesungen nicht sichtbar; normale Arbeitsblaetter enthalten keine Musterantworten oder Erwartungshorizonte.",
    "worksheet_design.label_ownership": "Benennungen eindeutig, aber nicht redundant; Rollen-, Seiten- und Blocklabels nicht doppelt sichtbar machen.",
    "worksheet_design.reading_text_titles": "Lesetext-/Infotexttitel fachlich setzen; keine generischen Rollen- oder Containerueberschriften erfinden.",
    "worksheet_design.no_default_name_fields": "Keine Name/Klasse/Datum/Punkte/Noten-Felder ohne ausdruecklichen Auftrag.",
    "worksheet_design.no_double_numbering": "Aufgaben genau einmal nummerieren; keine Muster wie 1. 1. oder 2. Aufgabe 2.",
    "worksheet_design.connected_page_marker": "Bei verbundenen Mehrseiten bleibt der kleine Seitenhinweis oben rechts am selben sicheren Randanker.",
    "worksheet_design.template_adaptation": "Vorlagen nur adaptiv als Rohblatt nutzen; Seitenvertrag und freigegebener Inhalt entscheiden Blockanzahl, Text-, Aufgaben- und Bildslots.",
    "worksheet_design.worksheet_economy": "Weicher Standard fuer klare Bloecke, genug Weissraum, funktionale Illustrationen und gut beschreibbare Antwortflaechen; explizite Nutzerwuensche bleiben staerker.",
    "worksheet_design.answer_surface_semantics": "Antwortfl.: Itemzahl=1./2./3.; Erklaerung=Linien; Zuordnung=leer, keine Loesung.",
    "didactic.matching_tasks": "Zuordnungsaufgaben nicht sichtbar aufloesen; gemischte Optionen und genug Bearbeitungsraum lassen.",
    "didactic.multiple_choice_quality": "Multiple-Choice-Aufgaben ohne erkennbare Musterloesung oder verratende Antwortreihenfolge rendern."
  };
  if (known[id]) {
    return `${id}: ${known[id]}`;
  }
  const instructions = Array.isArray(rule.imagePromptInstructions) && rule.imagePromptInstructions.length
    ? rule.imagePromptInstructions
    : rule.instructions || [];
  const directive = compactForPrompt(rule.directive || instructions[0] || rule.title || "Regel beachten", 190);
  return `${id || rule.title || "Regel"}: ${directive}`;
}

function appliedRuleLines(imageSpec = {}) {
  const rules = Array.isArray(imageSpec.appliedRules) ? imageSpec.appliedRules : [];
  if (!rules.length) {
    return "";
  }
  const lines = ["Angewendete SheetifyIMG-Regeln (kompakt):"];
  for (const rule of rules.slice(0, MAX_APPLIED_RULES_IN_FINAL_PROMPT)) {
    lines.push(`- ${canonicalRuleDirective(rule)}`);
  }
  return lines.join("\n");
}

function activeVisualContract(pagePlan = null) {
  return pagePlan?.visualContract || pageVisualContract(pagePlan || {});
}

function pageVisualRoleLabel(pageRole = "") {
  if (pageRole === "tasks_only") {
    return "reine Seite mit Aufgaben ohne freigegebenes Bildmaterial";
  }
  if (pageRole === "tasks_with_material") {
    return "Seite mit Aufgaben und genau freigegebenem Bildmaterial";
  }
  if (pageRole === "reading_with_material") {
    return "Leseseite mit freigegebenem Material";
  }
  if (pageRole === "reading_page") {
    return "Leseseite";
  }
  if (pageRole === "mixed_with_material") {
    return "gemischte Seite mit Text, Aufgaben und freigegebenem Material";
  }
  if (pageRole === "mixed_text_tasks") {
    return "gemischte Seite mit Text und Aufgaben";
  }
  return "freigegebene Arbeitsblattseite";
}

function pageVisualContractInstruction(pagePlan = null) {
  if (!pagePlan) {
    return "";
  }
  const contract = activeVisualContract(pagePlan);
  return [
    `Visueller Seitenvertrag: ${pageVisualRoleLabel(contract.pageRole)}.`,
    contract.allowedVisualSlots?.length
      ? `Erlaubte visuelle Elemente: ${contract.allowedVisualSlots.join("; ")}.`
      : "",
    contract.disallowedVisualSlots?.length
      ? `Nicht erlaubt ohne explizite Freigabe: ${contract.disallowedVisualSlots.join("; ")}.`
      : "",
    contract.allowedVisualSlots?.some((slot) => /seitenhinweis/i.test(slot))
      ? "Seitenhinweis-Anker: app-eigener Seitenhinweis oben rechts im sicheren Seitenrand, gleiche Position auf allen verbundenen Seiten; Vorlagen duerfen diesen Anker nicht verschieben."
      : "",
    contract.templateCarryoverPolicy ? `Vorlagenprioritaet: ${compactForPrompt(contract.templateCarryoverPolicy, 220)}` : ""
  ].filter(Boolean).join(" ");
}

function referenceVisualContractInstruction(role = "", purpose = "", pagePlan = null) {
  if (!pagePlan) {
    return "";
  }
  const effectiveRole = effectiveReferenceRole(role, purpose);
  const templateLike = effectiveRole === REFERENCE_ROLES.LAYOUT || effectiveRole === REFERENCE_ROLES.STYLE_LAYOUT;
  if (!templateLike) {
    return "";
  }
  const contract = activeVisualContract(pagePlan);
  const allowsPageMarker = contract.allowedVisualSlots?.some((slot) => /seitenhinweis/i.test(slot));
  const pageMarkerAnchor = allowsPageMarker
    ? "App-eigener Seitenhinweis: Marker wie `Seite X von Y` bleibt oben rechts im sicheren Seitenrand an derselben Position; Vorlage darf Stil geben, aber den Marker nicht verschieben."
    : "Seitenhinweis-Schutz: Diese Seite ist kein verbundenes Mehrseitenblatt; uebernimm keinen Seitenhinweis aus der Vorlage und erzeuge keinen einseitigen oder fremden mehrseitigen Seitenmarker.";
  if (contract.pageRole === "tasks_only") {
    return `Einschraenkung durch aktiven Seitenvertrag: Reine Seite mit Aufgaben; Vorlage nur fuer Kopfbereich, Randlogik, Abstaende, Aufgabenrhythmus, Nummerierung, Linienlogik und kleine Strukturmarker nutzen. Uebernimm keine Bildfelder, Materialkaesten, Karten, Diagramme, grossen Illustrationen oder Bildinhalte aus der Vorlage; alte Bildslots werden Aufgaben- und Schreibraum. ${pageMarkerAnchor}`;
  }
  if (contract.pageRole === "tasks_with_material") {
    return `Einschraenkung durch aktiven Seitenvertrag: Vorlage darf Aufgabenkomposition tragen; Bildfelder nur fuer freigegebenes Bildmaterial dieser Seite, keine zusaetzlichen generischen Bilder. ${pageMarkerAnchor}`;
  }
  return pageMarkerAnchor;
}

function referenceImageLines(imageSpec = {}, pagePlan = null) {
  const references = Array.isArray(imageSpec.referenceImages) ? imageSpec.referenceImages : [];
  if (!references.length) {
    return "";
  }
  return [
    "Direkte Bildreferenzen fuer das Bildmodell:",
    "Referenzrollen sind funktional: Materialbild = lokaler Inhalt, Stil = Look, Aufbau = Komposition, Vorlage = Stil plus Aufbau. Freigegebener Arbeitsblattinhalt bleibt verbindlich.",
    ...references.map((reference, index) => {
      const purpose = sanitizeInternalLabelText(reference.purpose || "Referenzbild");
      const role = effectiveReferenceRole(reference.role, purpose);
      const userDetails = sanitizeInternalLabelText(reference.userDetails || reference.details || "");
      const qrRule = /qr|barcode|code_asset|exact_qr/i.test(`${role} ${purpose} ${userDetails}`)
        ? " QR-Code/Barcode exakt als scharfes quadratisches Muster aus der Referenz uebernehmen, nicht stilisieren, nicht perspektivisch verzerren, nicht neu erfinden. Schwarze und weisse Module, Quiet Zone/Rand und quadratische Gesamtform muessen erhalten bleiben. Scanbarkeit ist wichtiger als Dekoration oder Stilangleichung."
        : "";
      const factualRule = /content|factual|map|karte|coordinate|koordinat|diagramm|template/i.test(`${role} ${purpose} ${userDetails}`)
        ? " Uebernimm die fachliche Struktur, Geometrie oder Positionen aus der Referenz moeglichst stabil; erfinde keine abweichenden Fakten."
        : "";
      return [
        `${index + 1}. ${role}: ${purpose}.`,
        referenceTargetLine(reference),
        referenceRoleInstruction(role, purpose),
        referenceVisualContractInstruction(role, purpose, pagePlan),
        userDetails ? `User-Hinweis: ${userDetails}.` : "",
        "Nutze die Referenz nur fuer den beschriebenen Zweck.",
        referenceTextBoundaryInstruction(role, purpose),
        factualRule.trim(),
        qrRule.trim()
      ].filter(Boolean).join(" ");
    })
  ].join("\n");
}

function imageSpecLines(imageSpec, pagePlan = null) {
  const spec = imageSpec?.data || imageSpec || null;
  if (!spec) {
    return [];
  }
  const references = spec.referenceImages || [];
  const hasTemplateLikeReference = references.some((reference) => {
    const role = effectiveReferenceRole(reference.role, reference.purpose || reference.userDetails || reference.details || "");
    return role === REFERENCE_ROLES.LAYOUT || role === REFERENCE_ROLES.STYLE_LAYOUT;
  });
  const mustShow = visibleSpecItems(spec.mustShow)
    .map(sanitizeInternalLabelText)
    .filter((item) => itemAppliesToPagePlan(item, pagePlan));
  const avoid = visibleSpecItems(spec.avoid).map(sanitizeAvoidSpecItem).map(sanitizeInternalLabelText);
  const style = [
    spec.style || "clean_scientific",
    spec.styleNotes
  ].filter(Boolean).join("; ");
  const visualBrief = isSolutionText(spec.visualBrief)
    ? ""
    : compactForPrompt(spec.visualBrief || spec.purpose || "vollstaendige Arbeitsblattseite", 280);
  const layoutIntent = hasTemplateLikeReference
    ? "Aktiver Seitenvertrag und Referenzrolle haben Vorrang; alte Layoutnotizen nur nutzen, soweit sie keine Text-, Aufgaben- oder Bildslots anderer Seiten eintragen."
    : compactForPrompt(isSolutionText(spec.layoutIntent) ? "" : (spec.layoutIntent || spec.placement || "klare DIN-A4-Arbeitsblattseite"), 260);
  const learningFunction = isSolutionText(spec.learningFunction) ? "" : compactForPrompt(spec.learningFunction || "", 180);
  const mustShowLine = compactPromptItems(mustShow, MAX_IMAGE_SPEC_ITEM_COUNT, 160).join("; ")
    || compactForPrompt(spec.topic || "", 160);
  const avoidLine = compactPromptItems(avoid, MAX_IMAGE_SPEC_ITEM_COUNT, 150).join("; ")
    || "Logos, Wasserzeichen, dekorative Unruhe";
  return [
    "Interne visuelle Ableitung aus dem Arbeitsblatt-Konzept:",
    visualBrief ? `Bildabsicht: ${visualBrief}` : "",
    layoutIntent ? `Layoutprioritaet: ${layoutIntent}` : "",
    learningFunction ? `Lernfunktion: ${learningFunction}` : "",
    `Stil: ${compactForPrompt(style, 220)}`,
    mustShowLine ? `Muss zeigen: ${mustShowLine}` : "",
    `Vermeiden: ${avoidLine}`,
    appliedRuleLines(spec),
    ...referencePolicyPromptLines(spec.referencePolicy, references),
    referenceImageLines(spec, pagePlan),
    "Textregel: sichtbarer Text ist erlaubt und gewuenscht, aber ausschliesslich aus dem freigegebenen Arbeitsblatttext."
  ].filter(Boolean);
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
    || /\b(?:einfache|simple|sichtbare|visible)?\s*(?:englisch|englische|englischer|englisches|english)\s+(?:sprache|language|instructions?|aufgaben|texte?|text)\b/.test(text)
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

  const words = text.match(/[a-z']+/g) || [];
  const englishWords = new Set(["a", "an", "and", "are", "as", "at", "be", "beginning", "between", "can", "changes", "choose", "cycle", "describe", "each", "explain", "find", "first", "forms", "from", "how", "in", "into", "is", "it", "moves", "of", "on", "one", "or", "students", "that", "the", "then", "through", "to", "use", "water", "when", "with", "write"]);
  const germanWords = new Set(["als", "auf", "aus", "beschreibe", "das", "der", "die", "durch", "ein", "eine", "erkläre", "erklaere", "für", "fuer", "in", "ist", "mit", "oder", "schreibe", "und", "von", "wasser", "wenn", "wie", "zu"]);
  const englishWordScore = words.filter((word) => englishWords.has(word)).length;
  const germanWordScore = words.filter((word) => germanWords.has(word)).length;

  if ((englishSignals >= 3 || englishWordScore >= 5) && englishSignals + englishWordScore > germanSignals + germanWordScore) {
    return "en";
  }
  if ((germanSignals >= 2 || germanWordScore >= 5) && germanSignals + germanWordScore > englishSignals + englishWordScore) {
    return "de";
  }

  const fallbackHint = explicitLanguageHint([
    lessonBrief.subject,
    lessonBrief.outputPreference?.language,
    lessonBrief.outputPreference?.worksheetLanguage,
    lessonBrief.outputPreference?.style,
    lessonBrief.outputPreference?.layout,
    ...(Array.isArray(lessonBrief.requirements) ? lessonBrief.requirements : [])
  ].filter(Boolean).join("\n"));
  return fallbackHint || "de";
}

function sectionHeadings(language = "de") {
  if (language === "en") {
    return {
      titlePrefix: "Title",
      sectionPrefix: "Section heading",
      material: "Reading text",
      tasks: "Tasks",
      worksheetLanguageLabel: "englischsprachiges",
      visibleLanguageRule: "Sichtbare Sprache: Englisch. Sichtbare Abschnittsueberschriften muessen aus dem freigegebenen Text, konkreten fachlichen Texttiteln oder dem Aufgabenblock stammen. Fuege keine zusaetzlichen Rollen- oder Seitenlabels hinzu. Verwende keine deutschen sichtbaren Labels oder deutschen Arbeitsblatt-Anweisungen."
    };
  }
  return {
    titlePrefix: "Titel",
    sectionPrefix: "Abschnittsueberschrift",
    material: "Lesetext",
    tasks: "Aufgaben",
    worksheetLanguageLabel: "deutschsprachiges",
    visibleLanguageRule: "Sichtbare Sprache: Deutsch. Sichtbare Abschnittsueberschriften muessen aus dem freigegebenen Text, konkreten fachlichen Texttiteln oder dem Aufgabenblock stammen. Fuege keine zusaetzlichen Rollen- oder Seitenlabels hinzu."
  };
}

function outputPreferenceText(contentMirror = {}) {
  const preference = contentMirror.outputPreference || {};
  return [
    preference.layout,
    preference.hierarchy,
    preference.style,
    preference.format
  ].filter(Boolean).join("\n");
}

function prefersMinimalWorksheetHierarchy(contentMirror = {}) {
  const text = normalizeText([
    contentMirror.title,
    outputPreferenceText(contentMirror),
    ...(Array.isArray(contentMirror.readingTexts) ? contentMirror.readingTexts.flatMap((entry) => [entry.title, entry.body]) : [])
  ].filter(Boolean).join("\n"));
  return /\b(minimal|single_task_sheet|compact_task_sheet|task_sheet|einseitig|reines aufgabenblatt|aufgabenblatt|aufgabenseite|keine doppelte|keine redundante|nur (?:die )?aufgaben|keine schreiblinien|ohne schreiblinien|keine loesungsfelder|keine losungsfelder|nur eine hauptueberschrift)\b/.test(text);
}

function prefersNoWritingLines(contentMirror = {}) {
  const text = normalizeText([
    outputPreferenceText(contentMirror),
    ...(Array.isArray(contentMirror.readingTexts) ? contentMirror.readingTexts.flatMap((entry) => [entry.title, entry.body]) : []),
    ...(Array.isArray(contentMirror.tasks) ? contentMirror.tasks.flatMap((entry) => [entry.prompt]) : []),
    ...(Array.isArray(contentMirror.solutionNotes) ? contentMirror.solutionNotes : [])
  ].filter(Boolean).join("\n"));
  return /\b(keine|ohne|no|without)\s+(?:schreiblinien|antwortlinien|antwortfelder|antwortflaechen|loesungsfelder|losungsfelder|writing lines|answer lines|answer fields|answer area)\b/.test(text)
    || /\bkein(?:e|en)?\s+(?:vorgesehener\s+)?antwortbereich\b/.test(text);
}

function titleAlreadyNamesTasks(title = "", language = "de") {
  const text = normalizeText(title);
  if (language === "en") {
    return /\b(tasks?|worksheet|exercises?)\b/.test(text);
  }
  return /\b(aufgaben|aufgabenblatt|arbeitsblatt)\b/.test(text);
}

function shouldShowMaterialHeading(contentMirror = {}, pagePlan = null) {
  return false;
}

function visibleReadingTitleKey(value) {
  return normalizeText(value).replace(/[^a-z0-9]+/g, " ").trim();
}

function visibleReadingTextLines(readingTexts = [], language = "de", limit = 6, options = {}) {
  const omittedTitleKeys = new Set((options.omitTitles || [])
    .flatMap((title) => [
      visibleReadingTitleKey(title),
      visibleReadingTitleKey(visibleContentHeading(title, language))
    ])
    .filter(Boolean));
  return normalizeReadingTexts(readingTexts)
    .slice(0, limit)
    .flatMap((text) => {
      const lines = [];
      const title = visibleContentHeading(text.title, language);
      if (title && !omittedTitleKeys.has(visibleReadingTitleKey(title))) {
        lines.push(title);
      }
      if (text.body) {
        lines.push(text.body);
      }
      return lines;
    });
}

function shouldShowTaskHeading(contentMirror = {}, pagePlan = null, language = "de") {
  if (pagePlan?.kind === "worksheet"
    && prefersMinimalWorksheetHierarchy(contentMirror)
    && titleAlreadyNamesTasks(contentMirror.title, language)) {
    return false;
  }
  return true;
}

function visibleHeadingText(value, language = "de") {
  let text = String(value || "").trim();
  if (language === "en") {
    text = text
      .replace(/^\s*seite\s*([1-4])\s*:/i, "Page $1:")
      .replace(/^\s*seite\s*([1-4])\s*$/i, "Page $1")
      .replace(/^\s*blatt\s*([1-4])\s*:/i, "Sheet $1:")
      .replace(/^\s*blatt\s*([1-4])\s*$/i, "Sheet $1");
  }
  if (language === "de") {
    text = text
      .replace(/^\s*sheet\s*([1-4])\s*:/i, "Seite $1:")
      .replace(/^\s*sheet\s*([1-4])\s*$/i, "Seite $1");
  }
  return text;
}

function stripLeadingPageLabel(value = "") {
  const text = String(value || "").trim();
  if (/^(?:page|sheet|seite|blatt)\s*[1-4]\s*$/i.test(text)) {
    return "";
  }
  return text.replace(/^\s*(?:page|sheet|seite|blatt)\s*[1-4]\s*[:\-–—]\s*/i, "").trim();
}

function isGenericContentHeading(value) {
  const key = normalizeText(value).replace(/[^a-z0-9]+/g, " ").trim();
  return !key || /^(?:material|materialseite|materialtext|materialteil|lesetext|leseseite|kurzinfo|infotext|sachtext|quelle|text|info|aufgabenseite|aufgabenblatt|worksheet|worksheet page|task page|tasks page|material page|reading page|sheet)$/.test(key);
}

function visibleContentHeading(value, language = "de") {
  const text = stripLeadingPageLabel(visibleHeadingText(value, language));
  return isGenericContentHeading(text) ? "" : text;
}

function splitPageLabelTitle(value = "") {
  const text = String(value || "").trim();
  const match = text.match(/^(Page|Sheet|Seite)\s*([1-4])\s*:\s*(.+)$/i);
  if (!match) {
    return {
      pageLabel: text,
      specificTitle: ""
    };
  }
  return {
    pageLabel: `${match[1]} ${match[2]}`,
    specificTitle: match[3].trim()
  };
}

function looksLikeTaskInstruction(value) {
  return /[?]/.test(String(value || ""))
    || /\b(?:read|complete|talk|write|answer|use|questions?|prompts?|boxes|lies|lest|bearbeite|beantwort|fragen|aufgaben|fuell|füll|schreib)\b/i.test(String(value || ""));
}

function splitLeadingDisplayTitle(value) {
  const text = String(value || "").trim();
  const match = text.match(/^(.{3,70}?)\.\s+(.+)$/s);
  if (!match) {
    return null;
  }
  const title = match[1].trim();
  const rest = match[2].trim();
  if (!title || !rest || looksLikeTaskInstruction(title) || !looksLikeTaskInstruction(rest)) {
    return null;
  }
  return { title, rest };
}

function stripLeadingSheetBlock(value) {
  const text = String(value || "").trim();
  const firstLineMatch = text.match(/^\s*(?:sheet|seite|blatt)\s*[1-4]\s*[:\-–—]\s*[^\r\n]*/i);
  if (!firstLineMatch) {
    return text;
  }
  const withoutSheetLabel = text.replace(/^\s*(?:sheet|seite|blatt)\s*[1-4]\s*[:\-–—]\s*/i, "").trim();
  const splitTitle = splitLeadingDisplayTitle(withoutSheetLabel);
  if (splitTitle) {
    return splitTitle.rest;
  }
  const afterTitle = text.slice(firstLineMatch[0].length).trim();
  const taskStart = afterTitle.search(/\b(?:task|aufgabe)\s*\d+\s*[:\-–—]/i);
  return taskStart >= 0 ? afterTitle.slice(taskStart).trim() : withoutSheetLabel;
}

function visibleWorksheetText(contentMirror, lessonBrief = {}) {
  const language = worksheetLanguage(contentMirror, lessonBrief);
  const headings = sectionHeadings(language);
  const lines = [];
  if (contentMirror.title) {
    lines.push(`${headings.titlePrefix}: ${contentMirror.title}`);
  }
  const readingTexts = normalizeReadingTexts(contentMirror.readingTexts || []);
  if (readingTexts.length) {
    if (shouldShowMaterialHeading(contentMirror, { kind: "worksheet", readingTexts, tasks: contentMirror.tasks || [] })) {
      lines.push(`${headings.sectionPrefix}: ${headings.material}`);
    }
    lines.push(...visibleReadingTextLines(readingTexts, language, 6, {
      omitTitles: [contentMirror.title]
    }));
  }
  const tasks = contentMirror.tasks || [];
  const visibleTasks = visibleTaskEntries(tasks.slice(0, 8));
  if (visibleTasks.length) {
    if (shouldShowTaskHeading(contentMirror, { kind: "worksheet", tasks }, language)) {
      lines.push(`${headings.sectionPrefix}: ${headings.tasks}`);
    }
    lines.push(...visibleTaskLines(visibleTasks));
  }
  return lines.filter(Boolean).join("\n");
}

function visibleWorksheetTextForPage(contentMirror, lessonBrief = {}, pageNumber = 1, pageCount = 1, providedPagePlan = null) {
  const plannedPageCount = Math.max(clampPageCount(pageCount), pageCountFromContent(contentMirror, null, lessonBrief));
  const pagePlan = providedPagePlan || buildPagePlans(contentMirror, lessonBrief, plannedPageCount)
    .find((plan) => plan.pageNumber === pageNumber) || null;
  const language = worksheetLanguage(contentMirror, lessonBrief);
  if (pagePlan && pagePlan.kind !== "default") {
    const headings = sectionHeadings(language);
    const lines = [];
    const pageHeading = pagePlan.kind === "sheet" && pagePlan.title
      ? splitPageLabelTitle(visibleHeadingText(pagePlan.title, language))
      : null;
    const pageTitle = pagePlan.kind === "sheet"
      ? visibleContentHeading(pageHeading?.specificTitle || pagePlan.title, language)
      : "";
    if (contentMirror.title) {
      lines.push(`${headings.titlePrefix}: ${pageTitle || contentMirror.title}`);
    } else if (pageTitle) {
      lines.push(`${headings.titlePrefix}: ${pageTitle}`);
    }
    if (pagePlan.intro) {
      lines.push(pagePlan.intro);
    }
    const pageReadingTexts = normalizeReadingTexts(pagePlan.readingTexts || []);
    if (pageReadingTexts.length) {
      if (shouldShowMaterialHeading(contentMirror, pagePlan)) {
        lines.push(`${headings.sectionPrefix}: ${headings.material}`);
      }
      lines.push(...visibleReadingTextLines(pageReadingTexts, language, 6, {
        omitTitles: [contentMirror.title, pageTitle]
      }));
    }
    const visibleTasks = visibleTaskEntries(pagePlan.tasks || [], { preprocessPrompt: stripLeadingSheetBlock });
    if (visibleTasks.length) {
      if (shouldShowTaskHeading(contentMirror, pagePlan, language)) {
        lines.push(`${headings.sectionPrefix}: ${headings.tasks}`);
      }
      lines.push(...visibleTaskLines(visibleTasks));
    }
    return lines.filter(Boolean).join("\n");
  }
  if (plannedPageCount <= 1) {
    return visibleWorksheetText(contentMirror, lessonBrief);
  }
  const headings = sectionHeadings(language);
  const lines = [];
  if (contentMirror.title) {
    lines.push(`${headings.titlePrefix}: ${contentMirror.title}`);
  }
  if (pageNumber === 1) {
    const readingTexts = normalizeReadingTexts(contentMirror.readingTexts || []);
    if (readingTexts.length) {
      if (shouldShowMaterialHeading(contentMirror, { kind: "material", readingTexts, tasks: [] })) {
        lines.push(`${headings.sectionPrefix}: ${headings.material}`);
      }
      lines.push(...visibleReadingTextLines(readingTexts, language, 4, {
        omitTitles: [contentMirror.title]
      }));
    }
    return lines.filter(Boolean).join("\n");
  }
  const tasks = contentMirror.tasks || [];
  const visibleTasks = visibleTaskEntries(tasks.slice(0, 8));
  if (visibleTasks.length) {
    if (shouldShowTaskHeading(contentMirror, { kind: "worksheet", tasks }, language)) {
      lines.push(`${headings.sectionPrefix}: ${headings.tasks}`);
    }
    lines.push(...visibleTaskLines(visibleTasks));
  }
  return lines.filter(Boolean).join("\n");
}

function compositionInstruction({
  role,
  pageNumber,
  pageCount,
  language = "de",
  pagePlan = null,
  minimalHierarchy = false,
  noWritingLines = false
}) {
  const headings = sectionHeadings(language);
  const visualContract = activeVisualContract(pagePlan);
  if (pagePlan?.kind === "sheet") {
    return [
      `Komposition: SEITE ${pageNumber} VON ${pageCount}, eigenstaendige Arbeitsblattseite fuer ${sanitizeInternalLabelText(pagePlan.title || `Sheet ${pagePlan.sheetNumber}`)}.`,
      "Keine Deckblatt- oder reine Ueberblicksseite.",
      "Zeige nur die Inhalte dieses Sheets; presse keine weiteren Sheets auf dieselbe Seite.",
      `Setze ${headings.tasks}, Tabellen/Zuordnungen und Sprechaufgaben mit viel lesbarem Abstand.`
    ].join(" ");
  }
  if (pagePlan?.kind === "page") {
    return [
      `Komposition: SEITE ${pageNumber} VON ${pageCount}, eigenstaendige Arbeitsblattseite mit genau den unten freigegebenen Inhalten dieser Seite.`,
      "Zeige keine Lesetexte, Aufgaben, Materialbilder oder Arbeitsauftraege anderer Seiten.",
      pagePlan.readingTexts?.length && pagePlan.tasks?.length
        ? `Setze Lesebereich, ${headings.tasks}, Bild-/Materialbereich und Schreib-/Bearbeitungsraum in klarer Reihenfolge.`
        : pagePlan.readingTexts?.length
          ? "Setze den Lesebereich und das passende Bild-/Materialfeld ruhig und gut lesbar."
          : pagePlan.tasks?.length
            ? visualContract.pageRole === "tasks_only"
              ? `Setze nur die freigegebenen ${headings.tasks} dieser Seite mit ausreichend Schreib-/Bearbeitungsraum; keine grosse Illustration, kein Materialkasten und kein aus einer Vorlage uebernommenes Bildfeld.`
              : `Setze die freigegebenen ${headings.tasks} dieser Seite mit ausreichend Schreib-/Bearbeitungsraum und nur dem freigegebenen Bildmaterial dieser Seite.`
            : "Setze nur die freigegebenen Inhalte dieser Seite."
    ].filter(Boolean).join(" ");
  }
  if (pagePlan?.kind === "material") {
    return [
      `Komposition: SEITE ${pageNumber} VON ${pageCount}, Seite mit freigegebenem Lesetext.`,
      "Zeige nur den freigegebenen Lesetext dieser Seite und passende Visualisierung.",
      `Keine ${headings.tasks}-Liste, keine Aufgaben anderer Seiten, kein Deckblatt ohne Inhalt.`
    ].join(" ");
  }
  if (pagePlan?.kind === "task_group") {
    const visualContract = activeVisualContract(pagePlan);
    return [
      `Komposition: SEITE ${pageNumber} VON ${pageCount}, Seite mit genau den unten freigegebenen Aufgaben.`,
      "Wiederhole nicht den Lesetext der anderen Seite und uebernimm keine Aufgaben anderer Seiten.",
      visualContract.pageRole === "tasks_only"
        ? `Setze ${headings.tasks}, Nummerierung, Schreib-/Bearbeitungsraum und kleine Strukturmarker. Keine grosse Illustration, kein Materialkasten, kein Bildfeld und kein aus einer Vorlage kopiertes Schaubild.`
        : `Setze ${headings.tasks}, Nummerierung, das freigegebene Bildmaterial dieser Seite und ausreichend Schreib-/Bearbeitungsraum.`
    ].join(" ");
  }
  if (pagePlan?.kind === "extension") {
    return [
      `Komposition: SEITE ${pageNumber} VON ${pageCount}, Zusatz- oder Weiterfuehrungsseite.`,
      "Nur freigegebene Inhalte dieser Seite verwenden; keine Aufgaben anderer Seiten wiederholen."
    ].join(" ");
  }
  if (visualContract.pageRole === "tasks_only") {
    return [
      "Komposition: einseitige reine Seite mit Aufgaben, Titel/Kopfzone, freigegebenem Aufgabenblock, klarer Nummerierung und ausreichend Schreib-/Bearbeitungsraum.",
      "Keine grosse Illustration, kein Materialkasten, kein Bildfeld und kein aus einer Vorlage kopierter Bildbereich.",
      noWritingLines ? "Keine Schreiblinien, keine Loesungsfelder und kein vorgesehener Antwortbereich." : ""
    ].filter(Boolean).join(" ");
  }
  if (visualContract.pageRole === "tasks_with_material") {
    return `Komposition: einseitige Seite mit Aufgaben und genau dem freigegebenen Bildmaterial dieser Seite, ${headings.tasks}, Nummerierung und ausreichend Schreib-/Bearbeitungsraum. Keine zusaetzliche generische Illustration.`;
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
      `Komposition: SEITE 2 VON ${pageCount}, Seite mit Aufgaben.`,
      `Zeige ${headings.tasks}, Nummerierung und viel Schreibraum.`,
      "Nur ein kleines Referenzdiagramm ist erlaubt, wenn es als Bildmaterial fuer diese Seite freigegeben ist.",
      "Wiederhole nicht den langen Materialtext und erzeuge kein zweites vollständiges Übersichtsblatt."
    ].join(" ");
  }
  if (pageCount > 1) {
    return `Komposition: SEITE ${pageNumber} VON ${pageCount}, Erweiterungsseite mit Aufgaben oder Zusatzmaterial. Keine Wiederholung der vorherigen Seiten.`;
  }
  if (role === "worksheet" && (minimalHierarchy || noWritingLines)) {
    return [
      "Komposition: vollstaendige A4-Arbeitsblattseite mit Titel oben, kurzem Arbeitsauftrag, klarer Aufgabenliste in den freigegebenen Stufen und dezenter Illustration.",
      "Keine sichtbaren Zusatzebenen oder nicht freigegebenen Seitenlabels.",
      noWritingLines ? "Keine Schreiblinien, keine Loesungsfelder und kein vorgesehener Antwortbereich." : ""
    ].filter(Boolean).join(" ");
  }
  return role === "worksheet"
    ? `Komposition: vollstaendige A4-Arbeitsblattseite mit Titel oben, fachlichem Textbereich, fachlicher Illustration, ${headings.tasks}-Bereich und Schreiblinien.`
    : "Komposition: zentrale fachliche Materialillustration mit ruhigem Rand.";
}

function pageTextContractInstruction({
  pageNumber = 1,
  pageCount = 1,
  pagePlan = null
} = {}) {
  const taskCount = Array.isArray(pagePlan?.tasks) ? pagePlan.tasks.length : 0;
  const textCount = Array.isArray(pagePlan?.readingTexts) ? pagePlan.readingTexts.length : 0;
  const materialCount = Array.isArray(pagePlan?.imageMaterialIds) ? pagePlan.imageMaterialIds.length : 0;
  if (pageCount <= 1) {
    const visualContract = activeVisualContract(pagePlan);
    const needsSinglePageContract = visualContract.pageRole === "tasks_only"
      || visualContract.pageRole === "tasks_with_material";
    if (!needsSinglePageContract) {
      return "";
    }
    return [
      "AKTIVER SEITENVERTRAG: Render dieses einseitige Arbeitsblatt ausschliesslich mit den freigegebenen aktiven Inhalten.",
      `Aktive Inhalte fuer diese Seite: ${textCount} Lesetext(e), ${taskCount} Aufgabe(n), ${materialCount} freigegebene visuelle Elemente.`,
      pageVisualContractInstruction(pagePlan),
      "Der Block 'Freigegebener sichtbarer Arbeitsblatttext' unten ist die einzige Quelle fuer sichtbaren Haupttext auf dieser Seite."
    ].filter(Boolean).join(" ");
  }
  return [
    `AKTIVER SEITENVERTRAG: Render jetzt ausschliesslich Seite ${pageNumber} von ${pageCount}.`,
    `Aktive Inhalte fuer diese Seite: ${textCount} Lesetext(e), ${taskCount} Aufgabe(n), ${materialCount} freigegebene visuelle Elemente.`,
    pageVisualContractInstruction(pagePlan),
    "Der Block 'Freigegebener sichtbarer Arbeitsblatttext' unten ist die einzige Quelle fuer sichtbaren Haupttext auf dieser Seite.",
    "Cross-page guard: Hinweise zu anderen Seiten in Thema, Bildplanung, Materialanweisungen oder Referenzen bleiben Kontext und duerfen auf dieser Seite nicht sichtbar werden."
  ].filter(Boolean).join(" ");
}

function isConnectedMultiPage(pagePlan = null, pageCount = 1) {
  return pageCount > 1 && pagePlan?.kind !== "sheet";
}

function pageMarkerText(language = "de", pageNumber = 1, pageCount = 1) {
  return language === "en"
    ? `Page ${pageNumber} of ${pageCount}`
    : `Seite ${pageNumber} von ${pageCount}`;
}

function pageMarkerInstruction({
  language = "de",
  pageNumber = 1,
  pageCount = 1,
  pagePlan = null
}) {
  if (!isConnectedMultiPage(pagePlan, pageCount)) {
    return "";
  }
  const marker = pageMarkerText(language, pageNumber, pageCount);
  return `Dezenter Seitenhinweis-Anker: Setze klein oben rechts im sicheren Seitenrand "${marker}". Auf allen verbundenen Seiten gleiche Position: gleicher rechter Rand, gleiche obere Kante. Der Hinweis ist Layout, kein Titel/Footer/Kasten; Stil darf passen, Position bleibt app-eigen und wird nicht durch Vorlagen verschoben.`;
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
  return "TEXT-LOCK: Sichtbarer Haupttext kommt aus dem Arbeitsblatt-Konzept. Text- oder Aufgabenänderungen brauchen zuerst eine Konzeptänderung, nicht nur eine Bildgenerierung.";
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
  const currentVisualContract = activeVisualContract(currentPagePlan);
  const approvedVisibleText = visibleWorksheetTextForPage(contentMirror, lessonBrief, pageNumber, actualPageCount, currentPagePlan);
  const minimalHierarchy = prefersMinimalWorksheetHierarchy(contentMirror);
  const noWritingLines = prefersNoWritingLines(contentMirror);
  const minimalElements = currentVisualContract.pageRole === "tasks_only"
    ? noWritingLines
      ? `Titel/Kopfzone, freigegebenen ${headings.tasks}-Block, Nummerierung und kleine Strukturmarker`
      : `Titel/Kopfzone, freigegebenen ${headings.tasks}-Block, Nummerierung, Schreib-/Antwortflaechen und kleine Strukturmarker`
    : currentVisualContract.pageRole === "tasks_with_material"
      ? `Titel/Kopfzone, freigegebenen ${headings.tasks}-Block, genau das freigegebene Bildmaterial dieser Seite und Schreib-/Antwortflaechen`
      : noWritingLines
        ? `Titel, freigegebenen Arbeitsauftrag, ${headings.tasks} und dezente Illustration`
        : `Titel, freigegebenen Arbeitsauftrag, ${headings.tasks} und passende Schreib-/Antwortflaechen`;
  const structureInstruction = currentVisualContract.pageRole === "tasks_only"
    ? `Image-First: Das Bild ist das Arbeitsblatt. Setze ${minimalElements} direkt im Bild. Verwende keine zusaetzlichen Bereichs- oder Seitenlabels und keine Bildflaechen, wenn sie nicht im freigegebenen Text oder Bildmaterial dieser Seite stehen.`
    : prefersMinimalWorksheetHierarchy(contentMirror)
      ? `Image-First: Das Bild ist das Arbeitsblatt. Setze ${minimalElements} direkt im Bild. Verwende keine zusaetzlichen Bereichs- oder Seitenlabels, wenn sie nicht im freigegebenen Text stehen.`
      : `Image-First: Das Bild ist das Arbeitsblatt. Setze Titel, freigegebenen Lesetext, konkrete fachliche Abschnittsueberschriften, ${headings.tasks}, Illustration und Schreiblinien direkt im Bild.`;
  const visibleLanguageRule = minimalHierarchy
    ? `Sichtbare Sprache: ${language === "en" ? "Englisch" : "Deutsch"}. Sichtbare Labels muessen zur freigegebenen Textstruktur passen; fuege keine zusaetzlichen Hierarchie-Labels hinzu.`
    : headings.visibleLanguageRule;
  const visualVariantInstruction = sanitizeInternalLabelText(variantInstruction || "");
  const pageMaterialLines = materialLinesForPage(contentMirror, currentPagePlan);
  const subtlePageMarkerInstruction = pageMarkerInstruction({
    language,
    pageNumber,
    pageCount: actualPageCount,
    pagePlan: currentPagePlan
  });
  const contentControlInstruction = subtlePageMarkerInstruction
    ? "Content-Control: Teacher controls content. Verwende sichtbar nur den freigegebenen Haupttext dieser aktiven Seite; ausgenommen ist nur der kleine app-eigene Seitenhinweis fuer zusammenhaengende mehrseitige Entwuerfe. Erfinde keine weiteren Aufgaben, Labels, Quellen, Antworten, Fussnoten oder Erklaertexte und uebernimm keine Inhalte anderer Seiten."
    : "Content-Control: Teacher controls content. Verwende sichtbar nur den freigegebenen Text dieser aktiven Seite. Erfinde keine weiteren Aufgaben, Labels, Quellen, Antworten, Fussnoten oder Erklaertexte.";
  const pixelInstruction = requestedSize
    ? `Zielcanvas: exakt ${requestedSize} Pixel, Hochformat. Wenn das Bildsystem Pixelmaße akzeptiert, muss die komplette PNG-Ausgabe genau ${requestedSize} groß sein.`
    : "";
  return [
    `Erzeuge ein vollstaendiges ${headings.worksheetLanguageLabel} Arbeitsblatt als ein einziges Image-First-Bild.`,
    "NICHT VERHANDELBAR: DIN A4 portrait, Seitenverhaeltnis 1:sqrt(2) bzw. 210:297. Keine 16:9-Komposition, kein Querformat, kein quadratisches Poster, kein 2:3-Posterformat.",
    pixelInstruction,
    structureInstruction,
    "Fachkontext fuer die Illustration:",
    `Thema: ${contentMirror.title || lessonBrief.topic || "Arbeitsblatt"}`,
    `Fach/Zielgruppe: ${lessonBrief.subject || "Unterricht"} ${lessonBrief.targetGroup || ""}`.trim(),
    didacticControlInstruction(lessonBrief),
    actualPageCount > 1
      ? `Illustrationsrolle: ${actualRole}, Seite ${pageNumber} von ${actualPageCount}`
      : `Illustrationsrolle: ${actualRole}`,
    pageTextContractInstruction({
      pageNumber,
      pageCount: actualPageCount,
      pagePlan: currentPagePlan
    }),
    approvedVisibleText ? `Freigegebener sichtbarer Arbeitsblatttext - exakt diese Inhalte verwenden:\n${approvedVisibleText}` : "",
    pageMaterialLines ? `Nicht sichtbare Bild-/Materialanweisung fuer diese Seite. Diese Zeilen duerfen NICHT als Text, Hinweisbox, Label oder Beschriftung im Arbeitsblatt erscheinen; nutze sie nur fuer Illustration, Icon, Bildfeld oder Materialgestaltung:\n${pageMaterialLines}` : "",
    ...imageSpecLines(imageSpec, currentPagePlan),
    compositionInstruction({
      role: actualRole,
      pageNumber,
      pageCount: actualPageCount,
      language,
      pagePlan: currentPagePlan,
      minimalHierarchy,
      noWritingLines
    }),
    subtlePageMarkerInstruction,
    "Grundstil: klar, schulisch, sachlich, gut druckbar, hochwertige Arbeitsblattseite, keine dekorativen Logos.",
    visibleLanguageRule,
    "Nummerierungsregel: Nummeriere jede Aufgabe genau einmal. Wenn der freigegebene Aufgabentext schon Nummern oder Labels enthielt, sind diese im sichtbaren Text bereits bereinigt. Erzeuge niemals doppelte Nummern wie '1. 1.' oder '1. Aufgabe 1'.",
    contentControlInstruction,
    textLockInstruction({ contentChangePolicy, changeScope }),
    "Keine Umgebungs-Texte: Tafel, Whiteboard, Poster, Bildschirm, Buchseiten, Handy-Displays und Dekoelemente muessen leer, unscharf oder unlesbar bleiben, ausser ihr Text steht explizit im freigegebenen sichtbaren Arbeitsblatttext.",
    "Texttreue: Uebernimm den freigegebenen sichtbaren Arbeitsblatttext moeglichst wortgetreu. Bei Unsicherheit lieber weniger Zusatzgestaltung statt neuen Text erfinden.",
    "Loesungen, Loesungserwartungen, Musterantworten und Erwartungshorizonte duerfen auf der Arbeitsblattseite nicht sichtbar sein. Konkrete Loesungstexte werden nicht an das Bildmodell uebergeben.",
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
