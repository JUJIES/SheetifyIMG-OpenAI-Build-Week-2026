"use strict";

const REFERENCE_ROLES = Object.freeze({
  STYLE: "style_reference",
  LAYOUT: "layout_reference",
  STYLE_LAYOUT: "style_layout_reference",
  MATERIAL: "material_image",
  CONTENT: "content_reference"
});

const normalizedReferenceRoleAliases = new Set([
  "style_reference",
  "style",
  "stil",
  "layout_reference",
  "layout",
  "aufbau",
  "style_layout_reference",
  "style_layout",
  "stil_aufbau",
  "stil-und-aufbau",
  "stil+aufbau",
  "template_reference",
  "vorlage",
  "reihenvorlage",
  "material_image",
  "materialbild",
  "bildmaterial",
  "embed",
  "insert",
  "einbettung",
  "content_reference",
  "content",
  "motif",
  "motiv",
  "inhalt"
]);

function normalizeReferenceRole(value = "") {
  const normalized = String(value || "").trim().toLowerCase();
  if (/^(style_layout_reference|style_layout|stil_aufbau|stil-und-aufbau|stil\+aufbau|template_reference|vorlage|reihenvorlage)$/.test(normalized)) {
    return REFERENCE_ROLES.STYLE_LAYOUT;
  }
  if (/^(layout_reference|layout|aufbau|template)$/.test(normalized)) {
    return REFERENCE_ROLES.LAYOUT;
  }
  if (/^(material_image|materialbild|bildmaterial|embed|insert|einbettung)$/.test(normalized)) {
    return REFERENCE_ROLES.MATERIAL;
  }
  if (/^(content_reference|content|motif|motiv|inhalt)$/.test(normalized)) {
    return REFERENCE_ROLES.CONTENT;
  }
  return REFERENCE_ROLES.STYLE;
}

function isExplicitReferenceRole(value = "") {
  const normalized = String(value || "").trim().toLowerCase();
  return normalizedReferenceRoleAliases.has(normalized);
}

function inferReferenceRoleFromPurpose(purpose = "") {
  const text = String(purpose || "").trim().toLowerCase();
  if (/materialbild|bildmaterial|einbettung|embed|insert/.test(text)) {
    return REFERENCE_ROLES.MATERIAL;
  }
  if (/stil\s*(?:und|\+|\/)\s*aufbau|aufbau\s*(?:und|\+|\/)\s*stil|reihen(?:vorlage)?|wie\s+aus\s+einem\s+guss|gleiche\s+visuelle\s+handschrift/.test(text)) {
    return REFERENCE_ROLES.STYLE_LAYOUT;
  }
  if (/layout|aufbau|template|rahmen/.test(text)) {
    return REFERENCE_ROLES.LAYOUT;
  }
  if (/motif|motiv|inhalt/.test(text)) {
    return REFERENCE_ROLES.CONTENT;
  }
  return REFERENCE_ROLES.STYLE;
}

function effectiveReferenceRole(role = "", purpose = "") {
  return isExplicitReferenceRole(role)
    ? normalizeReferenceRole(role)
    : inferReferenceRoleFromPurpose(purpose);
}

function referenceRoleInstruction(role = "", purpose = "") {
  const effectiveRole = effectiveReferenceRole(role, purpose);
  const targetedDraftRevision = effectiveRole === REFERENCE_ROLES.STYLE_LAYOUT
    && /basisentwurf|gezielte\s+(?:ueberarbeitung|überarbeitung)/i.test(String(purpose || ""));
  if (effectiveRole === REFERENCE_ROLES.MATERIAL) {
    return [
      "Funktion: Bildmaterial.",
      "Baue diese Referenz als lokales sichtbares Material an der fachlich geplanten Stelle ein; nicht frei neu erfinden und keine zweite generische Version erzeugen.",
      "Erhalte Form, Proportionen, Kontrast, Kanten, fachliche Details und funktionale Muster moeglichst stabil.",
      "Bei QR-Codes, Barcodes, Karten, Koordinatensystemen, Diagrammen, Tabellen oder Screenshots ist Funktion/Lesbarkeit wichtiger als Stilangleichung.",
      "Keine Stil- oder Layoutvorlage: keine Gesamtfarbwelt, Seitengliederung, Headerlogik oder Aufgabenformatierung daraus uebernehmen."
    ].join(" ");
  }
  if (effectiveRole === REFERENCE_ROLES.LAYOUT) {
    return [
      "Funktion: Aufbau/Layout.",
      "Nutze die Referenz fuer adaptive Blattkomposition: Titelzone, Randlogik, Kopf-/Fussbereich, Abstaende, Boxen-/Linienstil, Antwortlinien, relative Groessen und Rhythmus.",
      "Halte die Komposition nah ein, aber der aktive Seitenvertrag entscheidet; kopiere nicht blind die alte Blockanzahl oder alte Aufgabenstruktur.",
      "Uebernimm nur erlaubte Seitenelemente; Bild-, Karten-, Diagramm-, Lesetext- oder Materialslots aus der Vorlage sind keine neue Erlaubnis.",
      "Nicht passende Bereiche weglassen oder in passenden Aufgaben-, Schreib- oder Arbeitsraum umwandeln; Seitenhinweis bleibt app-eigen oben rechts.",
      "Keine Farbpalette, Schriftanmutung, Illustrationsstil, Bildinhalte, Aufgaben- oder Referenztexte uebernehmen.",
      "Inhalt, Aufgaben, Seitenzahl und freigegebener Text bleiben verbindlich."
    ].join(" ");
  }
  if (effectiveRole === REFERENCE_ROLES.STYLE_LAYOUT) {
    if (targetedDraftRevision) {
      return [
        "Funktion: Basisentwurf fuer eine gezielte Ueberarbeitung.",
        "Behandle die Referenz als bestehenden Entwurf, nicht als lose Inspiration und nicht als Anlass fuer eine komplette Neugestaltung.",
        "Erhalte alle nicht ausdruecklich genannten Bereiche moeglichst stabil: Komposition, Positionen, Groessenverhaeltnisse, Farbwelt, Schriftanmutung, Linien-/Boxenstil, Weissraum und Illustrationen.",
        "Setze den Variantenwunsch lokal und so klein wie sinnvoll um. Aendere weitere Bereiche nur, wenn es fuer die geforderte Anpassung technisch notwendig ist.",
        "Der aktuelle freigegebene Arbeitsblattinhalt bleibt fuer alle sichtbaren Texte verbindlich."
      ].join(" ");
    }
    return [
      "Funktion: Vorlage fuer Stil und Aufbau.",
      "Nutze diese Referenz als adaptive Rohblattvorlage fuer ein Folgeblatt oder eine Reihe: Randlogik, Header-/Titelstil, Seitenmarker-Stil, Kopf-/Fussbereich, Abstaende, Farbwelt, Schriftanmutung, Linien-/Boxenstil, Weissraum, Rhythmus und Illustrationsstil.",
      "Das neue Blatt soll wie aus derselben Vorlage abgeleitet wirken, aber mit dem aktuellen freigegebenen Inhalt gefuellt sein.",
      "Anzahl, Art und Reihenfolge der Inhaltsbereiche folgen dem aktiven Seitenvertrag; kopiere nicht blind die alte Blockanzahl, alte Aufgabenstruktur oder alte Bild-/Textverteilung.",
      "Nur erlaubte Vorlagenbereiche uebernehmen; Bildfelder, Kartenfelder, Diagramme, Lesetextbereiche oder Materialkaesten duerfen reine Seiten mit Aufgaben nicht verwandeln.",
      "Nicht passende Bereiche weglassen oder in passenden Aufgaben-, Schreib- oder Arbeitsraum umwandeln; Seitenhinweis bleibt bei verbundenen Seiten oben rechts gleich positioniert.",
      "Uebernimm daraus keine Inhalte, keine Aufgaben, keine Lesetexte, keine Bildbeschriftungen und keine konkreten Materialbilder.",
      "Freigegebener Inhalt und separat beigelegte Bildmaterial-Referenzen haben Vorrang vor der Vorlage."
    ].join(" ");
  }
  if (effectiveRole === REFERENCE_ROLES.CONTENT) {
    return [
      "Funktion: Motiv/Inhalt.",
      "Nutze die Referenz fuer Szene, Gegenstand, Perspektive oder fachliche Struktur.",
      "Zeichne das Arbeitsblatt passend neu, statt die Referenz als Layout- oder Stilvorgabe zu behandeln."
    ].join(" ");
  }
  return [
    "Funktion: Stil.",
    "Nutze die Referenz ausschliesslich fuer Oberflaechenlook: Farbpalette, Kontrast, Schriftanmutung, Strichstaerke, Liniencharakter, Textur und Illustrationsbehandlung.",
    "Uebernimm daraus keine Inhalte, keine Aufgaben, keine Bildbeschriftungen, keine Blattkomposition, keine Elementanordnung, keine Seitenzonen, keine Header-/Footer-Position, keine Boxstruktur, keine Abstaende und keine Layoutstruktur."
  ].join(" ");
}

function referenceTargetLine(reference = {}) {
  const targetPage = Number(reference.targetPage || reference.page || 0) || 0;
  return targetPage ? `Geltung: nur Seite ${targetPage}.` : "Geltung: alle passenden Seiten dieses Entwurfs.";
}

function referenceTextBoundaryInstruction(role = "", purpose = "") {
  const effectiveRole = effectiveReferenceRole(role, purpose);
  if (effectiveRole === REFERENCE_ROLES.MATERIAL) {
    return [
      "Materialschutz: QR-Muster, Kartenlabels, Achsenbeschriftungen, Diagrammteile und andere fachliche Bestandteile des Materials erhalten.",
      "Technische oder fachliche Materialbestandteile nicht dekorativ umdeuten oder durch aehnliche erfundene Muster ersetzen.",
      "Erfinde keine neuen Materialtexte oder falschen Labels; ausserhalb dieses lokalen Materials gilt ausschliesslich der freigegebene Arbeitsblatttext."
    ].join(" ");
  }
  return [
    "Referenzschutz: Keine Texte, Ortsnamen, Hausnummern, Schildaufschriften, Bildbeschriftungen, Aufgaben oder nicht freigegebenen Arbeitsblatttexte aus der Referenz uebernehmen.",
    "Referenztext neutralisieren oder ausschliesslich durch freigegebenen Arbeitsblatttext ersetzen, ausser er ist selbst als Bildmaterial vorgesehen."
  ].join(" ");
}

module.exports = {
  REFERENCE_ROLES,
  effectiveReferenceRole,
  normalizeReferenceRole,
  referenceRoleInstruction,
  referenceTextBoundaryInstruction,
  referenceTargetLine
};
