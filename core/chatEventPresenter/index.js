"use strict";

function clean(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function candidateLabel(value) {
  if (value && typeof value === "object") {
    const displayLabel = clean(value.displayLabel);
    if (displayLabel) {
      return displayLabel;
    }
    return candidateLabel(value.candidateId || value.id);
  }
  const raw = clean(value);
  const match = raw.match(/^candidate_0*(\d+)$/i);
  if (match) {
    return `Entwurf ${String(Number(match[1])).padStart(2, "0")}`;
  }
  return raw || "Entwurf";
}

function pageCountLabel(pageCount) {
  const count = Number(pageCount || 0) || 0;
  if (count <= 0) {
    return "";
  }
  return count === 1 ? "1 Seite" : `${count} Seiten`;
}

function conceptVersionFromAction(action = {}) {
  const label = clean(action.label);
  const match = label.match(/\bkonzept\s+v(\d+)\b/i);
  return match ? `Konzept v${match[1]}` : "Die Konzeptversion";
}

function presentWorkflowCommand(commandId, moment = {}) {
  const action = moment.action || (Array.isArray(moment.suggestedActions) ? moment.suggestedActions[0] : null) || null;
  const nextCandidate = action?.command === "generate_image_candidate";
  const messages = {
    generate_lessonbrief_proposal: "Arbeitsblatt-Konzept wurde vorbereitet.",
    adopt_lessonbrief_proposal: "Arbeitsblatt-Konzept wurde ausformuliert.",
    generate_content_mirror_proposal: "Arbeitsblatt-Konzept wurde ausformuliert.",
    adopt_content_mirror_proposal: "Mit dem Arbeitsblatt-Konzept wird weitergearbeitet.",
    approve_current_content: "Mit dem Arbeitsblatt-Konzept wird weitergearbeitet.",
    prepare_image_spec: "Referenzbedarf wurde geprüft.",
    adopt_image_spec: "Interner Stand wurde gespeichert.",
    prepare_reference_asset: "Referenz wurde vorbereitet.",
    prepare_web_reference_asset: "Bildreferenz wurde vorbereitet.",
    deposit_worksheet: "Arbeitsblatt abgelegt.",
    create_brief_draft: "Erste Konzeptfassung wurde angelegt.",
    create_content_draft: "Arbeitsblatt-Konzept wurde angelegt.",
    generate_content_warnings_proposal: "Konzept-Feedback wurde vorbereitet.",
    adopt_content_warnings_proposal: "Konzept-Feedback wurde intern gespeichert."
  };

  if (commandId === "activate_content_mirror_version") {
    return `${conceptVersionFromAction(action)} wird für die nächsten Schritte genutzt.`;
  }
  if (commandId === "generate_image_candidate") {
    return nextCandidate
      ? "Bildgenerierung ist vorbereitet und wartet auf deine bewusste Bestätigung."
      : "Bildgenerierung läuft im Hintergrund.";
  }
  return messages[commandId] || "Schritt erledigt.";
}

function presentCandidateCreated(moment = {}) {
  const candidate = moment.candidate || {};
  const label = candidateLabel(candidate);
  const pages = pageCountLabel(candidate.pageCount);
  return pages ? `${label} ist fertig. ${pages}.` : `${label} ist fertig.`;
}

function presentProposalAdopted(moment = {}) {
  const kind = moment.proposal?.kind || "";
  if (kind === "image_spec") {
    return "Interner Stand wurde gespeichert.";
  }
  if (kind === "content_warnings") {
    return "Konzept-Feedback wurde intern gespeichert.";
  }
  return "Mit dem Arbeitsblatt-Konzept wird weitergearbeitet.";
}

function presentWorkflowEvent(moment = {}) {
  const action = moment.action || (Array.isArray(moment.suggestedActions) ? moment.suggestedActions[0] : null) || null;
  if (
    (moment.kind === "suggested_action" || moment.kind === "local_action_offer")
    && moment.requiresPaidConfirmation === true
    && ["generate_candidate_from_content_proposal", "generate_image_candidate"].includes(action?.command)
  ) {
    return "Ich kann daraus jetzt einen Entwurf erstellen; die Bildgenerierung startet erst nach deiner bewussten Bestätigung.";
  }
  if (moment.kind === "workflow_followup") {
    return presentWorkflowCommand(moment.commandId, moment);
  }
  if (moment.kind === "proposal_adopted") {
    return presentProposalAdopted(moment);
  }
  if (moment.kind === "candidate_created") {
    return presentCandidateCreated(moment);
  }
  if (moment.kind === "candidate_selected") {
    return "Entwurf wurde als Arbeitsstand markiert.";
  }
  if (moment.kind === "export_created") {
    return "Arbeitsblatt-PDF wurde erstellt.";
  }
  if (moment.kind === "input_received") {
    return "Input erhalten. Ich kann daraus ein Arbeitsblatt-Konzept vorbereiten.";
  }
  return null;
}

module.exports = {
  presentWorkflowEvent
};
