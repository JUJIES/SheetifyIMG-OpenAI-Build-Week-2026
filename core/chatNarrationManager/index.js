"use strict";

const { getAiRuntimeStatus, getOpenAiRequestConfig } = require("../aiConfig");
const { createResponse, extractOutputText } = require("../openaiClient");
const { logModelRun } = require("../modelRunLogger");

const DEFAULT_TIMEOUT_MS = 12000;
const MAX_MESSAGE_LENGTH = 900;
const INTERNAL_TERMS = /\b(lesson brief|content mirror|imagespec|tool call|model run)\b/i;

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
  return {
    title: truncate(data.title, 180),
    textTitles: (Array.isArray(data.readingTexts) ? data.readingTexts : [])
      .slice(0, 3)
      .map((entry) => truncate(entry.title, 140))
      .filter(Boolean),
    tasks: compactTasks(data.tasks),
    imageMaterials: compactImageMaterials(data.imageMaterials)
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
    latestRun: latestRun.runId ? {
      runId: latestRun.runId,
      candidateIds,
      selectedCandidateId: latestRun.selectedCandidateId || null
    } : null,
    availableActions: (workspace.commands || [])
      .filter((command) => command.enabled)
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
    stateFacts.push("Kandidatenvorbereitung ist intern vorbereitet/übernommen; es wurde dadurch noch kein Bild-Kandidat erzeugt.");
  }
  if (moment.kind === "candidate_created") {
    stateFacts.push("Der Bild-Kandidat ist bereits fertig erzeugt; keine Bestätigung mehr verlangen.");
  }
  return {
    kind: moment.kind || "chat_followup",
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

function sanitizeNarration(value) {
  const text = nonEmpty(value)
    .replace(/^["“”]+|["“”]+$/g, "")
    .replace(/\bdiesen Kandidat\b/g, "diesen Kandidaten")
    .replace(/\bden Kandidat\b/g, "den Kandidaten")
    .replace(/\bnimm (diesen|den) Kandidaten als Auswahl\b/gi, "lade das PDF herunter")
    .replace(/\b(als )?Auswahl übernehmen\b/gi, "das PDF herunterladen")
    .replace(/\bauswählen\b/gi, "als PDF nutzen")
    .replace(/\bexportieren\b/gi, "als PDF herunterladen")
    .replace(/\bAuswahl\b/g, "PDF")
    .replace(/\bausgewählt\b/g, "als PDF bereit")
    .replace(/\bexportiert\b/g, "als PDF bereit")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  if (!text || INTERNAL_TERMS.test(text)) {
    return null;
  }
  return text.length > MAX_MESSAGE_LENGTH
    ? `${text.slice(0, MAX_MESSAGE_LENGTH - 1).trim()}…`
    : text;
}

function narrationInstructions() {
  return [
    "Du formulierst genau eine sichtbare Chatantwort für SheetifyIMG.",
    "Die App entscheidet Workflow, Buttons, Freigaben und Kostenbestätigungen. Du formulierst nur den Begleittext.",
    "Schreibe auf Deutsch mit echten Umlauten.",
    "Sprich die Lehrkraft immer mit du an, nie mit Sie.",
    "Ton: aufmerksam, knapp, freundlich, bestimmt. Kein generisches Lob.",
    "Wenn du eine Idee lobst, begründe konkret, warum sie didaktisch, gestalterisch oder für die Zielgruppe sinnvoll ist.",
    "Bleib beim aktuellen Wunsch des Users und beim aktuellen Produktionsschritt.",
    "Nenne nur sichtbare Produktbegriffe: Input, Arbeitsblatt-Konzept, Kandidat, Kandidaten und PDF.",
    "Keine internen Begriffe wie Lesson Brief, Content Mirror, ImageSpec, Tool Call oder Run.",
    "Kandidatenvorbereitung ist noch kein Kandidat. Sage nie, ein Kandidat sei übernommen oder fertig, solange moment.kind proposal_ready/proposal_adopted und proposal.kind image_spec ist.",
    "Bei moment.kind candidate_created ist die Bildgenerierung bereits abgeschlossen. Bitte keine Bestätigung mehr verlangen und nicht sagen, der User müsse die Bildgenerierung bestätigen.",
    "Bei moment.kind candidate_created beschreibe das fertige Ergebnis. Nicht schreiben: ich lege jetzt an, ich starte, ich erzeuge jetzt oder ich erstelle jetzt.",
    "Wenn eine Kandidatenvorbereitung eine referencePolicy hat, erklaere knapp und natuerlich, ob eine Referenz oder Vorlage hilfreich ist. Sage Referenz, Vorlage oder Bildvorlage, nicht ImageSpec.",
    "Raw-IDs wie candidate_01 nur nutzen, wenn sie im Fallback unvermeidbar sind; besser: Kandidat 01 oder dieser Kandidat.",
    "Erfinde keine abgeschlossenen Aktionen, keine Dateien, keine Freigaben und keine neuen Buttons.",
    "Wenn requiresPaidConfirmation true ist, erwähne knapp, dass die Bildgenerierung bewusst bestätigt werden muss.",
    "Vermeide im sichtbaren Chat technische Begriffe wie Bild-API; sage lieber Bildgenerierung oder Erzeugung.",
    "Maximal 3 kurze Sätze. Keine Liste, außer der Moment verlangt ausdrücklich kurze Optionen.",
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

function parseNarration(response) {
  const text = extractOutputText(response);
  if (!text) {
    return null;
  }
  try {
    return sanitizeNarration(JSON.parse(text).message);
  } catch {
    return sanitizeNarration(text);
  }
}

async function narrateChatMoment(projectDir, moment = {}, options = {}) {
  const fallback = sanitizeNarration(moment.fallback) || "Ich habe den nächsten Schritt vorbereitet.";
  const requestConfig = getOpenAiRequestConfig(process.env);
  if (!canUseNarration(requestConfig, process.env)) {
    return fallback;
  }

  const startedAt = Date.now();
  const model = requestConfig.textModel;
  try {
    const response = await createResponse({
      model,
      instructions: narrationInstructions(),
      input: [{
        role: "user",
        content: JSON.stringify(compactMoment(moment), null, 2)
      }],
      text: {
        format: {
          type: "json_schema",
          name: "sheetifyimg_chat_narration",
          strict: true,
          schema: narrationSchema()
        }
      },
      store: false
    }, {
      ...requestConfig,
      timeoutMs: timeoutMs(process.env, requestConfig.timeoutMs)
    });
    const message = parseNarration(response) || fallback;
    await logModelRun(projectDir, {
      status: "success",
      source: "chat_narration",
      purpose: moment.kind || "chat_narration",
      route: "narration",
      promptNames: ["chat_narration_inline"],
      model: response.model || model,
      responseId: response.id || null,
      durationMs: Date.now() - startedAt,
      uiEvent: options.uiEvent || moment.kind || "chat_narration"
    }, { now: options.now });
    return message;
  } catch (error) {
    await logModelRun(projectDir, {
      status: "error",
      source: "chat_narration",
      purpose: moment.kind || "chat_narration",
      route: "narration",
      promptNames: ["chat_narration_inline"],
      model,
      durationMs: Date.now() - startedAt,
      uiEvent: options.uiEvent || moment.kind || "chat_narration",
      error
    }, { now: options.now });
    return fallback;
  }
}

module.exports = {
  narrateChatMoment,
  sanitizeNarration
};
