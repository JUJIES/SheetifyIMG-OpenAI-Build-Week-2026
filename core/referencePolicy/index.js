"use strict";

function clean(value) {
  return String(value || "").trim();
}

function normalize(value) {
  return clean(value)
    .toLowerCase()
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/ß/g, "ss")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "");
}

function textParts(values = []) {
  return values.flatMap((value) => {
    if (!value) {
      return [];
    }
    if (Array.isArray(value)) {
      return textParts(value);
    }
    if (typeof value === "object") {
      return textParts(Object.values(value));
    }
    return [String(value)];
  });
}

function collectedText({ project = {}, lessonBrief = {}, contentMirror = {}, imageSpec = {} } = {}) {
  return normalize(textParts([
    project.subject,
    project.topic,
    project.manifest?.targetGroup,
    lessonBrief,
    contentMirror,
    imageSpec
  ]).join("\n"));
}

function matchAny(text, patterns) {
  return patterns.some((pattern) => pattern.test(text));
}

function isDecorativeThemeMotif(text) {
  return matchAny(text, [
    /\bdino[-\s]?(thema|themenlayout|layout|motiv|lernfigur)\b/,
    /\b(thema|themenlayout|motto|motiv|gestaltung|gestaltungselement|visuelle klammer|rahmung|rahmen|deko|dekoration|ornament|akzent)\b.{0,80}\b(dino|fossil|fossilien|knochen|fussspur|fussabdruck|fußspur|fußabdruck)\b/,
    /\b(dino|fossil|fossilien|knochen|fussspur|fussabdruck|fußspur|fußabdruck)\b.{0,80}\b(thema|themenlayout|motto|motiv|gestaltung|gestaltungselement|visuelle klammer|rahmung|rahmen|deko|dekoration|ornament|akzent)\b/,
    /\bfossilien?[-\s]?(karte|karten|akzent|akzente|ornament|ornamente|rahmen|rahmung)\b/,
    /\bknochen[-\s]?(akzent|akzente|ornament|ornamente|rahmen|rahmung)\b/
  ]);
}

function hasFactualSpecializedContext(text) {
  return matchAny(text, [
    /\barchaeopteryx\b/,
    /\bevolution\b/,
    /\bevolutions(beleg|belege|indiz|indizien|theorie)\b/,
    /\banatomie\b/,
    /\banatomisch\b/,
    /\bskelett\b/,
    /\bschaedel\b/,
    /\bschadel\b/,
    /\bknochenvergleich\b/,
    /\b(fossil|fossilien)\b.{0,80}\b(vergleichen|vergleich|beleg|belege|indiz|indizien|entstehung|bestimmen|bestimme|analysieren|analysiere|beschriften|beschrifte)\b/,
    /\b(vergleichen|vergleich|beleg|belege|indiz|indizien|entstehung|bestimmen|bestimme|analysieren|analysiere|beschriften|beschrifte)\b.{0,80}\b(fossil|fossilien)\b/,
    /\bmitose\b/,
    /\bmeiose\b/,
    /\bzellteilung\b/,
    /\bmikroskop\b/,
    /\bapparatur\b/
  ]);
}

const LEVEL_RANK = Object.freeze({
  none: 0,
  optional: 1,
  recommended: 2,
  required: 3,
  deterministic: 4
});

const ALLOWED_LEVELS = new Set(Object.keys(LEVEL_RANK));
const ALLOWED_SOURCES = new Set([
  "none",
  "user_upload",
  "web_reference_search",
  "user_upload_or_reference_search",
  "app_template",
  "app_template_or_user_upload"
]);

function pickAllowed(value, allowed, fallback) {
  const normalized = clean(value).toLowerCase();
  return allowed.has(normalized) ? normalized : fallback;
}

function policy({
  level,
  category,
  label,
  reason,
  triggers = [],
  preferredSource,
  suggestedSearchQuery,
  suggestedAction,
  allowImageModelToRedraw,
  canProceedWithoutReference,
  instructions,
  referenceImages = []
}) {
  return {
    level,
    category,
    label,
    reason,
    triggers,
    preferredSource,
    suggestedSearchQuery,
    suggestedAction,
    allowImageModelToRedraw,
    canProceedWithoutReference,
    isSatisfied: Array.isArray(referenceImages) && referenceImages.length > 0,
    instructions
  };
}

function normalizeReferencePolicy(input = {}, options = {}) {
  const referenceImages = Array.isArray(options.referenceImages) ? options.referenceImages : [];
  const level = pickAllowed(input.level, ALLOWED_LEVELS, "none");
  const preferredSource = pickAllowed(input.preferredSource, ALLOWED_SOURCES, level === "none" ? "none" : "user_upload_or_reference_search");
  return policy({
    level,
    category: clean(input.category) || (level === "none" ? "free_illustration" : "model_reference_decision"),
    label: clean(input.label) || (level === "none" ? "Keine Referenz nötig" : "Referenz sinnvoll"),
    reason: clean(input.reason) || (level === "none"
      ? "Die KI sieht keinen klaren Mehrwert fuer eine Referenz."
      : "Die KI sieht einen Qualitaetsgewinn durch eine Referenz."),
    triggers: Array.isArray(input.triggers) ? input.triggers.map(clean).filter(Boolean).slice(0, 6) : [],
    preferredSource,
    suggestedSearchQuery: clean(input.suggestedSearchQuery),
    suggestedAction: clean(input.suggestedAction) || (preferredSource.includes("reference_search")
      ? "Passende Referenz suchen."
      : level === "none" ? "Direkt Entwurf erstellen." : "Referenz nutzen."),
    allowImageModelToRedraw: input.allowImageModelToRedraw !== false,
    canProceedWithoutReference: input.canProceedWithoutReference !== false,
    instructions: clean(input.instructions) || "Nutze Referenzen nur fuer den beschriebenen Zweck und halte den freigegebenen Arbeitsblatttext ein.",
    referenceImages
  });
}

function mergeReferencePolicies(modelPolicy = null, guardPolicy = null, options = {}) {
  const referenceImages = Array.isArray(options.referenceImages) ? options.referenceImages : [];
  const normalizedModel = normalizeReferencePolicy(modelPolicy || {}, { referenceImages });
  if (!guardPolicy || guardPolicy.level === "none") {
    return {
      ...normalizedModel,
      decisionSource: modelPolicy ? "model" : "fallback"
    };
  }
  if (!modelPolicy) {
    return {
      ...guardPolicy,
      isSatisfied: referenceImages.length > 0,
      decisionSource: "guardrail"
    };
  }

  const guardRank = LEVEL_RANK[guardPolicy.level] || 0;
  const modelRank = LEVEL_RANK[normalizedModel.level] || 0;
  const guardWins = guardRank > modelRank;
  const base = guardWins ? guardPolicy : normalizedModel;
  const sameCategory = clean(guardPolicy.category) && clean(guardPolicy.category) === clean(normalizedModel.category);
  const instructions = [
    guardWins || sameCategory ? guardPolicy.instructions : "",
    normalizedModel.instructions
  ].filter(Boolean).join(" ");
  return {
    ...base,
    reason: guardWins
      ? `${guardPolicy.reason} (Guardrail hat die KI-Einschaetzung verschaerft: ${normalizedModel.reason})`
      : normalizedModel.reason,
    suggestedSearchQuery: guardWins
      ? guardPolicy.suggestedSearchQuery || normalizedModel.suggestedSearchQuery || ""
      : normalizedModel.suggestedSearchQuery || guardPolicy.suggestedSearchQuery || "",
    suggestedAction: guardWins
      ? guardPolicy.suggestedAction || normalizedModel.suggestedAction || ""
      : normalizedModel.suggestedAction || guardPolicy.suggestedAction || "",
    instructions,
    isSatisfied: referenceImages.length > 0,
    decisionSource: guardWins ? "model_plus_guardrail" : "model"
  };
}

function inferReferencePolicy(input = {}) {
  const referenceImages = Array.isArray(input.referenceImages) ? input.referenceImages : [];
  const text = collectedText(input);

  const hasQr = matchAny(text, [
    /\bqr[-\s]?code\b/,
    /\bbarcode\b/,
    /\bstrichcode\b/,
    /\bdata\s?matrix\b/
  ]);
  if (hasQr) {
    return policy({
      level: "deterministic",
      category: "code_asset",
      label: "Exakte Einbettung nötig",
      reason: "QR-Codes und Barcodes dürfen nicht vom Bildmodell nachgezeichnet werden, weil schon kleine Veränderungen sie unbrauchbar machen.",
      triggers: ["QR-Code/Barcode"],
      preferredSource: "user_upload",
      suggestedAction: "QR-Code nicht frei zeichnen; nur mit verlässlichem Referenzbild oder als klarer Platzhalter planen.",
      allowImageModelToRedraw: false,
      canProceedWithoutReference: false,
      instructions: "QR-Codes, Barcodes oder Data-Matrix-Codes nicht frei zeichnen. Wenn kein festes App-Asset vorhanden ist, nur einen klar markierten Platzhalterbereich vorsehen.",
      referenceImages
    });
  }

  const hasCoordinateSystem = matchAny(text, [
    /\bkoordinatensystem\b/,
    /\bkoordinaten\b/,
    /\bx[-\s]?achse\b/,
    /\by[-\s]?achse\b/,
    /\bspiegelachse\b/,
    /\bachsenbeschriftung\b/,
    /\bzahlenstrahl\b/,
    /\bkarierte?s?\s+raster\b/,
    /\bfunktionsgraph(?:en)?\b/,
    /\bgraph(?:en)?\s+(?:einer|der)\s+funktion\b/,
    /\b(?:lineare|quadratische|proportionale|exponential|trigonometrische)\s+funktionen?\b/,
    /\bfunktionen?\s+(?:zeichnen|skizzieren|darstellen|ablesen|untersuchen)\b/,
    /\bparabel\b/,
    /\b[a-z]\s*\(-?\d+\s*[|,]\s*-?\d+\)/i
  ]);
  if (hasCoordinateSystem) {
    return policy({
      level: "required",
      category: "coordinate_template",
      label: "Präzision beachten",
      reason: "Koordinatensysteme, Achsen und Punktlagen sind präzise Geometrie. Eine Vorlage stabilisiert Raster, Achsen und Beschriftungen deutlich.",
      triggers: ["Koordinatensystem/Achsen"],
      preferredSource: "user_upload",
      suggestedAction: "Bei Bedarf ein eigenes Referenzbild für das Koordinatensystem anhängen; ohne Referenz nur schematisch planen.",
      allowImageModelToRedraw: false,
      canProceedWithoutReference: true,
      instructions: "Wenn eine Koordinaten-Referenz vorhanden ist, Raster, Achsen, Ursprung und Beschriftungslogik daraus übernehmen. Ohne Referenz nur ein klares Übungsraster erzeugen und keine mathematische Exaktheit vortäuschen.",
      referenceImages
    });
  }

  const hasMap = matchAny(text, [
    /\blandkarte\b/,
    /\bumrisskarte\b/,
    /\broutenkarte\b/,
    /\bweltkarte\b/,
    /\beuropa(?:karte)?\b/,
    /\bdeutschland(?:karte)?\b/,
    /\b(?:zeichne|zeichnen|erstelle|erstellen|markiere|markieren|beschrifte|beschriften|analysiere|analysieren|nutze|verwende).{0,80}\bstadtplan\b/,
    /\bstadtplan\b.{0,80}\b(?:zeichnen|erstellen|markieren|beschriften|analysieren|ausfuellen|ausfüllen)\b/,
    /\b(?:nordsee|ostsee|luebeck|lubeck|hamburg|danzig|handelsroute)\b.{0,80}\bkarte\b/,
    /\bkarte\b.{0,80}\b(?:nordsee|ostsee|luebeck|lubeck|hamburg|danzig|handelsroute)\b/,
    /\b(?:markiere|markieren|zeichne|einzeichnen|trage|lokalisiere|verorte).{0,100}\bkarte\b/,
    /\bkarte\s+(?:von|zu|mit)\b/
  ]);
  if (hasMap) {
    return policy({
      level: "required",
      category: "factual_map",
      label: "Referenz sinnvoll",
      reason: "Karten brauchen fachliche und räumliche Genauigkeit. Das Bildmodell kann eine plausible Karte zeichnen, aber Positionen und Umrisse sind ohne Referenz nicht verlässlich.",
      triggers: ["Karte/Geografie"],
      preferredSource: "user_upload_or_reference_search",
      suggestedAction: "Eine geprüfte Karte oder Umrisskarte als Referenz verwenden.",
      allowImageModelToRedraw: false,
      canProceedWithoutReference: true,
      instructions: "Wenn eine Kartenreferenz vorhanden ist, geografische Formen, Stadtpositionen und Routenführung daraus übernehmen. Ohne Referenz nur als vereinfachte Orientierungskarte darstellen und keine exakte Karte behaupten.",
      referenceImages
    });
  }

  const hasExactLayout = matchAny(text, [
    /\btabelle\b/,
    /\btabellenraster\b/,
    /\bstundenplan\b/,
    /\bturnierplan\b/,
    /\bnotensystem\b/,
    /\bnotenlinien\b/,
    /\bschaltplan\b/,
    /\bstrukturformel\b/,
    /\bmolekuelstruktur\b/,
    /\bmolekuel\b/,
    /\boffizielles?\s+logo\b/,
    /\bwappen\b/
  ]);
  if (hasExactLayout) {
    return policy({
      level: "recommended",
      category: "exact_structure",
      label: "Referenz empfohlen",
      reason: "Die Visualisierung enthält genaue Strukturen oder Fachnotation. Eine Vorlage reduziert Fehler bei Linien, Tabellen, Symbolen und Beschriftungen.",
      triggers: ["exakte Struktur/Fachnotation"],
      preferredSource: "user_upload",
      suggestedAction: "Geeignetes Referenzbild anhängen.",
      allowImageModelToRedraw: false,
      canProceedWithoutReference: true,
      instructions: "Exakte Strukturen nur mit Referenz oder sehr vorsichtig schematisch darstellen. Keine offiziellen Logos, Wappen oder Fachnotationen frei erfinden.",
      referenceImages
    });
  }

  const hasLocalVisualReference = matchAny(text, [
    /\bstrassen?schild\b/,
    /\bstraßen?schild\b/,
    /\bberliner\s+strassen?schild\b/,
    /\bberliner\s+straßen?schild\b/,
    /\bstraßenecke\b/,
    /\bstrassenecke\b/,
    /\bbestimmte[rn]?\s+ecke\b/,
    /\blokale?r?\s+look\b/,
    /\brealistische?\s+(strasse|straße|ort|ecke|umgebung)\b/
  ]);
  if (hasLocalVisualReference) {
    return policy({
      level: "recommended",
      category: "local_visual_reference",
      label: "Bildreferenz sinnvoll",
      reason: "Lokale visuelle Details wie Schilder, Straßenecken oder stadttypische Gestaltung wirken ohne Referenz schnell generisch. Eine offene Bildreferenz stabilisiert Form, Material, Farbe und Kontext.",
      triggers: ["lokaler visueller Kontext"],
      preferredSource: "user_upload_or_reference_search",
      suggestedSearchQuery: "Berlin Straßenschild Wikimedia Commons",
      suggestedAction: "Passende offen lizenzierte Bildreferenz suchen oder eigenes Referenzbild hochladen.",
      allowImageModelToRedraw: true,
      canProceedWithoutReference: true,
      instructions: "Wenn eine lokale Bildreferenz vorhanden ist, nutze sie fuer Stil, Form, Material, Perspektive und Ortsanmutung. Kopiere keine fremden Texte unveraendert; der freigegebene Arbeitsblatttext und die gewuenschte Fake-Beschriftung haben Vorrang.",
      referenceImages
    });
  }

  const hasSpecializedSubject = matchAny(text, [
    /\barchaeopteryx\b/,
    /\bfossil(?:ien)?\b/,
    /\bskelett\b/,
    /\banatomie\b/,
    /\banatomisch\b/,
    /\bmitose\b/,
    /\bmeiose\b/,
    /\bzellteilung\b/,
    /\bmikroskop\b/,
    /\bseltene?\s+(pflanze|tierart|art)\b/,
    /\bgeraet\b/,
    /\bapparatur\b/
  ]);
  if (hasSpecializedSubject && (!isDecorativeThemeMotif(text) || hasFactualSpecializedContext(text))) {
    return policy({
      level: "recommended",
      category: "specialized_subject",
      label: "Referenz kann helfen",
      reason: "Das Motiv ist fachlich spezieller als eine Alltagsszene. Eine Referenz kann Form, Proportionen und wichtige Details stabilisieren.",
      triggers: ["spezielles Fachmotiv"],
      preferredSource: "user_upload_or_reference_search",
      suggestedAction: "Bei Bedarf Referenzbild anhängen oder später eine Referenzsuche nutzen.",
      allowImageModelToRedraw: true,
      canProceedWithoutReference: true,
      instructions: "Wenn eine Referenz vorhanden ist, fachliche Form und wichtige Details daran ausrichten. Ohne Referenz allgemein und didaktisch klar bleiben.",
      referenceImages
    });
  }

  return policy({
    level: "none",
    category: "free_illustration",
    label: "Keine Referenz nötig",
    reason: "Die Visualisierung ist für das Bildmodell voraussichtlich klar genug und braucht keine präzise externe Vorlage.",
    triggers: [],
    preferredSource: "none",
    suggestedAction: "Direkt Entwurf erstellen.",
    allowImageModelToRedraw: true,
    canProceedWithoutReference: true,
    instructions: "Freie, didaktisch klare Illustration ist ausreichend.",
    referenceImages
  });
}

function referencePolicyPromptLines(referencePolicy = null, referenceImages = []) {
  if (!referencePolicy || referencePolicy.level === "none") {
    return [];
  }
  const hasReferences = Array.isArray(referenceImages) && referenceImages.length > 0;
  return [
    "Referenz-/Vorlagenentscheidung:",
    `Status: ${referencePolicy.label || referencePolicy.level}. Grund: ${referencePolicy.reason || "Referenz kann die Darstellung stabilisieren."}`,
    `Anweisung: ${referencePolicy.instructions || "Nutze Referenzen nur fuer den beschriebenen Zweck."}`,
    hasReferences
      ? "Es sind direkte Referenzbilder vorhanden. Nutze sie fuer die genannte Struktur, aber uebernimm keine nicht freigegebenen Texte, Ortsnamen, Hausnummern, Bildbeschriftungen oder Schildaufschriften. Texte aus Referenzen weglassen, neutralisieren oder durch freigegebenen Arbeitsblatttext ersetzen."
      : `Es ist keine direkte Referenz vorhanden. ${referencePolicy.canProceedWithoutReference ? "Arbeite vorsichtig schematisch und vermeide falsche Praezisionsbehauptungen." : "Erzeuge keinen scheinbar funktionsfaehigen Code oder keine scheinbar exakte Spezialstruktur."}`
  ];
}

module.exports = {
  inferReferencePolicy,
  mergeReferencePolicies,
  normalizeReferencePolicy,
  referencePolicyPromptLines
};
