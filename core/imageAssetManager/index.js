"use strict";

const fs = require("node:fs/promises");
const path = require("node:path");
const { PRODUCTION_SCHEMA_VERSION } = require("../contracts");
const { writeJsonFile } = require("../jsonFile");

const FORMAT_EXTENSIONS = Object.freeze({
  jpeg: "jpg",
  jpg: "jpg",
  png: "png",
  webp: "webp",
  svg: "svg"
});

async function writeJson(filePath, value) {
  await writeJsonFile(filePath, value);
}

function safeFormat(value) {
  const format = String(value || "png").toLowerCase();
  return FORMAT_EXTENSIONS[format] ? format : "png";
}

function extensionFor(format) {
  return FORMAT_EXTENSIONS[safeFormat(format)];
}

async function writeImageAsset({ runDir, candidateId, pageNumber, role, base64, format, metadata = {}, now }) {
  const outputFormat = safeFormat(format);
  const extension = extensionFor(outputFormat);
  const relativePath = `candidates/${candidateId}_page_${pageNumber}.${extension}`;
  const filePath = path.join(runDir, relativePath);
  const bytes = Buffer.from(String(base64 || ""), "base64");

  if (bytes.length === 0) {
    throw new Error(`Image asset is empty for ${candidateId} page ${pageNumber}.`);
  }

  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, bytes);

  const asset = {
    schemaVersion: PRODUCTION_SCHEMA_VERSION,
    assetId: `${candidateId}_page_${pageNumber}`,
    candidateId,
    page: pageNumber,
    role,
    path: relativePath,
    format: outputFormat,
    byteLength: bytes.length,
    createdAt: now || new Date().toISOString(),
    metadata
  };
  await writeJson(path.join(runDir, `candidates/${candidateId}_page_${pageNumber}.asset.json`), asset);
  return asset;
}

async function writeImageFileAsset({ runDir, candidateId, pageNumber, role, sourcePath, format, metadata = {}, now }) {
  const outputFormat = safeFormat(format || path.extname(sourcePath).replace(".", ""));
  const extension = extensionFor(outputFormat);
  const relativePath = `candidates/${candidateId}_page_${pageNumber}.${extension}`;
  const filePath = path.join(runDir, relativePath);
  const bytes = await fs.readFile(sourcePath);

  if (bytes.length === 0) {
    throw new Error(`Image asset is empty for ${candidateId} page ${pageNumber}.`);
  }

  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, bytes);

  const asset = {
    schemaVersion: PRODUCTION_SCHEMA_VERSION,
    assetId: `${candidateId}_page_${pageNumber}`,
    candidateId,
    page: pageNumber,
    role,
    path: relativePath,
    format: outputFormat,
    byteLength: bytes.length,
    createdAt: now || new Date().toISOString(),
    metadata
  };
  await writeJson(path.join(runDir, `candidates/${candidateId}_page_${pageNumber}.asset.json`), asset);
  return asset;
}

async function writeTextAsset({ runDir, candidateId, pageNumber, role, text, extension = "svg", metadata = {}, now }) {
  const relativePath = `candidates/${candidateId}_page_${pageNumber}.${extension}`;
  const filePath = path.join(runDir, relativePath);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, text, "utf8");
  const asset = {
    schemaVersion: PRODUCTION_SCHEMA_VERSION,
    assetId: `${candidateId}_page_${pageNumber}`,
    candidateId,
    page: pageNumber,
    role,
    path: relativePath,
    format: extension,
    byteLength: Buffer.byteLength(text, "utf8"),
    createdAt: now || new Date().toISOString(),
    metadata
  };
  await writeJson(path.join(runDir, `candidates/${candidateId}_page_${pageNumber}.asset.json`), asset);
  return asset;
}

module.exports = {
  extensionFor,
  writeImageAsset,
  writeImageFileAsset,
  writeTextAsset
};
