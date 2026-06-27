"use strict";

const fs = require("node:fs/promises");
const path = require("node:path");

function toPosix(value) {
  return String(value || "").split(path.sep).join("/");
}

function normalizeReferenceImage(reference = {}, index = 0) {
  const refPath = String(reference.path || reference.sourcePath || "").trim().replaceAll("\\", "/").replace(/^\/+/, "");
  if (!refPath) {
    return null;
  }
  return {
    id: reference.id || `ref_${String(index + 1).padStart(2, "0")}`,
    role: reference.role || "style_reference",
    path: refPath,
    purpose: reference.purpose || "Referenzbild",
    scope: reference.scope || "next_candidate",
    source: reference.source || null
  };
}

function mergeRuntimeReferenceImages(imageSpec = {}, extraReferences = [], options = {}) {
  const currentData = imageSpec.data || {};
  const existingReferences = options.includeImageSpecReferenceImages
    ? currentData.referenceImages || imageSpec.referenceImages || []
    : [];
  const references = [...existingReferences, ...(Array.isArray(extraReferences) ? extraReferences : [])]
    .map((reference, index) => normalizeReferenceImage(reference, index))
    .filter(Boolean);
  const seen = new Set();
  const mergedReferences = references
    .filter((reference) => {
      if (seen.has(reference.path)) {
        return false;
      }
      seen.add(reference.path);
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
      role: reference.role || "style_reference",
      purpose: reference.purpose || "Referenzbild",
      path: toPosix(path.relative(projectDir, absolutePath)),
      absolutePath
    });
  }
  return resolved;
}

module.exports = {
  mergeRuntimeReferenceImages,
  resolveReferenceImages
};
