"use strict";

function normalizeText(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/ß/g, "ss")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function questionIntent(message) {
  const raw = String(message || "").trim();
  const text = normalizeText(raw);
  return /[?？]\s*$/.test(raw)
    || /\b(oder|oder nicht|richtig|korrekt)\s*$/.test(text)
    || /\b(heisst|heist|bedeutet|meinst du|verstehe ich|ist das|waere das|ware das|muss ich|sollte ich|kann ich|kannst du)\b/.test(text);
}

function brainstormingIntent(message) {
  const text = normalizeText(message);
  const wantsOptions = /\b(ideen|themenideen|optionen|moglichkeiten|moeglichkeiten|brainstorming|brainstorm)\b/.test(text)
    || /\b(gib|nenn|nenne|zeig|zeige|hast du|hattest du|haettest du)\b.{0,100}\b(idee|ideen|thema|themen|option|optionen|vorschlag|vorschlage|vorschlaege)\b/.test(text)
    || /\b(drei|3|zwei|2|mehrere|ein paar)\b.{0,80}\b(idee|ideen|thema|themen|option|optionen|vorschlag|vorschlage|vorschlaege)\b/.test(text);
  if (!wantsOptions) {
    return false;
  }
  if (
    workflowCreationHoldIntent(message)
    || conceptCreationHoldIntent(message)
    || candidateCreationHoldIntent(message)
  ) {
    return true;
  }
  return !/\b(konzept vorschlagen|arbeitsblatt-konzept vorschlagen|konzept erstellen|arbeitsblatt erstellen|direkt ein konzept|mach daraus ein konzept)\b/.test(text);
}

function workflowActionStopIntent(message) {
  const text = normalizeText(message);
  return /\b(?:mach|mache|machen|tu|tue)\s+(?:erstmal|zunaechst|bitte)?\s*(?:nichts|nix)\b/.test(text)
    || /\b(?:erstmal|zunaechst|bitte)?\s*(?:nichts|nix)\s+(?:machen|tun)\b/.test(text);
}

function proposalAdoptionHoldIntent(message) {
  const text = normalizeText(message);
  return /\b(?:nichts|nix|nicht|kein|keine|keinen)\s+(?:uebernehmen|ubernehmen|freigeben|freigabe)\b/.test(text)
    || /\b(?:uebernehmen|ubernehmen|freigeben|freigabe)\b.{0,24}\b(?:nicht|nichts|nix)\b/.test(text);
}

function artifactCreationHoldIntent(message, artifact) {
  const text = normalizeText(message);
  const create = "(?:erstell\\w*|mach\\w*|generier\\w*|erzeug\\w*|formulier\\w*|start\\w*|anleg\\w*)";
  const clauses = text
    .split(/(?:[.!?;,]|\baber\b|\bsondern\b|\bund\b)/)
    .map((clause) => clause.trim())
    .filter(Boolean);
  return clauses.some((clause) => {
    const noBeforeArtifact = new RegExp(`\\b(?:noch|erstmal|zunaechst|bitte)?\\s*(?:kein|keine|keinen|nicht)\\b.{0,24}\\b${artifact}\\b`);
    const artifactBeforeNo = new RegExp(`\\b${artifact}\\b.{0,24}\\b(?:noch|erstmal|zunaechst|bitte)?\\s*(?:nicht|kein|keine|keinen)\\b(?:.{0,24}\\b${create}\\b)?`);
    const createBeforeNoArtifact = new RegExp(`\\b${create}\\b.{0,24}\\b(?:noch|erstmal|zunaechst|bitte)?\\s*(?:kein|keine|keinen|nicht)\\b.{0,24}\\b${artifact}\\b`);
    return noBeforeArtifact.test(clause)
      || artifactBeforeNo.test(clause)
      || createBeforeNoArtifact.test(clause);
  });
}

function conceptCreationHoldIntent(message) {
  return artifactCreationHoldIntent(
    message,
    "(?:konzept|arbeitsblatt-konzept|arbeitsblatt|projektbogen|folgebogen)"
  );
}

function candidateCreationHoldIntent(message) {
  return artifactCreationHoldIntent(message, "(?:entwurf|entwurfsvariante|bildentwurf)");
}

function workflowCreationHoldIntent(message) {
  const text = normalizeText(message);
  const directHold = workflowActionStopIntent(message);
  const noExecution = /\b(?:kein|keine|keinen)\s+(?:aktion|workflowaktion|workflow-aktion|ausfuehrung|ausfuhrung|schritt)\b/.test(text)
    || /\b(?:nichts|nix|nicht)\s+(?:ausfuehren|ausfuhren)\b/.test(text)
    || /\b(?:ausfuehren|ausfuhren)\b.{0,24}\b(?:nicht|nichts|nix)\b/.test(text)
    || (
      /\b(?:nur|erstmal|zunaechst)\b.{0,50}\b(?:vergleichen|anschauen|ansehen|pruefen|prufen|besprechen|einschaetzen|einschatzen)\b/.test(text)
      && /\b(?:kein|keine|keinen|nichts|nix|nicht)\b.{0,50}\b(?:entwurf|konzept|uebernehmen|ubernehmen|erstellen|aktion|schritt)\b/.test(text)
    )
    || (
      /\bspaeter\b.{0,50}\b(?:vielleicht|evtl|eventuell|ggf|gegebenenfalls|konzept|v\d+)\b/.test(text)
      && /\b(?:jetzt|erstmal|zunaechst)\b.{0,40}\b(?:keine?\s+aktion|nichts|nix|nicht)\b/.test(text)
    );
  const discussionOnly = /\b(?:nur|erstmal|zunaechst|kurz)\b.{0,50}\b(?:vergleichen|anschauen|ansehen|pruefen|prufen|besprechen|einschaetzen|einschatzen)\b/.test(text)
    && (
      proposalAdoptionHoldIntent(message)
      || conceptCreationHoldIntent(message)
      || candidateCreationHoldIntent(message)
      || /\b(?:noch|erstmal|zunaechst|bitte)?\s*(?:kein|keine|keinen|nicht)\b.{0,40}\b(?:aktion|schritt)\b/.test(text)
    );
  const nothingCreation = directHold
    || /\b(?:noch|erstmal|zunaechst|bitte)?\s*(?:nichts|nix)\s+(?:erstell\w*|machen|mach\w*|generier\w*|erzeug\w*|formulier\w*|start\w*)\b/.test(text)
    || /\b(?:will|wollen|moechte|moechten|mochte|mochten)\b.{0,30}\b(?:noch|erstmal|zunaechst)?\s*(?:nichts|nix)\s+(?:erstell\w*|machen|mach\w*|generier\w*|erzeug\w*|formulier\w*|start\w*)\b/.test(text)
    || /\b(?:erstmal|zunaechst|nur)\b.{0,50}\b(optionen|ideen|ueberblick|einschaetzung|beratung)\b/.test(text)
      && /\b(?:noch|erstmal|zunaechst)?\s*(?:nichts|nix|kein|keine|keinen|nicht)\b.{0,40}\b(?:erstell\w*|machen|mach\w*|generier\w*|erzeug\w*|formulier\w*|start\w*)\b/.test(text);
  return noExecution || discussionOnly || nothingCreation;
}

function conditionalNoOpCheckIntent(message) {
  const text = normalizeText(message);
  const conditional = /\b(?:wenn|falls)\b.{0,80}\b(?:schon|bereits)\b.{0,40}\b(?:enthalten|drin|vorhanden|angelegt|umgesetzt)\b/.test(text)
    || /\b(?:wenn|falls)\b.{0,80}\b(?:das|es)\b.{0,40}\b(?:schon|bereits)\b/.test(text);
  const answerOnly = /\b(?:sag|sage|antwort|antworte|schreib|schreibe)\w*\b.{0,80}\b(?:knapp|kurz|nur)\b/.test(text)
    || /\b(?:knapp|kurz|nur)\b.{0,80}\b(?:sag|sage|antwort|antworte|schreib|schreibe)\w*\b/.test(text);
  const noNewArtifact = /\b(?:statt|keine?|nicht)\b.{0,80}\b(?:karte|konzeptkarte|vorschlag|konzeptvorschlag|fassung|version)\b.{0,40}\b(?:neu|posten|ausgeben|erstellen|erzeugen)\w*\b/.test(text)
    || /\b(?:keine?|nicht)\b.{0,80}\b(?:neue?|identische?)\b.{0,40}\b(?:karte|konzeptkarte|vorschlag|konzeptvorschlag|fassung|version)\b/.test(text);
  return conditional && (answerOnly || noNewArtifact);
}

function affirmativeIntent(message) {
  const text = normalizeText(message);
  return /^(ja|jo|jep|yes|okay|ok|passt|gern|gerne|bitte|mach|mache|tu|weiter|los)(\b|$)/.test(text)
    || /\b(ja gerne|mach das|tu das|mach weiter|weiter so|leg los|kannst du machen|direkt machen)\b/.test(text);
}

function adoptionIntent(message) {
  const text = normalizeText(message);
  if (proposalAdoptionHoldIntent(message)) {
    return false;
  }
  return /\b(uebernehmen|ubernehmen|uebernehme|ubernehme|uebernimm|ubernimm|freigeben|freigabe|passt so|so nehmen|nimm das)\b/.test(text);
}

function proposalIntent(message) {
  const text = normalizeText(message);
  if (questionIntent(message)) {
    return false;
  }
  return /\b(vorschlag|konzept|arbeitsblatt-konzept|formuliere|erstell|erstelle|mach|mache)\b/.test(text)
    && /\b(weiter|direkt|jetzt|daraus)\b/.test(text);
}

function directContextConceptRequestIntent(message) {
  const text = normalizeText(message);
  if (workflowCreationHoldIntent(message) || conceptCreationHoldIntent(message) || adviceQuestionIntent(message)) {
    return false;
  }
  const conceptTerm = "(?:konzept|arbeitsblatt-konzept|arbeitsbogen|arbeitsblatt|aufgabenblatt|aufgabenseite|projektbogen|folgebogen|folge-bogen|folgeblatt|folgearbeitsblatt)";
  const contextSignal = "(?:naechste|naechsten|weiteres|weiteren|weitere|anderen|anderes|folge|folgebogen|folgeblatt|folgearbeitsblatt)";
  const contextObject = "(?:seite|stunde|unterrichtsstunde|blatt|bogen|arbeitsblatt|aufgabenblatt|projekttag|teil|sequenz)";
  const conceptThenContext = new RegExp(`\\b${conceptTerm}\\b.{0,100}\\b${contextSignal}\\b.{0,60}\\b${contextObject}\\b`).test(text);
  const contextThenConcept = new RegExp(`\\b${contextSignal}\\b.{0,60}\\b${contextObject}\\b.{0,100}\\b${conceptTerm}\\b`).test(text);
  if (!conceptThenContext && !contextThenConcept) {
    return false;
  }
  const startsLikeRequest = /^(?:ok|okay|ja|jo|jep|bitte)\b/.test(text);
  const explicitAction = /\b(?:mach|mache|erstell|erstelle|entwickel|formulier|formuliere|schreib|schreibe|leg|lege|anleg|anlegen)\w*\b/.test(text);
  const terseConceptRequest = text.length <= 120
    && !/\b(?:was|wie|warum|wieso|ob|sinnvoll|besser|empfiehlst|wuerdest|wurde|sollte|sollten|koennen wir|kann man|kann ich)\b/.test(text);
  return startsLikeRequest || explicitAction || terseConceptRequest;
}

function newConceptFromContextIntent(message) {
  const text = normalizeText(message);
  if (workflowCreationHoldIntent(message) || conceptCreationHoldIntent(message)) {
    return false;
  }
  const conceptObject = /\b(konzept|arbeitsblatt-konzept|arbeitsbogen|arbeitsblatt|aufgabenblatt|aufgabenseite|projektbogen|folgebogen|folge-bogen|folgeblatt|folgearbeitsblatt)\b/.test(text);
  const creationSignal = /\b(erstell|erstelle|erzeugen|mach|mache|formulier|formuliere|ausformulier|entwickel|bastel|schreib|schreibe|leg|lege|anleg|anlegen|angelegt)\w*\b/.test(text);
  const naturalRequestSignal = /\b(?:will|wollen|moechte|moechten|mochte|mochten|brauche|brauchen|haette|haetten|hatte|hatten|waere|waeren|ware|waren|soll|sollen|koennte|konnte)\b.{0,100}\b(?:konzept|arbeitsblatt-konzept|arbeitsblatt|aufgabenblatt|aufgabenseite|bogen)\b/.test(text)
    || /\b(?:konzept|arbeitsblatt-konzept|arbeitsblatt|aufgabenblatt|aufgabenseite|bogen)\b.{0,100}\b(?:haben|kriegen|bekommen|raus|daraus)\b/.test(text);
  const newSignal = /\b(neu|neue|neues|neuen|weiteres|weiteren|weiterem|anderes|anderen|anderem|abgewandelte|abgewandelten|variante|folge|folgebogen|folgeblatt|folgearbeitsblatt|naechste|naechsten|nächste|nächsten|nochmal|nochmals|erneut|v\d+)\b/.test(text)
    || /\b(auf .*idee aufbau|darauf aufbau|daran anschliess|daran anschlies|im kontext bleib|wie bereits gesagt)\w*\b/.test(text);
  const explicitConceptCreation = /\b(leg|lege|anleg|anlegen|erstell|erstelle|entwickel|formulier|formuliere|schreib|schreibe)\w*\b.{0,120}\b(?:arbeitsblatt-)?konzept\b/.test(text)
    || /\b(?:arbeitsblatt-)?konzept\b.{0,120}\b(anleg|anlegen|erstell|erstelle|entwickel|formulier|formuliere|schreib|schreibe)\w*\b/.test(text);
  if (directContextConceptRequestIntent(message)) {
    return true;
  }
  if (explicitConceptCreation) {
    return true;
  }
  if (!conceptObject || !newSignal) {
    return false;
  }
  return creationSignal
    || naturalRequestSignal
    || /\b(konzept|arbeitsblatt-konzept)\s*v\d+\b/.test(text)
    || /\bv\d+\b.{0,60}\b(konzept|arbeitsblatt-konzept)\b/.test(text);
}

function newConceptWithDesignReferenceIntent(message) {
  const text = normalizeText(message);
  return newConceptFromContextIntent(message)
    && /\b(?:entwurf|kandidat|variante)\s*0*\d+\b/.test(text)
    && /\b(?:design|layout|stil|style|look|optisch|visuell|referenz|vorlage)\b/.test(text)
    && /\b(?:inhalt|arbeitsblatt|folgearbeitsblatt|folgebogen|folgeblatt|anderem|anderer|neuem|neuer)\b/.test(text);
}

function autopilotIntent(message) {
  const text = normalizeText(message);
  return /\b(mach einfach|einfach machen|direkt weiter|frag nicht nochmal|ohne nochmal|du entscheidest|setz du|zieh durch|mach daraus|mach mal|erstell das blatt|erstelle das blatt)\b/.test(text);
}

function skipReferenceIntent(message) {
  const text = normalizeText(message);
  return /\b(ohne referenz|ohne webreferenz|keine referenz|referenz ueberspringen|ohne vorlage|trotzdem weiter|direkt weiter)\b/.test(text);
}

function referenceStrategyQuestionIntent(message) {
  const text = normalizeText(message);
  if (!questionIntent(message)) {
    return false;
  }
  const referenceSignal = /\b(input\s*(?:bild|datei|pdf)|hochgeladen\w*|upload\w*|angehaengt\w*|angehangt\w*|datei|pdf|bild|screenshot|referenz|referenzbild|bildreferenz|layout\s*referenz|layoutreferenz|vorlage)\b/.test(text);
  const strategySignal = /\b(referenz|referenzbild|bildreferenz|layout\s*referenz|layoutreferenz|vorlage|beschreibung|neu\s*rendern|frei\s*rendern|mitgeben|weglassen|ohne\s+referenz|nur\s+beschreibung)\b/.test(text);
  const adviceSignal = /\b(wuerdest\s+du|wuerden\s+wir|sollte\s+(?:ich|man)|sollten\s+wir|soll\s+ich|sollen\s+wir|was\s+(?:waere|ware|ist)\s+besser|was\s+empfiehlst\s+du|empfiehlst\s+du|eher|lieber)\b/.test(text)
    || /\b(haeltst\s+du|haltst\s+du|hast\s+du|nutzt\s+du|nimmst\s+du|verwendest\s+du)\b.{0,100}\b(referenz|referenzbild|bildreferenz|layoutreferenz|vorlage)\b/.test(text)
    || /\b(ist|waere|ware|wird)\b.{0,100}\b(?:als\s+)?(?:referenz|referenzbild|bildreferenz|layoutreferenz|vorlage)\b/.test(text)
    || /\b(?:referenz|referenzbild|vorlage|beschreibung|neu\s*rendern|rendern)\b.{0,80}\boder\b/.test(text)
    || /\boder\b.{0,80}\b(?:referenz|referenzbild|vorlage|beschreibung|neu\s*rendern|rendern)\b/.test(text);
  const directInstruction = /\b(?:bitte|jetzt|direkt)\b.{0,60}\b(?:nimm|nehm|nutze|verwende|gib|mitgeben|uebernimm|ubernimm|setze|setz|erstell|erstelle|generier|generiere|render)\w*\b/.test(text)
    || /\b(?:nimm|nehm|nutze|verwende|gib|uebernimm|ubernimm|setze|setz)\w*\b.{0,60}\b(?:layout\s*referenz|layoutreferenz|referenz|referenzbild|vorlage)\b/.test(text);
  return referenceSignal && strategySignal && adviceSignal && !directInstruction;
}

function adviceQuestionIntent(message) {
  const text = normalizeText(message);
  if (!questionIntent(message)) {
    return false;
  }
  const adviceSignal = /\b(was|wie)\s+wuerdest\s+du\b/.test(text)
    || /\b(was\s+(?:waere|ware|ist)\s+besser|was\s+empfiehlst\s+du|empfiehlst\s+du|deine\s+empfehlung|was\s+meinst\s+du)\b/.test(text)
    || /\b(sollte\s+(?:ich|man)|sollten\s+wir)\b/.test(text)
    || /\b(?:waere|ware|wuerde|wurde)\b.{0,100}\b(?:sinnvoll|besser|gut|praktisch|hilfreich)\b/.test(text)
    || /\b(kannst\s+du|koenntest\s+du)\b.{0,80}\b(feedback|einschaetzung|einschätzung|bewertung|rat|empfehlung)\b/.test(text)
    || referenceStrategyQuestionIntent(message);
  if (!adviceSignal) {
    return false;
  }
  const workflowTopic = /\b(konzept|arbeitsblatt-konzept|entwurf|bild|pdf|datei|input|upload|referenz|referenzbild|bildreferenz|layoutreferenz|vorlage|aufgabe|aufgaben|text|inhalt|layout|design|stil|style|konzeptlayout|bildidee)\b/.test(text);
  if (!workflowTopic) {
    return false;
  }
  const directInstruction = /\b(?:bitte|jetzt|direkt|einfach)\b.{0,80}\b(?:mach|mache|nimm|nehm|nutze|verwende|uebernimm|ubernimm|setze|setz|erstell|erstelle|generier|generiere|render|aendere|andere|korrigier|ueberarbeit|uberarbeit|passe|pass)\w*\b/.test(text)
    || /\b(?:mach|mache|nimm|nehm|nutze|verwende|uebernimm|ubernimm|setze|setz|erstell|erstelle|generier|generiere|render|aendere|andere|korrigier|ueberarbeit|uberarbeit|passe|pass)\w*\b.{0,80}\b(?:bitte|jetzt|direkt|entsprechend|so)\b/.test(text);
  return !directInstruction;
}

function candidateGenerationIntent(message) {
  const text = normalizeText(message);
  return /\b(entwurf|entwurfe|entwurfsreihe|entwurfslauf|entwurfsrunde|mehrseitiger entwurf|mehrseitigen entwurf|kandidat|kandidaten|kandidatenreihe|kandidatenlauf|kandidatenrunde|bildkandidat|bild-kandidat|bild kandidaten|zweiter entwurf|zweiten entwurf|zweiter kandidat|zweiten kandidaten|neuer entwurf|neuen entwurf|neuer kandidat|neuen kandidaten|weitere variante|zweite variante|regenerier|regeneriere|nochmal erzeugen|noch einmal erzeugen|erneut erzeugen)\b/.test(text)
    && /\b(erzeug|erzeuge|erzeugen|erstelle|erstellen|mach|mache|generier|generiere|generieren|render|rendern|variante|zweiter|zweiten|neuer|neuen|regenerier|nochmal|erneut)\b/.test(text);
}

function explicitCandidateGenerationIntent(message) {
  return candidateGenerationIntent(message) && !questionIntent(message);
}

function revisionTerms(message) {
  const text = normalizeText(message);
  return /\b(ueberarbeit|uberarbeit|aktualisier|aender|ander|anpass|korrigier|entfern|streiche|streich|ersetze|revision|revidier|erweiter|ausbau|ausweit|konkretisier|konkreter|genauer|klarer|praezisier|praeziser|schaerf|ausformulier|weiterentwickel)\w*\b/.test(text)
    || /\b(umsetz|umsetzen|umgesetzt)\w*\b/.test(text)
    || /\b(?:pass|passe|passt|passen)\w*\b.{0,50}\ban\b/.test(text)
    || /\b(raus|weg|nicht mehr|ohne|statt)\b/.test(text);
}

function worksheetTextCorrectionIntent(message) {
  const text = normalizeText(message);
  const visibleTextObject = /\b(wort|woerter|worter|ausdruck|ausdruecke|ausdrucke|satz|saetze|satze|textstelle|markier\w*|hervorgehob\w*)\b/.test(text);
  const formattingOrPlacement = /\b(fett|bold|kursiv|unterstrich\w*|hervorheb\w*|markier\w*|direkt im satz|im satz|dahinter|daneben|statt|nicht dahinter|nicht daneben)\b/.test(text);
  const correctionSignal = /\b(soll|sollte|muss|muesste|musste|statt|nicht|falsch|korrigier\w*|aender\w*|ander\w*|ueberarbeit\w*|uberarbeit\w*)\b/.test(text);
  return visibleTextObject && formattingOrPlacement && correctionSignal;
}

function visibleTextRemovalQuestionOnly(message) {
  const text = normalizeText(message);
  const asksAboutPossibility = /\b(kannst du mir sagen|sag mir|weisst du|weiss?t du|was passiert|waere es sinnvoll|ware es sinnvoll|ist es sinnvoll|ob man|ob wir|ob ich|ob das)\b/.test(text);
  const directEdit = /\b(bitte|mal|direkt|jetzt)\b.{0,50}\b(raus\s*nehmen|rausnehmen|weg\s*(?:machen|nehmen)|wegmachen|wegnehmen|loesch\w*|entfern\w*|streich\w*)\b/.test(text);
  return asksAboutPossibility && !directEdit;
}

function visibleTextRemovalOrCorrectionIntent(message) {
  const text = normalizeText(message);
  if (visibleTextRemovalQuestionOnly(message)) {
    return false;
  }
  const removalSignal = /\b(raus\s*nehmen|rausnehmen|weg\s*(?:machen|nehmen)|wegmachen|wegnehmen|loesch\w*|loesche\w*|entfern\w*|streich\w*|streiche\w*)\b/.test(text)
    || /\bnimm\w*\b.{0,30}\b(?:raus|weg)\b/.test(text);
  const correctionSignal = /\b(korrigier\w*|aender\w*|ander\w*|ersetze\w*|tausch\w*|bereinig\w*)\b/.test(text);
  const visibleTextObject = /\b(wort|woerter|worter|ausdruck|ausdruecke|ausdrucke|satz|saetze|satze|textstelle|text|lesetext|inhalt|aufgabe|aufgaben|formulierung|formulierungen|ueberschrift|uberschrift|titel|beschriftung|label|nummerierung|nummer|punkt|doppelpunkt|komma|zeichen|satzzeichen)\b/.test(text)
    || /\bdoppelt\w*\b.{0,40}\b(punkt|doppelpunkt|komma|zeichen|nummer|nummerierung|wort|text|satz)\b/.test(text)
    || /\bdoppel\w*\s+(?:punkt|doppelpunkt|komma|zeichen|nummer|nummerierung)\b/.test(text);
  const visibleFaultContext = /\b(steht da|da steht|steht dort|steht drin|ist drin|in den inhalt|in die inhalte|im inhalt|in den text|im text|in die aufgabe|in aufgabe|reingerutscht|rein gerutscht|gerutscht|gehoert da nicht|gehort da nicht|soll da nicht|ist ein fehler|echter fehler|fehler drin|fehlerhaft)\b/.test(text);
  const deicticRemoval = removalSignal
    && /\b(das|dies|diese|diesen|dieser|den|die|der|stelle|da|hier)\b/.test(text)
    && !/\b(entwurf|bild|layout|farbe|farben|deko|dekoration|illustration|rand|abstand|weissraum|weißraum|schrift)\b/.test(text);
  return (removalSignal || correctionSignal)
    && (visibleTextObject || visibleFaultContext || deicticRemoval);
}

function contentChangeIntent(message) {
  const text = normalizeText(message);
  const contentObject = /\b(konzept|blatt|blaetter|blatter|arbeitsblatt|arbeitsblaetter|arbeitsblatter|seite|seiten|sheet|sheets|aufgabe|aufgaben|lesetext|text|inhalt|fragen|ziel|phrase|phrasen|formulierungen|sprachmittel|sprachliche mittel|zuordnung|zuordnungsaufgabe)\b/.test(text);
  const worksheetStructureChange = /\b(linie|linien|verbinden|zuordnen|zuordnung|zuordnungsaufgabe|zahlen|nummern|buchstaben|a b|1 a|1a|paare|phrasenpaare|phrase|phrasen|formulierungen|sprachmittel|sprachliche mittel)\b/.test(text)
    && /\b(soll|sollen|muss|muessen|mussen|bitte|nicht|ohne|statt|raus|weg|mehr|weniger|mindestens|ca|circa|ungefaehr|genau|pro blatt|je blatt|jeweils|brauchen|braeuchten|brauchten|nutzen)\b/.test(text);
  const preserveOnly = /\b(inhalt|text|aufgabe|aufgaben|konzept)\b.*\b(gleich lassen|nicht aendern|nicht andern|unveraendert|unverandert|beibehalten)\b/.test(text)
    || /\b(gleich lassen|nicht aendern|nicht andern|unveraendert|unverandert|beibehalten)\b.*\b(inhalt|text|aufgabe|aufgaben|konzept)\b/.test(text)
    || /\b(?:gleicher|gleiche|gleiches|identischer|identische|identisches|selber|selbe|selbes)\s+(?:inhalt|text|aufgabe|aufgaben|konzept)\b/.test(text)
    || /\b(?:inhalt|text|aufgabe|aufgaben|konzept)\s+(?:gleich|identisch|unveraendert|unverandert)\b/.test(text);
  const visualFaultOnly = /\b(?:bild|grafik|illustration|entwurf)(?:s)?fehler\b/.test(text)
    && !/\b(?:text|wort|satz|aufgabe|inhalt|beschriftung|label|nummer|punkt|komma)\b/.test(text);
  const hardChange = !visualFaultOnly && /\b(lernziel|unterrichtsziel|zielgruppe|klasse|niveau|schwierigkeit|schwer\w*|leicht\w*|einfacher\w*|vereinfach\w*|zu schwer|zu leicht|weniger text|mehr text|andere aufgaben|andere frage|fachlich|falsch|fehler|korrigiere|ersetze|tausch\w*|streiche|entferne|umformulier\w*|einfach\w* sprache|mehr uebung|mehr ubung|loesung|losung|antwort|umsetz\w*)\b/.test(text)
    || /\b(?:pass|passe|passt|passen)\w*\b.{0,50}\ban\b/.test(text);
  const objectChange = contentObject
    && (revisionTerms(message) || /\b(einfacher|kuerz|kuerzer|laeng|laenger|mehr|weniger|nicht passend|passt nicht|passt so nicht|zu viel|zu wenig|anders|tausch|tausche)\b/.test(text));
  if (preserveOnly && !hardChange && !worksheetStructureChange && !worksheetTextCorrectionIntent(message)) {
    return false;
  }
  return hardChange || worksheetTextCorrectionIntent(message) || visibleTextRemovalOrCorrectionIntent(message) || worksheetStructureChange || (objectChange && !preserveOnly);
}

function conceptRevisionRecommendationIntent(message) {
  const text = normalizeText(message);
  const recommendationSignal = /\b(ich\s+wuerde|ich\s+wurde|ich\s+empfehle|meine\s+empfehlung|mein\s+vorschlag|ich\s+schlage\s+vor|sinnvoll\s+waere|sinnvoll\s+ware|besser\s+waere|besser\s+ware|waere\s+besser|ware\s+besser|ich\s+kann|ich\s+koennte|ich\s+konnte)\b/.test(text);
  if (!recommendationSignal) {
    return false;
  }
  const conceptTopic = /\b(konzept|arbeitsblatt-konzept|blattaufbau|aufgabe|aufgaben|text|lesetext|inhalt|frage|fragen|struktur|lernziel|zielgruppe|niveau|schwierigkeit|bildidee|leitmotiv|szene|schreibaufgabe|material)\b/.test(text);
  if (!conceptTopic) {
    return false;
  }
  const concreteChange = contentChangeIntent(message)
    || conceptDesignRevisionIntent(message)
    || /\b(entschlack|vereinfach|einfacher|kuerz|kuerzer|kürz|reduzier|verdicht|klarer|staerker|stärker|weglass|weglassen|streichen|ersetzen|fokussier|anpass|aender|ander|ueberarbeit|uberarbeit|aufgreif|direkter|niedriger|hoeher|höher|abstrakt|konkreter|praezis|prazis)\w*\b/.test(text);
  if (!concreteChange) {
    return false;
  }
  return !/\b(?:erstmal|zunaechst|nur)\b.{0,80}\b(?:keine?\s+aktion|nichts|nix|nicht\s+umsetzen|noch\s+nicht\s+umsetzen)\b/.test(text);
}

function conceptDesignRevisionIntent(message) {
  const text = normalizeText(message);
  const designObject = /\b(konzeptlayout|arbeitsblattlayout|layout|thema|themenlayout|motto|motiv|stil|style|look|optik|design|gestaltung|visuell|visuelle klammer|rahmen)\b/.test(text);
  const changeSignal = /\b(soll|sollen|mach|mache|aendere|andere|anpassen|angepasst|ueberarbeite|uberarbeite|mit|im|als|bekommen|haben)\b/.test(text);
  return designObject && changeSignal;
}

function visualCandidateFeedbackIntent(message) {
  const text = normalizeText(message);
  return /\b(entwurf|entwurfe|kandidat|kandidaten|bild|bilder|variante|layout|schrift|groessere schrift|groesserer schrift|grosse schrift|weissraum|abstand|abstaende|ruhiger|unruhig|deko|dekoration|illustration|farben|farbe|zweig|beere|beeren|oben|unten|rand)\b/.test(text);
}

function explicitConceptTargetIntent(message) {
  const text = normalizeText(message);
  return /\b(konzept|konzeptlayout|konzeptgestaltung|arbeitsblatt-konzept|arbeitsblattlayout|konzeptschritt|lessonbrief|content mirror)\b/.test(text);
}

function hasCandidateContext(workspace = {}) {
  return Boolean(workspace.latestRun?.candidateCount || workspace.preview?.candidates?.length);
}

function conceptVersionMatchIsNegated(text, index, length) {
  const before = text.slice(Math.max(0, index - 28), index);
  const after = text.slice(index + length, index + length + 80);
  return /\b(?:nicht|kein|keine|keinen|ohne|statt)\b.{0,24}$/.test(before)
    || /\b(?:aber|nur|bitte)\s+(?:nicht|kein|keine|keinen)\s*$/.test(before)
    || /^\s*(?:nicht|kein|keine|keinen)\b/.test(after)
    || /^\s*(?:kannst\s+du|koennen\s+wir|konnen\s+wir|sollst\s+du|sollen\s+wir|bitte)?\s*(?:ja\s+)?(?:nicht|kein|keine|keinen)\b.{0,48}\b(?:benutz|benutzen|verwenden|verwende|nutzen|nutze|nehmen|nimm|uebernehmen|ubernehmen)\w*\b/.test(after)
    || /^\s*(?:kannst\s+du|koennen\s+wir|konnen\s+wir|sollst\s+du|sollen\s+wir|bitte)\b.{0,32}\b(?:nicht|kein|keine|keinen)\b.{0,32}\b(?:benutz|benutzen|verwenden|verwende|nutzen|nutze|nehmen|nimm|uebernehmen|ubernehmen)\w*\b/.test(after);
}

function firstNonNegatedVersionMatch(text, pattern) {
  pattern.lastIndex = 0;
  let match;
  while ((match = pattern.exec(text))) {
    if (!conceptVersionMatchIsNegated(text, match.index, match[0].length)) {
      return Number(match[1]) || null;
    }
  }
  return null;
}

function conceptVersionTarget(message) {
  const text = normalizeText(message);
  const direct = firstNonNegatedVersionMatch(text, /\b(?:konzept|concept)\s*(?:v(?:ersion)?\s*)?0*(\d+)\b/g)
    || firstNonNegatedVersionMatch(text, /\bv(?:ersion)?\s*0*(\d+)\b/g)
    || firstNonNegatedVersionMatch(text, /\b(?:konzept|concept)\s*0*(\d+)\b/g);
  if (direct) {
    return direct;
  }
  const varMatch = text.match(/\b(?:variante|var)\s*0*(\d+)\b/);
  const conceptContext = /\b(konzept|arbeitsblatt-konzept|freigeb|frei|aktuell|auswaehl|auswahl|basis|setz|setzen|nehmen|nimm|verwende|nutze)\w*\b/.test(text);
  return varMatch && conceptContext ? Number(varMatch[1]) || null : null;
}

function conceptVersionActionIntent(message) {
  const text = normalizeText(message);
  const targetVersion = conceptVersionTarget(message);
  if (!targetVersion) {
    return false;
  }
  return candidateGenerationIntent(message)
    || adoptionIntent(message)
    || /\b(nehm|nehmen|nimm|setze|setz|basis|aktuell|freigeb|frei|auswaehl|auswahl|verwende|verwenden|nutze|nutzen|zurueck|zuruck|wechsel|wechsle)\w*\b/.test(text)
    || /\b(basierend|basiert|auf grundlage|grundlage)\b.{0,80}\bv(?:ersion)?\s*0*\d+\b/.test(text)
    || /\b(basierend|basiert|auf grundlage|grundlage)\b.{0,80}\b(?:konzept|variante|var)\s*0*\d+\b/.test(text);
}

function pdfExportIntent(message) {
  const text = normalizeText(message);
  return /\b(pdf|export|exportier\w*|download|herunterladen)\b/.test(text)
    && /\b(erzeug|erzeuge|erstellen|mach|mache|geben|gib|bereit|exportier\w*|download|herunterladen)\b/.test(text);
}

function selectionIntent(message) {
  const text = normalizeText(message);
  return /\b(entwurf|kandidat|candidate)\s*0*(\d+)\b/.test(text)
    && /\b(auswaehl|auswahl|nehmen|nimm|select|waehle)\w*\b/.test(text);
}

function selectionAsVisualReferenceIntent(message) {
  const text = normalizeText(message);
  return selectionIntent(message)
    && /\b(layout\s*referenz|layoutreferenz|visuelle?\s+referenz|bildreferenz|referenzbild|referenz|vorlage|stil|style|look|optisch|visuell|inhalt\s+gleich|inhalt\s+unveraendert|content\s+gleich)\b/.test(text);
}

function worksheetDepositIntent(message) {
  const text = normalizeText(message);
  if (questionIntent(message)) {
    return false;
  }
  if (/\b(?:arbeitsblatt-)?konzept\b/.test(text)
    && /\b(leg|lege|anleg|anlegen|erstell|erstelle|entwickel|formulier|formuliere|schreib|schreibe)\w*\b/.test(text)) {
    return false;
  }
  const depositVerb = /\b(leg|lege|legen|ableg|ablegen|abgelegt|speicher|speichern|archivier|archivieren|ueberfuehr|uberfuhr|ueberfuehren|uberfuehren)\w*\b/.test(text);
  const target = /\b(arbeitsblatt|arbeitsblaetter|arbeitsblatter|ab|bundle|arbeitsblatt-bundle|ablage)\b/.test(text)
    || /\bin arbeitsblaetter\b/.test(text)
    || /\bin arbeitsblatter\b/.test(text);
  const source = /\b(entwurf|entwurfe|kandidat|candidate|variante|seite|seiten|pdf)\b/.test(text);
  const currentSource = /\b(das|dies|diese|diesen|dieser|daraus|aktuellen|aktuelle|fertigen|fertige)\b/.test(text);
  return depositVerb && target && (source || currentSource);
}

function explicitPdfDepositIntent(message) {
  const text = normalizeText(message);
  if (questionIntent(message)) {
    return false;
  }
  const action = /\b(erstell|erstelle|machen|mach|mache|bereitstell|bereitstellen|exportier|exportiere|speicher|speichern|ableg|ablegen)\w*\b/.test(text);
  const target = /\b(pdf|download|export)\b/.test(text);
  const source = /\b(entwurf|entwurfe|kandidat|candidate|variante|seite|seiten|daraus|dies|diesen|diese|aktuellen|aktuelle)\b/.test(text);
  return action && target && source;
}

function explicitWorksheetDepositIntent(message) {
  return worksheetDepositIntent(message) || explicitPdfDepositIntent(message);
}

module.exports = {
  adoptionIntent,
  adviceQuestionIntent,
  affirmativeIntent,
  autopilotIntent,
  brainstormingIntent,
  candidateCreationHoldIntent,
  candidateGenerationIntent,
  conceptCreationHoldIntent,
  conceptDesignRevisionIntent,
  conceptRevisionRecommendationIntent,
  conceptVersionActionIntent,
  conceptVersionTarget,
  conditionalNoOpCheckIntent,
  contentChangeIntent,
  directContextConceptRequestIntent,
  explicitCandidateGenerationIntent,
  explicitConceptTargetIntent,
  explicitPdfDepositIntent,
  explicitWorksheetDepositIntent,
  hasCandidateContext,
  normalizeText,
  newConceptFromContextIntent,
  newConceptWithDesignReferenceIntent,
  pdfExportIntent,
  proposalAdoptionHoldIntent,
  proposalIntent,
  questionIntent,
  referenceStrategyQuestionIntent,
  revisionTerms,
  selectionAsVisualReferenceIntent,
  selectionIntent,
  skipReferenceIntent,
  visualCandidateFeedbackIntent,
  visibleTextRemovalOrCorrectionIntent,
  workflowActionStopIntent,
  workflowCreationHoldIntent,
  worksheetDepositIntent,
  worksheetTextCorrectionIntent
};
