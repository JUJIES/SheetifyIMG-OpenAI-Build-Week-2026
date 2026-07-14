"use strict";

const {
  buildPagePlans,
  explicitPageCountFromContentIntent,
  explicitPageCountFromImageSpec,
  explicitPageCountFromText,
  pageCountFromContent
} = require("../pagePlanManager");

function normalizeText(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/ß/g, "ss")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "");
}

function numericPageCount(value) {
  const count = Number(value || 0);
  return Number.isFinite(count) && count > 0 ? count : 0;
}

function unwrapImageSpec(imageSpec = null) {
  return imageSpec?.data || imageSpec || {};
}

function imageSpecText(imageSpec = {}) {
  const spec = unwrapImageSpec(imageSpec);
  return [
    spec.purpose,
    spec.visualBrief,
    spec.layoutIntent,
    spec.placement,
    spec.learningFunction,
    spec.styleNotes,
    ...(Array.isArray(spec.mustShow) ? spec.mustShow : []),
    ...(Array.isArray(spec.avoid) ? spec.avoid : [])
  ].filter(Boolean).join("\n");
}

function contentContractText(contentMirror = {}) {
  return [
    contentMirror.title,
    contentMirror.outputPreference?.layout,
    contentMirror.outputPreference?.hierarchy,
    ...(Array.isArray(contentMirror.solutionNotes) ? contentMirror.solutionNotes : []),
    ...(Array.isArray(contentMirror.readingTexts) ? contentMirror.readingTexts.flatMap((entry) => [entry.title, entry.body]) : []),
    ...(Array.isArray(contentMirror.imageMaterials)
      ? contentMirror.imageMaterials.flatMap((entry) => [entry.prompt, entry.purpose, entry.placement])
      : [])
  ].filter(Boolean).join("\n");
}

function addIssue(issues, code, message, details = {}) {
  issues.push({ code, message, details });
}

function planTitlesFromImageSpec(imageSpec = {}) {
  const spec = unwrapImageSpec(imageSpec);
  const plans = Array.isArray(spec.pagePlan) ? spec.pagePlan : [];
  return plans.map((plan) => normalizeText(plan.title || plan.role || "")).filter(Boolean);
}

function analyzeImageGenerationContract({
  contentMirror = {},
  lessonBrief = {},
  imageSpec = null,
  requestedPageCount = null
} = {}) {
  const issues = [];
  const spec = unwrapImageSpec(imageSpec);
  const contentPageCount = explicitPageCountFromContentIntent(contentMirror);
  const specDirectPageCount = numericPageCount(spec.pageCount || spec.plannedPageCount || spec.outputPreference?.pages);
  const specTextPageCount = explicitPageCountFromText(imageSpecText(spec));
  const specPageCount = explicitPageCountFromImageSpec(spec);
  const requestedCount = numericPageCount(requestedPageCount);
  const effectivePageCount = requestedCount || pageCountFromContent(contentMirror, spec, lessonBrief);
  const plans = buildPagePlans(contentMirror, lessonBrief, effectivePageCount, spec);
  const effectiveCount = plans.length;

  if (contentPageCount > 0 && specDirectPageCount > 0 && contentPageCount !== specDirectPageCount) {
    addIssue(
      issues,
      "page_count_conflict",
      `Das Konzept verlangt ${contentPageCount} Seite(n), die Bildplanung plant aber ${specDirectPageCount}.`,
      { contentPageCount, specDirectPageCount }
    );
  }
  if (specTextPageCount > 0 && specDirectPageCount > 0 && specTextPageCount !== specDirectPageCount) {
    addIssue(
      issues,
      "image_spec_self_conflict",
      `Die Bildplanung beschreibt ${specTextPageCount} Seite(n), setzt aber pageCount auf ${specDirectPageCount}.`,
      { specTextPageCount, specDirectPageCount }
    );
  }
  if (requestedCount > 0 && contentPageCount > 0 && requestedCount !== contentPageCount) {
    addIssue(
      issues,
      "requested_page_count_conflict",
      `Der Lauf fordert ${requestedCount} Seite(n), das Konzept verlangt aber ${contentPageCount}.`,
      { requestedCount, contentPageCount }
    );
  }

  const onePageRequested = contentPageCount === 1 || specTextPageCount === 1 || specPageCount === 1;
  if (onePageRequested && effectiveCount > 1) {
    addIssue(
      issues,
      "one_page_plan_split",
      `Das Konzept verlangt eine einseitige Arbeitsblattseite, die effektive Seitenplanung erzeugt aber ${effectiveCount} Seiten.`,
      { effectiveCount }
    );
  }

  const combinedText = normalizeText(`${contentContractText(contentMirror)}\n${imageSpecText(spec)}`);
  const imageSpecPlanTitles = planTitlesFromImageSpec(spec);
  const hasMaterialPage = plans.some((plan) => normalizeText(plan.title).includes("materialseite"))
    || imageSpecPlanTitles.some((title) => title.includes("materialseite"));
  const hasTaskPage = plans.some((plan) => normalizeText(plan.title).includes("aufgabenseite"))
    || imageSpecPlanTitles.some((title) => title.includes("aufgabenseite"));
  const hasMaterialHeading = (contentMirror.readingTexts || []).some((entry) => normalizeText(entry.title) === "material");
  const titleNamesTasks = /\baufgaben\b/.test(normalizeText(contentMirror.title));
  const forbidsDoubleHierarchy = /\b(keine doppelte|keine redundante|redundante hierarchie|materialseite plus material|aufgabenseite plus aufgaben)\b/.test(combinedText);

  if (forbidsDoubleHierarchy && hasMaterialPage && hasMaterialHeading) {
    addIssue(
      issues,
      "material_heading_conflict",
      "Die Planung wuerde eine doppelte sichtbare Hierarchie fuer Lesetext/Material erzeugen.",
      { hasMaterialPage, hasMaterialHeading }
    );
  }
  if (forbidsDoubleHierarchy && hasTaskPage && titleNamesTasks) {
    addIssue(
      issues,
      "task_heading_conflict",
      "Die Planung wuerde eine doppelte sichtbare Hierarchie fuer Aufgaben erzeugen.",
      { hasTaskPage, titleNamesTasks }
    );
  }

  return {
    ok: issues.length === 0,
    issues,
    pageCount: effectiveCount,
    pagePlan: plans.map((plan) => plan.summary || {
      pageNumber: plan.pageNumber,
      role: plan.role,
      title: plan.title || null
    })
  };
}

function assertImageGenerationContract(input = {}) {
  const analysis = analyzeImageGenerationContract(input);
  if (!analysis.ok) {
    const firstIssue = analysis.issues[0];
    const error = new Error(`Die Bildplanung ist widerspruechlich: ${firstIssue.message}`);
    error.code = "IMAGE_GENERATION_CONTRACT_CONFLICT";
    error.details = analysis;
    throw error;
  }
  return analysis;
}

module.exports = {
  analyzeImageGenerationContract,
  assertImageGenerationContract
};
