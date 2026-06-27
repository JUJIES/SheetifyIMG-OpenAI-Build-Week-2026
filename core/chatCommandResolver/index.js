"use strict";

const { EXECUTION_POLICIES, INTENTS } = require("../chatIntentInterpreter");
const {
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
  explicitWorksheetDepositIntent,
  hasCandidateContext,
  normalizeText,
  proposalIntent,
  questionIntent,
  revisionTerms,
  skipReferenceIntent,
  visualCandidateFeedbackIntent,
  worksheetTextCorrectionIntent
} = require("../chatIntentSignals");
const { visibleWorkflowCommands } = require("../workflowPolicy");

const AUTO_COMMANDS = new Set([
  "generate_lessonbrief_proposal",
  "adopt_lessonbrief_proposal",
  "generate_content_mirror_proposal",
  "activate_content_mirror_version",
  "adopt_content_mirror_proposal",
  "approve_current_content",
  "deposit_worksheet"
]);

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

function candidateCreatedAtValue(candidate = {}) {
  return candidate.createdAt
    || candidate.generation?.createdAt
    || candidate.pages?.[0]?.metadata?.createdAt
    || "";
}

function sortedCandidateTargets(workspace = {}) {
  const candidates = Array.isArray(workspace.artifacts?.candidates)
    ? workspace.artifacts.candidates
    : workspace.preview?.candidates || [];
  return candidates
    .filter((candidate) => (candidate.pages || []).length > 0)
    .map((candidate, index) => ({ candidate, index }))
    .sort((left, right) => {
      return String(candidateCreatedAtValue(left.candidate)).localeCompare(String(candidateCreatedAtValue(right.candidate)))
        || String(left.candidate.runId || "").localeCompare(String(right.candidate.runId || ""))
        || String(left.candidate.id || "").localeCompare(String(right.candidate.id || ""))
        || left.index - right.index;
    })
    .map((entry, index) => ({
      ...entry.candidate,
      displayNumber: index + 1
    }));
}

function candidateNumberTarget(message) {
  const text = normalizeText(message);
  const match = text.match(/\b(?:entwurf|kandidat|candidate|bundle|variante)\s*0*(\d+)\b/);
  return match ? Number(match[1]) || null : null;
}

function parsePageNumbers(value) {
  return [...new Set(String(value || "")
    .match(/\d+/g)
    ?.map((number) => Number(number))
    .filter((number) => Number.isFinite(number) && number > 0) || [])];
}

function requestedPageNumbers(message) {
  const text = normalizeText(message);
  const include = [];
  const exclude = [];
  const pagePattern = /\bseiten?\s*([0-9 ,/undbis-]+)/g;
  let match;
  while ((match = pagePattern.exec(text))) {
    const numbers = parsePageNumbers(match[1]);
    const tail = text.slice(match.index, match.index + match[0].length + 18);
    if (/\b(nicht|raus|weg|weglassen|ohne)\b/.test(tail)) {
      exclude.push(...numbers);
    } else {
      include.push(...numbers);
    }
  }
  const excluded = new Set(exclude);
  return [...new Set(include)].filter((page) => !excluded.has(page));
}

function worksheetDepositPayload(workspace = {}, message = "") {
  const command = commandById(workspace, "deposit_worksheet");
  const ordered = sortedCandidateTargets(workspace);
  const targetNumber = candidateNumberTarget(message);
  const targetCandidate = targetNumber
    ? ordered.find((candidate) => candidate.displayNumber === targetNumber) || null
    : null;
  const defaultPayload = command?.defaultPayload || {};
  const candidateId = targetCandidate?.id || defaultPayload.candidateId || workspace.latestRun?.latestCurrentCandidateId || null;
  const runId = targetCandidate?.runId || defaultPayload.runId || workspace.latestRun?.runId || null;
  const pageNumbers = requestedPageNumbers(message);
  const outputMode = /\b(einzelblaetter|einzelblatter|einzelblatt|einzeln|einzel-pdf|separat)\b/.test(normalizeText(message))
    ? "single_pdfs"
    : "bundle_pdf";
  return {
    ...(runId ? { runId } : {}),
    ...(candidateId ? { candidateId } : {}),
    ...(pageNumbers.length ? { pages: pageNumbers.map((page) => ({ candidateId, page })) } : {}),
    outputMode
  };
}

function resolveWorksheetDepositCommand(workspace = {}, message = "", source = "worksheet_deposit_intent") {
  if (!explicitWorksheetDepositIntent(message)) {
    return null;
  }
  const command = commandById(workspace, "deposit_worksheet");
  if (!isExecutableChatCommand(command)) {
    return null;
  }
  return {
    command: command.id,
    payload: worksheetDepositPayload(workspace, message),
    source,
    autopilot: false
  };
}

function candidateVariantIntent(workspace = {}, message = "") {
  return hasCandidateContext(workspace)
    && !contentChangeIntent(message)
    && (candidateGenerationIntent(message) || visualCandidateFeedbackIntent(message));
}

function visualOnlyTextLockPayload() {
  return {
    changeScope: "visual_only",
    contentChangePolicy: "preserve_approved_text"
  };
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

function inferAttachmentReferenceRole(message, attachment = {}) {
  const sourceRole = normalizeText(attachment.source?.role || attachment.role || "");
  if (["layout_reference", "style_reference", "content_reference"].includes(sourceRole)) {
    return sourceRole;
  }
  const label = normalizeText(attachment.label || "");
  if (/\b(nicht als layout|kein layout|not as layout|not as a layout|nur motiv|motif context|themenkontext|topic context|nur thema|nur inhalt|content context)\b/.test(label)
    || (sourceRole === "worksheet" && /\b(existing candidate|old candidate|alter entwurf|alter kandidat|entwurf|kandidat|candidate_\d+)\b/.test(label))) {
    return "content_reference";
  }
  return inferReferenceRole(`${message} ${attachment.label || ""}`);
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

function conceptVersionApproveIntent(message) {
  const text = normalizeText(message);
  return /\b(freigeb|frei|approve|genehmig)\w*\b/.test(text);
}

function conceptByVersion(workspace = {}, version = null) {
  if (!version) {
    return null;
  }
  const concepts = Array.isArray(workspace.artifacts?.concepts) ? workspace.artifacts.concepts : [];
  return concepts.find((concept) => Number(concept.version || 0) === Number(version)) || null;
}

function currentContentMirrorId(workspace = {}) {
  return workspace.artifacts?.currentContent?.id
    || workspace.documents?.content?.artifactId
    || workspace.documents?.content?.id
    || null;
}

function conceptIsCurrent(workspace = {}, concept = null) {
  if (!concept) {
    return false;
  }
  const currentId = currentContentMirrorId(workspace);
  return concept.current === true
    || Boolean(currentId && concept.id === currentId);
}

function resolveConceptVersionActivationCommand(workspace = {}, message = "") {
  if (!conceptVersionActionIntent(message)) {
    return null;
  }
  const version = conceptVersionTarget(message);
  const concept = conceptByVersion(workspace, version);
  const command = commandById(workspace, "activate_content_mirror_version");
  if (!concept || !isExecutableChatCommand(command)) {
    return null;
  }
  if (conceptIsCurrent(workspace, concept)) {
    return null;
  }
  const wantsCandidate = explicitCandidateGenerationIntent(message);
  return {
    command: command.id,
    payload: {
      contentMirrorId: concept.id,
      conceptVersion: concept.version || version,
      approve: conceptVersionApproveIntent(message) && concept.status !== "approved"
    },
    source: "concept_version_activation",
    followUpCommand: wantsCandidate ? "generate_image_candidate" : null,
    autoOpenConfirmation: wantsCandidate,
    autopilot: false
  };
}

function resolveContentProposalCandidateChainCommand(workspace = {}, message = "") {
  if (contentChangeIntent(message) || questionIntent(message)) {
    return null;
  }
  if (!explicitCandidateGenerationIntent(message)) {
    return null;
  }
  if (!(adoptionIntent(message) || /\b(daraus|damit|mit diesem konzept|mit dem konzept|auf dieser basis|auf grundlage|auf dieser grundlage)\b/.test(normalizeText(message)))) {
    return null;
  }
  const command = openContentProposalCommand(workspace);
  if (!command || !isExecutableChatCommand(command)) {
    return null;
  }
  return {
    command: command.id,
    payload: command.defaultPayload || {},
    source: "content_proposal_candidate_chain",
    followUpCommand: "generate_image_candidate",
    autoOpenConfirmation: true,
    autopilot: false
  };
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
  const candidateSignal = /\b(entwurf|entwurfe|bildentwurf|kandidat|kandidaten|bildgenerier|bildgenerierung|bild-kandidat|bildkandidat|naechsten entwurf|nachsten entwurf|naechster entwurf|nachster entwurf|naechsten kandidat|nächsten kandidat|naechster kandidat|nächster kandidat|variante|erzeuge|erzeugen|erstelle|erstellen|generier|generiere|render)\b/.test(text);
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
      role: inferAttachmentReferenceRole(message, attachment),
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
  return /\b(dieser|dieses|diese|diesen|dem|hier|screenshot|ausschnitt|markierung|crop|referenz|vorlage|wie candidate_\d+|candidate_\d+|aktueller entwurf|aktuellen entwurf|dieser entwurf|diesen entwurf|aktueller kandidat|aktuellen kandidat|dieser kandidat|diesen kandidat|behalten|genau so|gleiches layout|gleichen stil|gleicher stil)\b/.test(text);
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
        purpose: `Bestehenden Entwurf ${candidate.id || ""}${pageNumber ? ` Seite ${pageNumber}` : ""} als visuelle Referenz nutzen: ${String(message || "").trim()}`,
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
      purpose: reference.purpose || `Persistente visuelle Referenz aus ${candidate.id || "dem letzten Entwurf"}`,
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
    || /\b(entwurf\w*|variante\w*|kandidat\w*|bildentwurf\w*|bildkandidat\w*|bildgenerier\w*|bildgenerierung|render\w*|direkt weiter|weiter machen|weitermachen|naechster schritt|nächster schritt)\b/.test(text);
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

function intentMessage(intent = {}, fallback = "") {
  return String(intent.sourceMessage || fallback || "").trim();
}

function usableWorkflowIntent(intent = {}) {
  return Boolean(intent)
    && intent.confidence !== "low"
    && ![INTENTS.NONE, INTENTS.QUESTION, INTENTS.BRAINSTORM].includes(intent.intent);
}

function intentAllowsAutoCommand(intent = {}) {
  return [
    EXECUTION_POLICIES.AUTO_EXECUTE,
    EXECUTION_POLICIES.AUTO_EXECUTE_THEN_CONFIRMATION
  ].includes(intent.executionPolicy);
}

function intentAllowsActionOffer(intent = {}) {
  return [
    EXECUTION_POLICIES.OFFER_ACTION,
    EXECUTION_POLICIES.AUTO_OPEN_CONFIRMATION,
    EXECUTION_POLICIES.AUTO_EXECUTE_THEN_CONFIRMATION
  ].includes(intent.executionPolicy);
}

function resolveConceptVersionActivationIntentCommand(workspace = {}, intent = {}) {
  const version = Number(intent.target?.conceptVersion || 0) || null;
  if (!version) {
    return null;
  }
  const concept = conceptByVersion(workspace, version);
  const command = commandById(workspace, "activate_content_mirror_version");
  if (!concept || !isExecutableChatCommand(command)) {
    return null;
  }
  if (conceptIsCurrent(workspace, concept)) {
    return null;
  }
  const wantsCandidate = intent.wantsCandidate === true;
  return {
    command: command.id,
    payload: {
      contentMirrorId: concept.id,
      conceptVersion: concept.version || version,
      approve: intent.wantsAdoption === true && concept.status !== "approved"
    },
    source: "chat_intent_concept_version_activation",
    followUpCommand: wantsCandidate ? "generate_image_candidate" : null,
    autoOpenConfirmation: wantsCandidate && intent.executionPolicy === EXECUTION_POLICIES.AUTO_EXECUTE_THEN_CONFIRMATION,
    autopilot: false
  };
}

function resolveContentProposalAdoptionIntentCommand(workspace = {}, intent = {}) {
  const command = openContentProposalCommand(workspace);
  if (!command || !isExecutableChatCommand(command)) {
    return null;
  }
  const wantsCandidate = intent.intent === INTENTS.CONTENT_PROPOSAL_ADOPTION_CANDIDATE_CHAIN
    || intent.wantsCandidate === true;
  return {
    command: command.id,
    payload: command.defaultPayload || {},
    source: wantsCandidate
      ? "chat_intent_content_proposal_candidate_chain"
      : "chat_intent_content_proposal_adoption",
    followUpCommand: wantsCandidate ? "generate_image_candidate" : null,
    autoOpenConfirmation: wantsCandidate && intent.executionPolicy === EXECUTION_POLICIES.AUTO_EXECUTE_THEN_CONFIRMATION,
    autopilot: false
  };
}

function resolveChatCommandFromIntent(workspace = {}, intent = {}, message = "") {
  const sourceMessage = intentMessage(intent, message);
  const deposit = resolveWorksheetDepositCommand(workspace, sourceMessage, "chat_intent_worksheet_deposit");
  if (deposit) {
    return deposit;
  }
  if (!usableWorkflowIntent(intent)) {
    return null;
  }
  if (!intentAllowsAutoCommand(intent)) {
    return null;
  }

  if (intent.wantsContentChange === true || intent.intent === INTENTS.CONCEPT_REVISION) {
    const revision = resolveConceptRevisionCommand(workspace, sourceMessage);
    if (revision) {
      return {
        ...revision,
        source: "chat_intent_concept_revision"
      };
    }
    return null;
  }

  if (intent.intent === INTENTS.CONCEPT_VERSION_ACTIVATION || intent.target?.conceptVersion) {
    const activation = resolveConceptVersionActivationIntentCommand(workspace, intent);
    if (activation) {
      return activation;
    }
  }

  if (
    intent.intent === INTENTS.CONTENT_PROPOSAL_ADOPTION
    || intent.intent === INTENTS.CONTENT_PROPOSAL_ADOPTION_CANDIDATE_CHAIN
  ) {
    return resolveContentProposalAdoptionIntentCommand(workspace, intent);
  }

  return null;
}

function worksheetDepositOfferFromIntent(workspace = {}, intent = {}, message = "") {
  const command = commandById(workspace, "deposit_worksheet");
  if (!command?.enabled) {
    return null;
  }
  const payload = worksheetDepositPayload(workspace, intentMessage(intent, message));
  return {
    source: "chat_intent_pdf_export_replaced_by_worksheet_deposit",
    message: "PDF läuft jetzt über die Arbeitsblätter. Ich kann den aktuellen Entwurf als festen Arbeitsblatt-Snapshot ablegen; danach findest du ihn dort zum Prüfen und Herunterladen.",
    suggestedActions: [{
      command: command.id,
      label: command.label || "Arbeitsblatt ablegen",
      payload,
      requiresConfirmation: command.requiresConfirmation === true,
      confirmationKind: command.confirmationKind || null,
      reason: command.reason || null
    }]
  };
}

function candidateOfferFromIntent(workspace = {}, intent = {}, message = "") {
  const sourceMessage = intentMessage(intent, message);
  const command = commandById(workspace, "generate_image_candidate");
  if (!command?.enabled || command.requiresConfirmation !== true) {
    return null;
  }
  const feedback = sourceMessage;
  const referenceImages = referenceImagesForVariant(workspace, sourceMessage);
  const hasExistingCandidate = hasCandidateContext(workspace);
  return {
    source: "chat_intent_candidate_generation_confirmation",
    message: referenceImages.length
      ? hasExistingCandidate
        ? "Der Wunsch ist klar. Ich kann dafür eine weitere Bildvariante erzeugen und die markierte bzw. vorhandene Bildreferenz als Vorlage mitgeben. Die Bildgenerierung bestätigst du bitte bewusst."
        : "Der Wunsch ist klar. Ich kann dafür einen Entwurf erstellen und die markierte bzw. vorhandene Bildreferenz als Vorlage mitgeben. Die Bildgenerierung bestätigst du bitte bewusst."
      : hasExistingCandidate
        ? "Der Wunsch ist klar. Ich kann dafür eine weitere Bildvariante erzeugen. Die Bildgenerierung bestätigst du bitte bewusst."
        : "Der Wunsch ist klar. Ich kann dafür einen Entwurf erstellen. Die Bildgenerierung bestätigst du bitte bewusst.",
    suggestedActions: [{
      command: command.id,
      label: hasExistingCandidate ? "Weitere Variante erstellen" : command.label,
      payload: {
        ...(command.defaultPayload || {}),
        ...visualOnlyTextLockPayload(),
        message: feedback,
        variantInstruction: feedback,
        ...(referenceImages.length ? { referenceImages } : {})
      },
      requiresConfirmation: true,
      confirmationKind: command.confirmationKind || null,
      reason: command.reason || null,
      autoOpenConfirmation: [
        EXECUTION_POLICIES.AUTO_OPEN_CONFIRMATION,
        EXECUTION_POLICIES.AUTO_EXECUTE_THEN_CONFIRMATION
      ].includes(intent.executionPolicy)
    }]
  };
}

function skipReferenceOfferFromIntent(workspace = {}, intent = {}, message = "") {
  const command = commandById(workspace, "generate_image_candidate");
  if (!command?.enabled) {
    return null;
  }
  return {
    source: "chat_intent_skip_reference_candidate_offer",
    message: "Die Referenz ist optional. Ich kann ohne Referenz direkt einen Entwurf erstellen; die Bildgenerierung bestätigst du bitte bewusst.",
    suggestedActions: [{
      command: command.id,
      label: command.label || "Entwurf erstellen",
      payload: command.defaultPayload || {},
      requiresConfirmation: command.requiresConfirmation === true,
      confirmationKind: command.confirmationKind || null,
      reason: command.reason || null,
      autoOpenConfirmation: intent.executionPolicy === EXECUTION_POLICIES.AUTO_OPEN_CONFIRMATION
    }]
  };
}

function conceptVersionActivationOfferFromIntent(workspace = {}, intent = {}) {
  const version = Number(intent.target?.conceptVersion || 0) || null;
  const concept = conceptByVersion(workspace, version);
  const command = commandById(workspace, "activate_content_mirror_version");
  if (!concept || !command?.enabled) {
    return null;
  }
  if (conceptIsCurrent(workspace, concept)) {
    return null;
  }
  return {
    source: "chat_intent_concept_version_activation_offer",
    message: `Ich kann Konzept v${concept.version || version} als aktuelle Basis setzen. Danach kann der Entwurfs-Schritt separat bestätigt werden.`,
    suggestedActions: [{
      command: command.id,
      label: `Konzept v${concept.version || version} als Basis setzen`,
      payload: {
        contentMirrorId: concept.id,
        conceptVersion: concept.version || version,
        approve: intent.wantsAdoption === true && concept.status !== "approved"
      },
      requiresConfirmation: command.requiresConfirmation === true,
      confirmationKind: command.confirmationKind || null,
      reason: command.reason || null
    }]
  };
}

function contentProposalAdoptionOfferFromIntent(workspace = {}, intent = {}) {
  const command = openContentProposalCommand(workspace);
  if (!command) {
    return null;
  }
  const wantsCandidate = intent.chainRequested === true || intent.wantsCandidate === true;
  return {
    source: "chat_intent_content_proposal_adoption_offer",
    message: wantsCandidate
      ? "Ich kann zuerst das offene Arbeitsblatt-Konzept übernehmen; danach wird der Entwurfs-Schritt auf genau dieser Basis angeboten."
      : "Ich kann das offene Arbeitsblatt-Konzept übernehmen und als aktuelle Basis setzen.",
    suggestedActions: [{
      command: command.id,
      label: command.label || "Konzept übernehmen",
      payload: command.defaultPayload || {},
      requiresConfirmation: command.requiresConfirmation === true,
      confirmationKind: command.confirmationKind || null,
      reason: command.reason || null
    }]
  };
}

function contentProposalBeforeCandidateOfferFromIntent(workspace = {}) {
  const contentProposalCommand = openContentProposalCommand(workspace);
  if (!contentProposalCommand) {
    return null;
  }
  const label = contentProposalCommand.label || "Konzept aktualisieren";
  return {
    source: "chat_intent_content_proposal_before_candidate",
    message: "Es liegt noch eine offene Konzeptänderung vor. Ich sollte zuerst dieses Konzept aktualisieren; danach wird der nächste Entwurf auf genau dieser neuen Grundlage erzeugt.",
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

function resolveChatActionOfferFromIntent(workspace = {}, intent = {}, message = "") {
  if (!usableWorkflowIntent(intent)) {
    return null;
  }
  if (!intentAllowsActionOffer(intent)) {
    return null;
  }
  if (intent.wantsContentChange === true || intent.intent === INTENTS.CONCEPT_REVISION) {
    return null;
  }
  if (intent.intent === INTENTS.CONCEPT_VERSION_ACTIVATION || intent.target?.conceptVersion) {
    const activationOffer = conceptVersionActivationOfferFromIntent(workspace, intent);
    if (activationOffer) {
      return activationOffer;
    }
    if (intent.wantsCandidate !== true) {
      return null;
    }
  }
  if (
    intent.intent === INTENTS.CONTENT_PROPOSAL_ADOPTION
    || intent.intent === INTENTS.CONTENT_PROPOSAL_ADOPTION_CANDIDATE_CHAIN
  ) {
    return contentProposalAdoptionOfferFromIntent(workspace, intent);
  }
  if (intent.intent === INTENTS.PDF_EXPORT || intent.intent === INTENTS.SELECTION) {
    return worksheetDepositOfferFromIntent(workspace, intent, message);
  }
  if (intent.intent === INTENTS.SKIP_REFERENCE) {
    return skipReferenceOfferFromIntent(workspace, intent, message);
  }
  if (intent.intent === INTENTS.CANDIDATE_GENERATION || intent.wantsCandidate === true) {
    const pendingProposalOffer = contentProposalBeforeCandidateOfferFromIntent(workspace);
    return pendingProposalOffer || candidateOfferFromIntent(workspace, intent, message);
  }
  return null;
}

function resolveChatActionOffer(workspace = {}, message = "") {
  if (visualReferenceForCandidateIntent(workspace, message)) {
    const command = commandById(workspace, "generate_image_candidate");
    const feedback = String(message || "").trim();
    const referenceImages = referenceImagesForVariant(workspace, message);
    return {
      source: "visual_reference_candidate_confirmation",
      message: referenceImages.length
        ? "Ich nutze das angehängte Bild als Layout- bzw. Stilreferenz für den nächsten Entwurf. Inhaltlich bleibt das freigegebene Arbeitsblatt-Konzept maßgeblich; die Bildgenerierung bestätigst du bitte bewusst."
        : "Ich kann daraus jetzt den nächsten Entwurf erstellen; die Bildgenerierung bestätigst du bitte bewusst.",
      suggestedActions: [{
        command: command.id,
        label: hasCandidateContext(workspace) ? "Weitere Variante erstellen" : command.label,
        payload: {
          ...(command.defaultPayload || {}),
          message: feedback,
          variantInstruction: feedback,
          ...(referenceImages.length ? { referenceImages } : {})
        },
        requiresConfirmation: command.requiresConfirmation === true,
        confirmationKind: command.confirmationKind || null,
        reason: command.reason || null,
        autoOpenConfirmation: explicitCandidateGenerationIntent(message)
      }]
    };
  }

  if (conceptRevisionQuestionIntent(message)) {
    const command = commandById(workspace, "generate_content_mirror_proposal");
    if (command?.enabled && command.requiresConfirmation === true) {
      return {
        source: "concept_revision_question",
        message: "Ja, das ist eine Konzeptänderung. Ich sollte zuerst das Arbeitsblatt-Konzept überarbeiten; erst danach sollte ein neuer Entwurf erzeugt oder exportiert werden.",
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
      message: "Es liegt noch eine offene Konzeptänderung vor. Ich sollte zuerst dieses Konzept aktualisieren; danach wird der nächste Entwurf auf genau dieser neuen Grundlage erzeugt.",
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
        message: "Die Referenz ist optional. Ich kann ohne Referenz direkt einen Entwurf erstellen; die Bildgenerierung bestätigst du bitte bewusst.",
        suggestedActions: [{
          command: command.id,
          label: command.label || "Entwurf erstellen",
          payload: command.defaultPayload || {},
          requiresConfirmation: command.requiresConfirmation === true,
          confirmationKind: command.confirmationKind || null,
          reason: command.reason || null,
          autoOpenConfirmation: explicitCandidateGenerationIntent(message) || skipReferenceIntent(message)
        }]
      };
    }
  }

  if (!contentChangeIntent(message) && (candidateVariantIntent(workspace, message) || candidateGenerationIntent(message))) {
    const command = commandById(workspace, "generate_image_candidate");
    if (command?.enabled && command.requiresConfirmation === true) {
      const feedback = String(message || "").trim();
      const referenceImages = contentChangeIntent(message) ? [] : referenceImagesForVariant(workspace, message);
      const hasExistingCandidate = hasCandidateContext(workspace);
      return {
        source: "candidate_generation_confirmation",
        message: referenceImages.length
          ? hasExistingCandidate
            ? "Der Wunsch ist klar. Ich kann dafür eine weitere Bildvariante erzeugen und die markierte bzw. vorhandene Bildreferenz als Vorlage mitgeben. Die Bildgenerierung bestätigst du bitte bewusst."
            : "Der Wunsch ist klar. Ich kann dafür einen Entwurf erstellen und die markierte bzw. vorhandene Bildreferenz als Vorlage mitgeben. Die Bildgenerierung bestätigst du bitte bewusst."
          : hasExistingCandidate
            ? "Der Wunsch ist klar. Ich kann dafür eine weitere Bildvariante erzeugen. Die Bildgenerierung bestätigst du bitte bewusst."
            : "Der Wunsch ist klar. Ich kann dafür einen Entwurf erstellen. Die Bildgenerierung bestätigst du bitte bewusst.",
        suggestedActions: [{
          command: command.id,
          label: hasExistingCandidate ? "Weitere Variante erstellen" : command.label,
          payload: {
            ...(command.defaultPayload || {}),
            ...visualOnlyTextLockPayload(),
            message: feedback,
            variantInstruction: feedback,
            ...(referenceImages.length ? { referenceImages } : {})
          },
          requiresConfirmation: true,
          confirmationKind: command.confirmationKind || null,
          reason: command.reason || null,
          autoOpenConfirmation: explicitCandidateGenerationIntent(message)
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
    return prefer(["deposit_worksheet", "generate_image_candidate"]) || visible[0];
  }
  if (/\b(arbeitsblatt|arbeitsblaetter|arbeitsblatter|ableg|ablegen|ablage)\b/.test(text)) {
    return prefer(["deposit_worksheet"]) || visible[0];
  }
  if (/\b(entwurf|entwurfe|kandidat|auswahl)\b/.test(text)) {
    return prefer(["deposit_worksheet", "generate_image_candidate"]) || visible[0];
  }
  return visible[0];
}

function assistantOfferedNextStep(assistant = {}) {
  const safeAssistant = assistant || {};
  const text = normalizeText(safeAssistant.content || "");
  return /\b(ich kann|kann ich|ich koennte|ich könnte|koennte ich|könnte ich|ich wuerde|ich würde|soll ich|wenn du willst|wenn du magst|naechster sinnvoller schritt|naechster schritt|als naechstes)\b/.test(text)
    && /\b(vorschlag|konzept|uebernehmen|ubernehmen|freigabe|freigeben|aufgaben|entwurf|entwurfe|kandidat|arbeitsblatt|ablegen|ablage|auswahl|pdf|export|weiter)\b/.test(text);
}

function resolveChatCommand(workspace = {}, message = "") {
  const deposit = resolveWorksheetDepositCommand(workspace, message);
  if (deposit) {
    return deposit;
  }

  const conceptVersionActivation = resolveConceptVersionActivationCommand(workspace, message);
  if (conceptVersionActivation) {
    return conceptVersionActivation;
  }

  const contentProposalCandidateChain = resolveContentProposalCandidateChainCommand(workspace, message);
  if (contentProposalCandidateChain) {
    return contentProposalCandidateChain;
  }

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
  brainstormingIntent,
  resolveChatActionOfferFromIntent,
  resolveChatActionOffer,
  resolveChatCommandFromIntent,
  resolveChatCommand
};
