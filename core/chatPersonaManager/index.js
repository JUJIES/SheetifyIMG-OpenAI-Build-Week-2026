"use strict";

const SUBJECT_TERMS = [
  "Deutsch",
  "Englisch",
  "English",
  "Mathematik",
  "Mathe",
  "Biologie",
  "Sachunterricht",
  "Geschichte",
  "Erdkunde",
  "Geografie",
  "Physik",
  "Chemie",
  "Musik",
  "Kunst"
];

const RESPONSE_DEPTHS = Object.freeze({
  MINIMAL: "minimal",
  BRIEF: "brief",
  REFLECTIVE: "reflective"
});

const RELATIONSHIP_MOVES = Object.freeze({
  NONE: "none",
  ACKNOWLEDGE: "acknowledge",
  ENCOURAGE: "encourage",
  CHALLENGE: "challenge",
  REPAIR: "repair"
});

function responsePlan(responseDepth, relationshipMove, sentenceBudget, guidance) {
  return {
    responseDepth,
    relationshipMove,
    sentenceBudget,
    guidance
  };
}

function clean(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .replace(/^["'`]+|["'`]+$/g, "")
    .replace(/[.!?;:,\s]+$/g, "")
    .trim();
}

function normalize(value) {
  return clean(value)
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/ß/g, "ss");
}

function truncate(value, max = 140) {
  const text = clean(value);
  return text.length > max ? `${text.slice(0, max - 1).trim()}…` : text;
}

function sentence(value) {
  const text = clean(value);
  if (!text) {
    return "";
  }
  const capitalized = `${text.charAt(0).toUpperCase()}${text.slice(1)}`;
  return /[.!?]$/.test(capitalized) ? capitalized : `${capitalized}.`;
}

function contextField(workspace = {}, fieldId) {
  return clean(workspace.teachingContext?.fields?.[fieldId]?.value);
}

function matchFirst(raw, patterns = []) {
  for (const pattern of patterns) {
    const match = String(raw || "").match(pattern);
    const value = clean(match?.[1] || "");
    if (value) {
      return value;
    }
  }
  return "";
}

function inferGrade(raw = "", workspace = {}) {
  const fromContext = contextField(workspace, "targetGroup") || workspace.project?.targetGroup;
  if (fromContext) {
    return truncate(fromContext, 70);
  }
  const grade = matchFirst(raw, [
    /\b(?:klasse|kl\.?)\s*(\d{1,2}[a-z]?)\b/i,
    /\bgrade\s*(\d{1,2}[a-z]?)\b/i
  ]);
  if (!grade) {
    return "";
  }
  return /\bgrade\b/i.test(raw) ? `Grade ${grade}` : `Klasse ${grade}`;
}

function inferSubject(raw = "", workspace = {}) {
  const fromProject = clean(workspace.project?.subject);
  if (fromProject) {
    return truncate(fromProject, 60);
  }
  const found = SUBJECT_TERMS.find((term) => new RegExp(`\\b${term}\\b`, "i").test(raw));
  return found ? found : "";
}

function inferTopic(raw = "", workspace = {}) {
  const fromContext = contextField(workspace, "topic") || workspace.project?.topic;
  if (fromContext) {
    return truncate(fromContext, 90);
  }
  return truncate(matchFirst(raw, [
    /\b(?:thema|topic)\s*(?:ist|:)?\s*([^.!?\n;]+)/i,
    /\b(?:arbeitsblatt|blatt|material|leseblatt|uebungsblatt|übungsblatt)\s+(?:zu|zum|zur|ueber|über)\s+([^.!?\n,;]+?)(?:\s+(?:fuer|für|klasse|grade)\b|$)/i,
    /\b(?:sachtext|lesetext|text)\s+(?:zu|zum|zur|ueber|über)\s+([^.!?\n,;]+)/i,
    /\bzu\s+([^.!?\n,;]+?)\s+(?:fuer|für|klasse|grade)\b/i
  ]), 90);
}

function inferWorksheetType(raw = "", workspace = {}) {
  const fromContext = contextField(workspace, "worksheetType");
  if (fromContext) {
    return truncate(fromContext, 80);
  }
  const text = normalize(raw);
  if (/\bleseblatt|leseaufgabe|sachtext\b/.test(text)) {
    return "Leseblatt";
  }
  if (/\bubungsblatt|uebungsblatt|ueben|uben\b/.test(text)) {
    return "Übungsblatt";
  }
  if (/\bzuordn|matching|verbinde|verbinden\b/.test(text)) {
    return "Zuordnungsaufgabe";
  }
  if (/\bprufungsblatt|pruefungsblatt|mock|oral|speaking|mundlich|mündlich\b/.test(text)) {
    return "Prüfungsblatt";
  }
  if (/\binfoblatt|erklarblatt|erklärblatt|lernplakat\b/.test(text)) {
    return "Erklärblatt";
  }
  return "Arbeitsblatt";
}

function inferGoal(raw = "", workspace = {}) {
  const fromContext = contextField(workspace, "lessonGoal");
  if (fromContext) {
    return truncate(fromContext, 140);
  }
  return truncate(matchFirst(raw, [
    /\bziel\s*(?:ist|:)?\s*([^.!?\n;]+)/i,
    /\b(?:die kinder|die schueler|die schüler|students|learners)\s+sollen\s+([^.!?\n;]+)/i,
    /\b(?:trainieren|üben|ueben|sichern|wiederholen)\s*:? ([^.!?\n;]+)/i
  ]), 140);
}

function miniConceptSummary(raw = "", workspace = {}) {
  const subject = inferSubject(raw, workspace);
  const grade = inferGrade(raw, workspace);
  const topic = inferTopic(raw, workspace);
  const type = inferWorksheetType(raw, workspace);
  const goal = inferGoal(raw, workspace);
  const parts = [
    grade || null,
    subject || null,
    topic ? `zum Thema ${topic}` : null
  ].filter(Boolean).join(" ");
  const target = parts ? `${type} für ${parts}` : `${type}`;
  const goalClause = goal && (goal.includes(":") || /^[A-ZÄÖÜ]/.test(goal))
    ? `das auf ${goal} zielt`
    : goal
      ? `bei dem die Schüler ${goal}`
      : "";
  return goal
    ? `Du willst ein ${target} bauen, ${goalClause}.`
    : `Du willst ein ${target} bauen und daraus ein konkretes Arbeitsblatt-Konzept entwickeln.`;
}

function strengthForInput(raw = "", workspace = {}) {
  const text = normalize(raw);
  const goal = inferGoal(raw, workspace);
  if (/\btextbeleg|beleg|detaillesen|informationen entnehmen|reihenfolge|chronologie\b/.test(text)) {
    return "stark ist die klare Leselogik: Informationen entnehmen, belegen und ordnen sind keine Deko-Aufgaben, sondern passen sauber zum Textverstehen.";
  }
  if (/\bleseanfanger|leseanfänger|klasse 1|erstklass|anfanger|anfänger\b/.test(text)) {
    return "stark ist die enge Zielgruppenpassung: kurze Sprache, Bildstütze und wenige Aufgaben können Leseanfänger wirklich entlasten.";
  }
  if (/\bzuordn|matching|verbinde|verbinden|bild-wort\b/.test(text)) {
    return "stark ist der handlungsnahe Zugriff: Zuordnen und Verbinden macht sichtbar, ob die Kinder die Begriffe wirklich verstanden haben.";
  }
  if (/\boral|speaking|mündlich|mundlich|prüfung|pruefung|mock\b/.test(text)) {
    return "stark ist die Nähe zur echten Sprechsituation: Die Aufgaben können Sprachmittel aktivieren, ohne gleich einen langen Schreibteil daraus zu machen.";
  }
  if (/\bafb|operator|begruend|begründen|erklar|erklär|analyse|auswert\b/.test(text)) {
    return "stark ist die Aufgabenstaffelung: Reproduktion, Anwenden und Begründen lassen sich daraus gut sichtbar trennen.";
  }
  if (goal) {
    return "stark ist, dass du nicht nur ein Thema nennst, sondern schon eine Zielrichtung vorgibst; dadurch kann das Konzept didaktisch fokussiert bleiben.";
  }
  return "stark ist der konkrete thematische Kern; daraus lässt sich schnell eine erste Struktur mit Text, Aufgaben und Bildidee ableiten.";
}

function improvementFocusForInput(raw = "", workspace = {}) {
  const text = normalize(raw);
  if (/\bserios|seriös|nicht kindlich|klasse 8|klasse 9|klasse 10|wissenschaftlich|prufungsnah|prüfungsnah\b/.test(text)) {
    return "im Blick behalten würde ich vor allem den Ton: Bildidee und Layout müssen stützen, dürfen das Blatt aber nicht kindlicher machen als die Zielgruppe verträgt.";
  }
  if (/\beinseitig|eine seite|1 seite|din a4\b/.test(text) && /\b(text|aufgabe|aufgaben|bild|karte|diagramm|beleg|belege)\b/.test(text)) {
    return "das meiste Feintuning steckt wahrscheinlich im Platz: Text, Aufgaben und Bildanteil müssen so gewichtet werden, dass die Seite nicht voll wirkt.";
  }
  if (/\bleseanfanger|leseanfänger|klasse 1|erstklass|anfanger|anfänger\b/.test(text)) {
    return "stolpern könnten die Kinder vor allem an Textmenge und Schriftgröße; hier lohnt sich eine sehr klare Auswahl weniger Wörter und Aufgaben.";
  }
  if (/\btextbeleg|beleg|detaillesen|informationen entnehmen|reihenfolge|chronologie\b/.test(text)) {
    return "wichtig wird ein Sachtext mit wirklich belegbaren Stellen; sonst geraten die Aufgaben schnell zu allgemein.";
  }
  if (/\bkarte|diagramm|prozess|pfeil|zeitstrahl\b/.test(text)) {
    return "kritisch wird die visuelle Ordnung: Das Material muss fachlich helfen und darf nicht nur hübsch aussehen.";
  }
  if (/\bhubsch|hübsch|bilder|bild|illustration|cartoon\b/.test(text)) {
    return "aufpassen würde ich darauf, dass die Bilder die Aufgabe tragen und nicht nur dekorativ neben dem Inhalt stehen.";
  }
  return "das größte Verbesserungspotenzial liegt vermutlich in der Feinabstimmung von Umfang, Niveau und Aufgabenformat.";
}

function conceptStartFallback(input = {}, workspace = {}, action = {}) {
  const userMessage = input.message || "";
  const exact = /\b(genau|exakt|1:1|unveraendert|unverändert|nicht umschreiben)\b/i.test(userMessage);
  const withAssumptions = action.confirmationKind === "concept_with_assumptions";
  const summary = miniConceptSummary(userMessage, workspace);
  const strengthText = strengthForInput(userMessage, workspace);
  const strength = sentence(strengthText);
  const improvement = sentence(improvementFocusForInput(userMessage, workspace));
  if (withAssumptions) {
    return `Der Kern ist brauchbar: ${summary} ${strength} ${improvement} Ich kann mit klar markierten Annahmen ein erstes Arbeitsblatt-Konzept vorbereiten, wenn du bewusst loslegen willst.`;
  }
  if (exact) {
    return `Deine Vorgaben sind klar genug, um sie als Leitplanke zu nehmen: ${summary} ${strength} Ich achte besonders darauf, keinen sichtbaren Inhalt dazuzuerfinden, und kann daraus jetzt das Arbeitsblatt-Konzept vorbereiten.`;
  }
  return `Das ist eine gute Grundlage: ${summary} Besonders ${clean(strengthText)}. ${improvement} Ich kann daraus jetzt ein vollständiges Arbeitsblatt-Konzept vorbereiten.`;
}

function suggestedActionFallback(suggestedActions = [], input = {}, workspace = {}) {
  const firstAction = suggestedActions[0] || null;
  if (!firstAction) {
    return "Ich habe den Stand geprüft. Gerade sehe ich keinen sicheren nächsten Produktionsschritt; schick mir am besten kurz, was du ändern oder entscheiden möchtest.";
  }
  if (firstAction.command === "generate_lessonbrief_proposal") {
    return conceptStartFallback(input, workspace, firstAction);
  }
  if (firstAction.command === "generate_content_mirror_proposal") {
    return "Ich greife deinen Planungsstand auf und formuliere daraus jetzt die sichtbare Konzeptfassung mit Text, Aufgaben, erwarteten Antworten und Bildidee. Danach kannst du gezielt entscheiden, ob die Fassung trägt oder noch geschärft werden soll.";
  }
  if (firstAction.command === "approve_current_content") {
    return "Das Arbeitsblatt-Konzept wirkt jetzt tragfähig genug als Basis. Wenn du es freigibst, bleibt genau dieser Inhalt die Grundlage für die Entwürfe.";
  }
  if (firstAction.command === "generate_image_candidate") {
    return "Das Konzept steht; der nächste sinnvolle Schritt ist ein Entwurf. Die Bildgenerierung startet aber nicht nebenbei, sondern erst nach deiner bewussten Kostenbestätigung.";
  }
  return "Ich habe den passenden nächsten Schritt vorbereitet. Du kannst ihn direkt über die vorgeschlagene Aktion ausführen oder vorher noch im Chat nachschärfen.";
}

function conceptVersionFromAction(action = {}) {
  const safeAction = action || {};
  const label = clean(safeAction.label);
  const match = label.match(/\bkonzept\s+v(\d+)\b/i);
  return match ? `Konzept v${match[1]}` : "die gewünschte Konzeptversion";
}

function firstMomentAction(moment = {}) {
  return moment.action || (Array.isArray(moment.suggestedActions) ? moment.suggestedActions[0] : null) || null;
}

function commandFromMoment(moment = {}) {
  return firstMomentAction(moment)?.command || null;
}

function responsePlanForMoment(moment = {}) {
  const action = firstMomentAction(moment);
  const command = commandFromMoment(moment);
  const requiresConfirmation = moment.requiresPaidConfirmation === true || action?.requiresConfirmation === true;

  if (moment.kind === "proposal_ready" && moment.proposal?.kind === "content_mirror") {
    return responsePlan(
      RESPONSE_DEPTHS.REFLECTIVE,
      RELATIONSHIP_MOVES.ENCOURAGE,
      3,
      "Kurze Konzept-Einschaetzung: konkrete Staerke, echte moegliche Stolperstelle, dann Entscheidung oder Nachschaerfung anbieten."
    );
  }

  if (
    (moment.kind === "suggested_action" || moment.kind === "local_action_offer")
    && command === "generate_lessonbrief_proposal"
  ) {
    return responsePlan(
      RESPONSE_DEPTHS.REFLECTIVE,
      RELATIONSHIP_MOVES.ENCOURAGE,
      3,
      "Erste kreative Input-Rueckmeldung: Mini-Konzept spiegeln, konkrete Staerke nennen, nur bei Nutzen einen Denkimpuls ergaenzen."
    );
  }

  if (
    moment.kind === "workflow_followup"
    && ["activate_content_mirror_version", "adopt_content_mirror_proposal", "approve_current_content"].includes(moment.commandId)
  ) {
    return responsePlan(
      RESPONSE_DEPTHS.MINIMAL,
      RELATIONSHIP_MOVES.ACKNOWLEDGE,
      1,
      requiresConfirmation
        ? "Kurz bestaetigen, was jetzt Basis ist, und nur die bewusste Bestaetigung fuer die Entwurfserstellung nennen."
        : "Kurz bestaetigen, was erledigt ist; keine erneute Entscheidung daraus machen."
    );
  }

  if (
    command === "generate_image_candidate"
    || moment.commandId === "generate_image_candidate"
    || requiresConfirmation
  ) {
    return responsePlan(
      RESPONSE_DEPTHS.MINIMAL,
      RELATIONSHIP_MOVES.ACKNOWLEDGE,
      1,
      "Routine-Produktionsschritt: knapp, natuerlich, keine didaktische Einordnung; Kosten-/Bildbestaetigung nicht ueberspringen."
    );
  }

  if (moment.kind === "candidate_created") {
    return responsePlan(
      RESPONSE_DEPTHS.BRIEF,
      RELATIONSHIP_MOVES.ACKNOWLEDGE,
      2,
      "Fertiges Ergebnis knapp beschreiben und den naechsten Review-Schritt nennen."
    );
  }

  if (moment.kind === "proposal_ready" && moment.proposal?.kind === "image_spec") {
    return responsePlan(
      RESPONSE_DEPTHS.BRIEF,
      RELATIONSHIP_MOVES.ACKNOWLEDGE,
      2,
      "Entwurfsvorbereitung kurz erklaeren; keine neue Konzeptdebatte aufmachen."
    );
  }

  if (command === "generate_content_mirror_proposal" || moment.commandId === "generate_content_mirror_proposal") {
    return responsePlan(
      RESPONSE_DEPTHS.BRIEF,
      RELATIONSHIP_MOVES.ACKNOWLEDGE,
      2,
      "Kurz sagen, dass daraus die sichtbare Konzeptfassung entsteht, und worauf die Lehrkraft gleich pruefen sollte."
    );
  }

  if (moment.kind === "proposal_adopted") {
    return responsePlan(
      RESPONSE_DEPTHS.MINIMAL,
      RELATIONSHIP_MOVES.ACKNOWLEDGE,
      1,
      "Uebernahme knapp bestaetigen; keine Reflexion und keine neue Rueckfrage."
    );
  }

  return responsePlan(
    RESPONSE_DEPTHS.BRIEF,
    RELATIONSHIP_MOVES.NONE,
    2,
    "Kurz orientieren und beim aktuellen Wunsch bleiben."
  );
}

function workflowFollowupFallback(commandId, action = null) {
  const nextCandidate = action?.command === "generate_image_candidate";
  if (commandId === "generate_lessonbrief_proposal") {
    return "Ich habe daraus eine erste Konzeptfassung gebaut. Schau vor allem auf Ziel, Aufgabenlogik und Bildidee; wenn die Richtung stimmt, können wir sie als Arbeitsblatt-Konzept ausformulieren.";
  }
  if (commandId === "adopt_lessonbrief_proposal") {
    return "Okay, dann nehmen wir diese Konzeptfassung als Basis. Ich formuliere daraus als Nächstes das sichtbare Arbeitsblatt-Konzept aus.";
  }
  if (commandId === "generate_content_mirror_proposal") {
    return "Ich habe daraus ein vollständiges Arbeitsblatt-Konzept gemacht. Prüf kurz, ob Textmenge, Aufgaben und Bildidee wirklich zu deiner Lerngruppe passen; dann können wir es übernehmen oder gezielt nachschärfen.";
  }
  if (commandId === "activate_content_mirror_version") {
    const version = conceptVersionFromAction(action);
    return nextCandidate
      ? `Alles klar, ${version} ist die Basis; ich öffne dir die Bestätigung für den nächsten Entwurf.`
      : `Alles klar, ${version} ist jetzt die aktuelle Basis.`;
  }
  if (commandId === "adopt_content_mirror_proposal") {
    return nextCandidate
      ? "Alles klar, diese Konzeptversion ist freigegeben; ich öffne dir die Bestätigung für den nächsten Entwurf."
      : "Alles klar, diese Konzeptversion ist jetzt freigegeben und damit die Grundlage für Entwürfe.";
  }
  if (commandId === "approve_current_content") {
    return "Alles klar, das Arbeitsblatt-Konzept ist freigegeben; der nächste Entwurf braucht nur noch deine bewusste Bestätigung.";
  }
  if (commandId === "generate_image_candidate") {
    return "Bildgenerierung läuft im Hintergrund. Sobald der Entwurf fertig ist, erscheint er in der Entwurfsansicht.";
  }
  if (commandId === "deposit_worksheet") {
    return "Arbeitsblatt abgelegt.";
  }
  return "Der Schritt ist erledigt. Ich richte den nächsten Vorschlag am aktuellen Stand aus.";
}

function localActionOfferFallback(actionOffer = {}, context = {}) {
  const suggestedActions = actionOffer.suggestedActions || [];
  const firstAction = suggestedActions[0] || null;
  if (!firstAction) {
    return actionOffer.message || "Ich habe den Stand geprüft. Sag mir kurz, ob du etwas übernehmen, ändern oder als Entwurf sehen möchtest.";
  }
  if (firstAction.command === "adopt_content_mirror_proposal") {
    return "Das klingt nach: diese Konzeptfassung nehmen. Ich kann sie übernehmen und freigeben, damit sie zur Grundlage für Entwürfe wird.";
  }
  if (firstAction.command === "generate_content_mirror_proposal") {
    return "Ich greife deine Änderung am Arbeitsblatt-Konzept auf und mache daraus eine neue Fassung. Danach entscheidest du, ob diese Version die neue Basis wird.";
  }
  if (firstAction.command === "generate_image_candidate") {
    return firstAction.requiresConfirmation
      ? "Alles klar, ich bereite den nächsten Entwurf aus der aktuellen Konzeptbasis vor; die Bildgenerierung startet erst nach deiner Bestätigung."
      : "Alles klar, ich bereite den nächsten Entwurf aus der aktuellen Konzeptbasis vor.";
  }
  if (firstAction.command === "deposit_worksheet") {
    return "Ich kann den aktuellen Entwurf jetzt als Arbeitsblatt ablegen. Danach findest du ihn in der Arbeitsblatt-Ansicht.";
  }
  if (firstAction.command === "activate_content_mirror_version") {
    return "Ich kann diese Konzeptversion als aktuelle Basis setzen. Danach beziehen sich die nächsten Entwurf genau auf diese Fassung.";
  }
  return actionOffer.message || suggestedActionFallback(suggestedActions, { message: context.message || "" }, context.workspace || {});
}

function personaInstructions() {
  return [
    "Produkt-Persona: Du bist SheetifyIMG AI, die antwortende Stimme der App.",
    "Du klingst wie ein didaktisch starker, pragmatischer Kollege: konkret, warm, wach, nicht werblich.",
    "Deine Aufgabe ist nicht nur Statusmeldung, sondern Orientierung: sichtbar verstehen, sinnvoll einordnen, dann den nächsten Schritt benennen.",
    "Workflow-Wahrheit kommt ausschließlich aus dem Moment-Kontext. Erfinde keine ausgeführten Aktionen, keine Freigaben, keine Dateien, keine Buttons und keine Kostenentscheidung.",
    "Passe die Länge an das persona.responseDepth-Profil an: minimal = ein Satz, brief = ein bis zwei kurze Saetze, reflective = zwei bis drei kurze Saetze.",
    "Passe die Beziehungsebene an persona.relationshipMove an: acknowledge = knapp bestaetigen, encourage = konkret bestaerken, challenge = freundlich auf eine echte Stolperstelle zeigen, repair = Irritation kurz sauberstellen.",
    "Minimal heisst: kein Mini-Konzept, kein Lob, keine didaktische Analyse. Nur natuerlich bestaetigen und den sicheren naechsten Schritt nennen.",
    "Reflective heisst: nicht ausschweifen, sondern sehr verdichtet spiegeln, was die Lehrkraft will, warum daran etwas stark ist, und was fachlich oder gestalterisch als Naechstes wichtig wird.",
    "In der Input-Phase: erst Mini-Zusammenfassung der Idee, dann konkrete Stärke, dann nur bei echtem Nutzen eine Stolperstelle, Erweiterung oder Denkfrage.",
    "Lob nie generisch. Wenn du positiv reagierst, begründe konkret an Zielgruppe, Aufgabenlogik, Materialbezug, Textmenge, Visualisierung oder Unterrichtsziel.",
    "Benutze keine Checklisten-Sprache wie 'Rahmen reicht aus', 'Konzept wurde übernommen', 'Auftrag angekommen' oder 'Entwurf wird erstellt', wenn ein natürlicher Satz genauer wäre.",
    "Bei Unsicherheit nicht mechanisch fehlende Angaben aufzählen. Überlege, was eine erfahrene Lehrkraft oder ein guter AB-Entwickler wirklich zurückmelden würde.",
    "Bleib knapp, wenn der User knapp handelt. Menschlich heißt nicht wortreich."
  ].join("\n");
}

module.exports = {
  conceptStartFallback,
  localActionOfferFallback,
  miniConceptSummary,
  personaInstructions,
  RELATIONSHIP_MOVES,
  RESPONSE_DEPTHS,
  responsePlanForMoment,
  strengthForInput,
  suggestedActionFallback,
  workflowFollowupFallback,
  __testing: {
    improvementFocusForInput,
    inferGoal,
    inferGrade,
    inferSubject,
    inferTopic,
    inferWorksheetType
  }
};
