"use strict";

const fs = require("node:fs/promises");
const path = require("node:path");
const { REFERENCE_ROLES, normalizeReferenceRole } = require("./referenceRoles");

function toPosix(value) {
  return String(value || "").split(path.sep).join("/");
}

function normalizeReferenceImage(reference = {}, index = 0) {
  const refPath = String(reference.path || reference.sourcePath || "").trim().replaceAll("\\", "/").replace(/^\/+/, "");
  if (!refPath) {
    return null;
  }
  const targetPage = Number(reference.targetPage || reference.page || 0) || null;
  return {
    id: reference.id || `ref_${String(index + 1).padStart(2, "0")}`,
    role: normalizeReferenceRole(reference.role),
    path: refPath,
    purpose: reference.purpose || "Referenzbild",
    scope: reference.scope || "next_candidate",
    source: reference.source || null,
    sourceLabel: reference.sourceLabel || reference.label || null,
    targetPage,
    userDetails: reference.userDetails || reference.details || null
  };
}

function uniqueText(values = []) {
  const seen = new Set();
  return values
    .map((value) => String(value || "").trim())
    .filter((value) => {
      if (!value || seen.has(value)) {
        return false;
      }
      seen.add(value);
      return true;
    });
}

function combineSameSourceReferences(references = []) {
  const groups = new Map();
  for (const reference of references) {
    const key = `${reference.path}::${reference.targetPage || 0}`;
    const group = groups.get(key) || [];
    group.push(reference);
    groups.set(key, group);
  }
  const combined = [];
  for (const group of groups.values()) {
    if (group.length === 1) {
      combined.push(group[0]);
      continue;
    }
    const roles = new Set(group.map((reference) => normalizeReferenceRole(reference.role)));
    const first = group[0];
    const role = roles.has(REFERENCE_ROLES.MATERIAL)
      ? REFERENCE_ROLES.MATERIAL
      : roles.has(REFERENCE_ROLES.STYLE_LAYOUT)
        || (roles.has(REFERENCE_ROLES.STYLE) && roles.has(REFERENCE_ROLES.LAYOUT))
        ? REFERENCE_ROLES.STYLE_LAYOUT
        : normalizeReferenceRole(first.role);
    const sourceLabel = first.sourceLabel || first.label || group.find((reference) => reference.sourceLabel || reference.label)?.sourceLabel || null;
    combined.push({
      ...first,
      role,
      sourceLabel,
      purpose: role === REFERENCE_ROLES.STYLE_LAYOUT
        ? `${sourceLabel || first.path} als Vorlage fuer Stil und Aufbau nutzen`
        : first.purpose,
      userDetails: uniqueText(group.map((reference) => reference.userDetails || reference.details)).join(" / ") || first.userDetails || null
    });
  }
  return combined;
}

function referenceUniquenessKey(reference = {}) {
  return `${reference.path}::${reference.targetPage || 0}`;
}

function mergeRuntimeReferenceImages(imageSpec = {}, extraReferences = [], options = {}) {
  const currentData = imageSpec.data || {};
  const existingReferences = options.includeImageSpecReferenceImages
    ? currentData.referenceImages || imageSpec.referenceImages || []
    : [];
  const references = combineSameSourceReferences([...existingReferences, ...(Array.isArray(extraReferences) ? extraReferences : [])]
    .map((reference, index) => normalizeReferenceImage(reference, index))
    .filter(Boolean));
  const seen = new Set();
  const mergedReferences = references
    .filter((reference) => {
      const key = referenceUniquenessKey(reference);
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    })
    .slice(-4)
    .map((reference, index) => ({
      ...reference,
      id: reference.id || `ref_${String(index + 1).padStart(2, "0")}`
    }));

  return {
    ...imageSpec,
    data: {
      ...currentData,
      referenceImages: mergedReferences
    }
  };
}

function referenceAppliesToPage(reference = {}, pageNumber = 1) {
  const targetPage = Number(reference.targetPage || reference.page || 0) || 0;
  return !targetPage || targetPage === Number(pageNumber || 0);
}

function referencesForPage(references = [], pageNumber = 1) {
  return (Array.isArray(references) ? references : [])
    .filter((reference) => referenceAppliesToPage(reference, pageNumber));
}

function isInsideRoot(rootDir, filePath) {
  const relative = path.relative(rootDir, filePath);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

async function pathExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function resolveReferenceImages(projectDir, references = []) {
  const resolved = [];
  const seen = new Set();
  for (const reference of (Array.isArray(references) ? references : []).slice(0, 4)) {
    const refPath = String(reference.path || "").trim();
    if (!refPath) {
      continue;
    }
    const absolutePath = path.resolve(projectDir, refPath);
    if (!isInsideRoot(projectDir, absolutePath) || seen.has(absolutePath)) {
      continue;
    }
    if (!(await pathExists(absolutePath))) {
      continue;
    }
    seen.add(absolutePath);
    resolved.push({
      id: reference.id || `ref_${resolved.length + 1}`,
      role: normalizeReferenceRole(reference.role),
      purpose: reference.purpose || "Referenzbild",
      path: toPosix(path.relative(projectDir, absolutePath)),
      absolutePath,
      source: reference.source || null,
      sourceLabel: reference.sourceLabel || reference.label || null,
      targetPage: Number(reference.targetPage || reference.page || 0) || null,
      userDetails: reference.userDetails || reference.details || null,
      scope: reference.scope || "next_candidate"
    });
  }
  return resolved;
}

module.exports = {
  mergeRuntimeReferenceImages,
  referencesForPage,
  resolveReferenceImages
};
