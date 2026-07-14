"use strict";

const fs = require("node:fs/promises");
const path = require("node:path");
const {
  ARTIFACT_STATUSES,
  ARTIFACT_TYPES,
  EVENT_TYPES
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
const { listProjectWorksheets } = require("../worksheetLibraryManager");
const { getAiRuntimeStatus, getImageRuntimeStatus, getTranscriptionRuntimeStatus } = require("../aiConfig");
const {
  annotateCandidateDisplayList,
  candidateDisplayLabelMap
} = require("../candidateDisplay");
const { inputReadiness } = require("../inputReadiness");
const { readProposalState } = require("../aiProposalManager");
const { hasMeaningfulContent } = require("../contentMirrorManager");
const { normalizeConceptReference } = require("../conceptReference");
const { inferReferencePolicy } = require("../referencePolicy");
const { readTeachingContext } = require("../teachingContextManager");
const { presentWorkflowEvent } = require("../chatEventPresenter");
const {
  contentReadinessForGeneration,
  contentReadinessMessage
} = require("../contentReadiness");
const { pageCountFromContent } = require("../pagePlanManager");
const {
  deriveWorkflowActions,
  deriveWorkflowFacts,
  visibleWorkflowCommands
} = require("../workflowState");
const { commandUiMetadata } = require("../workflowCommandCatalog");
const { readJsonFileIfExists } = require("../jsonFile");

const DEFAULT_REPO_ROOT = path.resolve(__dirname, "..", "..");
const DEFAULT_PROJECTS_DIR = path.join(DEFAULT_REPO_ROOT, "projects");
const APP_TEMPLATE_REFERENCE_USERFLOW_ENABLED = false;

async function pathExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function readJsonIfExists(filePath) {
  return readJsonFileIfExists(filePath);
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

function assetUrl(repoRoot, filePath) {
  return `/files/${encodeURI(toPosix(path.relative(repoRoot, filePath)))}`;
}

function commandState(id, label, enabled, reason = null, meta = {}) {
  return {
    id,
    label,
    enabled: Boolean(enabled),
    reason: enabled ? null : reason,
    ...commandUiMetadata(id, label),
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

  const runEntries = [];
  for (const runDir of runDirs) {
    runEntries.push({
      runDir,
      manifest: await readJsonIfExists(path.join(runDir, "run-manifest.json"))
    });
  }
  const matchingEntry = currentContentMirrorId
    ? [...runEntries].reverse().find((entry) => {
        const manifestContentId = entry.manifest?.sourceArtifacts?.contentMirrorId
          || contentMirrorIdFromConcept(entry.manifest?.concept || {});
        return manifestContentId === currentContentMirrorId
          || (entry.manifest?.candidates || []).some((candidate) => {
            return candidateContentMirrorId({ manifest: entry.manifest }, candidate) === currentContentMirrorId;
          });
      })
    : null;
  const selectedEntry = matchingEntry || runEntries[runEntries.length - 1];
  const runDir = selectedEntry.runDir;
  const manifest = selectedEntry.manifest;
  const runId = manifest?.runId || path.basename(runDir);
  const rawCandidates = Array.isArray(manifest?.candidates) ? manifest.candidates : [];
  const candidates = await Promise.all(rawCandidates.map(async (candidate) => {
    const qc = await readJsonIfExists(path.join(runDir, "qc", `${candidate.id}.technical-qc.json`));
    if (!qc?.formatContract) {
      return candidate;
    }
    return {
      ...candidate,
      status: qc.status === "error" ? "technical_failed" : candidate.status,
      qc: {
        status: qc.status || null,
        errorCount: qc.errorCount || 0,
        warningCount: qc.warningCount || 0,
        path: `qc/${candidate.id}.technical-qc.json`
      }
    };
  }));
  const manifestWithQc = manifest ? { ...manifest, candidates } : manifest;
  const currentCandidates = candidates.filter((candidate) => {
    return contentMirrorRefMatchesCurrent(candidateContentMirrorId({ manifest: manifestWithQc }, candidate), currentContentMirrorId);
  });
  const selectableCurrentCandidates = currentCandidates.filter((candidate) => (candidate.pages || []).length > 0);
  const latestCurrentCandidate = selectableCurrentCandidates.at(-1) || null;
  const concept = normalizeConceptReference(
    manifest?.concept || {},
    manifest?.sourceArtifacts || {}
  );
  return {
    runId,
    path: rel(projectDir, runDir),
    manifest: manifestWithQc,
    selection: null,
    concept,
    candidateCount: currentCandidates.length,
    rawCandidateCount: candidates.length,
    latestCurrentCandidateId: latestCurrentCandidate?.id || null,
    latestCurrentCandidateArtifactId: latestCurrentCandidate?.id ? `${runId}_${latestCurrentCandidate.id}` : null,
    selectedCandidate: null,
    selectedCandidateId: null,
    rawSelectedCandidate: null,
    rawSelectedCandidateId: null,
    selectedCandidateDetail: null,
    selectedCandidateConcept: null,
    selectedPageCount: 0,
    rawSelectedPageCount: 0,
    selectionIsCurrent: true,
    hasOutdatedSelection: false,
    hasUnselectedCurrentCandidate: Boolean(latestCurrentCandidate?.id),
    selectionContentMirrorId: null
  };
}

function candidateContentMirrorId(runState, candidate = {}) {
  return candidate.sourceArtifacts?.contentMirrorId
    || runState?.manifest?.sourceArtifacts?.contentMirrorId
    || null;
}

function candidateHasBlockingQc(candidate = {}) {
  return candidate.status === "technical_failed" || candidate.qc?.status === "error";
}

function sortByVersionDesc(left, right) {
  return (Number(right.version) || 0) - (Number(left.version) || 0)
    || String(right.createdAt || "").localeCompare(String(left.createdAt || ""));
}

function conceptSummaryFromContent(data = {}) {
  const taskCount = Array.isArray(data.tasks) ? data.tasks.length : 0;
  const readingTextCount = Array.isArray(data.readingTexts) ? data.readingTexts.length : 0;
  const imageMaterialCount = Array.isArray(data.imageMaterials) ? data.imageMaterials.length : 0;
  return {
    title: data.title || data.topic || null,
    taskCount,
    readingTextCount,
    imageMaterialCount
  };
}

async function contentMirrorHistory(projectDir, index, currentContent = null) {
  const artifacts = listArtifacts(index, { type: ARTIFACT_TYPES.CONTENT_MIRROR })
    .sort(sortByVersionDesc);
  const history = [];

  for (const artifact of artifacts) {
    const data = artifact.path ? await readJsonIfExists(path.join(projectDir, artifact.path)) : null;
    const summary = conceptSummaryFromContent(data || {});
    history.push({
      id: artifact.id,
      type: artifact.type,
      version: Number(artifact.version) || null,
      label: artifact.version ? `Konzept v${artifact.version}` : "Arbeitsblatt-Konzept",
      path: artifact.path || null,
      status: artifact.status || null,
      current: currentContent?.id === artifact.id,
      createdFrom: Array.isArray(artifact.createdFrom) ? artifact.createdFrom : [],
      lineage: data?.lineage || artifact.lineage || null,
      createdAt: artifact.createdAt || data?.createdAt || null,
      updatedAt: artifact.updatedAt || data?.updatedAt || null,
      title: summary.title,
      taskCount: summary.taskCount,
      readingTextCount: summary.readingTextCount,
      imageMaterialCount: summary.imageMaterialCount,
      data
    });
  }

  return history;
}

async function candidatePreviewFromRun({ repoRoot, runDir, index, currentContentMirrorId }) {
  const manifest = await readJsonIfExists(path.join(runDir, "run-manifest.json"));
  const runId = manifest?.runId || path.basename(runDir);
  const runArtifact = findArtifact(index, runId);
  const candidates = [];

  for (const candidate of manifest?.candidates || []) {
    const concept = normalizeConceptReference(candidate.concept || manifest.concept || {}, manifest.sourceArtifacts || {});
    const artifactId = `${runId}_${candidate.id}`;
    const artifact = findArtifact(index, artifactId);
    const qc = await readJsonIfExists(path.join(runDir, "qc", `${candidate.id}.technical-qc.json`));
    const pages = [];
    for (const page of candidate.pages || []) {
      if (!page.path) {
        continue;
      }
      const filePath = path.join(runDir, page.path);
      const exists = await pathExists(filePath);
      pages.push({
        page: page.page,
        role: page.role,
        path: toPosix(path.relative(repoRoot, filePath)),
        url: exists ? assetUrl(repoRoot, filePath) : null,
        missing: !exists,
        assetId: page.assetId || null,
        format: page.format || null
      });
    }

    const contentMirrorId = candidateContentMirrorId({ manifest }, candidate) || contentMirrorIdFromConcept(concept);
    const matchesCurrentContent = Boolean(currentContentMirrorId && contentMirrorId === currentContentMirrorId);
    const storedStatus = artifact?.status || candidate.status || runArtifact?.status || null;
    const status = matchesCurrentContent && storedStatus === ARTIFACT_STATUSES.OUTDATED
      ? candidate.status || "reviewable"
      : storedStatus;
    candidates.push({
      artifactId,
      id: candidate.id,
      runId,
      runStatus: runArtifact?.status || manifest?.status || null,
      status,
      current: matchesCurrentContent && status !== "technical_failed",
      concept,
      basedOnConceptId: candidate.basedOnConceptId || contentMirrorId || concept.conceptId,
      basedOnConceptVersion: candidate.basedOnConceptVersion || concept.conceptVersion,
      contentMirrorId,
      createdAt: artifact?.createdAt || candidate.createdAt || manifest?.createdAt || null,
      generation: candidate.generation ? {
        provider: candidate.generation.provider || null,
        model: candidate.generation.model || null,
        generationMode: candidate.generation.generationMode || null,
        pageCount: candidate.generation.pageCount || candidate.generation.plannedPageCount || null,
        plannedPageCount: candidate.generation.plannedPageCount || null,
        generatedPageCount: candidate.generation.generatedPageCount || null,
        qualityPreset: candidate.generation.qualityPreset || null,
        qualityLabel: candidate.generation.qualityLabel || null,
        imageSpecProposalId: candidate.generation.imageSpecProposalId || null,
        referencePolicy: candidate.generation.referencePolicy || null,
        referenceImages: candidate.generation.referenceImages || []
      } : null,
      qc: qc?.formatContract ? {
        status: qc.status || null,
        errorCount: qc.errorCount || 0,
        warningCount: qc.warningCount || 0,
        path: `runs/${runId}/qc/${candidate.id}.technical-qc.json`
      } : candidate.qc || null,
      pages
    });
  }

  return candidates;
}

async function candidateHistory({ repoRoot, projectDir, index, currentContentMirrorId }) {
  const runDirs = await listDirs(path.join(projectDir, "runs"));
  const candidates = [];
  for (const runDir of runDirs) {
    candidates.push(...await candidatePreviewFromRun({
      repoRoot,
      runDir,
      index,
      currentContentMirrorId
    }));
  }
  const sortedCandidates = candidates.sort((left, right) => {
    return String(right.createdAt || "").localeCompare(String(left.createdAt || ""))
      || String(right.runId || "").localeCompare(String(left.runId || ""))
      || String(right.id || "").localeCompare(String(left.id || ""));
  });
  return annotateCandidateDisplayList(sortedCandidates);
}

function firstSelectableCandidate(runState, currentContentMirrorId = null) {
  const selectableCandidates = [];
  for (const candidate of runState?.manifest?.candidates || []) {
    const candidateContentId = candidateContentMirrorId(runState, candidate);
    if (currentContentMirrorId && candidateContentId && candidateContentId !== currentContentMirrorId) {
      continue;
    }
    if ((candidate.pages || []).length > 0 && !candidateHasBlockingQc(candidate)) {
      selectableCandidates.push(candidate);
    }
  }
  return selectableCandidates.at(-1)?.id || null;
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
  return Boolean(APP_TEMPLATE_REFERENCE_USERFLOW_ENABLED
    && policy
    && ["coordinate_template", "code_asset"].includes(policy.category)
    && policy.preferredSource === "app_template");
}

function referencePolicyNeedsUpload(policy = null) {
  return Boolean(policy && [
    "user_upload",
    "user_upload_or_reference_search",
    "app_template",
    "app_template_or_user_upload"
  ].includes(policy.preferredSource));
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
    imageQualityPreset: imageRuntime.imageQualityPreset,
    contentChangePolicy: "preserve_approved_text"
  };
  if (runState?.candidateCount) {
    payload.changeScope = "visual_only";
  }
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
  const contentDeclaredPageCount = Number(currentContentData?.pageCount || currentContentData?.outputPreference?.pages || 0) || 0;
  if (contentDeclaredPageCount > 0) {
    return pageCountFromContent(currentContentData || {}, null, currentBriefData || {});
  }
  return Number(activeImageSpec?.data?.pageCount || activeImageSpec?.pageCount || 0)
    || pageCountFromContent(currentContentData || {}, activeImageSpec?.data || activeImageSpec || null, currentBriefData || {});
}

function candidateGenerationLabel({ hasCandidate, pageCount }) {
  if (pageCount > 1) {
    return hasCandidate ? "Weiteren mehrseitigen Entwurf erstellen" : "Mehrseitigen Entwurf erstellen";
  }
  return hasCandidate ? "Weitere Entwurfsvariante erstellen" : "Entwurf erstellen";
}

function candidateGenerationLabelForConcept({ hasCandidate, pageCount, currentContent }) {
  const version = Number(currentContent?.version || 0) || null;
  const conceptLabel = version ? `Konzept v${version}` : null;
  const baseLabel = candidateGenerationLabel({ hasCandidate, pageCount });
  if (!conceptLabel) {
    return baseLabel;
  }
  if (/weitere (?:entwurfs)?variante/i.test(baseLabel)) {
    return `Weitere Entwurfsvariante aus ${conceptLabel} erstellen`;
  }
  if (/weiteren mehrseitigen entwurf|mehrseitigen entwurf/i.test(baseLabel) && /weitere/i.test(baseLabel)) {
    return `Weiteren mehrseitigen Entwurf aus ${conceptLabel} erstellen`;
  }
  if (/mehrseitigen entwurf/i.test(baseLabel)) {
    return `Mehrseitigen Entwurf aus ${conceptLabel} erstellen`;
  }
  return `Entwurf aus ${conceptLabel} erstellen`;
}

function nextCandidateReferenceImagesFromProposal(proposal = null) {
  return (Array.isArray(proposal?.source?.nextCandidateReferenceImages)
    ? proposal.source.nextCandidateReferenceImages
    : [])
    .filter((reference) => reference?.path)
    .slice(0, 4);
}

function contentProposalCandidatePayload(proposal = null) {
  if (!proposal) {
    return {};
  }
  const referenceImages = nextCandidateReferenceImagesFromProposal(proposal);
  return {
    proposalId: proposal.proposalId,
    approve: true,
    ...(referenceImages.length ? { referenceImages } : {})
  };
}

function contentProposalAdoptionPayload(proposal = null) {
  return proposal ? {
    proposalId: proposal.proposalId,
    approve: true
  } : {};
}

function worksheetDepositActionLabel(pageCount = 1) {
  return (Number(pageCount || 0) || 1) > 1 ? "Arbeitsblätter ablegen" : "Arbeitsblatt ablegen";
}

function buildWorksheetSteps({
  project,
  currentBrief,
  currentContent,
  currentBriefData = {},
  currentContentData = {},
  approvalState,
  runState,
  item,
  inputState,
  candidateGeneration,
  events = [],
  proposals = {}
}) {
  const preview = item.preview || {};
  const hasInput = Boolean(inputState?.ready);
  const canUsePreviewSelection = !runState || !runState.hasOutdatedSelection;
  const hasCandidates = Boolean(runState?.candidateCount || (canUsePreviewSelection && preview.previewMeta?.renderedCandidateCount));
  const candidatePending = Boolean(candidateGeneration?.isRunning);
  const candidateState = candidatePending ? "generating" : hasCandidates ? "available" : "missing";
  const contentReadiness = contentReadinessForGeneration(currentContentData || {}, { events, brief: currentBriefData || {} });
  const hasReadyConcept = Boolean(currentContent)
    && hasMeaningfulContent(currentContentData || {})
    && contentReadiness.ready;
  const latestContentProposal = proposals.latestContentMirror || null;
  const proposalReadiness = latestContentProposal
    ? contentReadinessForGeneration(latestContentProposal.data || {}, { events, brief: currentBriefData || {} })
    : { ready: false };
  const hasReadyConceptProposal = Boolean(latestContentProposal)
    && hasMeaningfulContent(latestContentProposal.data || {})
    && proposalReadiness.ready;
  const conceptState = hasReadyConcept
    ? "available"
    : hasReadyConceptProposal
      ? "proposed"
      : currentContent
        ? currentContent.status
        : "missing";

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
      state: conceptState,
      complete: hasReadyConcept || hasReadyConceptProposal || approvalState.canGenerate
    },
    {
      id: "candidates",
      label: "Entwürfe",
      state: candidateState,
      complete: hasCandidates
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
  teachingContext,
  candidateGeneration,
  conceptHistory = []
}) {
  if (project.isLegacy) {
    return [
      commandState(
        "legacy_read_only",
        "Legacy-Projekt migrieren",
        false,
        "Dieses Projekt ist ein importierter POC-Stand. Produktionsbefehle sind erst nach einer sauberen Migration aktiv."
      )
    ];
  }

  const selectableCandidateId = firstSelectableCandidate(runState, currentContent?.id || null);
  const latestCurrentCandidate = (runState?.manifest?.candidates || [])
    .find((candidate) => candidate.id === runState?.latestCurrentCandidateId) || null;
  const defaultDepositCandidateId = latestCurrentCandidate && !candidateHasBlockingQc(latestCurrentCandidate)
    ? runState?.latestCurrentCandidateId
    : selectableCandidateId;
  const defaultDepositCandidate = (runState?.manifest?.candidates || [])
    .find((candidate) => candidate.id === defaultDepositCandidateId) || null;
  const defaultDepositCandidatePageCount = (defaultDepositCandidate?.pages || []).length || 0;
  const hasBlockedCandidateForDeposit = (runState?.manifest?.candidates || [])
    .some((candidate) => (candidate.pages || []).length > 0 && candidateHasBlockingQc(candidate));
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
  const candidateGenerationRunning = Boolean(candidateGeneration?.isRunning);
  const defaultImageProvider = imageRuntime.status === "ready"
    ? imageRuntime.mode
    : imageRuntime.canUseCodex
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
  const referenceActionPolicy = imageSpecReferencePolicy || preliminaryReferencePolicy || null;
  const latestSourceImage = latestImageSourceFile(source);
  const referenceActionNeedsAppTemplate = referencePolicyUsesAppTemplate(referenceActionPolicy);
  const referenceActionNeedsUpload = referencePolicyNeedsUpload(referenceActionPolicy);
  const referenceActionSupportsWebSearch = referencePolicySupportsWebSearch(referenceActionPolicy);
  const referenceActionUsesInput = !referenceActionNeedsAppTemplate && Boolean(latestSourceImage);
  const referenceActionEnabled = approvalState.canGenerate
    && contentIsReadyForCandidates
    && referencePolicyNeedsAction(referenceActionPolicy)
    && (referenceActionNeedsAppTemplate || Boolean(latestSourceImage));
  const webReferenceActionEnabled = approvalState.canGenerate
    && contentIsReadyForCandidates
    && referencePolicyNeedsAction(referenceActionPolicy)
    && referenceActionSupportsWebSearch;
  const referenceActionPayload = {
    ...(referenceImageSpec?.proposalId ? { proposalId: referenceImageSpec.proposalId } : {}),
    ...(latestSourceImage ? { sourcePath: latestSourceImage.path } : {}),
    ...(!referenceImageSpec ? {
      message: "Prüfe intern, welche Referenz oder Vorlage den nächsten Entwurf stabiler macht.",
      uiEvent: "reference_preflight"
    } : {})
  };
  const webReferenceActionPayload = {
    ...(referenceImageSpec?.proposalId ? { proposalId: referenceImageSpec.proposalId } : {}),
    ...(referenceActionPolicy?.suggestedSearchQuery ? { query: referenceActionPolicy.suggestedSearchQuery } : {}),
    ...(!referenceImageSpec ? {
      message: "Prüfe intern, welche Webreferenz den nächsten Entwurf stabiler macht.",
      uiEvent: "reference_preflight"
    } : {})
  };
  const referenceActionReason = !approvalState.canGenerate
    ? approvalState.reason || "Es gibt noch keine Entwurfsbasis."
    : !contentIsReadyForCandidates
      ? contentReadinessReason
      : !referencePolicyNeedsAction(referenceActionPolicy)
      ? "Referenzbild ist schon berücksichtigt."
      : referenceActionNeedsUpload
        ? "Bitte zuerst ein passendes Referenzbild als Input hochladen."
        : "Für diese Visualisierung gibt es keine automatisch vorbereitete Spezialvorlage.";

  return [
    commandState(
      "activate_content_mirror_version",
      "Konzeptversion nutzen",
      conceptHistory.length > 0,
      "Es gibt noch keine Konzeptversion."
    ),
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
      "Arbeitsblatt-Konzept ausformulieren",
      Boolean(latestLessonBriefProposal),
      "Es gibt keinen offenen internen Konzeptstand.",
      latestLessonBriefProposal ? {
        defaultPayload: {
          proposalId: latestLessonBriefProposal.proposalId,
          continueToContent: true,
          silent: true
        }
      } : {}
    ),
    commandState(
      "create_brief_draft",
      "Konzept direkt anlegen",
      conceptInputReady,
      conceptInputReason
    ),
    commandState(
      "approve_current_brief",
      "Internen Konzeptstand speichern",
      currentBrief?.status === ARTIFACT_STATUSES.DRAFT,
      "Der aktuelle Konzeptentwurf ist nicht im Bearbeitungsstatus."
    ),
    commandState(
      "generate_content_mirror_proposal",
      hasContent ? "Konzept überarbeiten" : "Konzept ausformulieren",
      hasBrief,
      "Es gibt noch kein Arbeitsblatt-Konzept als Planungsgrundlage.",
      latestContentMirrorProposal ? {
        defaultPayload: {
          basisProposalId: latestContentMirrorProposal.proposalId
        }
      } : {}
    ),
    commandState(
      "adopt_content_mirror_proposal",
      "Konzeptbasis intern setzen",
      Boolean(latestContentMirrorProposal),
      "Es gibt keinen offenen Aufgaben- und Materialvorschlag.",
      latestContentMirrorProposal ? { defaultPayload: contentProposalAdoptionPayload(latestContentMirrorProposal) } : {}
    ),
    commandState(
      "generate_candidate_from_content_proposal",
      "Entwurf aus diesem Konzept erstellen",
      proposalContentIsReadyForCandidates && imageGenerationConfigured && !candidateGenerationRunning,
      candidateGenerationRunning
        ? plannedCandidatePageCount > 1
          ? "Für dieses Projekt läuft bereits ein mehrseitiger Entwurf im Hintergrund."
          : "Für dieses Projekt läuft bereits ein Entwurf im Hintergrund."
        : !latestContentMirrorProposal
          ? "Es gibt keinen offenen Konzeptvorschlag."
          : !proposalContentIsReadyForCandidates
            ? proposalContentReadinessReason
            : imageRuntime.fallbackReason || "Bildgenerierung ist nicht konfiguriert.",
      {
        requiresConfirmation: true,
        confirmationKind: "image_generation_provider",
        confirmationMessage: `Dieser Schritt erstellt aus dem angezeigten Arbeitsblatt-Konzept einen ${imageRuntime.imageQualityLabel || "Standard"}-Entwurf. Die Konzeptbasis wird dafür intern gespeichert.`,
        imageProviders: imageProviderOptions,
        defaultPayload: latestContentMirrorProposal ? {
          ...contentProposalCandidatePayload(latestContentMirrorProposal),
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
      "Konzeptbasis intern speichern",
      currentContent?.status === ARTIFACT_STATUSES.DRAFT && contentIsReadyForCandidates,
      currentContent?.status !== ARTIFACT_STATUSES.DRAFT
        ? "Das aktuelle Arbeitsblatt-Konzept ist nicht im Bearbeitungsstatus."
        : contentIsMeaningful
          ? contentReadinessReason
          : "Das Arbeitsblatt-Konzept braucht Aufgaben, Text oder Bildmaterial."
    ),
    commandState(
      "generate_content_warnings_proposal",
      "Konzept-Feedback intern erzeugen",
      hasContent && contentIsMeaningful,
      "Es gibt noch kein Arbeitsblatt-Konzept für Konzept-Feedback."
    ),
    commandState(
      "adopt_content_warnings_proposal",
      "Konzept-Feedback intern speichern",
      Boolean(latestContentWarningsProposal),
      "Es gibt kein offenes Konzept-Feedback.",
      latestContentWarningsProposal ? { defaultPayload: { proposalId: latestContentWarningsProposal.proposalId } } : {}
    ),
    commandState(
      "prepare_image_spec",
      preliminaryReferencePolicy.level !== "none" && !referenceImageSpec
        ? "Referenzbedarf intern prüfen"
        : "Bildplanung intern erstellen",
      approvalState.canGenerate && contentIsReadyForCandidates,
      approvalState.canGenerate
        ? contentReadinessReason
        : approvalState.reason || "Es gibt noch keine Entwurfsbasis.",
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
      "Bildplanung intern speichern",
      Boolean(latestImageSpecProposal),
      "Es gibt keine offene Bildplanung.",
      latestImageSpecProposal ? { defaultPayload: { proposalId: latestImageSpecProposal.proposalId } } : {}
    ),
    commandState(
      "prepare_reference_asset",
      referenceActionUsesInput || referenceActionNeedsUpload ? "Input als Referenz nutzen" : "Referenzbild nutzen",
      referenceActionEnabled,
      referenceActionReason,
      {
        defaultPayload: referenceActionPayload,
        referencePolicy: referenceActionPolicy
      }
    ),
    commandState(
      "prepare_web_reference_asset",
      "Bildreferenz suchen",
      webReferenceActionEnabled,
      !approvalState.canGenerate
        ? approvalState.reason || "Es gibt noch keine Entwurfsbasis."
        : !contentIsReadyForCandidates
          ? contentReadinessReason
          : !referencePolicyNeedsAction(referenceActionPolicy)
            ? "Referenzbild ist schon berücksichtigt."
            : "Für diese Visualisierung ist keine offene Bildreferenz vorgesehen.",
      {
        defaultPayload: webReferenceActionPayload,
        referencePolicy: referenceActionPolicy
      }
    ),
    commandState(
      "create_run",
      "Entwurfsrunde anlegen",
      approvalState.canGenerate && contentIsReadyForCandidates,
      approvalState.canGenerate
        ? contentReadinessReason
        : approvalState.reason || "Es gibt noch keine Entwurfsbasis."
    ),
    commandState(
      "generate_image_candidate",
      candidateGenerationLabelForConcept({
        hasCandidate: Boolean(selectableCandidateId),
        pageCount: plannedCandidatePageCount,
        currentContent
      }),
      contentIsReadyForCandidates && imageGenerationConfigured && !candidateGenerationRunning,
      candidateGenerationRunning
        ? plannedCandidatePageCount > 1
          ? "Für dieses Projekt läuft bereits ein mehrseitiger Entwurf im Hintergrund."
          : "Für dieses Projekt läuft bereits ein Entwurf im Hintergrund."
        : !contentIsReadyForCandidates
          ? contentReadinessReason
          : imageRuntime.fallbackReason || "Bildgenerierung ist nicht konfiguriert.",
      {
        requiresConfirmation: true,
        confirmationKind: "image_generation_provider",
        confirmationMessage: selectableCandidateId
          ? plannedCandidatePageCount > 1
            ? `Dieser Schritt erstellt einen weiteren ${imageRuntime.imageQualityLabel || "Standard"}-Entwurf mit ${plannedCandidatePageCount} Seiten. Der Bildanbieter ist in den Einstellungen festgelegt.`
            : `Dieser Schritt erstellt einen weiteren ${imageRuntime.imageQualityLabel || "Standard"}-Entwurf als Variante. Der Bildanbieter ist in den Einstellungen festgelegt.`
          : plannedCandidatePageCount > 1
            ? `Dieser Schritt erstellt einen ${imageRuntime.imageQualityLabel || "Standard"}-Entwurf mit ${plannedCandidatePageCount} Seiten. Der Bildanbieter ist in den Einstellungen festgelegt.`
            : `Dieser Schritt erstellt einen ${imageRuntime.imageQualityLabel || "Standard"}-Entwurf. Der Bildanbieter ist in den Einstellungen festgelegt.`,
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
      "deposit_worksheet",
      worksheetDepositActionLabel(defaultDepositCandidatePageCount || plannedCandidatePageCount),
      Boolean(defaultDepositCandidateId),
      hasBlockedCandidateForDeposit
        ? "Der aktuelle Entwurf hat die technische Formatprüfung nicht bestanden."
        : "Es gibt noch keinen Entwurf mit Seiten.",
      {
        defaultPayload: defaultDepositCandidateId ? {
          runId: runState?.runId || null,
          candidateId: defaultDepositCandidateId
        } : {}
      }
    ),
  ];
}

function workspaceMessagesFromEvents(events, options = {}) {
  const candidateDisplayLabels = options.candidateDisplayLabels || {};
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
          contextRefs: event.payload?.contextRefs || null,
          revisionTarget: event.payload?.revisionTarget || null,
          proposal: event.payload?.proposal || null,
          suggestedActions: event.payload?.suggestedActions || []
        };
      }
      if (event.type === EVENT_TYPES.CANDIDATE_CREATED) {
        const candidateId = event.payload?.candidateId || "Entwurf";
        const pageCount = Number(event.payload?.pageCount || event.payload?.candidate?.pages?.length || 1) || 1;
        const runId = event.runId || event.payload?.runId || null;
        const displayLabel = candidateDisplayLabels[`${runId || ""}:${candidateId || ""}`]
          || event.payload?.displayLabel
          || null;
        const depositLabel = worksheetDepositActionLabel(pageCount);
        const fallbackMessage = presentWorkflowEvent({
          kind: "candidate_created",
          candidate: {
            id: candidateId,
            displayLabel,
            pageCount
          }
        }) || `${candidateId} ist fertig.`;
        return {
          id: event.id,
          role: "assistant",
          createdAt: event.createdAt,
          content: displayLabel ? fallbackMessage : event.payload?.message || fallbackMessage,
          mode: "system",
          productionCard: {
            kind: "candidate",
            runId,
            candidateId,
            displayLabel
          },
          suggestedActions: [{
            command: "deposit_worksheet",
            label: depositLabel,
            payload: {
              ...(runId ? { runId } : {}),
              candidateId
            }
          }]
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

function worksheetDepositKey(runId = "", candidateId = "") {
  const normalizedRunId = String(runId || "").trim();
  const normalizedCandidateId = String(candidateId || "").trim();
  return normalizedRunId && normalizedCandidateId ? `${normalizedRunId}::${normalizedCandidateId}` : "";
}

function buildWorksheetDepositState(worksheets = []) {
  const byCandidateKey = {};
  for (const worksheet of worksheets) {
    const source = worksheet.source || {};
    const runId = String(source.runId || "").trim();
    const candidateIds = new Set([
      source.candidateId,
      ...(Array.isArray(source.candidateIds) ? source.candidateIds : []),
      ...(worksheet.pages || []).map((page) => page.sourceCandidateId || null)
    ].filter(Boolean));
    for (const candidateId of candidateIds) {
      const key = worksheetDepositKey(runId, candidateId);
      if (!key) {
        continue;
      }
      if (!byCandidateKey[key]) {
        byCandidateKey[key] = [];
      }
      byCandidateKey[key].push({
        worksheetId: worksheet.worksheetId,
        title: worksheet.title || worksheet.worksheetId,
        kind: worksheet.kind || null,
        pageCount: Number(worksheet.pageCount || worksheet.pages?.length || 0) || 0,
        createdAt: worksheet.createdAt || null
      });
    }
  }
  return {
    count: worksheets.length,
    byCandidateKey
  };
}

async function worksheetWorkspace({ projectId, projectDir, projectsDir, repoRoot, worksheetsDir, project }) {
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
  const candidateGeneration = project.derivedStatus?.candidateGeneration || {
    isRunning: false,
    activeJob: null,
    latestCompletion: null,
    latestFailure: null,
    hasUnreadCompletion: false
  };
  const events = await readEvents(projectDir);
  const chatRuntime = getAiRuntimeStatus();
  const imageRuntime = getImageRuntimeStatus();
  const transcriptionRuntime = getTranscriptionRuntimeStatus();
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
  const conceptHistory = await contentMirrorHistory(projectDir, index, currentContent);
  const candidates = await candidateHistory({
    repoRoot,
    projectDir,
    index,
    currentContentMirrorId: currentContent?.id || null
  });
  const candidateDisplayLabels = candidateDisplayLabelMap(candidates);
  const projectWorksheets = await listProjectWorksheets(projectId, {
    repoRoot,
    ...(worksheetsDir ? { worksheetsDir } : {})
  });
  const worksheetDeposits = buildWorksheetDepositState(projectWorksheets);

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
    candidateGeneration,
    artifacts: {
      currentBrief,
      currentContent,
      approvedContent: approvalState.approvedContentMirror,
      concepts: conceptHistory,
      candidates,
      worksheetDeposits,
      counts: Object.fromEntries(Object.values(ARTIFACT_TYPES).map((type) => [
        type,
        listArtifacts(index, { type }).length
      ]))
    },
    approval: approvalState,
    image: imageRuntime,
    transcription: transcriptionRuntime,
    latestRun: runState,
    exports: {
      totalCount: 0,
      currentCount: 0,
      hasAny: false,
      hasCurrent: false,
      items: [],
      current: []
    },
    steps: buildWorksheetSteps({
      project,
      currentBrief,
      currentContent,
      currentBriefData,
      currentContentData,
      approvalState,
      runState,
      item,
      inputState,
      candidateGeneration,
      events,
      proposals
    }),
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
      teachingContext,
      candidateGeneration,
      conceptHistory
    }),
    chat: {
      ...chatRuntime,
      messages: workspaceMessagesFromEvents(events, { candidateDisplayLabels })
    },
    paths: {
      projectDir: rel(repoRoot, projectDir)
    }
  };
  workspace.workflowState = deriveWorkflowFacts(workspace);
  workspace.workflowActions = deriveWorkflowActions(workspace);
  workspace.visibleCommands = visibleWorkflowCommands(workspace);
  return workspace;
}

async function buildWorkspace(projectId, options = {}) {
  const repoRoot = options.repoRoot || DEFAULT_REPO_ROOT;
  const projectsDir = options.projectsDir || DEFAULT_PROJECTS_DIR;
  const worksheetsDir = options.worksheetsDir;
  const projectDir = path.join(projectsDir, projectId);
  const project = await openProject(projectId, { projectsDir });

  if (project.projectType !== "single_worksheet") {
    throw new Error(`Only single worksheet projects are supported here: ${project.projectType}`);
  }

  return worksheetWorkspace({ projectId, projectDir, projectsDir, repoRoot, worksheetsDir, project });
}

module.exports = {
  buildWorkspace,
  workspaceMessagesFromEvents
};
