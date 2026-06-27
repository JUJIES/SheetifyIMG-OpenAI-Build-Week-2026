"use strict";

function dynamicDecisionPrompt(commandId, label = "") {
  if (commandId === "generate_image_candidate" && /(mehrseitig\w* entwurf|entwurfsreihe|kandidatenreihe)/i.test(label)) {
    return "Soll ich einen weiteren mehrseitigen Entwurf mit allen geplanten Seiten erstellen?";
  }
  if (commandId === "generate_image_candidate" && /variante/i.test(label)) {
    return "Soll ich einen weiteren Entwurf mit demselben freigegebenen Konzept erzeugen?";
  }
  if (commandId === "generate_content_mirror_proposal" && /überarbeiten|ueberarbeiten|aktualisieren/i.test(label)) {
    return "Soll ich das Arbeitsblatt-Konzept mit deiner Änderung überarbeiten?";
  }
  if (commandId === "adopt_content_mirror_proposal" && /aktualisieren/i.test(label)) {
    return "Die Konzept-Aktualisierung liegt vor. Soll ich sie übernehmen? Danach erstellst du den nächsten Entwurf auf dieser neuen Grundlage.";
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
    return "Weiteren Entwurf erzeugen";
  }
  if (commandId === "generate_content_mirror_proposal" && /überarbeiten|ueberarbeiten|aktualisieren/i.test(label)) {
    return "Konzept überarbeiten";
  }
  if (commandId === "adopt_content_mirror_proposal" && /aktualisieren/i.test(label)) {
    return "Konzept aktualisieren";
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
    decisionPrompt: "Der Konzept-Vorschlag liegt vor. Soll ich ihn übernehmen?",
    decisionLabel: "Ja, übernehmen"
  },
  generate_content_mirror_proposal: {
    decisionPrompt: "Soll ich daraus das vollständige Arbeitsblatt-Konzept ausformulieren?",
    decisionLabel: "Ja, Konzept ausformulieren"
  },
  create_content_draft: {
    decisionPrompt: "Soll ich daraus direkt die Aufgabenstruktur und Materialseite anlegen?",
    decisionLabel: "Ja, direkt anlegen"
  },
  adopt_content_mirror_proposal: {
    decisionPrompt: "Das Arbeitsblatt-Konzept liegt vor. Wenn es passt, übernehme ich es als Grundlage für Entwürfe.",
    decisionLabel: "Ja, Konzept passt"
  },
  generate_candidate_from_content_proposal: {
    decisionPrompt: "Wenn das Konzept passt, kann ich direkt einen Entwurf erstellen. Dafür kommt vorher die Kostenbestätigung.",
    decisionLabel: "Entwurf erstellen"
  },
  adopt_content_warnings_proposal: {
    decisionPrompt: "Die Prüfhinweise sind vorbereitet. Soll ich sie übernehmen?",
    decisionLabel: "Ja, übernehmen"
  },
  approve_current_content: {
    decisionPrompt: "Das Arbeitsblatt-Konzept wirkt bereit. Soll ich es als Grundlage für Entwürfe freigeben?",
    decisionLabel: "Ja, freigeben"
  },
  prepare_image_spec: {
    decisionPrompt: "Ich kann kurz prüfen, ob die geplante Visualisierung eine Referenz oder Vorlage braucht. Soll ich das vorbereiten?",
    decisionLabel: "Visualisierung prüfen"
  },
  prepare_reference_asset: {
    decisionPrompt: "Für diese Visualisierung kann ich jetzt die passende Referenz oder Vorlage vorbereiten. Soll ich das machen?",
    decisionLabel: "Referenz/Vorlage vorbereiten"
  },
  prepare_web_reference_asset: {
    decisionPrompt: "Hier ist eine Webreferenz sinnvoll. Soll ich eine passende offene Bildreferenz suchen und für die Generierung anhängen?",
    decisionLabel: "Webreferenz suchen"
  },
  adopt_image_spec: {
    decisionPrompt: "Die Vorbereitung für den nächsten Entwurf liegt vor. Soll ich sie für die Bildgenerierung nutzen?",
    decisionLabel: "Vorbereitung passt"
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
