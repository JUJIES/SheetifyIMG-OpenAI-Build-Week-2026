"use strict";

const fs = require("node:fs/promises");
const path = require("node:path");
const {
  ARTIFACT_STATUSES,
  ARTIFACT_TYPES,
  EVENT_TYPES,
  PROJECT_TYPES
} = require("../contracts");
const { getApprovalState } = require("../approvalManager");
const {
  findArtifact,
  listArtifacts,
  readArtifactIndex
} = require("../artifactManager");
const { readEvents } = require("../eventLog");
const { getLibraryItem } = require("../libraryManager");
const { openProject } = require("../projectManager");
const { getAiRuntimeStatus, getImageRuntimeStatus } = require("../aiConfig");
const { inputReadiness } = require("../inputReadiness");
const { readProposalState } = require("../aiProposalManager");
const { hasMeaningfulContent } = require("../contentMirrorManager");
const { normalizeConceptReference } = require("../conceptReference");
const { inferReferencePolicy } = require("../referencePolicy");
const { readTeachingContext } = require("../teachingContextManager");
const {
  contentReadinessForGeneration,
  contentReadinessMessage
} = require("../contentReadiness");
const { pageCountFromContent } = require("../pagePlanManager");
const { workflowActionSummaries } = require("../workflowPolicy");

const DEFAULT_REPO_ROOT = path.resolve(__dirname, "..", "..");
const DEFAULT_PROJECTS_DIR = path.join(DEFAULT_REPO_ROOT, "projects");

async function pathExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function readJsonIfExists(filePath) {
  if (!(await pathExists(filePath))) {
    return null;
  }
  return JSON.parse(await fs.readFile(filePath, "utf8"));
}

async function listDirs(dirPath) {
  if (!(await pathExists(dirPath))) {
    return [];
  }
  const entries = await fs.readdir(dirPath, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(dirPath, entry.name))
    .sort();
}

function toPosix(value) {
  return String(value).split(path.sep).join("/");
}

function rel(from, to) {
  return toPosix(path.relative(from, to));
}

function commandState(id, label, enabled, reason = null, meta = {}) {
  return {
    id,
    label,
    enabled: Boolean(enabled),
    reason: enabled ? null : reason,
    ...meta
  };
}

function latestArtifact(index, type, status = null) {
  return listArtifacts(index, { type, ...(status ? { status } : {}) })
    .sort((left, right) => (Number(right.version) || 0) - (Number(left.version) || 0))[0] || null;
}

function currentArtifactFromManifest(index, manifest, fieldName, type) {
  const artifactId = manifest.currentArtifacts?.[fieldName] || null;
  const artifact = artifactId ? findArtifact(index, artifactId) : null;
  return artifact || latestArtifact(index, type);
}

function contentMirrorIdFromConcept(concept = {}) {
  return concept.contentMirrorId || concept.conceptId || null;
}

function contentMirrorRefMatchesCurrent(contentMirrorId, currentContentMirrorId) {
  return !currentContentMirrorId || !contentMirrorId || contentMirrorId === currentContentMirrorId;
}

async function latestRunState(projectDir, options = {}) {
  const currentContentMirrorId = options.currentContentMirrorId || null;
  const runDirs = await listDirs(path.join(projectDir, "runs"));
  if (runDirs.length === 0) {
    return null;
  }

  const runDir = runDirs[runDirs.length - 1];
  const manifest = await readJsonIfExists(path.join(runDir, "run-manifest.json"));
  const selection = await readJsonIfExists(path.join(runDir, "selected", "selection.json"));
  const candidates = Array.isArray(manifest?.candidates) ? manifest.candidates : [];
  const currentCandidates = candidates.filter((candidate) => {
    return contentMirrorRefMatchesCurrent(candidateContentMirrorId({ manifest }, candidate), currentContentMirrorId);
  });
  const rawSelectedCandidateId = selection?.selectedCandidate || manifest?.selectedCandidate || null;
  const rawSelectedCandidateDetail = rawSelectedCandidateId
    ? candidates.find((candidate) => candidate.id === rawSelectedCandidateId) || null
    : null;
  const concept = normalizeConceptReference(
    selection?.concept || rawSelectedCandidateDetail?.concept || manifest?.selectedCandidateConcept || manifest?.concept || {},
    manifest?.sourceArtifacts || {}
  );
  const rawSelectedPageCount = Array.isArray(selection?.pages) ? selection.pages.length : 0;
  const selectionContentMirrorId = contentMirrorIdFromConcept(concept);
  const selectionIsCurrent = rawSelectedPageCount === 0
    || contentMirrorRefMatchesCurrent(selectionContentMirrorId, currentContentMirrorId);
  const selectedCandidateId = selectionIsCurrent ? rawSelectedCandidateId : null;
  const selectedCandidateDetail = selectionIsCurrent ? rawSelectedCandidateDetail : null;
  return {
    runId: manifest?.runId || path.basename(runDir),
    path: rel(projectDir, runDir),
    manifest,
    selection,
    concept,
    candidateCount: currentCandidates.length,
    rawCandidateCount: candidates.length,
    selectedCandidate: selectedCandidateId,
    selectedCandidateId,
    rawSelectedCandidate: rawSelectedCandidateId,
    rawSelectedCandidateId,
    selectedCandidateDetail,
    selectedCandidateConcept: selectedCandidateId ? concept : null,
    selectedPageCount: selectionIsCurrent ? rawSelectedPageCount : 0,
    rawSelectedPageCount,
    selectionIsCurrent,
    hasOutdatedSelection: rawSelectedPageCount > 0 && !selectionIsCurrent,
    selectionContentMirrorId
  };
}

function candidateContentMirrorId(runState, candidate = {}) {
  return candidate.sourceArtifacts?.contentMirrorId
    || runState?.manifest?.sourceArtifacts?.contentMirrorId
    || null;
}

function firstSelectableCandidate(runState, currentContentMirrorId = null) {
  for (const candidate of runState?.manifest?.candidates || []) {
    const candidateContentId = candidateContentMirrorId(runState, candidate);
    if (currentContentMirrorId && candidateContentId && candidateContentId !== currentContentMirrorId) {
      continue;
    }
    if ((candidate.pages || []).length > 0) {
      return candidate.id;
    }
  }
  return null;
}

function imageSpecMatchesCurrentContent(imageSpec = null, currentContent = null) {
  if (!imageSpec) {
    return false;
  }
  const sourceContentId = imageSpec.source?.currentContentMirrorId || null;
  if (!sourceContentId || !currentContent?.id) {
    return true;
  }
  return sourceContentId === currentContent.id;
}

function usedReferencePathsForImageSpec(runState = null, imageSpecProposalId = null) {
  const used = new Set();
  for (const candidate of runState?.manifest?.candidates || []) {
    if (imageSpecProposalId && candidate.generation?.imageSpecProposalId !== imageSpecProposalId) {
      continue;
    }
    for (const reference of candidate.generation?.referenceImages || []) {
      if (reference.path) {
        used.add(reference.path);
      }
    }
  }
  return used;
}

function unusedOneShotImageSpecReferences(imageSpec = null, runState = null) {
  const references = Array.isArray(imageSpec?.data?.referenceImages) ? imageSpec.data.referenceImages : [];
  if (!references.length) {
    return [];
  }
  const used = usedReferencePathsForImageSpec(runState, imageSpec.proposalId);
  return references
    .filter((reference) => {
      if (!reference.path) {
        return false;
      }
      const scope = String(reference.scope || "").toLowerCase();
      const role = String(reference.role || "").toLowerCase();
      const persistent = ["all_candidates", "every_candidate", "persistent"].includes(scope)
        || role === "layout_reference"
        || role === "style_reference";
      return persistent || !used.has(reference.path);
    })
    .map((reference) => ({
      id: reference.id || null,
      role: reference.role || "style_reference",
      path: reference.path,
      purpose: reference.purpose || null,
      scope: reference.scope || (String(reference.role || "").toLowerCase() === "layout_reference" ? "all_candidates" : "next_candidate"),
      source: reference.source || null
    }));
}

function latestImageSourceFile(source = {}) {
  const files = Array.isArray(source?.manifest?.files) ? source.manifest.files : [];
  return files
    .filter((file) => String(file.mimeType || "").startsWith("image/") && file.path)
    .at(-1) || null;
}

function referencePolicyNeedsAction(policy = null) {
  return Boolean(policy && policy.level && policy.level !== "none" && policy.isSatisfied !== true);
}

function referencePolicyUsesAppTemplate(policy = null) {
  return Boolean(policy && (
    policy.preferredSource === "app_template"
    || policy.preferredSource === "app_template_or_user_upload"
    || policy.category === "coordinate_template"
    || policy.category === "code_asset"
  ));
}

function referencePolicyNeedsUpload(policy = null) {
  return Boolean(policy && policy.preferredSource === "user_upload_or_reference_search");
}

function referencePolicySupportsWebSearch(policy = null) {
  return Boolean(policy && (
    policy.preferredSource === "user_upload_or_reference_search"
    || policy.preferredSource === "web_reference_search"
    || ["factual_map", "specialized_subject", "local_visual_reference"].includes(policy.category)
  ));
}

function imageCandidateDefaultPayload({ activeImageSpec, runState, imageRuntime, currentContent, pageCount }) {
  const payload = {
    imageQualityPreset: imageRuntime.imageQualityPreset
  };
  if (Number(pageCount) > 1) {
    payload.pageCount = Number(pageCount);
  }
  if (!imageSpecMatchesCurrentContent(activeImageSpec, currentContent)) {
    return payload;
  }
  if (activeImageSpec?.proposalId) {
    payload.imageSpecProposalId = activeImageSpec.proposalId;
  }
  const referenceImages = unusedOneShotImageSpecReferences(activeImageSpec, runState);
  if (referenceImages.length) {
    payload.referenceImages = referenceImages;
  }
  return payload;
}

function plannedPageCountForCandidates(activeImageSpec = null, currentContentData = {}, currentBriefData = {}) {
  return Number(activeImageSpec?.data?.pageCount || activeImageSpec?.pageCount || 0)
    || pageCountFromContent(currentContentData || {}, activeImageSpec?.data || activeImageSpec || null, currentBriefData || {});
}

function candidateGenerationLabel({ hasCandidate, pageCount }) {
  if (pageCount > 1) {
    return hasCandidate ? "Weitere Kandidatenreihe erzeugen" : "Kandidatenreihe erzeugen";
  }
  return hasCandidate ? "Weitere Variante erzeugen" : "Kandidat erzeugen";
}

function buildWorksheetSteps({ project, currentBrief, currentContent, approvalState, runState, item, inputState }) {
  const preview = item.preview || {};
  const hasInput = Boolean(inputState?.ready);
  const canUsePreviewSelection = !runState || !runState.hasOutdatedSelection;
  const hasCandidates = Boolean(runState?.candidateCount || (canUsePreviewSelection && preview.previewMeta?.renderedCandidateCount));
  const candidateState = hasCandidates ? "available" : "missing";

  return [
    {
      id: "input",
      label: "Input",
      state: hasInput ? "available" : "missing",
      complete: hasInput
    },
    {
      id: "concept",
      label: "Arbeitsblatt-Konzept",
      state: currentContent ? currentContent.status : "missing",
      complete: approvalState.canGenerate
    },
    {
      id: "candidates",
      label: "Kandidaten",
      state: candidateState,
      complete: hasCandidates
    }
  ];
}

async function buildSeriesSteps(projectDir) {
  const seriesManifest = await readJsonIfExists(path.join(projectDir, "series-manifest.json"));
  const worksheetCount = Array.isArray(seriesManifest?.worksheets) ? seriesManifest.worksheets.length : 0;
  return [
    {
      id: "input",
      label: "Input",
      state: worksheetCount > 0 ? "has_worksheets" : "empty",
      complete: worksheetCount > 0
    },
    {
      id: "concept",
      label: "Arbeitsblatt-Konzept",
      state: worksheetCount > 0 ? "has_worksheets" : "empty",
      complete: worksheetCount > 0
    },
    {
      id: "candidates",
      label: "Kandidaten",
      state: worksheetCount > 0 ? "available" : "missing",
      complete: worksheetCount > 0
    }
  ];
}

function buildWorksheetCommands({
  project,
  currentBrief,
  currentContent,
  currentBriefData = {},
  currentContentData = {},
  approvalState,
  runState,
  proposals,
  imageRuntime,
  events = [],
  inputState,
  source,
  teachingContext
}) {
  if (project.isLegacy) {
    return [
      commandState("copy_context", "Inhalt kopieren", true),
      commandState(
        "legacy_read_only",
        "Legacy-Projekt migrieren",
        false,
        "Dieses Projekt ist ein importierter POC-Stand. Produktionsbefehle sind erst nach einer sauberen Migration aktiv."
      )
    ];
  }

  const selectableCandidateId = firstSelectableCandidate(runState, currentContent?.id || null);
  const hasSelection = Boolean(runState?.selectedPageCount);
  const latestLessonBriefProposal = proposals?.latestLessonBrief || null;
  const latestContentMirrorProposal = proposals?.latestContentMirror || null;
  const latestContentWarningsProposal = proposals?.latestContentWarnings || null;
  const latestImageSpecProposal = proposals?.latestImageSpec || null;
  const activeImageSpec = proposals?.activeImageSpec || null;
  const plannedCandidatePageCount = plannedPageCountForCandidates(activeImageSpec, currentContentData, currentBriefData);
  const referenceImageSpec = latestImageSpecProposal || activeImageSpec || null;
  const hasBrief = Boolean(currentBrief);
  const hasContent = Boolean(currentContent);
  const contentReadiness = contentReadinessForGeneration(currentContentData || {}, { events, brief: currentBriefData || {} });
  const contentIsMeaningful = hasMeaningfulContent(currentContentData || {});
  const contentIsReadyForCandidates = contentIsMeaningful && contentReadiness.ready;
  const contentReadinessReason = contentReadinessMessage(contentReadiness);
  const proposalContentData = latestContentMirrorProposal?.data || {};
  const proposalContentReadiness = contentReadinessForGeneration(proposalContentData, { events, brief: currentBriefData || {} });
  const proposalContentIsReadyForCandidates = Boolean(latestContentMirrorProposal)
    && hasMeaningfulContent(proposalContentData)
    && proposalContentReadiness.ready;
  const imageProviderOptions = imageRuntime.imageProviders || [];
  const imageGenerationConfigured = imageRuntime.canUseOpenAi || imageRuntime.canUseCodex;
  const defaultImageProvider = imageRuntime.canUseCodex
    ? "codex_cli"
    : imageRuntime.canUseOpenAi
      ? "openai"
      : imageRuntime.mode;
  const proposalContentReadinessReason = contentReadinessMessage(proposalContentReadiness);
  const inputReady = Boolean(inputState?.ready);
  const inputMissingReason = inputState?.reason || "Es fehlt noch ein verwertbarer Arbeitsblatt-Auftrag.";
  const teachingContextReady = Boolean(teachingContext?.readiness?.conceptAllowed);
  const teachingContextForcedWithAssumptions = Boolean(teachingContext?.readiness?.forcedWithAssumptions);
  const teachingContextReason = teachingContext?.nextQuestion
    ? `Unterrichtsrahmen noch offen: ${teachingContext.nextQuestion}`
    : "Unterrichtsrahmen ist noch nicht klar genug für ein gutes Arbeitsblatt-Konzept.";
  const conceptInputReady = inputReady && teachingContextReady;
  const conceptInputReason = inputReady ? teachingContextReason : inputMissingReason;
  const conceptAssumptionWarning = teachingContextForcedWithAssumptions
    ? {
      requiresConfirmation: true,
      confirmationKind: "concept_with_assumptions",
      confirmationTitle: "Konzept mit Annahmen erstellen?",
      confirmationMessage: "Die KI weiß noch wenig über das Ziel der Stunde oder wichtige Rahmenbedingungen. Dadurch kann das Arbeitsblatt weniger passend werden. Du kannst trotzdem fortfahren; offene Punkte werden als Annahmen behandelt.",
      confirmationAcceptLabel: "Trotzdem Konzept erstellen"
    }
    : {};
  const preliminaryReferencePolicy = inferReferencePolicy({
    project,
    lessonBrief: currentBriefData || {},
    contentMirror: currentContentData || {}
  });
  const imageSpecReferencePolicy = referenceImageSpec?.data?.referencePolicy || null;
  const referenceActionPolicy = imageSpecReferencePolicy || null;
  const latestSourceImage = latestImageSourceFile(source);
  const referenceActionNeedsAppTemplate = referencePolicyUsesAppTemplate(referenceActionPolicy);
  const referenceActionNeedsUpload = referencePolicyNeedsUpload(referenceActionPolicy);
  const referenceActionSupportsWebSearch = referencePolicySupportsWebSearch(referenceActionPolicy);
  const referenceActionEnabled = Boolean(referenceImageSpec)
    && referencePolicyNeedsAction(referenceActionPolicy)
    && (referenceActionNeedsAppTemplate || Boolean(latestSourceImage));
  const webReferenceActionEnabled = Boolean(referenceImageSpec)
    && referencePolicyNeedsAction(referenceActionPolicy)
    && referenceActionSupportsWebSearch;
  const referenceActionReason = !referenceImageSpec
    ? "Es gibt noch keine Kandidatenvorbereitung."
    : !referencePolicyNeedsAction(referenceActionPolicy)
      ? "Referenzentscheidung ist schon erledigt."
      : referenceActionNeedsUpload
        ? "Bitte zuerst ein passendes Referenzbild als Input hochladen."
        : "Für diese Visualisierung gibt es keine automatisch erzeugbare Vorlage.";

  return [
    commandState(
      "generate_lessonbrief_proposal",
      "Konzept vorschlagen",
      conceptInputReady,
      conceptInputReason,
      {
        defaultPayload: { completeConcept: true },
        ...conceptAssumptionWarning
      }
    ),
    commandState(
      "adopt_lessonbrief_proposal",
      "Konzept übernehmen",
      Boolean(latestLessonBriefProposal),
      "Es gibt keinen offenen Konzept-Vorschlag.",
      latestLessonBriefProposal ? { defaultPayload: { proposalId: latestLessonBriefProposal.proposalId } } : {}
    ),
    commandState(
      "create_brief_draft",
      "Konzept direkt anlegen",
      conceptInputReady,
      conceptInputReason
    ),
    commandState(
      "approve_current_brief",
      "Konzeptentwurf freigeben",
      currentBrief?.status === ARTIFACT_STATUSES.DRAFT,
      "Der aktuelle Konzeptentwurf ist nicht im Bearbeitungsstatus."
    ),
    commandState(
      "generate_content_mirror_proposal",
      hasContent ? "Konzept überarbeiten" : "Konzept ausformulieren",
      hasBrief,
      "Es gibt noch kein Arbeitsblatt-Konzept als Planungsgrundlage."
    ),
    commandState(
      "adopt_content_mirror_proposal",
      hasContent ? "Konzept aktualisieren" : "Konzept übernehmen",
      Boolean(latestContentMirrorProposal),
      "Es gibt keinen offenen Aufgaben- und Materialvorschlag.",
      latestContentMirrorProposal ? { defaultPayload: { proposalId: latestContentMirrorProposal.proposalId, approve: true } } : {}
    ),
    commandState(
      "generate_candidate_from_content_proposal",
      "Konzept übernehmen und Kandidat erzeugen",
      false,
      latestContentMirrorProposal
        ? "Bitte zuerst das Konzept übernehmen oder aktualisieren. Danach wird Kandidat erzeugen auf dem freigegebenen Stand angeboten."
        : "Es gibt kein offenes Arbeitsblatt-Konzept.",
      {
        requiresConfirmation: true,
        confirmationKind: "image_generation_provider",
        confirmationMessage: `Das übernimmt das angezeigte Arbeitsblatt-Konzept, gibt es frei und erzeugt einen ${imageRuntime.imageQualityLabel || "Standard"}-Kandidaten. Der Bildanbieter ist in den Einstellungen festgelegt.`,
        imageProviders: imageProviderOptions,
        defaultPayload: latestContentMirrorProposal ? {
          proposalId: latestContentMirrorProposal.proposalId,
          approve: true,
          imageProvider: defaultImageProvider,
          imageQualityPreset: imageRuntime.imageQualityPreset
        } : {}
      }
    ),
    commandState(
      "create_content_draft",
      "Konzept direkt ausformulieren",
      hasBrief,
      "Es gibt noch kein Arbeitsblatt-Konzept als Planungsgrundlage."
    ),
    commandState(
      "approve_current_content",
      "Konzept freigeben",
      currentContent?.status === ARTIFACT_STATUSES.DRAFT && contentIsReadyForCandidates,
      currentContent?.status !== ARTIFACT_STATUSES.DRAFT
        ? "Das aktuelle Arbeitsblatt-Konzept ist nicht im Bearbeitungsstatus."
        : contentIsMeaningful
          ? contentReadinessReason
          : "Das Arbeitsblatt-Konzept braucht Aufgaben, Text oder Bildmaterial."
    ),
    commandState(
      "generate_content_warnings_proposal",
      "Prüfung vorschlagen",
      hasContent && contentIsMeaningful,
      "Es gibt noch kein Arbeitsblatt-Konzept für die Prüfung."
    ),
    commandState(
      "adopt_content_warnings_proposal",
      "Prüfhinweise übernehmen",
      Boolean(latestContentWarningsProposal),
      "Es gibt keinen offenen Prüfvorschlag.",
      latestContentWarningsProposal ? { defaultPayload: { proposalId: latestContentWarningsProposal.proposalId } } : {}
    ),
    commandState(
      "prepare_image_spec",
      preliminaryReferencePolicy.level !== "none" && !referenceImageSpec
        ? "Visualisierung prüfen"
        : "Kandidaten vorbereiten",
      approvalState.canGenerate && contentIsReadyForCandidates,
      approvalState.canGenerate
        ? contentReadinessReason
        : approvalState.reason || "Arbeitsblatt-Konzept ist noch nicht freigegeben.",
      {
        defaultPayload: preliminaryReferencePolicy.level !== "none"
          ? {
            message: "Prüfe die geplante Visualisierung und ob eine Referenz oder Vorlage sinnvoll ist.",
            uiEvent: "reference_preflight"
          }
          : {},
        referencePreflight: preliminaryReferencePolicy.level !== "none" && !referenceImageSpec,
        referencePolicy: preliminaryReferencePolicy
      }
    ),
    commandState(
      "adopt_image_spec",
      "Kandidatenvorbereitung übernehmen",
      Boolean(latestImageSpecProposal),
      "Es gibt keine offene Kandidatenvorbereitung.",
      latestImageSpecProposal ? { defaultPayload: { proposalId: latestImageSpecProposal.proposalId } } : {}
    ),
    commandState(
      "prepare_reference_asset",
      referenceActionNeedsUpload ? "Input als Referenz nutzen" : "Vorlage vorbereiten",
      referenceActionEnabled,
      referenceActionReason,
      {
        defaultPayload: referenceImageSpec ? {
          proposalId: referenceImageSpec.proposalId,
          ...(latestSourceImage ? { sourcePath: latestSourceImage.path } : {})
        } : {},
        referencePolicy: referenceActionPolicy
      }
    ),
    commandState(
      "prepare_web_reference_asset",
      "Webreferenz suchen",
      webReferenceActionEnabled,
      !referenceImageSpec
        ? "Es gibt noch keine Kandidatenvorbereitung."
        : !referencePolicyNeedsAction(referenceActionPolicy)
          ? "Referenzentscheidung ist schon erledigt."
          : "Für diese Visualisierung ist keine Webreferenz vorgesehen.",
      {
        defaultPayload: referenceImageSpec ? {
          proposalId: referenceImageSpec.proposalId,
          ...(referenceActionPolicy?.suggestedSearchQuery ? { query: referenceActionPolicy.suggestedSearchQuery } : {})
        } : {},
        referencePolicy: referenceActionPolicy
      }
    ),
    commandState(
      "create_run",
      "Kandidatenrunde anlegen",
      approvalState.canGenerate && contentIsReadyForCandidates,
      approvalState.canGenerate
        ? contentReadinessReason
        : approvalState.reason || "Arbeitsblatt-Konzept ist nicht freigegeben."
    ),
    commandState(
      "generate_image_candidate",
      candidateGenerationLabel({ hasCandidate: Boolean(selectableCandidateId), pageCount: plannedCandidatePageCount }),
      approvalState.canGenerate && contentIsReadyForCandidates && imageGenerationConfigured,
      !approvalState.canGenerate
        ? approvalState.reason || "Arbeitsblatt-Konzept ist nicht freigegeben."
        : !contentIsReadyForCandidates
          ? contentReadinessReason
          : imageRuntime.fallbackReason || "Bildgenerierung ist nicht konfiguriert.",
      {
        requiresConfirmation: true,
        confirmationKind: "image_generation_provider",
        confirmationMessage: selectableCandidateId
          ? plannedCandidatePageCount > 1
            ? `Dieser Schritt erzeugt eine weitere ${imageRuntime.imageQualityLabel || "Standard"}-Kandidatenreihe mit ${plannedCandidatePageCount} Seiten. Der Bildanbieter ist in den Einstellungen festgelegt.`
            : `Dieser Schritt erzeugt eine weitere ${imageRuntime.imageQualityLabel || "Standard"}-Variante. Der Bildanbieter ist in den Einstellungen festgelegt.`
          : plannedCandidatePageCount > 1
            ? `Dieser Schritt erzeugt eine ${imageRuntime.imageQualityLabel || "Standard"}-Kandidatenreihe mit ${plannedCandidatePageCount} Seiten. Der Bildanbieter ist in den Einstellungen festgelegt.`
            : `Dieser Schritt erzeugt einen ${imageRuntime.imageQualityLabel || "Standard"}-Kandidaten. Der Bildanbieter ist in den Einstellungen festgelegt.`,
        imageProviders: imageProviderOptions,
        defaultPayload: {
          ...imageCandidateDefaultPayload({
            activeImageSpec,
            runState,
            imageRuntime,
            currentContent,
            pageCount: plannedCandidatePageCount
          }),
          imageProvider: defaultImageProvider
        }
      }
    ),
    commandState(
      "select_candidate",
      plannedCandidatePageCount > 1 ? "Alle Seiten übernehmen" : "Kandidat auswählen",
      Boolean(selectableCandidateId),
      "Es gibt noch keinen Kandidaten mit Seiten.",
      {
        defaultCandidateId: selectableCandidateId,
        defaultPayload: selectableCandidateId ? {
          runId: runState?.runId || null,
          candidateId: selectableCandidateId
        } : {}
      }
    ),
    commandState(
      "prepare_export",
      "PDF erstellen",
      hasSelection && approvalState.canGenerate,
      hasSelection
        ? approvalState.reason || "Arbeitsblatt-Konzept ist nicht freigegeben."
        : "Es gibt noch keine Auswahl."
    ),
    commandState("copy_context", "Inhalt kopieren", true)
  ];
}

async function buildSeriesCommands(projectDir) {
  const seriesManifest = await readJsonIfExists(path.join(projectDir, "series-manifest.json"));
  const worksheets = Array.isArray(seriesManifest?.worksheets) ? seriesManifest.worksheets : [];
  return [
    commandState("copy_context", "Reiheninhalt kopieren", true),
    commandState(
      "prepare_series_export",
      "Reihen-PDF erstellen",
      worksheets.length > 0,
      "Die Reihe enthält noch keine Arbeitsblätter.",
      { worksheetCount: worksheets.length }
    )
  ];
}

function workspaceMessagesFromEvents(events) {
  return events
    .map((event) => {
      if (event.type === EVENT_TYPES.USER_MESSAGE || event.type === EVENT_TYPES.ASSISTANT_MESSAGE) {
        return {
          id: event.id,
          role: event.type === EVENT_TYPES.USER_MESSAGE ? "user" : "assistant",
          createdAt: event.createdAt,
          content: event.payload?.message || event.payload?.content || "",
          mode: event.payload?.mode || "openai",
          attachments: Array.isArray(event.payload?.attachments) ? event.payload.attachments : [],
          proposal: event.payload?.proposal || null,
          suggestedActions: event.payload?.suggestedActions || []
        };
      }
      if (event.type === EVENT_TYPES.CANDIDATE_CREATED) {
        const candidateId = event.payload?.candidateId || "Kandidat";
        const fallbackMessage = `${candidateId} ist fertig gerendert. Du kannst das PDF herunterladen, eine weitere Variante erzeugen oder das Konzept im Chat nachschärfen.`;
        return {
          id: event.id,
          role: "assistant",
          createdAt: event.createdAt,
          content: event.payload?.message || fallbackMessage,
          mode: "system",
          productionCard: {
            kind: "candidate",
            runId: event.runId || null,
            candidateId
          },
          suggestedActions: []
        };
      }
      if (event.type === EVENT_TYPES.ARTIFACT_CREATED && (
        event.payload?.type === ARTIFACT_TYPES.LESSON_BRIEF
        || event.payload?.type === ARTIFACT_TYPES.CONTENT_MIRROR
      )) {
        return null;
      }
      return null;
    })
    .filter(Boolean);
}

async function worksheetWorkspace({ projectId, projectDir, projectsDir, repoRoot, project }) {
  const item = await getLibraryItem(`project:${projectId}`, { repoRoot, projectsDir });
  const index = await readArtifactIndex(projectDir);
  const approvalState = await getApprovalState(projectDir);
  const currentBrief = currentArtifactFromManifest(index, project.manifest || {}, "lessonbriefId", ARTIFACT_TYPES.LESSON_BRIEF);
  const currentContent = currentArtifactFromManifest(index, project.manifest || {}, "contentMirrorId", ARTIFACT_TYPES.CONTENT_MIRROR);
  const currentBriefData = currentBrief ? await readJsonIfExists(path.join(projectDir, currentBrief.path)) : {};
  const currentContentData = currentContent ? await readJsonIfExists(path.join(projectDir, currentContent.path)) : {};
  const runState = await latestRunState(projectDir, {
    currentContentMirrorId: currentContent?.id || null
  });
  const events = await readEvents(projectDir);
  const chatRuntime = getAiRuntimeStatus();
  const imageRuntime = getImageRuntimeStatus();
  const proposals = await readProposalState(projectDir);
  const teachingContext = await readTeachingContext(projectDir, {
    project,
    events,
    source: item.documents?.source || {},
    brief: currentBriefData || {},
    content: currentContentData || {}
  });
  const inputState = inputReadiness({
    source: item.documents?.source || {},
    events
  });

  const workspace = {
    schemaVersion: 1,
    mode: "production_workspace",
    project: {
      projectId,
      projectType: project.projectType,
      title: project.title,
      subject: project.subject,
      topic: project.topic,
      targetGroup: project.targetGroup,
      sourceType: project.sourceType,
      isLegacy: project.isLegacy,
      status: project.status
    },
    workspaceEntry: project.workspaceEntry,
    documents: item.documents,
    teachingContext,
    inputReadiness: inputState,
    preview: item.preview,
    artifacts: {
      currentBrief,
      currentContent,
      approvedContent: approvalState.approvedContentMirror,
      counts: Object.fromEntries(Object.values(ARTIFACT_TYPES).map((type) => [
        type,
        listArtifacts(index, { type }).length
      ]))
    },
    approval: approvalState,
    image: imageRuntime,
    latestRun: runState,
    steps: buildWorksheetSteps({ project, currentBrief, currentContent, approvalState, runState, item, inputState }),
    proposals,
    commands: buildWorksheetCommands({
      project,
      currentBrief,
      currentContent,
      currentBriefData,
      currentContentData,
      approvalState,
      runState,
      proposals,
      imageRuntime,
      events,
      inputState,
      source: item.documents?.source || {},
      teachingContext
    }),
    chat: {
      ...chatRuntime,
      messages: workspaceMessagesFromEvents(events)
    },
    paths: {
      projectDir: rel(repoRoot, projectDir)
    }
  };
  workspace.workflowActions = workflowActionSummaries(workspace);
  return workspace;
}

async function seriesWorkspace({ projectId, projectDir, projectsDir, repoRoot, project }) {
  const item = await getLibraryItem(`project:${projectId}`, { repoRoot, projectsDir });
  const index = await readArtifactIndex(projectDir);
  const events = await readEvents(projectDir);
  const seriesManifest = await readJsonIfExists(path.join(projectDir, "series-manifest.json"));
  const chatRuntime = getAiRuntimeStatus();
  const imageRuntime = getImageRuntimeStatus();
  const workspace = {
    schemaVersion: 1,
    mode: "production_workspace",
    project: {
      projectId,
      projectType: project.projectType,
      title: project.title,
      subject: project.subject,
      topic: project.topic,
      sourceType: project.sourceType,
      isLegacy: project.isLegacy,
      status: project.status
    },
    workspaceEntry: project.workspaceEntry,
    documents: item.documents,
    preview: item.preview,
    image: imageRuntime,
    series: seriesManifest || null,
    artifacts: {
      counts: Object.fromEntries(Object.values(ARTIFACT_TYPES).map((type) => [
        type,
        listArtifacts(index, { type }).length
      ]))
    },
    steps: await buildSeriesSteps(projectDir),
    commands: await buildSeriesCommands(projectDir),
    chat: {
      ...chatRuntime,
      messages: workspaceMessagesFromEvents(events)
    },
    paths: {
      projectDir: rel(repoRoot, projectDir)
    }
  };
  workspace.workflowActions = workflowActionSummaries(workspace);
  return workspace;
}

async function buildWorkspace(projectId, options = {}) {
  const repoRoot = options.repoRoot || DEFAULT_REPO_ROOT;
  const projectsDir = options.projectsDir || DEFAULT_PROJECTS_DIR;
  const projectDir = path.join(projectsDir, projectId);
  const project = await openProject(projectId, { projectsDir });

  if (project.projectType === PROJECT_TYPES.SERIES || project.projectType === "bundle") {
    return seriesWorkspace({ projectId, projectDir, projectsDir, repoRoot, project });
  }

  return worksheetWorkspace({ projectId, projectDir, projectsDir, repoRoot, project });
}

async function worksheetCopyContext(projectId, projectDir, project) {
  const draftBrief = await readJsonIfExists(path.join(projectDir, "brief", "draft.lessonbrief.json"));
  const approvedBrief = await readJsonIfExists(path.join(projectDir, "brief", "approved.lessonbrief.json"));
  const draftContent = await readJsonIfExists(path.join(projectDir, "content", "draft.content-mirror.json"));
  const approvedContent = await readJsonIfExists(path.join(projectDir, "content", "approved.content-mirror.json"));
  const briefStatus = approvedBrief ? "approved" : draftBrief ? "draft" : "missing";
  const contentStatus = approvedContent ? "approved" : draftContent ? "draft" : "missing";
  return {
    app: "SheetifyIMG",
    kind: "worksheet_concept_export",
    schemaVersion: 1,
    intendedUse: "Use this JSON as machine-readable worksheet concept input for another LLM. It intentionally contains only project metadata, lesson planning data and worksheet content data.",
    project: {
      projectId,
      title: project.title,
      subject: project.subject,
      topic: project.topic,
      status: project.status,
      seriesMembership: project.manifest?.seriesMembership || null
    },
    sourceStatus: {
      lessonBrief: briefStatus,
      worksheetContent: contentStatus
    },
    lessonBrief: {
      status: briefStatus,
      data: approvedBrief || draftBrief || null
    },
    worksheetContent: {
      status: contentStatus,
      data: approvedContent || draftContent || null
    }
  };
}

async function seriesCopyContext(projectId, projectDir, project, options = {}) {
  const seriesManifest = await readJsonIfExists(path.join(projectDir, "series-manifest.json"));
  const allowedIds = new Set((options.worksheetIds || []).filter(Boolean));
  const worksheets = [];

  for (const entry of seriesManifest?.worksheets || []) {
    if (allowedIds.size > 0 && !allowedIds.has(entry.projectId)) {
      continue;
    }
    const worksheetDir = path.resolve(projectDir, entry.path || "");
    const worksheetManifest = await readJsonIfExists(path.join(worksheetDir, "project-manifest.json"));
    if (!worksheetManifest) {
      worksheets.push({
        ...entry,
        status: "missing"
      });
      continue;
    }
    const worksheetProject = await openProject(worksheetManifest.projectId || entry.projectId, {
      projectsDir: path.dirname(worksheetDir)
    });
    worksheets.push({
      ...entry,
      status: "available",
      conceptExport: await worksheetCopyContext(worksheetManifest.projectId || entry.projectId, worksheetDir, worksheetProject)
    });
  }

  return {
    app: "SheetifyIMG",
    kind: "series_content_export",
    schemaVersion: 1,
    intendedUse: "Use this JSON as machine-readable worksheet-series concept input for another LLM. It intentionally contains only project metadata, lesson planning data and worksheet content data.",
    project: {
      projectId,
      title: project.title,
      subject: project.subject,
      topic: project.topic,
      status: project.status
    },
    series: {
      title: seriesManifest?.title || project.title,
      worksheetCount: worksheets.length,
      worksheets
    }
  };
}

async function buildCopyContext(projectId, options = {}) {
  const repoRoot = options.repoRoot || DEFAULT_REPO_ROOT;
  const projectsDir = options.projectsDir || DEFAULT_PROJECTS_DIR;
  const projectDir = path.join(projectsDir, projectId);
  const project = await openProject(projectId, { projectsDir });
  const payload = project.projectType === PROJECT_TYPES.SERIES || project.projectType === "bundle"
    ? await seriesCopyContext(projectId, projectDir, project, options)
    : await worksheetCopyContext(projectId, projectDir, project);

  return {
    payload,
    text: `${JSON.stringify(payload, null, 2)}\n`,
    paths: {
      projectDir: rel(repoRoot, projectDir)
    }
  };
}

module.exports = {
  buildCopyContext,
  buildWorkspace,
  workspaceMessagesFromEvents
};
