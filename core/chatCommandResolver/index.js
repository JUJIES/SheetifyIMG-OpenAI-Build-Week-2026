"use strict";

const { visibleWorkflowCommands } = require("../workflowPolicy");

const AUTO_COMMANDS = new Set([
  "generate_lessonbrief_proposal",
  "adopt_lessonbrief_proposal",
  "generate_content_mirror_proposal",
  "adopt_content_mirror_proposal",
  "approve_current_content"
]);

function normalizeText(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/ß/g, "ss")
    .replace(/\s+/g, " ")
    .trim();
}

function latestAssistantMessage(messages = []) {
  return [...messages].reverse().find((message) => message.role === "assistant") || null;
}

function commandById(workspace = {}, commandId) {
  return (workspace.commands || []).find((command) => command.id === commandId) || null;
}

function isExecutableChatCommand(command = {}) {
  return Boolean(command?.enabled)
    && AUTO_COMMANDS.has(command.id)
    && command.requiresConfirmation !== true;
}

function affirmativeIntent(message) {
  const text = normalizeText(message);
  return /^(ja|jo|jep|yes|okay|ok|passt|gern|gerne|bitte|mach|mache|tu|weiter|los)(\b|$)/.test(text)
    || /\b(ja gerne|mach das|tu das|mach weiter|weiter so|leg los|kannst du machen|direkt machen)\b/.test(text);
}

function adoptionIntent(message) {
  const text = normalizeText(message);
  return /\b(uebernehmen|ubernehmen|übernehmen|uebernehme|ubernehme|übernehme|freigeben|freigabe|passt so|so nehmen|nimm das)\b/.test(text);
}

function proposalIntent(message) {
  const text = normalizeText(message);
  if (questionIntent(message)) {
    return false;
  }
  return /\b(vorschlag|konzept|arbeitsblatt-konzept|formuliere|erstell|erstelle|mach|mache)\b/.test(text)
    && /\b(weiter|direkt|jetzt|daraus)\b/.test(text);
}

function questionIntent(message) {
  const raw = String(message || "").trim();
  const text = normalizeText(raw);
  return /[?？]\s*$/.test(raw)
    || /\b(oder|oder nicht|richtig|korrekt)\s*$/.test(text)
    || /\b(heisst|heist|bedeutet|meinst du|verstehe ich|ist das|waere das|ware das|muss ich|sollte ich|kann ich|kannst du)\b/.test(text);
}

function revisionTerms(message) {
  const text = normalizeText(message);
  return /\b(ueberarbeit|uberarbeit|aktualisier|aender|ander|anpass|korrigier|entfern|streiche|streich|ersetze|revision|revidier)\w*\b/.test(text)
    || /\b(raus|weg|nicht mehr|ohne|statt)\b/.test(text);
}

function conceptRevisionQuestionIntent(message) {
  const text = normalizeText(message);
  return questionIntent(message)
    && /\b(konzept|arbeitsblatt-konzept|konzeptschritt|aufgabe|aufgaben|text|inhalt|phrase|phrasen|satzstarter|sprachmittel|bildidee)\b/.test(text)
    && revisionTerms(message);
}

function conceptRevisionIntent(message) {
  const isContentChange = contentChangeIntent(message);
  const isDesignChange = conceptDesignRevisionIntent(message);
  if (!isContentChange && !isDesignChange) {
    return false;
  }
  if (candidateGenerationIntent(message)) {
    return true;
  }
  if (isDesignChange) {
    return true;
  }
  if (worksheetTextCorrectionIntent(message)) {
    return true;
  }
  if (isContentChange) {
    return true;
  }
  return /\b(ueberarbeite|uberarbeite|überarbeite|aendere|ändere|anpassen|angepasst|einfacher|leicht|leichter|schwer|schwerer|kuerz|kuerzer|kürzer|laeng|laenger|länger|mehr uebung|mehr übung|weniger aufgaben|andere aufgaben|andere frage|anders|tausch|tausche|streiche|entferne|fokussier|fokussieren|nicht passend|passt nicht|passt so nicht|zu schwer|zu leicht|zu viel|zu wenig|fachlich|korrigiere|ersetze)\b/.test(normalizeText(message));
}

function conceptRevisionContinuationIntent(workspace = {}, message = "") {
  if (!affirmativeIntent(message)) {
    return false;
  }
  const assistant = latestAssistantMessage(workspace.chat?.messages || []);
  const text = normalizeText(assistant?.content || "");
  if (!text || /\b(uebernehmen|ubernehmen|freigeben|freigabe|passt)\b/.test(text)) {
    return false;
  }
  return /\b(konzept|konzeptfassung|arbeitsblatt-konzept|sichtbare konzept)\b/.test(text)
    && /\b(ueberarbeit|uberarbeit|formuliere|formulieren|ausformulier|vollstaendig|vollstandig|saubere fassung|passenden stil|genau diesem stil)\b/.test(text);
}

function wantsAction(message) {
  return affirmativeIntent(message) || adoptionIntent(message) || proposalIntent(message);
}

function autopilotIntent(message) {
  const text = normalizeText(message);
  return /\b(mach einfach|einfach machen|direkt weiter|frag nicht nochmal|ohne nochmal|du entscheidest|setz du|zieh durch|mach daraus|mach mal|erstell das blatt|erstelle das blatt)\b/.test(text);
}

function skipReferenceIntent(message) {
  const text = normalizeText(message);
  return /\b(ohne referenz|ohne webreferenz|keine referenz|referenz ueberspringen|referenz überspringen|ohne vorlage|trotzdem weiter|direkt weiter)\b/.test(text);
}

function candidateGenerationIntent(message) {
  const text = normalizeText(message);
  return /\b(kandidat|kandidaten|bildkandidat|bild-kandidat|bild kandidaten|zweiter kandidat|zweiten kandidaten|neuer kandidat|neuen kandidaten|weitere variante|zweite variante|regenerier|regeneriere|nochmal erzeugen|noch einmal erzeugen|erneut erzeugen)\b/.test(text)
    && /\b(erzeug|erzeuge|erzeugen|erstelle|mach|mache|generier|generiere|generieren|render|rendern|variante|zweiter|zweiten|neuer|neuen|regenerier|nochmal|erneut)\b/.test(text);
}

function hasCandidateContext(workspace = {}) {
  return Boolean(workspace.latestRun?.candidateCount || workspace.preview?.candidates?.length);
}

function conceptLevelChangeIntent(message) {
  return contentChangeIntent(message);
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
    && /\b(soll|sollen|muss|muessen|mussen|bitte|nicht|ohne|statt|raus|weg|mehr|weniger|mindestens|ca|circa|ungefaehr|ungefähr|genau|pro blatt|je blatt|jeweils|brauchen|braeuchten|brauchten|nutzen)\b/.test(text);
  const preserveOnly = /\b(inhalt|text|aufgabe|aufgaben|konzept)\b.*\b(gleich lassen|nicht aendern|nicht andern|unveraendert|unverandert|beibehalten)\b/.test(text)
    || /\b(gleich lassen|nicht aendern|nicht andern|unveraendert|unverandert|beibehalten)\b.*\b(inhalt|text|aufgabe|aufgaben|konzept)\b/.test(text);
  const hardChange = /\b(lernziel|unterrichtsziel|zielgruppe|klasse|niveau|schwierigkeit|schwer\w*|leicht\w*|einfacher\w*|vereinfach\w*|zu schwer|zu leicht|weniger text|mehr text|andere aufgaben|andere frage|fachlich|falsch|korrigiere|ersetze|tausch\w*|streiche|entferne|umformulier\w*|einfach\w* sprache|mehr uebung|mehr ubung|loesung|losung|antwort)\b/.test(text);
  const objectChange = contentObject
    && (revisionTerms(message) || /\b(einfacher|kuerz|kuerzer|laeng|laenger|mehr|weniger|nicht passend|passt nicht|passt so nicht|zu viel|zu wenig|anders|tausch|tausche)\b/.test(text));
  return hardChange || worksheetTextCorrectionIntent(message) || worksheetStructureChange || (objectChange && !preserveOnly);
}

function conceptDesignRevisionIntent(message) {
  const text = normalizeText(message);
  const designObject = /\b(layout|thema|themenlayout|motto|motiv|stil|style|look|optik|design|gestaltung|visuell|visuelle klammer|rahmen)\b/.test(text);
  const changeSignal = /\b(soll|sollen|mach|mache|aendere|andere|ändere|anpassen|angepasst|ueberarbeite|uberarbeite|überarbeite|mit|im|als|bekommen|haben)\b/.test(text);
  return designObject && changeSignal;
}

function visualCandidateFeedbackIntent(message) {
  const text = normalizeText(message);
  return /\b(kandidat|kandidaten|bild|bilder|variante|layout|schrift|groessere schrift|große schrift|grosse schrift|größere schrift|weissraum|weißraum|abstand|abstaende|abstände|ruhiger|unruhig|deko|dekoration|illustration|farben|farbe|zweig|beere|beeren|oben|unten|rand)\b/.test(text);
}

function candidateVariantIntent(workspace = {}, message = "") {
  return hasCandidateContext(workspace)
    && !contentChangeIntent(message)
    && (candidateGenerationIntent(message) || visualCandidateFeedbackIntent(message));
}

function normalizeReferencePath(value) {
  const text = String(value || "").trim();
  return text ? text.replaceAll("\\", "/").replace(/^\/+/, "") : null;
}

function inferReferenceRole(message) {
  const text = normalizeText(message);
  if (/\b(layout|aufbau|komposition|struktur|anordnung|rand|abstand|weissraum|weißraum)\b/.test(text)) {
    return "layout_reference";
  }
  if (/\b(motiv|figur|gegenstand|objekt|inhalt|bildinhalt)\b/.test(text)) {
    return "content_reference";
  }
  return "style_reference";
}

function persistentReferenceIntent(message) {
  const text = normalizeText(message);
  return /\b(stil beibehalten|style beibehalten|look beibehalten|optik beibehalten|weiter so|als basis behalten|als vorlage behalten|diesen stil behalten|gleicher stil auch weiter|fuer weitere varianten|für weitere varianten|dauerhaft|immer so)\b/.test(text);
}

function referenceScopeForMessage(message) {
  return persistentReferenceIntent(message) ? "persistent" : "next_candidate";
}

function latestUserMessage(workspace = {}) {
  return [...(workspace.chat?.messages || [])].reverse()
    .find((entry) => entry.role === "user") || null;
}

function hasVisualFeedbackAttachment(workspace = {}) {
  return (latestUserMessage(workspace)?.attachments || [])
    .some((attachment) => attachment.kind === "visual_feedback");
}

function visualReferenceForCandidateIntent(workspace = {}, message = "") {
  if (!hasVisualFeedbackAttachment(workspace)) {
    return false;
  }
  const command = commandById(workspace, "generate_image_candidate");
  if (!command?.enabled) {
    return false;
  }
  const text = normalizeText(message);
  const referenceSignal = /\b(referenz|vorlage|screenshot|ausschnitt|angehaengt|angehangt|angehaengte|angehangte|layout|stil|style|aufbau|gleich aufgebaut|gleiches layout|gleichen stil|mock-exam|mock exam)\b/.test(text);
  const candidateSignal = /\b(kandidat|kandidaten|bildgenerier|bildgenerierung|bild-kandidat|bildkandidat|naechsten kandidat|nächsten kandidat|naechster kandidat|nächster kandidat|variante|erzeuge|erzeugen|generier|generiere|render)\b/.test(text);
  const preserveContentSignal = /\b(inhaltlich gilt|inhaltlich bleibt|inhalt bleibt|konzept gilt|ueberarbeitete konzept|überarbeitete konzept|freigegebene konzept|auf basis des konzepts)\b/.test(text);
  return referenceSignal && (candidateSignal || preserveContentSignal);
}

function latestCandidate(workspace = {}) {
  const candidates = workspace.latestRun?.manifest?.candidates || [];
  return workspace.latestRun?.selectedCandidateDetail || candidates[candidates.length - 1] || null;
}

function attachmentReferenceImages(workspace = {}, message = "") {
  const userMessage = latestUserMessage(workspace);
  const references = [];
  for (const attachment of userMessage?.attachments || []) {
    if (attachment.kind !== "visual_feedback") {
      continue;
    }
    const refPath = normalizeReferencePath(attachment.path);
    if (!refPath) {
      continue;
    }
    references.push({
      id: attachment.id || `ref_visual_${references.length + 1}`,
      role: inferReferenceRole(`${message} ${attachment.label || ""}`),
      path: refPath,
      purpose: String(message || "").trim() || attachment.label || "Visuelle Referenz aus dem Chat",
      scope: referenceScopeForMessage(message),
      source: attachment.source || null
    });
  }
  return references;
}

function concreteVisualReferenceIntent(message) {
  const text = normalizeText(message);
  return /\b(dieser|dieses|diese|diesen|dem|hier|screenshot|ausschnitt|markierung|crop|referenz|vorlage|wie candidate_\d+|candidate_\d+|aktueller kandidat|aktuellen kandidat|dieser kandidat|diesen kandidat|behalten|genau so|gleiches layout|gleichen stil|gleicher stil)\b/.test(text);
}

function candidateReferenceImages(workspace = {}, message = "") {
  if (!concreteVisualReferenceIntent(message)) {
    return [];
  }
  const runState = workspace.latestRun || null;
  const runPath = normalizeReferencePath(runState?.path);
  const candidate = latestCandidate(workspace);
  if (!runPath || !candidate) {
    return [];
  }
  return (candidate.pages || [])
    .slice(0, 2)
    .map((page, index) => {
      const pagePath = normalizeReferencePath(page.path);
      if (!pagePath) {
        return null;
      }
      const pageNumber = Number(page.page || index + 1);
      return {
        id: `ref_${candidate.id || "candidate"}_${pageNumber}`,
        role: inferReferenceRole(message),
        path: `${runPath}/${pagePath}`,
        purpose: `Bestehenden Kandidaten ${candidate.id || ""}${pageNumber ? ` Seite ${pageNumber}` : ""} als visuelle Referenz nutzen: ${String(message || "").trim()}`,
        scope: referenceScopeForMessage(message),
        source: {
          projectId: workspace.project?.projectId || null,
          runId: runState.runId || null,
          candidateId: candidate.id || null,
          page: pageNumber,
          role: page.role || null
        }
      };
    })
    .filter(Boolean);
}

function persistentReferenceImagesFromLatestCandidate(workspace = {}, message = "") {
  if (concreteVisualReferenceIntent(message)) {
    return [];
  }
  const candidate = latestCandidate(workspace);
  return (candidate?.generation?.referenceImages || [])
    .filter((reference) => reference.scope === "persistent")
    .map((reference) => ({
      ...reference,
      purpose: reference.purpose || `Persistente visuelle Referenz aus ${candidate.id || "dem letzten Kandidaten"}`,
      scope: "persistent"
    }));
}

function referenceImagesForVariant(workspace = {}, message = "") {
  const references = [
    ...attachmentReferenceImages(workspace, message),
    ...candidateReferenceImages(workspace, message),
    ...persistentReferenceImagesFromLatestCandidate(workspace, message)
  ];
  const seen = new Set();
  return references
    .filter((reference) => {
      if (!reference.path || seen.has(reference.path)) {
        return false;
      }
      seen.add(reference.path);
      return true;
    })
    .slice(0, 4)
    .map((reference, index) => ({
      id: reference.id || `ref_${String(index + 1).padStart(2, "0")}`,
      role: reference.role || "style_reference",
      path: reference.path,
      purpose: reference.purpose || "Visuelle Referenz",
      scope: reference.scope || "next_candidate",
      source: reference.source || null
    }));
}

function openContentProposalCommand(workspace = {}) {
  const hasOpenContentProposal = Boolean(workspace.proposals?.latestContentMirror);
  if (!hasOpenContentProposal) {
    return null;
  }
  const command = commandById(workspace, "adopt_content_mirror_proposal");
  return command?.enabled ? command : null;
}

function openProposalCandidateOrContinuationIntent(message) {
  const text = normalizeText(message);
  return skipReferenceIntent(message)
    || candidateGenerationIntent(message)
    || /\b(kandidat\w*|variante\w*|bildkandidat\w*|bildgenerier\w*|bildgenerierung|render\w*|direkt weiter|weiter machen|weitermachen|naechster schritt|nächster schritt)\b/.test(text);
}

function recentAutopilotIntent(workspace = {}) {
  return (workspace.chat?.messages || [])
    .filter((message) => message.role === "user")
    .slice(-4)
    .some((message) => autopilotIntent(message.content || ""));
}

function shouldUseAutopilot(workspace, message, commandId) {
  if (autopilotIntent(message)) {
    return true;
  }
  return commandId === "adopt_lessonbrief_proposal" && recentAutopilotIntent(workspace);
}

function resolveConceptRevisionCommand(workspace = {}, message = "") {
  if (visualReferenceForCandidateIntent(workspace, message)) {
    return null;
  }
  if (candidateVariantIntent(workspace, message)) {
    return null;
  }
  const hasConceptBasis = Boolean(
    workspace.proposals?.latestContentMirror
      || workspace.documents?.content?.data
      || workspace.documents?.brief?.data
  );
  if (!(conceptRevisionIntent(message) || conceptRevisionContinuationIntent(workspace, message)) || !hasConceptBasis) {
    return null;
  }
  const command = commandById(workspace, "generate_content_mirror_proposal");
  if (!isExecutableChatCommand(command)) {
    return null;
  }
  return {
    command: command.id,
    payload: {
      ...(command.defaultPayload || {}),
      message: String(message || "").trim()
    },
    source: "concept_revision_feedback",
    autopilot: false
  };
}

function resolveChatActionOffer(workspace = {}, message = "") {
  if (visualReferenceForCandidateIntent(workspace, message)) {
    const command = commandById(workspace, "generate_image_candidate");
    const feedback = String(message || "").trim();
    const referenceImages = referenceImagesForVariant(workspace, message);
    return {
      source: "visual_reference_candidate_confirmation",
      message: referenceImages.length
        ? "Ich nutze das angehängte Bild als Layout- bzw. Stilreferenz für den nächsten Kandidaten. Inhaltlich bleibt das freigegebene Arbeitsblatt-Konzept maßgeblich; die Bildgenerierung bestätigst du bitte bewusst."
        : "Ich kann daraus jetzt den nächsten Kandidaten erzeugen; die Bildgenerierung bestätigst du bitte bewusst.",
      suggestedActions: [{
        command: command.id,
        label: hasCandidateContext(workspace) ? "Weitere Variante erzeugen" : command.label,
        payload: {
          ...(command.defaultPayload || {}),
          message: feedback,
          variantInstruction: feedback,
          ...(referenceImages.length ? { referenceImages } : {})
        },
        requiresConfirmation: command.requiresConfirmation === true,
        confirmationKind: command.confirmationKind || null,
        reason: command.reason || null
      }]
    };
  }

  if (conceptRevisionQuestionIntent(message)) {
    const command = commandById(workspace, "generate_content_mirror_proposal");
    if (command?.enabled && command.requiresConfirmation === true) {
      return {
        source: "concept_revision_question",
        message: "Ja, das ist eine Konzeptänderung. Ich sollte zuerst das Arbeitsblatt-Konzept überarbeiten; erst danach sollte ein neuer Kandidat erzeugt oder exportiert werden.",
        suggestedActions: [{
          command: command.id,
          label: "Konzept überarbeiten",
          payload: {
            ...(command.defaultPayload || {}),
            message: String(message || "").trim()
          },
          requiresConfirmation: command.requiresConfirmation === true,
          confirmationKind: command.confirmationKind || null,
          reason: command.reason || null
        }]
      };
    }
  }

  const contentProposalCommand = openContentProposalCommand(workspace);
  if (contentProposalCommand && openProposalCandidateOrContinuationIntent(message)) {
    const label = contentProposalCommand.label || "Konzept aktualisieren";
    return {
      source: "content_proposal_before_candidate",
      message: "Es liegt noch eine offene Konzeptänderung vor. Ich sollte zuerst dieses Konzept aktualisieren; danach wird der nächste Kandidat auf genau dieser neuen Grundlage erzeugt.",
      suggestedActions: [{
        command: contentProposalCommand.id,
        label,
        payload: contentProposalCommand.defaultPayload || {},
        requiresConfirmation: contentProposalCommand.requiresConfirmation === true,
        confirmationKind: contentProposalCommand.confirmationKind || null,
        reason: contentProposalCommand.reason || null
      }]
    };
  }

  if (skipReferenceIntent(message)) {
    const command = commandById(workspace, "generate_image_candidate");
    if (command?.enabled) {
      return {
        source: "skip_reference_candidate_offer",
        message: "Die Referenz ist optional. Ich kann ohne Referenz direkt einen Kandidaten erzeugen; die Bildgenerierung bestätigst du bitte bewusst.",
        suggestedActions: [{
          command: command.id,
          label: command.label || "Kandidat erzeugen",
          payload: command.defaultPayload || {},
          requiresConfirmation: command.requiresConfirmation === true,
          confirmationKind: command.confirmationKind || null,
          reason: command.reason || null
        }]
      };
    }
  }

  if (!contentChangeIntent(message) && (candidateVariantIntent(workspace, message) || candidateGenerationIntent(message))) {
    const command = commandById(workspace, "generate_image_candidate");
    if (command?.enabled && command.requiresConfirmation === true) {
      const feedback = String(message || "").trim();
      const referenceImages = contentChangeIntent(message) ? [] : referenceImagesForVariant(workspace, message);
      return {
        source: "candidate_generation_confirmation",
        message: referenceImages.length
          ? "Der Wunsch ist klar. Ich kann dafür eine weitere Bildvariante erzeugen und die markierte bzw. vorhandene Bildreferenz als Vorlage mitgeben. Die Bildgenerierung bestätigst du bitte bewusst."
          : "Der Wunsch ist klar. Ich kann dafür eine weitere Bildvariante erzeugen. Die Bildgenerierung bestätigst du bitte bewusst.",
        suggestedActions: [{
          command: command.id,
          label: hasCandidateContext(workspace) ? "Weitere Variante erzeugen" : command.label,
          payload: {
            ...(command.defaultPayload || {}),
            message: feedback,
            variantInstruction: feedback,
            ...(referenceImages.length ? { referenceImages } : {})
          },
          requiresConfirmation: true,
          confirmationKind: command.confirmationKind || null,
          reason: command.reason || null
        }]
      };
    }
  }
  return null;
}

function latestSuggestedCommand(workspace, assistant) {
  for (const action of assistant?.suggestedActions || []) {
    const commandId = action.command || action.id;
    const command = commandById(workspace, commandId);
    if (isExecutableChatCommand(command)) {
      return {
        command,
        payload: action.payload || command.defaultPayload || {}
      };
    }
  }
  return null;
}

function preferredVisibleCommand(workspace, message) {
  const visible = visibleWorkflowCommands(workspace)
    .map((command) => commandById(workspace, command.id))
    .filter(isExecutableChatCommand);
  if (!visible.length) {
    return null;
  }

  const text = normalizeText(message);
  const prefer = (ids) => visible.find((command) => ids.includes(command.id)) || null;

  if (adoptionIntent(message)) {
    return prefer([
      "adopt_lessonbrief_proposal",
      "adopt_content_mirror_proposal",
      "approve_current_content"
    ]) || visible[0];
  }
  if (/\b(aufgabe|aufgaben|text|lesetext|inhalt|material)\b/.test(text)) {
    return prefer(["generate_content_mirror_proposal", "adopt_content_mirror_proposal", "approve_current_content"]) || visible[0];
  }
  if (/\b(pdf|export)\b/.test(text)) {
    return prefer(["generate_image_candidate"]) || visible[0];
  }
  if (/\b(kandidat|auswahl)\b/.test(text)) {
    return prefer(["generate_image_candidate"]) || visible[0];
  }
  return visible[0];
}

function assistantOfferedNextStep(assistant = {}) {
  const safeAssistant = assistant || {};
  const text = normalizeText(safeAssistant.content || "");
  return /\b(ich kann|kann ich|ich koennte|ich könnte|koennte ich|könnte ich|ich wuerde|ich würde|soll ich|wenn du willst|wenn du magst|naechster sinnvoller schritt|naechster schritt|als naechstes)\b/.test(text)
    && /\b(vorschlag|konzept|uebernehmen|ubernehmen|freigabe|freigeben|aufgaben|kandidat|auswahl|pdf|export|weiter)\b/.test(text);
}

function resolveChatCommand(workspace = {}, message = "") {
  const revision = resolveConceptRevisionCommand(workspace, message);
  if (revision) {
    return revision;
  }

  if (!contentChangeIntent(message) && (candidateVariantIntent(workspace, message) || candidateGenerationIntent(message))) {
    return null;
  }
  if (openContentProposalCommand(workspace) && openProposalCandidateOrContinuationIntent(message)) {
    return null;
  }

  const skipReference = skipReferenceIntent(message);
  if (!wantsAction(message) && !skipReference) {
    return null;
  }

  if (skipReference) {
    const fallbackCommand = ["generate_image_candidate", "adopt_image_spec"]
      .map((id) => commandById(workspace, id))
      .find(isExecutableChatCommand);
    if (fallbackCommand) {
      return {
        command: fallbackCommand.id,
        payload: fallbackCommand.defaultPayload || {},
        source: "skip_reference_intent",
        autopilot: shouldUseAutopilot(workspace, message, fallbackCommand.id)
      };
    }
  }

  const assistant = latestAssistantMessage(workspace.chat?.messages || []);
  const suggested = latestSuggestedCommand(workspace, assistant);
  if (suggested) {
    return {
      command: suggested.command.id,
      payload: suggested.payload,
      source: "assistant_suggested_action",
      autopilot: shouldUseAutopilot(workspace, message, suggested.command.id)
    };
  }

  if (!assistantOfferedNextStep(assistant) && !proposalIntent(message) && !adoptionIntent(message)) {
    return null;
  }

  const command = preferredVisibleCommand(workspace, message);
  if (!command) {
    return null;
  }
  return {
    command: command.id,
    payload: command.defaultPayload || {},
    source: "visible_next_action",
    autopilot: shouldUseAutopilot(workspace, message, command.id)
  };
}

module.exports = {
  autopilotIntent,
  resolveChatActionOffer,
  resolveChatCommand
};
