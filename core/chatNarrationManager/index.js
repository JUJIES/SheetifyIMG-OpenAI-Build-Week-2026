"use strict";

const NARRATION_ACTION_BLOCKLIST = new Set([
  "select_candidate",
  "prepare_export"
]);

const { getAiRuntimeStatus, getOpenAiRequestConfig } = require("../aiConfig");
const { createResponse, extractOutputText } = require("../openaiClient");
const { logModelRun } = require("../modelRunLogger");
const { estimateOpenAiTextCost } = require("../imageCostManager");
const { measureModelRequest } = require("../modelRequestMetrics");
const { ROUTE_PURPOSES, routeForPurpose } = require("../modelRouter");
const { personaInstructions, responsePlanForMoment } = require("../chatPersonaManager");
const { presentWorkflowEvent } = require("../chatEventPresenter");

const DEFAULT_TIMEOUT_MS = 12000;
const MAX_MESSAGE_LENGTH = 900;
const INTERNAL_TERMS = /\b(lesson brief|content mirror|imagespec|tool call|model run)\b/i;
const OLD_WORKFLOW_TERMS = [
  {
    reason: "legacy_selection_language",
    pattern: /\b(?:als\s+)?Auswahl\s+(?:übernehmen|uebernehmen)|\bals\s+Auswahl\b|\b(?:ist|wird|war)\s+die\s+Auswahl\b|\b(?:ihn|sie|es|diesen|den)\s+auswählen\b|\bausgewählt\b|\bausgewaehlt\b/i
  },
  {
    reason: "legacy_export_language",
    pattern: /\b(?:exportieren|exportiert|Export|prepare_export)\b/i
  },
  {
    reason: "candidate_pdf_action",
    pattern: /\bPDF\b.{0,60}\b(?:herunterlad|download|erstell|mach|generier|nutz|ausgeb)|\b(?:herunterlad|download|erstell|mach|generier|nutz|ausgeb).{0,60}\bPDF\b/i
  }
];
const OFFER_ONLY_MOMENTS = new Set([
  "local_action_offer",
  "suggested_action"
]);
const EXECUTED_MOMENTS = new Set([
  "candidate_created",
  "input_received",
  "proposal_adopted",
  "proposal_ready",
  "workflow_followup"
]);
const RESULT_LANGUAGE_WITHOUT_COMMAND = [
  /\b(?:wurde|wird|ist|sei)\s+(?:erstellt|erzeugt|generiert|überarbeitet|ueberarbeitet|ausformuliert|abgelegt|gespeichert|vorbereitet|angelegt|gemacht)\b/i,
  /\b(?:Arbeitsblatt-Konzept|Konzeptfassung|Konzept|Entwurf|Arbeitsblatt|Referenz|Bildreferenz)\b.{0,90}\b(?:fertig|abgelegt|gespeichert|erstellt|erzeugt|generiert|überarbeitet|ueberarbeitet|ausformuliert|vorbereitet|angelegt|gemacht)\b/i,
  /\bich\s+habe\b.{0,100}\b(?:erstellt|erzeugt|generiert|überarbeitet|ueberarbeitet|ausformuliert|abgelegt|gespeichert|vorbereitet|angelegt|gemacht)\b/i,
  /\b(?:liegt|steht)\s+(?:vor|bereit)\b/i
];
const EXECUTED_VISIBILITY_LANGUAGE = /\b(?:Arbeitsblatt-Konzept|Konzept|Konzeptversion|Konzeptfassung|Entwurf|Entwürfe|Arbeitsblatt|Referenz|Bildreferenz|Input|Basis|Bestätigung|Bestaetigung|nächste|naechste|weitergearbeitet|genutzt|fertig|abgelegt|vorbereitet|ausformuliert|angelegt|erstellt|erzeugt|gespeichert)\b/i;

function nonEmpty(value) {
  return String(value || "").trim();
}

function disabledByEnv(env = process.env) {
  return /^(0|false|off|disabled)$/i.test(nonEmpty(env.SHEETIFYIMG_CHAT_NARRATION));
}

function looksLikeTestKey(apiKey) {
  const key = nonEmpty(apiKey).toLowerCase();
  return !key || key === "test" || key.includes("no-network") || key.includes("fake") || key.startsWith("sk-test");
}

function timeoutMs(env = process.env, fallback = DEFAULT_TIMEOUT_MS) {
  const parsed = Number(env.SHEETIFYIMG_CHAT_NARRATION_TIMEOUT_MS);
  if (Number.isFinite(parsed) && parsed > 0) {
    return Math.min(parsed, fallback);
  }
  return Math.min(DEFAULT_TIMEOUT_MS, fallback);
}

function canUseNarration(requestConfig, env = process.env) {
  const runtime = getAiRuntimeStatus(env);
  return runtime.status === "ready"
    && !disabledByEnv(env)
    && !looksLikeTestKey(requestConfig.apiKey);
}

function truncate(value, max = 500) {
  const text = nonEmpty(value);
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function compactMessages(messages = []) {
  return (Array.isArray(messages) ? messages : [])
    .slice(-8)
    .map((message) => ({
      role: message.role === "assistant" ? "assistant" : "user",
      content: truncate(message.content || message.message, 500)
    }))
    .filter((message) => message.content);
}

function compactTasks(tasks = []) {
  return (Array.isArray(tasks) ? tasks : [])
    .slice(0, 5)
    .map((task) => truncate(task.prompt || task.text || task.title, 220))
    .filter(Boolean);
}

function compactImageMaterials(materials = []) {
  return (Array.isArray(materials) ? materials : [])
    .slice(0, 4)
    .map((material) => truncate(material.prompt || material.description || material.purpose, 220))
    .filter(Boolean);
}

function compactContent(content = {}) {
  const data = content.data || content;
  if (!data || typeof data !== "object") {
    return null;
  }
  const readingTexts = Array.isArray(data.readingTexts) ? data.readingTexts : [];
  const tasks = Array.isArray(data.tasks) ? data.tasks : [];
  const imageMaterials = Array.isArray(data.imageMaterials) ? data.imageMaterials : [];
  return {
    title: truncate(data.title, 180),
    textCount: readingTexts.length,
    taskCount: tasks.length,
    imageMaterialCount: imageMaterials.length,
    textTitles: readingTexts
      .slice(0, 3)
      .map((entry) => truncate(entry.title, 140))
      .filter(Boolean),
    tasks: compactTasks(tasks),
    imageMaterials: compactImageMaterials(imageMaterials)
  };
}

function compactProposal(proposal = {}) {
  if (!proposal) {
    return null;
  }
  const referencePolicy = proposal.kind === "image_spec" && proposal.data?.referencePolicy
    ? {
        level: proposal.data.referencePolicy.level || null,
        label: truncate(proposal.data.referencePolicy.label, 100),
        reason: truncate(proposal.data.referencePolicy.reason, 260),
        suggestedAction: truncate(proposal.data.referencePolicy.suggestedAction, 180),
        isSatisfied: proposal.data.referencePolicy.isSatisfied === true
      }
    : null;
  return {
    kind: proposal.kind || null,
    title: truncate(proposal.title, 180),
    summary: truncate(proposal.summary, 260),
    content: proposal.kind === "content_mirror" ? compactContent(proposal.data) : null,
    topic: truncate(proposal.data?.topic || proposal.data?.title, 180),
    targetGroup: truncate(proposal.data?.targetGroup, 140),
    goal: truncate(proposal.data?.goal, 220),
    pageCount: Number(proposal.data?.pageCount || proposal.data?.pagePlan?.length || 0) || null,
    referencePolicy
  };
}

function compactWorkspace(workspace = {}) {
  const latestRun = workspace.latestRun || {};
  const candidateIds = (latestRun.candidates || [])
    .map((candidate) => candidate.id)
    .filter(Boolean)
    .slice(-4);
  return {
    project: workspace.project ? {
      title: truncate(workspace.project.title, 180),
      topic: truncate(workspace.project.topic, 160),
      targetGroup: truncate(workspace.project.targetGroup, 120)
    } : null,
    teachingContext: workspace.teachingContext ? {
      status: workspace.teachingContext.status || null,
      summary: workspace.teachingContext.summary || null,
      fields: workspace.teachingContext.fields || null,
      readiness: workspace.teachingContext.readiness || null
    } : null,
    content: compactContent(workspace.documents?.content),
    concepts: (workspace.artifacts?.concepts || [])
      .slice(-5)
      .map((concept) => ({
        id: concept.id || concept.artifactId || null,
        version: concept.version || null,
        status: concept.status || null,
        current: concept.current === true,
        title: truncate(concept.title, 120)
      })),
    currentConcept: workspace.artifacts?.currentContent ? {
      id: workspace.artifacts.currentContent.id || null,
      version: workspace.artifacts.currentContent.version || null,
      status: workspace.artifacts.currentContent.status || null
    } : null,
    latestRun: latestRun.runId ? {
      runId: latestRun.runId,
      candidateIds,
      selectedCandidateId: latestRun.selectedCandidateId || null
    } : null,
    availableActions: (workspace.commands || [])
      .filter((command) => command.enabled)
      .filter((command) => !NARRATION_ACTION_BLOCKLIST.has(command.id))
      .slice(0, 5)
      .map((command) => ({
        id: command.id,
        label: command.label,
        requiresConfirmation: command.requiresConfirmation === true
      })),
    recentMessages: compactMessages(workspace.chat?.messages || [])
  };
}

function compactMoment(moment = {}) {
  const proposalKind = moment.proposal?.kind || null;
  const stateFacts = [];
  if (proposalKind === "image_spec" && (moment.kind === "proposal_ready" || moment.kind === "proposal_adopted")) {
    stateFacts.push("Interne Bildplanung ist vorbereitet/gespeichert; es wurde dadurch noch kein Bild-Entwurf erzeugt.");
  }
  if (moment.kind === "candidate_created") {
    stateFacts.push("Der Bild-Entwurf ist bereits fertig erzeugt; keine Bestätigung mehr verlangen.");
  }
  if (moment.kind === "workflow_followup") {
    stateFacts.push("Die commandId beschreibt eine bereits ausgeführte Workflow-Aktion, nicht eine noch offene Entscheidung.");
    if (moment.commandId === "activate_content_mirror_version") {
      stateFacts.push("Die gewünschte Konzeptversion ist bereits als Arbeitsbasis gesetzt. Nicht fragen, ob sie noch übernommen oder freigegeben werden soll.");
    }
    if (moment.commandId === "adopt_content_mirror_proposal") {
      stateFacts.push("Das Arbeitsblatt-Konzept ist bereits als Arbeitsbasis gespeichert. Nicht fragen, ob es noch übernommen oder freigegeben werden soll.");
    }
    if (moment.action?.command === "generate_image_candidate") {
      stateFacts.push("Der Entwurfs-Schritt ist nur als nächste Aktion vorbereitet; die Bildgenerierung startet erst nach bewusster Bestätigung.");
    }
  }
  return {
    kind: moment.kind || "chat_followup",
    persona: responsePlanForMoment(moment),
    stateFacts,
    fallback: truncate(moment.fallback, MAX_MESSAGE_LENGTH),
    userMessage: truncate(moment.userMessage, 600),
    commandId: moment.commandId || null,
    action: moment.action ? {
      command: moment.action.command || null,
      label: moment.action.label || null,
      requiresConfirmation: moment.action.requiresConfirmation === true
    } : null,
    suggestedActions: (moment.suggestedActions || []).slice(0, 3).map((action) => ({
      command: action.command || null,
      label: action.label || null,
      requiresConfirmation: action.requiresConfirmation === true
    })),
    proposal: compactProposal(moment.proposal),
    candidate: moment.candidate ? {
      candidateId: moment.candidate.id || moment.candidate.candidateId || null,
      pageCount: Number(moment.candidate.pageCount || moment.candidate.pages?.length || 0) || null,
      variantInstruction: truncate(moment.candidate.generation?.variantInstruction || moment.candidate.variantInstruction, 300),
      generationMode: moment.candidate.generation?.generationMode || null,
      referenceImageCount: (moment.candidate.generation?.referenceImages || moment.candidate.referenceImages || []).length,
      qualityLabel: moment.candidate.generation?.qualityLabel || null
    } : null,
    export: moment.export || null,
    selection: moment.selection || null,
    requiresPaidConfirmation: moment.requiresPaidConfirmation === true,
    workspace: compactWorkspace(moment.workspace || {})
  };
}

function normalizeNarrationSurface(value) {
  const text = nonEmpty(value)
    .replace(/^["“”]+|["“”]+$/g, "")
    .replace(/\s+[–—]\s+/g, "; ")
    .replace(/\bKandidatenvorbereitung\b/g, "Bildplanung")
    .replace(/\bKandidatenerzeugung\b/g, "Entwurfserstellung")
    .replace(/\bKandidaten-Schritt\b/g, "Entwurfs-Schritt")
    .replace(/\bKandidatenschritt\b/g, "Entwurfsschritt")
    .replace(/\bKandidatenansicht\b/g, "Entwurfsansicht")
    .replace(/\beine Kandidatenreihe\b/g, "einen mehrseitigen Entwurf")
    .replace(/\bEine Kandidatenreihe\b/g, "Ein mehrseitiger Entwurf")
    .replace(/\bdie Kandidatenreihe\b/g, "der mehrseitige Entwurf")
    .replace(/\bDie Kandidatenreihe\b/g, "Der mehrseitige Entwurf")
    .replace(/\bKandidatenreihe\b/g, "mehrseitiger Entwurf")
    .replace(/\bdiesen Kandidaten\b/g, "diesen Entwurf")
    .replace(/\bden Kandidaten\b/g, "den Entwurf")
    .replace(/\beinen Kandidaten\b/g, "einen Entwurf")
    .replace(/\baktuellen Kandidaten\b/g, "aktuellen Entwurf")
    .replace(/\bnächsten Kandidaten\b/g, "nächsten Entwurf")
    .replace(/\bneuen Kandidaten\b/g, "neuen Entwurf")
    .replace(/\bdiesen Entwurf\b/g, "diesen Entwurf")
    .replace(/\bden Entwurf\b/g, "den Entwurf")
    .replace(/\bcandidate_0*(\d+)\b/gi, (_, value) => `Entwurf ${String(Number(value)).padStart(2, "0")}`)
    .replace(/\bKandidaten\b/g, "Entwürfe")
    .replace(/\bKandidat\b/g, "Entwurf")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return text.length > MAX_MESSAGE_LENGTH
    ? `${text.slice(0, MAX_MESSAGE_LENGTH - 1).trim()}…`
    : text;
}

function hasExecutedWorkflowMoment(moment = null) {
  if (!moment || typeof moment !== "object") {
    return false;
  }
  return Boolean(moment.commandId) || EXECUTED_MOMENTS.has(moment.kind);
}

function hasOnlyOfferedAction(moment = null) {
  if (!moment || typeof moment !== "object") {
    return false;
  }
  return OFFER_ONLY_MOMENTS.has(moment.kind) && !hasExecutedWorkflowMoment(moment);
}

function violatesActionConsistency(message, moment = null) {
  if (!moment) {
    return null;
  }
  const text = nonEmpty(message);
  if (!text) {
    return "empty";
  }
  if (hasOnlyOfferedAction(moment) && RESULT_LANGUAGE_WITHOUT_COMMAND.some((pattern) => pattern.test(text))) {
    return "offered_action_spoke_as_result";
  }
  if (hasExecutedWorkflowMoment(moment) && !EXECUTED_VISIBILITY_LANGUAGE.test(text)) {
    return "executed_action_missing_visible_state";
  }
  return null;
}

function validateNarrationPolicy(value, moment = null) {
  const text = nonEmpty(value);
  if (!text) {
    return { ok: false, reason: "empty" };
  }
  if (INTERNAL_TERMS.test(text) || /\bintern(?:e[rsn]?)?\b/i.test(text)) {
    return { ok: false, reason: "internal_term" };
  }
  for (const rule of OLD_WORKFLOW_TERMS) {
    if (rule.pattern.test(text)) {
      return { ok: false, reason: rule.reason };
    }
  }
  const actionConsistencyReason = violatesActionConsistency(text, moment);
  if (actionConsistencyReason) {
    return { ok: false, reason: actionConsistencyReason };
  }
  return { ok: true, reason: null };
}

function sanitizeNarration(value, moment = null) {
  const text = normalizeNarrationSurface(value);
  const validation = validateNarrationPolicy(text, moment);
  if (!validation.ok) {
    return null;
  }
  return text;
}

function narrationInstructions() {
  return [
    personaInstructions(),
    "Du formulierst genau eine sichtbare Chatantwort für SheetifyIMG.",
    "Die App entscheidet Workflow, Buttons, Freigaben und Kostenbestätigungen. Du formulierst nur den Begleittext.",
    "Schreibe auf Deutsch mit echten Umlauten.",
    "Sprich die Lehrkraft immer mit du an, nie mit Sie.",
    "Ton: aufmerksam, knapp, freundlich, bestimmt. Kein generisches Lob und kein neutraler Behördenstil.",
    "Halte dich an moment.persona: responseDepth bestimmt die Laenge, relationshipMove bestimmt die Art der Beziehungsebene.",
    "Bei responseDepth minimal: genau ein kurzer Satz. Kein Lob, keine Mini-Zusammenfassung, keine didaktische Einschaetzung.",
    "Bei responseDepth brief: ein bis zwei kurze Saetze mit Orientierung, aber ohne lange Analyse.",
    "Bei responseDepth reflective: zwei bis drei kurze Saetze mit Mini-Zusammenfassung, konkreter Staerke und nur falls sinnvoll einem Stolperpunkt oder Denkimpuls.",
    "Bei relationshipMove acknowledge reicht ein natuerliches 'Alles klar' oder 'Okay', wenn es zum Satz passt.",
    "Bei relationshipMove encourage nur konkret bestaerken; kein pauschales 'tolle Idee', wenn du es nicht begruendest.",
    "Wenn du eine Idee lobst, begründe konkret, warum sie didaktisch, gestalterisch oder für die Zielgruppe sinnvoll ist.",
    "Bleib beim aktuellen Wunsch des Users und beim aktuellen Produktionsschritt.",
    "Nenne nur sichtbare Produktbegriffe: Input, Arbeitsblatt-Konzept, Entwurf, Entwürfe und Arbeitsblatt-Ablage. Arbeitsblatt-PDF nur nennen, wenn es um ein bereits abgelegtes Arbeitsblatt geht.",
    "Nutze nicht mehr die alten Nutzerbegriffe Auswahl übernehmen, PDF erstellen, PDF herunterladen oder Export.",
    "Entwürfe sind Bildentwürfe. Ein PDF entsteht erst beim Ablegen als Arbeitsblatt.",
    "Keine internen Begriffe wie Lesson Brief, Content Mirror, ImageSpec, Tool Call oder Run.",
    "Interne Bildplanung ist noch kein Entwurf. Sage nie, ein Entwurf sei übernommen oder fertig, solange moment.kind proposal_ready/proposal_adopted und proposal.kind image_spec ist.",
    "Bei moment.kind suggested_action oder local_action_offer in der Input-Phase: Wenn eine Lehrkraft eine Arbeitsblattidee nennt, beginne mit einer sehr kurzen Mini-Zusammenfassung der Idee und einer konkreten Stärke, bevor du den nächsten Schritt nennst.",
    "Bei moment.kind proposal_ready und proposal.kind content_mirror: Mache klar, dass jetzt ein sichtbarer Konzeptvorschlag vorliegt. Schreibe eine kurze didaktische Einschätzung zum Arbeitsblatt-Konzept. Satz 1: was aus Aufgaben, Text oder Bildidee gut trägt. Satz 2: eine mögliche Unschärfe oder Schwäche mit Begründung aus dem Konzept. Satz 3: biete einen Entwurf aus diesem Konzept oder eine weitere Anpassung an; verlange keinen separaten Übernahme- oder Freigabeschritt.",
    "Bei dieser Konzept-Einschätzung keine Schnelloptionen oder Alternativbuttons vorschlagen. Die Lehrkraft kann natürlich im Chat nachschärfen.",
    "Bei moment.kind candidate_created ist die Bildgenerierung bereits abgeschlossen. Bitte keine Bestätigung mehr verlangen und nicht sagen, der User müsse die Bildgenerierung bestätigen.",
    "Bei moment.kind candidate_created beschreibe das fertige Ergebnis. Nicht schreiben: ich lege jetzt an, ich starte, ich erzeuge jetzt oder ich erstelle jetzt.",
    "Bei moment.kind workflow_followup ist die genannte Workflow-Aktion bereits erledigt. Frage nicht, ob die erledigte Aktion noch übernommen, freigegeben oder ausgeführt werden soll.",
    "Bei commandId activate_content_mirror_version: Schreibe, dass die gewünschte Konzeptversion jetzt für den nächsten Schritt genutzt wird, und nenne höchstens den nächsten Entwurfs-Schritt.",
    "Bei commandId adopt_content_mirror_proposal: Schreibe, dass mit diesem Arbeitsblatt-Konzept weitergearbeitet wird, und nenne höchstens den nächsten Entwurfs-Schritt.",
    "Wenn die interne Bildplanung eine referencePolicy hat, erklaere knapp und natuerlich, ob eine Referenz oder Vorlage hilfreich ist. Sage Referenz, Vorlage oder Bildvorlage, nicht ImageSpec.",
    "Raw-IDs wie candidate_01 nur nutzen, wenn sie im Fallback unvermeidbar sind; besser: Entwurf 01 oder dieser Entwurf.",
    "Erfinde keine abgeschlossenen Aktionen, keine Dateien, keine Freigaben und keine neuen Buttons.",
    "Wenn requiresPaidConfirmation true ist, erwähne knapp, dass die Bildgenerierung bewusst bestätigt werden muss.",
    "Vermeide im sichtbaren Chat technische Begriffe wie Bild-API; sage lieber Bildgenerierung oder Erzeugung.",
    "Maximal moment.persona.sentenceBudget Saetze, nie mehr als 3 kurze Saetze. Keine Liste, außer der Moment verlangt ausdrücklich kurze Optionen.",
    "Gib ausschließlich JSON im vorgegebenen Schema zurück."
  ].join("\n");
}

function narrationSchema() {
  return {
    type: "object",
    additionalProperties: false,
    required: ["message"],
    properties: {
      message: {
        type: "string",
        description: "Kurze sichtbare Chatantwort für die Lehrkraft."
      }
    }
  };
}

function parseNarration(response, moment = null) {
  const text = extractOutputText(response);
  if (!text) {
    return null;
  }
  try {
    return sanitizeNarration(JSON.parse(text).message, moment);
  } catch {
    return sanitizeNarration(text, moment);
  }
}

function contradictsCompletedActivation(message, moment = {}) {
  if (
    moment.kind !== "workflow_followup"
    || !["activate_content_mirror_version", "adopt_content_mirror_proposal"].includes(moment.commandId)
  ) {
    return false;
  }
  const text = nonEmpty(message);
  if (!text) {
    return false;
  }
  return /(?:willst|möchtest|moechtest|soll\s+ich|sag(?:e)?\s+mir|antworte|bestätige|bestaetige|ob\s+ich).{0,140}(?:übernehm|uebernehm|freigeb|frei\s+geb|anpass|neu\s+aufsetz|auswähl|auswaehl|prüf|pruef)/i.test(text)
    || /(?:kann|darf).{0,80}(?:nicht|noch\s+nicht|hier\s+nicht).{0,120}(?:übernehm|uebernehm|freigeb|frei\s+geb|setzen|auswähl|auswaehl)/i.test(text)
    || /(?:nur\s+als\s+Entwurf|nicht\s+als\s+freigegebenes\s+Konzept)/i.test(text);
}

async function narrateChatMoment(projectDir, moment = {}, options = {}) {
  const deterministicMessage = presentWorkflowEvent(moment);
  const fallback = sanitizeNarration(deterministicMessage || moment.fallback, moment)
    || "Der nächste sichere Schritt ist als Aktion verfügbar.";
  if (deterministicMessage) {
    return fallback;
  }
  const requestConfig = getOpenAiRequestConfig(process.env);
  if (!canUseNarration(requestConfig, process.env)) {
    return fallback;
  }

  const startedAt = Date.now();
  const route = routeForPurpose(ROUTE_PURPOSES.NARRATION, requestConfig);
  const model = route.model || requestConfig.textModel;
  let modelCallLogged = false;
  const payload = compactMoment(moment);
  const responseBody = {
    model,
    instructions: narrationInstructions(),
    input: [{
      role: "user",
      content: JSON.stringify(payload, null, 2)
    }],
    text: {
      format: {
        type: "json_schema",
        name: "sheetifyimg_chat_narration",
        strict: true,
        schema: narrationSchema()
      }
    },
    reasoning: route.reasoningEffort && route.reasoningEffort !== "none"
      ? { effort: route.reasoningEffort }
      : undefined,
    store: false
  };
  const requestShape = measureModelRequest(responseBody, {
    contextSections: payload
  });
  try {
    const response = await createResponse(responseBody, {
      ...requestConfig,
      timeoutMs: timeoutMs(process.env, requestConfig.timeoutMs)
    });
    const responseModel = response.model || model;
    const usage = response.usage || null;
    const costEstimate = estimateOpenAiTextCost({
      usage,
      model: responseModel
    });
    await logModelRun(projectDir, {
      status: "success",
      source: "chat_narration",
      purpose: moment.kind || "chat_narration",
      route: route.route,
      promptNames: route.promptNames,
      model: responseModel,
      reasoningEffort: route.reasoningEffort,
      responseId: response.id || null,
      durationMs: Date.now() - startedAt,
      usage,
      costEstimate,
      requestShape,
      attribution: options.usageAttribution,
      uiEvent: options.uiEvent || moment.kind || "chat_narration"
    }, { now: options.now });
    modelCallLogged = true;
    const parsedMessage = parseNarration(response, moment);
    const message = parsedMessage && !contradictsCompletedActivation(parsedMessage, moment)
      ? parsedMessage
      : fallback;
    return message;
  } catch (error) {
    if (!modelCallLogged) {
      await logModelRun(projectDir, {
        status: "error",
        source: "chat_narration",
        purpose: moment.kind || "chat_narration",
        route: route.route,
        promptNames: route.promptNames,
        model,
        reasoningEffort: route.reasoningEffort,
        durationMs: Date.now() - startedAt,
        requestShape,
        attribution: options.usageAttribution,
        uiEvent: options.uiEvent || moment.kind || "chat_narration",
        error
      }, { now: options.now });
    }
    return fallback;
  }
}

module.exports = {
  narrateChatMoment,
  sanitizeNarration,
  normalizeNarrationSurface,
  validateNarrationPolicy,
  contradictsCompletedActivation,
  violatesActionConsistency
};
