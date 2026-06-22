"use strict";

const { isEnabledWorkflowCommand, visibleWorkflowCommands } = require("../workflowPolicy");

const TOOL_DESCRIPTIONS = Object.freeze({
  approve_current_brief: "Schlaegt vor, den aktuellen Planstand des Arbeitsblatt-Konzepts freizugeben.",
  approve_current_content: "Schlaegt vor, das aktuelle Arbeitsblatt-Konzept fuer Kandidaten freizugeben.",
  create_brief_draft: "Schlaegt vor, ein erstes Arbeitsblatt-Konzept direkt anzulegen.",
  create_content_draft: "Schlaegt vor, Aufgaben und Material direkt ins Arbeitsblatt-Konzept zu uebernehmen.",
  create_run: "Schlaegt vor, aus dem freigegebenen Arbeitsblatt-Konzept eine Kandidatenrunde anzulegen.",
  generate_lessonbrief_proposal: "Schlaegt vor, einen strukturierten Vorschlag fuer ein Arbeitsblatt-Konzept zu erzeugen.",
  adopt_lessonbrief_proposal: "Schlaegt vor, einen offenen Konzept-Vorschlag explizit zu uebernehmen.",
  generate_content_mirror_proposal: "Schlaegt vor, Aufgaben, Material und Loesungshinweise fuer das Arbeitsblatt-Konzept zu erzeugen.",
  generate_candidate_from_content_proposal: "Alter Kombi-Schritt. Im normalen Workflow nicht anbieten: erst Konzept uebernehmen oder aktualisieren, danach Kandidat erzeugen.",
  adopt_content_mirror_proposal: "Schlaegt vor, einen offenen Aufgaben- und Materialvorschlag ins Arbeitsblatt-Konzept zu uebernehmen.",
  generate_content_warnings_proposal: "Schlaegt vor, eine AI-gestuetzte Qualitaetspruefung des Arbeitsblatt-Konzepts zu erzeugen.",
  adopt_content_warnings_proposal: "Schlaegt vor, offene Pruefhinweise explizit in den Warnstand zu uebernehmen.",
  prepare_image_spec: "Schlaegt vor, die geplante Visualisierung aus dem freigegebenen Arbeitsblatt-Konzept zu pruefen und bei Bedarf eine Referenz- oder Vorlagenentscheidung vorzubereiten.",
  adopt_image_spec: "Schlaegt vor, die Kandidatenvorbereitung fuer die Bildgenerierung zu uebernehmen.",
  prepare_reference_asset: "Schlaegt vor, eine benoetigte Referenz oder App-Vorlage fuer die naechste Kandidatenerzeugung vorzubereiten.",
  prepare_web_reference_asset: "Schlaegt vor, eine offen lizenzierte Webreferenz zu suchen, herunterzuladen und als Bildreferenz fuer die naechste Kandidatenerzeugung zu verwenden.",
  generate_image_candidate: "Schlaegt vor, nach Konzept-Freigabe einen Kandidaten zu erzeugen. Die App leitet die ImageSpec intern ab und die UI muss bezahlte Generierung bestaetigen. Niemals behaupten, dass keine weitere Bestaetigung noetig ist.",
  prepare_export: "Schlaegt vor, aus der Auswahl ein PDF zu erstellen; optional mit Loesungsblatt, wenn die Lehrkraft das bestaetigt.",
  prepare_series_export: "Schlaegt vor, fuer die enthaltenen Arbeitsblaetter ein Reihen-PDF zu erstellen.",
  select_candidate: "Schlaegt vor, einen vorhandenen Kandidaten oder eine einzelne Kandidatenseite als Auswahl zu markieren."
});

function parametersForCommand(command) {
  if (command.id === "select_candidate") {
    return {
      type: "object",
      properties: {
        candidateId: {
          type: "string",
          description: "ID des auswaehlbaren Kandidaten. Wenn leer, verwendet SheetifyIMG den aktuellen Standardkandidaten."
        },
        page: {
          type: "number",
          description: "Optionale Seitennummer, wenn nur eine Seite in die bestehende Auswahl uebernommen werden soll."
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
          description: "ID des offenen Vorschlags, der explizit uebernommen werden soll."
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
  const commands = visibleWorkflowCommands(workspace).slice(0, 2);

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
  if (command.id === "select_candidate") {
    const candidateId = String(args.candidateId || command.defaultCandidateId || "").trim();
    const page = Number(args.page || 0);
    if (candidateId && page > 0) {
      return { candidateId, merge: true, pages: [{ candidateId, page }] };
    }
    return candidateId ? { candidateId } : {};
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

function suggestedActionsFromToolCalls(toolCalls, workspace) {
  const commandsById = new Map((workspace.commands || []).map((command) => [command.id, command]));
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
      payload: safePayloadForCommand(command, call.arguments)
    });
  }

  return actions;
}

module.exports = {
  buildAiTools,
  suggestedActionsFromToolCalls
};
