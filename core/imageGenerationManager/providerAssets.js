"use strict";

const path = require("node:path");
const { runCodexImageJob } = require("../codexImageWorker");
const { createImageEdit, createImageGeneration } = require("../openaiClient");
const { writeImageAsset, writeImageFileAsset } = require("../imageAssetManager");
const { estimateOpenAiImageCost } = require("../imageCostManager");
const { logModelRun } = require("../modelRunLogger");
const {
  buildPagePlans,
  pageRole,
  promptForPage
} = require("./promptBuilder");
const { resolveReferenceImages } = require("./referenceImages");

function filterPagePlans(pagePlans = [], pageNumbers = []) {
  if (!pageNumbers.length) {
    return pagePlans;
  }
  const wanted = new Set(pageNumbers);
  return pagePlans.filter((pagePlan) => wanted.has(Number(pagePlan.pageNumber)));
}

async function generateOpenAiAssets({
  projectDir,
  runDir,
  candidateId,
  imageSheetBrief,
  imageSpec,
  pageCount,
  pageNumbers = [],
  requestConfig,
  now,
  variantInstruction = "",
  contentChangePolicy = "preserve_approved_text",
  changeScope = "candidate_from_concept"
}) {
  const assets = [];
  const referenceImages = await resolveReferenceImages(projectDir, imageSpec?.data?.referenceImages || imageSpec?.referenceImages || []);
  const usesReferenceImages = referenceImages.length > 0;
  const allPagePlans = buildPagePlans(imageSheetBrief.contentMirror || {}, imageSheetBrief.lessonBrief || {}, pageCount, imageSpec);
  const pagePlans = filterPagePlans(allPagePlans, pageNumbers);
  if (!pagePlans.length) {
    throw new Error(`No matching page plan found for pages: ${pageNumbers.join(", ") || "all"}`);
  }
  for (const pagePlan of pagePlans) {
    const pageNumber = pagePlan.pageNumber;
    const role = pageRole(pageNumber, pagePlan);
    const prompt = promptForPage({
      imageSheetBrief,
      pageNumber,
      role,
      imageSpec,
      variantInstruction,
      pageCount: allPagePlans.length,
      pagePlan,
      requestedSize: requestConfig.imageSize,
      contentChangePolicy,
      changeScope
    });
    const body = {
      model: requestConfig.imageModel,
      prompt,
      n: 1,
      size: requestConfig.imageSize,
      quality: requestConfig.imageQuality,
      output_format: requestConfig.imageOutputFormat,
      background: requestConfig.imageBackground,
      moderation: requestConfig.imageModeration
    };
    const imageBody = usesReferenceImages
      ? {
          ...body,
          imagePaths: referenceImages.map((reference) => reference.absolutePath)
        }
      : body;
    const startedAt = Date.now();
    let response;
    try {
      response = usesReferenceImages
        ? await createImageEdit(imageBody, requestConfig)
        : await createImageGeneration(imageBody, requestConfig);
    } catch (error) {
      await logModelRun(projectDir, {
        status: "error",
        source: "image_generation",
        purpose: "image_generation",
        route: "image_generation",
        model: requestConfig.imageModel,
        proposalId: imageSpec?.proposalId || null,
        durationMs: Date.now() - startedAt,
        error
      }, { now });
      throw error;
    }
    const image = response.data?.[0] || {};
    if (!image.b64_json) {
      throw new Error("OpenAI image response did not include base64 image data.");
    }
    const durationMs = Date.now() - startedAt;
    const usage = response.usage || null;
    const costEstimate = estimateOpenAiImageCost({
      usage,
      model: requestConfig.imageModel,
      size: requestConfig.imageSize,
      quality: requestConfig.imageQuality,
      imageCount: 1
    });
    const asset = await writeImageAsset({
      runDir,
      candidateId,
      pageNumber,
      role,
      base64: image.b64_json,
      format: response.output_format || requestConfig.imageOutputFormat,
      metadata: {
        provider: "openai",
        model: requestConfig.imageModel,
        generationMode: usesReferenceImages ? "image_edit_with_references" : "image_generation",
        qualityPreset: requestConfig.imageQualityPreset,
        quality: requestConfig.imageQuality,
        size: requestConfig.imageSize,
        durationMs,
        responseCreated: response.created || null,
        revisedPrompt: image.revised_prompt || null,
        usage,
        costEstimate,
        openAiImageStreaming: requestConfig.openAiImageStreaming === true,
        referencePolicy: imageSpec?.data?.referencePolicy || imageSpec?.referencePolicy || null,
        referenceImages: referenceImages.map(({ absolutePath, ...reference }) => reference),
        contentChangePolicy,
        changeScope
      },
      now
    });
    assets.push({
      ...asset,
      prompt
    });
    await logModelRun(projectDir, {
      status: "success",
      source: "image_generation",
      purpose: "image_generation",
      route: "image_generation",
      model: requestConfig.imageModel,
      proposalId: imageSpec?.proposalId || null,
      responseId: response.id || null,
      durationMs,
      usage,
      costEstimate,
      metadata: {
        generationMode: usesReferenceImages ? "image_edit_with_references" : "image_generation",
        referenceImageCount: referenceImages.length,
        runId: path.basename(runDir),
        candidateId,
        pageNumber,
        size: requestConfig.imageSize,
        quality: requestConfig.imageQuality,
        qualityPreset: requestConfig.imageQualityPreset,
        openAiImageStreaming: requestConfig.openAiImageStreaming === true,
        contentChangePolicy,
        changeScope
      }
    }, { now });
  }
  return assets;
}

async function generateCodexAssets({
  projectDir,
  runDir,
  candidateId,
  imageSheetBrief,
  imageSpec,
  pageCount,
  pageNumbers = [],
  requestConfig,
  now,
  variantInstruction = "",
  contentChangePolicy = "preserve_approved_text",
  changeScope = "candidate_from_concept"
}) {
  const assets = [];
  const referenceImages = await resolveReferenceImages(projectDir, imageSpec?.data?.referenceImages || imageSpec?.referenceImages || []);
  const allPagePlans = buildPagePlans(imageSheetBrief.contentMirror || {}, imageSheetBrief.lessonBrief || {}, pageCount, imageSpec);
  const pagePlans = filterPagePlans(allPagePlans, pageNumbers);
  if (!pagePlans.length) {
    throw new Error(`No matching page plan found for pages: ${pageNumbers.join(", ") || "all"}`);
  }
  for (const pagePlan of pagePlans) {
    const pageNumber = pagePlan.pageNumber;
    const role = pageRole(pageNumber, pagePlan);
    const prompt = promptForPage({
      imageSheetBrief,
      pageNumber,
      role,
      imageSpec,
      variantInstruction,
      pageCount: allPagePlans.length,
      pagePlan,
      requestedSize: requestConfig.imageSize,
      contentChangePolicy,
      changeScope
    });
    const startedAt = Date.now();
    let codexResult;
    try {
      codexResult = await runCodexImageJob({
        projectDir,
        runDir,
        candidateId,
        pageNumber,
        prompt,
        referenceImages,
        requestConfig,
        now
      });
    } catch (error) {
      await logModelRun(projectDir, {
        status: "error",
        source: "image_generation",
        purpose: "image_generation",
        route: "codex_image_generation",
        model: requestConfig.codexModel,
        provider: "codex_cli",
        proposalId: imageSpec?.proposalId || null,
        durationMs: Date.now() - startedAt,
        error
      }, { now });
      throw error;
    }
    const asset = await writeImageFileAsset({
      runDir,
      candidateId,
      pageNumber,
      role,
      sourcePath: codexResult.imagePath,
      format: "png",
      metadata: {
        provider: "codex_cli",
        model: requestConfig.codexModel,
        generationMode: "codex_builtin_image_generation",
        qualityPreset: requestConfig.imageQualityPreset,
        quality: requestConfig.imageQuality,
        requestedSize: requestConfig.imageSize,
        durationMs: codexResult.durationMs,
        codexSessionId: codexResult.sessionId,
        codexJobPath: codexResult.jobPath,
        codexFinalMessage: codexResult.finalMessage,
        codexStdoutPath: codexResult.stdoutPath,
        codexStderrPath: codexResult.stderrPath,
        referencePolicy: imageSpec?.data?.referencePolicy || imageSpec?.referencePolicy || null,
        referenceImages: referenceImages.map(({ absolutePath, ...reference }) => reference),
        contentChangePolicy,
        changeScope
      },
      now
    });
    assets.push({
      ...asset,
      prompt
    });
    await logModelRun(projectDir, {
      status: "success",
      source: "image_generation",
      purpose: "image_generation",
      route: "codex_image_generation",
      model: requestConfig.codexModel,
      provider: "codex_cli",
      proposalId: imageSpec?.proposalId || null,
      responseId: codexResult.sessionId || null,
      durationMs: codexResult.durationMs,
      metadata: {
        generationMode: "codex_builtin_image_generation",
        referenceImageCount: referenceImages.length,
        codexJobPath: codexResult.jobPath,
        contentChangePolicy,
        changeScope
      }
    }, { now });
  }
  return assets;
}

module.exports = {
  generateCodexAssets,
  generateOpenAiAssets
};
