"use strict";

const fs = require("node:fs/promises");
const QRCode = require("qrcode");
const jsQR = require("jsqr");
const { PNG } = require("pngjs");

const DEFAULT_QR_CONTENT = "https://sheetifyimg.local/qr/benchmark";

function clean(value) {
  return String(value || "").trim();
}

function defaultQrContent(input = {}) {
  const explicit = clean(input.qrContent || input.url || input.content);
  if (explicit) {
    return explicit;
  }
  const projectId = clean(input.projectId).replace(/[^a-zA-Z0-9_-]+/g, "-");
  const proposalId = clean(input.proposalId).replace(/[^a-zA-Z0-9_-]+/g, "-");
  if (projectId || proposalId) {
    return `https://sheetifyimg.local/qr/${projectId || "project"}/${proposalId || "proposal"}`;
  }
  return DEFAULT_QR_CONTENT;
}

async function createQrPngBuffer(content, options = {}) {
  const text = clean(content) || DEFAULT_QR_CONTENT;
  return QRCode.toBuffer(text, {
    type: "png",
    errorCorrectionLevel: options.errorCorrectionLevel || "H",
    margin: Number.isFinite(Number(options.margin)) ? Number(options.margin) : 4,
    scale: Number.isFinite(Number(options.scale)) ? Number(options.scale) : 14,
    color: {
      dark: options.dark || "#111827",
      light: options.light || "#ffffff"
    }
  });
}

async function createQrSvg(content, options = {}) {
  const text = clean(content) || DEFAULT_QR_CONTENT;
  return QRCode.toString(text, {
    type: "svg",
    errorCorrectionLevel: options.errorCorrectionLevel || "M",
    margin: Number.isFinite(Number(options.margin)) ? Number(options.margin) : 2,
    color: {
      dark: options.dark || "#111827",
      light: options.light || "#ffffff"
    }
  });
}

async function writeQrPng(filePath, content, options = {}) {
  const buffer = await createQrPngBuffer(content, options);
  await fs.writeFile(filePath, buffer);
  return {
    content: clean(content) || DEFAULT_QR_CONTENT,
    byteLength: buffer.length
  };
}

function scanQrPngBuffer(buffer) {
  const png = PNG.sync.read(buffer);
  const data = new Uint8ClampedArray(png.data.buffer, png.data.byteOffset, png.data.byteLength);
  const result = jsQR(data, png.width, png.height, {
    inversionAttempts: "attemptBoth"
  });
  return result ? {
    data: result.data,
    location: result.location || null
  } : null;
}

async function scanQrPngFile(filePath) {
  const buffer = await fs.readFile(filePath);
  return scanQrPngBuffer(buffer);
}

module.exports = {
  DEFAULT_QR_CONTENT,
  createQrPngBuffer,
  createQrSvg,
  defaultQrContent,
  scanQrPngBuffer,
  scanQrPngFile,
  writeQrPng
};
