"use strict";

function dynamicDecisionPrompt(commandId, label = "") {
  if (commandId === "generate_image_candidate" && /(mehrseitig\w* entwurf|entwurfsreihe|kandidatenreihe)/i.test(label)) {
    return "Soll ich einen weiteren mehrseitigen Entwurf mit allen geplanten Seiten erstellen?";
  }
  if (commandId === "generate_image_candidate" && /variante/i.test(label)) {
    return "Soll ich einen weiteren Entwurf mit demselben Arbeitsblatt-Konzept erzeugen?";
  }
  if (commandId === "generate_content_mirror_proposal" && /überarbeiten|ueberarbeiten|aktualisieren/i.test(label)) {
    return "Soll ich das Arbeitsblatt-Konzept mit deiner Änderung überarbeiten?";
  }
  if (commandId === "adopt_content_mirror_proposal" && /aktualisieren/i.test(label)) {
    return "Das überarbeitete Arbeitsblatt-Konzept liegt vor. Soll ich daraus den nächsten Entwurf vorbereiten?";
  }
  return null;
}

function dynamicDecisionLabel(commandId, label = "") {
  if (commandId === "generate_image_candidate" && /\baus konzept v\d+\b/i.test(label)) {
    return label;
  }
  if (commandId === "generate_image_candidate" && /(mehrseitig\w* entwurf|entwurfsreihe|kandidatenreihe)/i.test(label)) {
    return /weitere/i.test(label) ? "Weiteren mehrseitigen Entwurf erstellen" : "Mehrseitigen Entwurf erstellen";
  }
  if (commandId === "generate_image_candidate" && /variante/i.test(label)) {
    return "Weitere Entwurfsvariante erzeugen";
  }
  if (commandId === "generate_content_mirror_proposal" && /überarbeiten|ueberarbeiten|aktualisieren/i.test(label)) {
    return "Konzept überarbeiten";
  }
  if (commandId === "adopt_content_mirror_proposal" && /aktualisieren/i.test(label)) {
    return "Mit diesem Konzept weiterarbeiten";
  }
  return null;
}

const COMMAND_UI = Object.freeze({
  generate_lessonbrief_proposal: {
    decisionPrompt: "Ich kann daraus ein vollständiges Arbeitsblatt-Konzept mit Text, Aufgaben und Bildidee schreiben. Soll ich das machen?",
    decisionLabel: "Ja, Konzept schreiben"
  },
  create_brief_draft: {
    decisionPrompt: "Ich kann daraus direkt ein erstes Arbeitsblatt-Konzept anlegen. Soll ich das machen?",
    decisionLabel: "Ja, direkt anlegen"
  },
  adopt_lessonbrief_proposal: {
    decisionPrompt: "Der interne Konzeptstand liegt vor. Soll ich daraus das vollständige Arbeitsblatt-Konzept ausformulieren?",
    decisionLabel: "Ja, Konzept ausformulieren"
  },
  generate_content_mirror_proposal: {
    decisionPrompt: "Soll ich daraus das vollständige Arbeitsblatt-Konzept ausformulieren?",
    decisionLabel: "Ja, Konzept ausformulieren"
  },
  create_content_draft: {
    decisionPrompt: "Soll ich daraus direkt Lesetext/Material und Aufgabenstruktur anlegen?",
    decisionLabel: "Ja, direkt anlegen"
  },
  adopt_content_mirror_proposal: {
    decisionPrompt: "Das Arbeitsblatt-Konzept liegt vor. Soll ich mit diesem Stand weiterarbeiten?",
    decisionLabel: "Mit diesem Konzept weiterarbeiten"
  },
  generate_candidate_from_content_proposal: {
    decisionPrompt: "Soll ich aus diesem Arbeitsblatt-Konzept einen Entwurf erstellen? Dafür kommt vorher die Kostenbestätigung.",
    decisionLabel: "Entwurf erstellen"
  },
  approve_current_content: {
    decisionPrompt: "Das Arbeitsblatt-Konzept wirkt bereit. Soll ich mit diesem Stand weiterarbeiten?",
    decisionLabel: "Mit diesem Konzept weiterarbeiten"
  },
  prepare_image_spec: {
    decisionPrompt: "Soll ich prüfen, ob der nächste Entwurf eine Referenz oder Vorlage braucht?",
    decisionLabel: "Referenzbedarf prüfen"
  },
  prepare_reference_asset: {
    decisionPrompt: "Für diese Visualisierung kann ich ein hochgeladenes Referenzbild nutzen. Soll ich das machen?",
    decisionLabel: "Referenzbild nutzen"
  },
  prepare_web_reference_asset: {
    decisionPrompt: "Hier kann eine offene Bildreferenz helfen. Soll ich eine passende Wikimedia-Bildreferenz suchen und für die Generierung anhängen?",
    decisionLabel: "Bildreferenz suchen"
  },
  adopt_image_spec: {
    decisionPrompt: "Soll ich den internen Stand für die Bildgenerierung nutzen?",
    decisionLabel: "Internen Stand nutzen"
  },
  deposit_worksheet: {
    decisionPrompt: "Soll ich diesen Entwurf als Arbeitsblatt in der Ablage speichern?",
    decisionLabel: "Arbeitsblatt ablegen"
  },
  generate_image_candidate: {
    decisionPrompt: "Soll ich jetzt einen Entwurf erstellen?",
    decisionLabel: "Ja, Entwurf erstellen"
  }
});

function commandUiMetadata(commandId, label = "") {
  const base = COMMAND_UI[commandId] || {};
  const decisionPrompt = dynamicDecisionPrompt(commandId, label) || base.decisionPrompt || null;
  const decisionLabel = dynamicDecisionLabel(commandId, label) || base.decisionLabel || null;
  return {
    ...(decisionPrompt ? { decisionPrompt } : {}),
    ...(decisionLabel ? { decisionLabel } : {})
  };
}

module.exports = {
  commandUiMetadata
};
