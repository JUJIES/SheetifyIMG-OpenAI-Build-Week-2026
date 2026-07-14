"use strict";

const { isEnabledWorkflowCommand, visibleWorkflowCommands } = require("../workflowPolicy");

const TOOL_DESCRIPTIONS = Object.freeze({
  approve_current_brief: "Interner Schritt: speichert den aktuellen Konzeptstand als Arbeitsbasis.",
  approve_current_content: "Interner Schritt: speichert das aktuelle Arbeitsblatt-Konzept als Entwurfsbasis.",
  create_brief_draft: "Schlaegt vor, ein erstes Arbeitsblatt-Konzept direkt anzulegen.",
  create_content_draft: "Schlaegt vor, Aufgaben und Material direkt ins Arbeitsblatt-Konzept zu schreiben.",
  create_run: "Interner Schritt: legt aus der gespeicherten Konzeptbasis eine Entwurfsrunde an.",
  generate_lessonbrief_proposal: "Schlaegt vor, einen strukturierten Vorschlag fuer ein Arbeitsblatt-Konzept zu erzeugen.",
  adopt_lessonbrief_proposal: "Schlaegt vor, aus einem offenen internen Konzeptstand das vollstaendige Arbeitsblatt-Konzept auszuformulieren.",
  generate_content_mirror_proposal: "Schlaegt vor, einen strukturierten Arbeitsblatt-Konzept-Vorschlag zu erzeugen: als erstes Konzept, gezielte Anpassung oder neues Konzept aus dem bisherigen Kontext.",
  generate_candidate_from_content_proposal: "Schlaegt vor, aus einem offenen Arbeitsblatt-Konzeptvorschlag direkt einen Entwurf zu erstellen. Die App speichert die Konzeptbasis intern und die UI muss bezahlte Generierung bestaetigen.",
  adopt_content_mirror_proposal: "Interner Schritt: speichert einen offenen Aufgaben- und Materialvorschlag als Arbeitsblatt-Konzeptbasis.",
  generate_content_warnings_proposal: "Interner Legacy-Schritt fuer Konzept-Feedback. Im normalen UI-Workflow nicht anbieten.",
  adopt_content_warnings_proposal: "Interner Legacy-Schritt zum Speichern von Konzept-Feedback. Im normalen UI-Workflow nicht anbieten.",
  prepare_image_spec: "Schlaegt vor, die geplante Visualisierung aus dem Arbeitsblatt-Konzept zu pruefen und bei Bedarf eine Referenz- oder Vorlagenentscheidung vorzubereiten.",
  adopt_image_spec: "Interner Legacy-Schritt zum Speichern der Bildplanung. Im normalen UI-Workflow nicht anbieten.",
  prepare_reference_asset: "Schlaegt vor, ein hochgeladenes Referenzbild fuer die naechste Entwurfserstellung zu verwenden.",
  prepare_web_reference_asset: "Schlaegt vor, eine offen lizenzierte Wikimedia-Bildreferenz zu suchen, herunterzuladen und als Bildreferenz fuer die naechste Entwurfserstellung zu verwenden.",
  generate_image_candidate: "Schlaegt vor, aus dem Arbeitsblatt-Konzept einen Entwurf zu erstellen. Die App speichert eine entwurfsfaehige Konzeptbasis bei Bedarf intern, leitet die ImageSpec intern ab und die UI muss bezahlte Generierung bestaetigen. Niemals behaupten, dass keine weitere Bestaetigung noetig ist.",
  deposit_worksheet: "Legt einen vorhandenen Entwurf als festen Arbeitsblatt- oder Bundle-Snapshot in der Arbeitsblatt-Ablage ab. Nur verwenden, wenn die Lehrkraft das explizit verlangt."
});

const CHAT_CONTEXTUAL_COMMAND_IDS = Object.freeze([
  "generate_content_mirror_proposal"
]);

function commandById(workspace = {}, commandId = "") {
  return (workspace.commands || []).find((command) => command.id === commandId) || null;
}

function hasConceptBasis(workspace = {}) {
  return Boolean(
    workspace.proposals?.latestContentMirror
      || workspace.documents?.content?.data
      || workspace.artifacts?.currentContent
      || workspace.documents?.brief?.data
  );
}

function chatContextualCommands(workspace = {}) {
  return CHAT_CONTEXTUAL_COMMAND_IDS
    .map((commandId) => commandById(workspace, commandId))
    .filter((command) => {
      if (!isEnabledWorkflowCommand(command)) {
        return false;
      }
      if (command.id === "generate_content_mirror_proposal") {
        return hasConceptBasis(workspace);
      }
      return true;
    });
}

function uniqueCommands(commands = []) {
  const seen = new Set();
  const result = [];
  for (const command of commands) {
    if (!command?.id || seen.has(command.id)) {
      continue;
    }
    seen.add(command.id);
    result.push(command);
  }
  return result;
}

function parametersForCommand(command) {
  if (command.id === "deposit_worksheet") {
    return {
      type: "object",
      properties: {
        candidateId: {
          type: "string",
          description: "ID des Entwurfs. Wenn leer, verwendet SheetifyIMG den aktuellen Standardentwurf."
        },
        page: {
          type: "number",
          description: "Optionale Seitennummer, wenn nur eine Seite abgelegt werden soll."
        }
      },
      additionalProperties: false
    };
  }

  if (command.id === "generate_content_mirror_proposal") {
    return {
      type: "object",
      properties: {
        message: {
          type: "string",
          description: "Kurzer Auftrag der Lehrkraft oder verdichteter Kontext fuer den Konzeptvorschlag."
        },
        revisionMode: {
          type: "string",
          enum: ["patch", "followup_concept", "new_concept_from_context"],
          description: "patch fuer gezielte Anpassung; followup_concept fuer Folgebogen; new_concept_from_context fuer eine neue Konzeptvariante aus dem bisherigen Kontext."
        },
        preserveUnmentionedConceptParts: {
          type: "boolean",
          description: "Nur bei patch true setzen. Bei neuen Konzepten false."
        },
        basisProposalId: {
          type: "string",
          description: "Optionaler offener Arbeitsblatt-Konzept-Vorschlag, der als Bearbeitungsbasis dienen soll."
        }
      },
      additionalProperties: false
    };
  }

  if (command.defaultPayload?.proposalId) {
    return {
      type: "object",
      properties: {
        proposalId: {
          type: "string",
          description: "ID des offenen Vorschlags, der fuer den naechsten Schritt genutzt werden soll."
        }
      },
      additionalProperties: false
    };
  }

  return {
    type: "object",
    properties: {},
    additionalProperties: false
  };
}

function buildAiTools(workspace) {
  const commands = uniqueCommands([
    ...chatContextualCommands(workspace),
    ...visibleWorkflowCommands(workspace).filter(isEnabledWorkflowCommand)
  ]).slice(0, 4);

  return commands.map((command) => ({
      type: "function",
      name: command.id,
      description: TOOL_DESCRIPTIONS[command.id],
      parameters: parametersForCommand(command),
      strict: false
    }));
}

function parseArguments(rawArguments) {
  if (!rawArguments) {
    return {};
  }
  if (typeof rawArguments === "object") {
    return rawArguments;
  }
  try {
    return JSON.parse(rawArguments);
  } catch {
    return {};
  }
}

function safePayloadForCommand(command, rawArguments) {
  const args = parseArguments(rawArguments);
  if (command.id === "deposit_worksheet") {
    const candidateId = String(args.candidateId || command.defaultCandidateId || command.defaultPayload?.candidateId || "").trim();
    const page = Number(args.page || 0);
    const payload = {
      ...(command.defaultPayload || {}),
      ...(candidateId ? { candidateId } : {})
    };
    if (candidateId && page > 0) {
      payload.pages = [{ candidateId, page }];
    }
    return payload;
  }
  if (command.id === "generate_content_mirror_proposal") {
    const revisionMode = ["patch", "followup_concept", "new_concept_from_context"].includes(args.revisionMode)
      ? args.revisionMode
      : null;
    const basisProposalId = String(args.basisProposalId || command.defaultPayload?.basisProposalId || "").trim();
    const effectiveRevisionMode = revisionMode || (basisProposalId ? "patch" : null);
    const basePayload = { ...(command.defaultPayload || {}) };
    if (effectiveRevisionMode !== "patch") {
      delete basePayload.basisProposalId;
    }
    return {
      ...basePayload,
      ...(String(args.message || "").trim() ? { message: String(args.message).trim().slice(0, 2000) } : {}),
      ...(effectiveRevisionMode ? { revisionMode: effectiveRevisionMode } : {}),
      ...(typeof args.preserveUnmentionedConceptParts === "boolean"
        ? { preserveUnmentionedConceptParts: args.preserveUnmentionedConceptParts }
        : {}),
      ...(effectiveRevisionMode === "patch" && basisProposalId
        ? { basisProposalId: basisProposalId.slice(0, 160) }
        : {})
    };
  }
  if (command.defaultPayload?.proposalId) {
    return {
      ...command.defaultPayload,
      proposalId: String(args.proposalId || command.defaultPayload.proposalId)
    };
  }
  if (command.defaultPayload) {
    return command.defaultPayload;
  }
  return {};
}

function shouldAutoOpenConfirmation(command = {}, options = {}) {
  if (command.requiresConfirmation !== true) {
    return false;
  }
  if (options.autoOpenConfirmation === true) {
    return true;
  }
  const intent = options.intent || {};
  return intent.executionPolicy === "auto_open_confirmation";
}

function suggestedActionsFromToolCalls(toolCalls, workspace, options = {}) {
  const commandsById = new Map(uniqueCommands([
    ...chatContextualCommands(workspace),
    ...visibleWorkflowCommands(workspace)
  ]).map((command) => [command.id, command]));
  const actions = [];
  const seen = new Set();

  for (const call of toolCalls || []) {
    const command = commandsById.get(call.name);
    if (!isEnabledWorkflowCommand(command) || seen.has(command.id)) {
      continue;
    }
    seen.add(command.id);
    actions.push({
      command: command.id,
      label: command.label,
      payload: safePayloadForCommand(command, call.arguments),
      requiresConfirmation: command.requiresConfirmation === true,
      confirmationKind: command.confirmationKind || null,
      autoOpenConfirmation: shouldAutoOpenConfirmation(command, options)
    });
  }

  return actions;
}

module.exports = {
  buildAiTools,
  suggestedActionsFromToolCalls
};
