"use strict";

function normalizeText(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/ß/g, "ss")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function questionIntent(message) {
  const raw = String(message || "").trim();
  const text = normalizeText(raw);
  return /[?？]\s*$/.test(raw)
    || /\b(oder|oder nicht|richtig|korrekt)\s*$/.test(text)
    || /\b(heisst|heist|bedeutet|meinst du|verstehe ich|ist das|waere das|ware das|muss ich|sollte ich|kann ich|kannst du)\b/.test(text);
}

function brainstormingIntent(message) {
  const text = normalizeText(message);
  const wantsOptions = /\b(ideen|themenideen|optionen|moglichkeiten|moeglichkeiten|brainstorming|brainstorm)\b/.test(text)
    || /\b(gib|nenn|nenne|zeig|zeige|hast du|hattest du|haettest du)\b.{0,100}\b(idee|ideen|thema|themen|option|optionen|vorschlag|vorschlage|vorschlaege)\b/.test(text)
    || /\b(drei|3|zwei|2|mehrere|ein paar)\b.{0,80}\b(idee|ideen|thema|themen|option|optionen|vorschlag|vorschlage|vorschlaege)\b/.test(text);
  if (!wantsOptions) {
    return false;
  }
  return !/\b(konzept vorschlagen|arbeitsblatt-konzept vorschlagen|konzept erstellen|arbeitsblatt erstellen|direkt ein konzept|mach daraus ein konzept)\b/.test(text);
}

function affirmativeIntent(message) {
  const text = normalizeText(message);
  return /^(ja|jo|jep|yes|okay|ok|passt|gern|gerne|bitte|mach|mache|tu|weiter|los)(\b|$)/.test(text)
    || /\b(ja gerne|mach das|tu das|mach weiter|weiter so|leg los|kannst du machen|direkt machen)\b/.test(text);
}

function adoptionIntent(message) {
  const text = normalizeText(message);
  return /\b(uebernehmen|ubernehmen|uebernehme|ubernehme|uebernimm|ubernimm|freigeben|freigabe|passt so|so nehmen|nimm das)\b/.test(text);
}

function proposalIntent(message) {
  const text = normalizeText(message);
  if (questionIntent(message)) {
    return false;
  }
  return /\b(vorschlag|konzept|arbeitsblatt-konzept|formuliere|erstell|erstelle|mach|mache)\b/.test(text)
    && /\b(weiter|direkt|jetzt|daraus)\b/.test(text);
}

function autopilotIntent(message) {
  const text = normalizeText(message);
  return /\b(mach einfach|einfach machen|direkt weiter|frag nicht nochmal|ohne nochmal|du entscheidest|setz du|zieh durch|mach daraus|mach mal|erstell das blatt|erstelle das blatt)\b/.test(text);
}

function skipReferenceIntent(message) {
  const text = normalizeText(message);
  return /\b(ohne referenz|ohne webreferenz|keine referenz|referenz ueberspringen|ohne vorlage|trotzdem weiter|direkt weiter)\b/.test(text);
}

function candidateGenerationIntent(message) {
  const text = normalizeText(message);
  return /\b(entwurf|entwurfe|entwurfsreihe|entwurfslauf|entwurfsrunde|mehrseitiger entwurf|mehrseitigen entwurf|kandidat|kandidaten|kandidatenreihe|kandidatenlauf|kandidatenrunde|bildkandidat|bild-kandidat|bild kandidaten|zweiter entwurf|zweiten entwurf|zweiter kandidat|zweiten kandidaten|neuer entwurf|neuen entwurf|neuer kandidat|neuen kandidaten|weitere variante|zweite variante|regenerier|regeneriere|nochmal erzeugen|noch einmal erzeugen|erneut erzeugen)\b/.test(text)
    && /\b(erzeug|erzeuge|erzeugen|erstelle|erstellen|mach|mache|generier|generiere|generieren|render|rendern|variante|zweiter|zweiten|neuer|neuen|regenerier|nochmal|erneut)\b/.test(text);
}

function explicitCandidateGenerationIntent(message) {
  return candidateGenerationIntent(message) && !questionIntent(message);
}

function revisionTerms(message) {
  const text = normalizeText(message);
  return /\b(ueberarbeit|uberarbeit|aktualisier|aender|ander|anpass|korrigier|entfern|streiche|streich|ersetze|revision|revidier)\w*\b/.test(text)
    || /\b(raus|weg|nicht mehr|ohne|statt)\b/.test(text);
}

function worksheetTextCorrectionIntent(message) {
  const text = normalizeText(message);
  const visibleTextObject = /\b(wort|woerter|worter|ausdruck|ausdruecke|ausdrucke|satz|saetze|satze|textstelle|markier\w*|hervorgehob\w*)\b/.test(text);
  const formattingOrPlacement = /\b(fett|bold|kursiv|unterstrich\w*|hervorheb\w*|markier\w*|direkt im satz|im satz|dahinter|daneben|statt|nicht dahinter|nicht daneben)\b/.test(text);
  const correctionSignal = /\b(soll|sollte|muss|muesste|musste|statt|nicht|falsch|korrigier\w*|aender\w*|ander\w*|ueberarbeit\w*|uberarbeit\w*)\b/.test(text);
  return visibleTextObject && formattingOrPlacement && correctionSignal;
}

function contentChangeIntent(message) {
  const text = normalizeText(message);
  const contentObject = /\b(konzept|blatt|blaetter|blatter|arbeitsblatt|arbeitsblaetter|arbeitsblatter|seite|seiten|sheet|sheets|aufgabe|aufgaben|lesetext|text|inhalt|fragen|ziel|phrase|phrasen|formulierungen|sprachmittel|sprachliche mittel|zuordnung|zuordnungsaufgabe)\b/.test(text);
  const worksheetStructureChange = /\b(linie|linien|verbinden|zuordnen|zuordnung|zuordnungsaufgabe|zahlen|nummern|buchstaben|a b|1 a|1a|paare|phrasenpaare|phrase|phrasen|formulierungen|sprachmittel|sprachliche mittel)\b/.test(text)
    && /\b(soll|sollen|muss|muessen|mussen|bitte|nicht|ohne|statt|raus|weg|mehr|weniger|mindestens|ca|circa|ungefaehr|genau|pro blatt|je blatt|jeweils|brauchen|braeuchten|brauchten|nutzen)\b/.test(text);
  const preserveOnly = /\b(inhalt|text|aufgabe|aufgaben|konzept)\b.*\b(gleich lassen|nicht aendern|nicht andern|unveraendert|unverandert|beibehalten)\b/.test(text)
    || /\b(gleich lassen|nicht aendern|nicht andern|unveraendert|unverandert|beibehalten)\b.*\b(inhalt|text|aufgabe|aufgaben|konzept)\b/.test(text);
  const hardChange = /\b(lernziel|unterrichtsziel|zielgruppe|klasse|niveau|schwierigkeit|schwer\w*|leicht\w*|einfacher\w*|vereinfach\w*|zu schwer|zu leicht|weniger text|mehr text|andere aufgaben|andere frage|fachlich|falsch|korrigiere|ersetze|tausch\w*|streiche|entferne|umformulier\w*|einfach\w* sprache|mehr uebung|mehr ubung|loesung|losung|antwort)\b/.test(text);
  const objectChange = contentObject
    && (revisionTerms(message) || /\b(einfacher|kuerz|kuerzer|laeng|laenger|mehr|weniger|nicht passend|passt nicht|passt so nicht|zu viel|zu wenig|anders|tausch|tausche)\b/.test(text));
  return hardChange || worksheetTextCorrectionIntent(message) || worksheetStructureChange || (objectChange && !preserveOnly);
}

function conceptDesignRevisionIntent(message) {
  const text = normalizeText(message);
  const designObject = /\b(konzeptlayout|arbeitsblattlayout|layout|thema|themenlayout|motto|motiv|stil|style|look|optik|design|gestaltung|visuell|visuelle klammer|rahmen)\b/.test(text);
  const changeSignal = /\b(soll|sollen|mach|mache|aendere|andere|anpassen|angepasst|ueberarbeite|uberarbeite|mit|im|als|bekommen|haben)\b/.test(text);
  return designObject && changeSignal;
}

function visualCandidateFeedbackIntent(message) {
  const text = normalizeText(message);
  return /\b(entwurf|entwurfe|kandidat|kandidaten|bild|bilder|variante|layout|schrift|groessere schrift|groesserer schrift|grosse schrift|weissraum|abstand|abstaende|ruhiger|unruhig|deko|dekoration|illustration|farben|farbe|zweig|beere|beeren|oben|unten|rand)\b/.test(text);
}

function explicitConceptTargetIntent(message) {
  const text = normalizeText(message);
  return /\b(konzept|konzeptlayout|konzeptgestaltung|arbeitsblatt-konzept|arbeitsblattlayout|konzeptschritt|lessonbrief|content mirror)\b/.test(text);
}

function hasCandidateContext(workspace = {}) {
  return Boolean(workspace.latestRun?.candidateCount || workspace.preview?.candidates?.length);
}

function conceptVersionTarget(message) {
  const text = normalizeText(message);
  const direct = text.match(/\b(?:konzept|concept)?\s*v(?:ersion)?\s*0*(\d+)\b/)
    || text.match(/\b(?:konzept|concept)\s*0*(\d+)\b/);
  if (direct) {
    return Number(direct[1]) || null;
  }
  const varMatch = text.match(/\b(?:variante|var)\s*0*(\d+)\b/);
  const conceptContext = /\b(konzept|arbeitsblatt-konzept|freigeb|frei|aktuell|auswaehl|auswahl|basis|setz|setzen|nehmen|nimm|verwende|nutze)\w*\b/.test(text);
  return varMatch && conceptContext ? Number(varMatch[1]) || null : null;
}

function conceptVersionActionIntent(message) {
  const text = normalizeText(message);
  const targetVersion = conceptVersionTarget(message);
  if (!targetVersion) {
    return false;
  }
  return candidateGenerationIntent(message)
    || adoptionIntent(message)
    || /\b(nehm|nehmen|nimm|setze|setz|basis|aktuell|freigeb|frei|auswaehl|auswahl|verwende|verwenden|nutze|nutzen|zurueck|zuruck|wechsel|wechsle)\w*\b/.test(text)
    || /\b(basierend|basiert|auf grundlage|grundlage)\b.{0,80}\bv(?:ersion)?\s*0*\d+\b/.test(text)
    || /\b(basierend|basiert|auf grundlage|grundlage)\b.{0,80}\b(?:konzept|variante|var)\s*0*\d+\b/.test(text);
}

function pdfExportIntent(message) {
  const text = normalizeText(message);
  return /\b(pdf|export|download|herunterladen)\b/.test(text)
    && /\b(erzeug|erzeuge|erstellen|mach|mache|geben|gib|bereit|download|herunterladen)\b/.test(text);
}

function selectionIntent(message) {
  const text = normalizeText(message);
  return /\b(entwurf|kandidat|candidate)\s*0*(\d+)\b/.test(text)
    && /\b(auswaehl|auswahl|nehmen|nimm|select|waehle)\w*\b/.test(text);
}

function worksheetDepositIntent(message) {
  const text = normalizeText(message);
  if (questionIntent(message)) {
    return false;
  }
  const depositVerb = /\b(leg|lege|legen|ableg|ablegen|abgelegt|speicher|speichern|archivier|archivieren|ueberfuehr|uberfuhr|ueberfuehren|uberfuehren)\w*\b/.test(text);
  const target = /\b(arbeitsblatt|arbeitsblaetter|arbeitsblatter|ab|bundle|arbeitsblatt-bundle|ablage)\b/.test(text)
    || /\bin arbeitsblaetter\b/.test(text)
    || /\bin arbeitsblatter\b/.test(text);
  const source = /\b(entwurf|entwurfe|kandidat|candidate|variante|seite|seiten|pdf)\b/.test(text);
  const currentSource = /\b(das|dies|diese|diesen|dieser|daraus|aktuellen|aktuelle|fertigen|fertige)\b/.test(text);
  return depositVerb && target && (source || currentSource);
}

function explicitPdfDepositIntent(message) {
  const text = normalizeText(message);
  if (questionIntent(message)) {
    return false;
  }
  const action = /\b(erstell|erstelle|machen|mach|mache|bereitstell|bereitstellen|exportier|exportiere|speicher|speichern|ableg|ablegen)\w*\b/.test(text);
  const target = /\b(pdf|download|export)\b/.test(text);
  const source = /\b(entwurf|entwurfe|kandidat|candidate|variante|seite|seiten|daraus|dies|diesen|diese|aktuellen|aktuelle)\b/.test(text);
  return action && target && source;
}

function explicitWorksheetDepositIntent(message) {
  return worksheetDepositIntent(message) || explicitPdfDepositIntent(message);
}

module.exports = {
  adoptionIntent,
  affirmativeIntent,
  autopilotIntent,
  brainstormingIntent,
  candidateGenerationIntent,
  conceptDesignRevisionIntent,
  conceptVersionActionIntent,
  conceptVersionTarget,
  contentChangeIntent,
  explicitCandidateGenerationIntent,
  explicitConceptTargetIntent,
  explicitPdfDepositIntent,
  explicitWorksheetDepositIntent,
  hasCandidateContext,
  normalizeText,
  pdfExportIntent,
  proposalIntent,
  questionIntent,
  revisionTerms,
  selectionIntent,
  skipReferenceIntent,
  visualCandidateFeedbackIntent,
  worksheetDepositIntent,
  worksheetTextCorrectionIntent
};
