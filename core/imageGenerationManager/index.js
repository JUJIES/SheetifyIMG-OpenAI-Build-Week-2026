"use strict";

const fs = require("node:fs/promises");
const path = require("node:path");
const { assertCanGenerate } = require("../approvalManager");
const { registerCandidate } = require("../candidateManager");
const { getImageRequestConfig, getImageRuntimeStatus } = require("../aiConfig");
const { createRun } = require("../runManager");
const { runCandidateTechnicalQc } = require("../imageQcManager");
const { readActiveImageSpec } = require("../aiProposalManager");
const { narrateChatMoment } = require("../chatNarrationManager");
const { readEvents } = require("../eventLog");
const {
  buildPagePlans,
  clampPageCount,
  normalizeChangeScope,
  normalizeContentChangePolicy,
  pageCountFromContent,
  promptForPage
} = require("./promptBuilder");
const { mergeRuntimeReferenceImages } = require("./referenceImages");
const { generateCodexAssets, generateOpenAiAssets } = require("./providerAssets");
const {
  contentReadinessForGeneration,
  contentReadinessMessage
} = require("../contentReadiness");
const { assertImageGenerationContract } = require("../imageGenerationContract");
const { writeJsonFile } = require("../jsonFile");
const { createUsageAttribution } = require("../usageAttributionManager");

async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, "utf8"));
}

async function writeJson(filePath, value) {
  await writeJsonFile(filePath, value);
}

async function listDirs(dirPath) {
  try {
    const entries = await fs.readdir(dirPath, { withFileTypes: true });
    return entries.filter((entry) => entry.isDirectory()).map((entry) => path.join(dirPath, entry.name)).sort();
  } catch {
    return [];
  }
}

async function latestRunId(projectDir) {
  const runDirs = await listDirs(path.join(projectDir, "runs"));
  if (runDirs.length === 0) {
    return null;
  }
  const manifest = await readJson(path.join(runDirs[runDirs.length - 1], "run-manifest.json"));
  return manifest.runId || path.basename(runDirs[runDirs.length - 1]);
}

async function updateCandidateTechnicalStatus(runDir, candidateId, qc, now) {
  const manifestPath = path.join(runDir, "run-manifest.json");
  const manifest = await readJson(manifestPath);
  let updatedCandidate = null;
  manifest.candidates = (manifest.candidates || []).map((candidate) => {
    if (candidate.id !== candidateId) {
      return candidate;
    }
    updatedCandidate = {
      ...candidate,
      status: qc.status === "error" ? "technical_failed" : candidate.status,
      qc: {
        status: qc.status,
        errorCount: qc.errorCount,
        warningCount: qc.warningCount,
        path: `qc/${candidateId}.technical-qc.json`
      }
    };
    return updatedCandidate;
  });
  manifest.updatedAt = now;
  await writeJson(manifestPath, manifest);
  return updatedCandidate;
}

function nextCandidateId(manifest) {
  const numbers = (manifest.candidates || [])
    .map((candidate) => Number(String(candidate.id || "").match(/^candidate_(\d+)$/)?.[1] || 0))
    .filter(Boolean);
  return `candidate_${String(Math.max(0, ...numbers) + 1).padStart(2, "0")}`;
}

function assertPaidConfirmation(runtime, input) {
  if (input.confirmPaidRun !== true) {
    throw new Error("Paid image generation requires explicit confirmation.");
  }
}

async function ensureRun(projectDir, input, options, approvalState) {
  if (input.runId) {
    return input.runId;
  }
  const runId = await latestRunId(projectDir);
  if (runId) {
    const manifest = await readJson(path.join(projectDir, "runs", runId, "run-manifest.json"));
    const sameContent = manifest.sourceArtifacts?.contentMirrorId === approvalState.approvedContentMirror?.id;
    const lessonBriefArtifact = approvalState.effectiveLessonBrief
      || approvalState.approvedLessonBrief
      || approvalState.currentLessonBrief
      || null;
    const sameBrief = (manifest.sourceArtifacts?.lessonbriefId || null) === (lessonBriefArtifact?.id || null);
    if (sameContent && sameBrief) {
      return runId;
    }
  }
  const run = await createRun(projectDir, options);
  return run.runId;
}

function requestedPageNumbers(input = {}) {
  const values = Array.isArray(input.pages) && input.pages.length
    ? input.pages.map((entry) => typeof entry === "number" ? entry : entry?.page)
    : input.pageNumber || input.page
      ? [input.pageNumber || input.page]
      : [];
  return [...new Set(values.map((value) => Number(value)).filter((value) => Number.isInteger(value) && value > 0))].sort((a, b) => a - b);
}

async function generateImageCandidate(projectDir, input = {}, options = {}) {
  const now = input.now || options.now || new Date().toISOString();
  const usageAttribution = createUsageAttribution(options.usageAttribution, {
    projectId: path.basename(projectDir),
    operationKind: "candidate_generation",
    commandId: "generate_image_candidate"
  });
  const approvalState = await assertCanGenerate(projectDir);
  const approvedContent = await readJson(path.join(projectDir, approvalState.approvedContentMirror.path));
  const lessonBriefArtifact = approvalState.effectiveLessonBrief
    || approvalState.approvedLessonBrief
    || approvalState.currentLessonBrief
    || null;
  const approvedBrief = lessonBriefArtifact
    ? await readJson(path.join(projectDir, lessonBriefArtifact.path))
    : {};
  const events = await readEvents(projectDir);
  const readiness = contentReadinessForGeneration(approvedContent, { events, brief: approvedBrief });
  if (!readiness.ready) {
    throw new Error(contentReadinessMessage(readiness));
  }
  const requestedProvider = input.imageProvider || input.provider || process.env.SHEETIFYIMG_IMAGE_PROVIDER;
  const runtime = getImageRuntimeStatus(process.env, {
    imageProvider: requestedProvider,
    imageQualityPreset: input.imageQualityPreset || input.imagePreset,
    imageQuality: input.imageQuality,
    openAiImageStreaming: input.openAiImageStreaming
  });
  if (runtime.status !== "ready") {
    throw new Error(runtime.fallbackReason || "Image generation is not configured.");
  }
  if (runtime.mode === "openai") {
    assertPaidConfirmation(runtime, input);
  }
  const imageSpec = await readActiveImageSpec(projectDir, input.imageSpecProposalId);
  if (!imageSpec) {
    throw new Error("Image generation requires an adopted ImageSpec.");
  }
  const runtimeImageSpec = mergeRuntimeReferenceImages(imageSpec, input.referenceImages, {
    includeImageSpecReferenceImages: input.useImageSpecReferenceImages === true
  });
  const contractAnalysis = assertImageGenerationContract({
    contentMirror: approvedContent,
    lessonBrief: approvedBrief,
    imageSpec: runtimeImageSpec,
    requestedPageCount: input.pageCount || null
  });

  const runId = await ensureRun(projectDir, input, { ...options, now }, approvalState);
  const runDir = path.join(projectDir, "runs", runId);
  const runManifest = await readJson(path.join(runDir, "run-manifest.json"));
  const imageSheetBrief = await readJson(path.join(runDir, "brief.imagesheet.json"));
  const candidateId = input.candidateId || nextCandidateId(runManifest);
  const pageCount = clampPageCount(Number(input.pageCount) || contractAnalysis.pageCount || runtimeImageSpec.data?.pageCount || runtimeImageSpec.pageCount || pageCountFromContent(imageSheetBrief.contentMirror || {}, runtimeImageSpec, imageSheetBrief.lessonBrief || {}));
  const pageNumbers = requestedPageNumbers(input);
  const variantInstruction = String(input.variantInstruction || input.message || "").trim();
  const contentChangePolicy = normalizeContentChangePolicy(input.contentChangePolicy);
  const changeScope = normalizeChangeScope(input.changeScope, variantInstruction);
  const requestConfig = getImageRequestConfig(process.env, {
    imageProvider: runtime.mode,
    imageQualityPreset: input.imageQualityPreset || input.imagePreset,
    imageQuality: input.imageQuality,
    openAiImageStreaming: input.openAiImageStreaming
  });
  const assets = requestConfig.mode === "codex_cli"
    ? await generateCodexAssets({ projectDir, runDir, candidateId, imageSheetBrief, imageSpec: runtimeImageSpec, pageCount, pageNumbers, requestConfig, now, variantInstruction, contentChangePolicy, changeScope, usageAttribution })
    : await generateOpenAiAssets({ projectDir, runDir, candidateId, imageSheetBrief, imageSpec: runtimeImageSpec, pageCount, pageNumbers, requestConfig, now, variantInstruction, contentChangePolicy, changeScope, usageAttribution });
  const generationMode = requestConfig.mode === "codex_cli"
    ? "codex_builtin_image_generation"
    : assets.some((asset) => asset.metadata?.generationMode === "image_edit_with_references")
      ? "image_edit_with_references"
      : "image_generation";
  const candidateReferenceImages = (runtimeImageSpec.data?.referenceImages || runtimeImageSpec.referenceImages || []).map((reference) => ({
    id: reference.id || null,
    role: reference.role || "style_reference",
    path: reference.path || null,
    purpose: reference.purpose || null,
    scope: reference.scope || "next_candidate",
    source: reference.source || null,
    sourceLabel: reference.sourceLabel || reference.label || null,
    targetPage: Number(reference.targetPage || reference.page || 0) || null,
    userDetails: reference.userDetails || reference.details || null
  }));
  const chatMessage = await narrateChatMoment(projectDir, {
    kind: "candidate_created",
    fallback: assets.length < pageCount
      ? `${candidateId} ist fertig. ${assets.length} von ${pageCount} Seiten.`
      : `${candidateId} ist fertig. ${assets.length === 1 ? "1 Seite." : `${assets.length} Seiten.`}`,
    userMessage: variantInstruction,
    candidate: {
      id: candidateId,
      pageCount: assets.length,
      generation: {
        provider: requestConfig.mode === "codex_cli" ? "codex_cli" : "openai",
        model: requestConfig.mode === "codex_cli" ? requestConfig.codexModel : requestConfig.imageModel,
        generationMode,
        qualityLabel: requestConfig.imageQualityLabel,
        referenceImages: candidateReferenceImages,
        openAiImageStreaming: requestConfig.openAiImageStreaming === true,
        variantInstruction: variantInstruction || null,
        contentChangePolicy,
        changeScope,
        plannedPageCount: pageCount,
        generatedPages: assets.map((asset) => asset.page)
      }
    },
    workspace: {
      documents: {
        brief: { data: approvedBrief },
        content: { data: approvedContent }
      },
      latestRun: {
        runId,
        candidates: runManifest.candidates || []
      },
      chat: {
        messages: events
          .filter((event) => event.type === "user_message" || event.type === "assistant_message")
          .map((event) => ({
            role: event.type === "assistant_message" ? "assistant" : "user",
            content: event.payload?.message || ""
          }))
      }
    }
  }, {
    now,
    uiEvent: "candidate_created",
    usageAttribution
  });

  let candidate = await registerCandidate(projectDir, runId, {
    id: candidateId,
    status: "reviewable",
    pages: assets.map((asset) => ({
      page: asset.page,
      role: asset.role,
      path: asset.path,
      assetId: asset.assetId,
      prompt: asset.prompt,
      format: asset.format,
      width: null,
      height: null
    })),
    generation: {
      provider: requestConfig.mode === "codex_cli" ? "codex_cli" : "openai",
      model: requestConfig.mode === "codex_cli" ? requestConfig.codexModel : requestConfig.imageModel,
      generationMode,
      size: requestConfig.imageSize,
      qualityPreset: requestConfig.imageQualityPreset,
      qualityLabel: requestConfig.imageQualityLabel,
      quality: requestConfig.imageQuality,
      outputFormat: requestConfig.imageOutputFormat,
      pageCount,
      plannedPageCount: pageCount,
      generatedPageCount: assets.length,
      generatedPages: assets.map((asset) => asset.page),
      confirmedPaidRun: requestConfig.mode === "openai" && input.confirmPaidRun === true,
      confirmedCodexRun: requestConfig.mode === "codex_cli",
      openAiImageStreaming: requestConfig.mode === "openai" && requestConfig.openAiImageStreaming === true,
      imageSpecProposalId: runtimeImageSpec.proposalId,
      imageSpecSummary: runtimeImageSpec.summary || runtimeImageSpec.title || null,
      referencePolicy: runtimeImageSpec.data?.referencePolicy || runtimeImageSpec.referencePolicy || null,
      referenceImages: candidateReferenceImages,
      variantInstruction: variantInstruction || null,
      contentChangePolicy,
      changeScope
    },
    chatMessage,
    notes: [
      requestConfig.mode === "codex_cli"
        ? "Generated with Codex built-in image generation after explicit confirmation."
        : "Generated with OpenAI Image API after explicit confirmation.",
      `Content change policy: ${contentChangePolicy}.`,
      `Change scope: ${changeScope}.`,
      ...(variantInstruction ? [`Variant instruction: ${variantInstruction}`] : [])
    ]
  }, { ...options, now });

  const qc = await runCandidateTechnicalQc(projectDir, runId, candidateId, { ...options, now });
  const candidateWithQc = await updateCandidateTechnicalStatus(runDir, candidateId, qc, now);
  if (candidateWithQc) {
    candidate = candidateWithQc;
  }
  return {
    runId,
    candidate,
    assets,
    qc
  };
}

module.exports = {
  generateImageCandidate,
  promptForPage,
  pageCountFromContent,
  buildPagePlans
};
