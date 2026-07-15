"use strict";

const sharp = require("sharp");
const { createQrSvg } = require("../qrCodeManager");

const CARD_WIDTH = 1200;
const CARD_HEIGHT = 756;

function escapeXml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function qrDataUrl(svg) {
  return `data:image/svg+xml;base64,${Buffer.from(svg, "utf8").toString("base64")}`;
}

function shortLabel(value, fallback) {
  const label = String(value || fallback).trim() || fallback;
  return label.length > 54 ? `${label.slice(0, 53).trimEnd()}…` : label;
}

function cardCopy(input) {
  if (input.kind === "topup") {
    const credits = Number(input.credits || 0);
    return {
      title: "Sheetify IMG Guthabenkarte",
      eyebrow: `${credits} ${credits === 1 ? "Entwurfsseite" : "Entwurfsseiten"}`,
      description: "Einmal einlösen und direkt weitergestalten.",
      note: "Einmal einlösbar · Der Code wird nach dem Einlösen ungültig.",
      accent: "#23845b",
      accentSoft: "#dcefe5",
      qrLabel: "Guthaben einlösen"
    };
  }
  return {
    title: "Sheetify IMG Beta Pass",
    eyebrow: shortLabel(input.label, "Gemeinsamer Arbeitsbereich"),
    description: "Scannen oder Code eingeben und den Arbeitsbereich öffnen.",
    note: "Wer diese Karte besitzt, kann auf den Arbeitsbereich zugreifen.",
    accent: "#df6c4f",
    accentSoft: "#f8ded5",
    qrLabel: "Arbeitsbereich öffnen"
  };
}

function sheetWatermark(accent) {
  return `<g transform="translate(1010 104) rotate(9)" opacity=".1" fill="none" stroke="${accent}" stroke-width="16">
    <rect x="-92" y="-46" width="174" height="222" rx="24"/>
    <rect x="-62" y="-74" width="174" height="222" rx="24"/>
    <path d="M-25-18h78M-25 21h78M-25 60h50" stroke-linecap="round"/>
  </g>`;
}

async function createBetaCard(input = {}) {
  const kind = input.kind === "topup" ? "topup" : "pass";
  const copy = cardCopy({ ...input, kind });
  const code = String(input.code || "").trim();
  if (!code) throw new Error("code is required for a Sheetify IMG card.");
  const qrSvg = await createQrSvg(input.qrContent || code, {
    margin: 1,
    errorCorrectionLevel: "M",
    dark: "#25221f",
    light: "#fffdf8"
  });
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${CARD_WIDTH}" height="${CARD_HEIGHT}" viewBox="0 0 ${CARD_WIDTH} ${CARD_HEIGHT}" role="img" aria-label="${escapeXml(copy.title)}">
  <defs>
    <linearGradient id="card-bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#fffdf8"/>
      <stop offset="1" stop-color="#f7f1e8"/>
    </linearGradient>
    <linearGradient id="accent-line" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="${copy.accent}"/>
      <stop offset="1" stop-color="${copy.accent}" stop-opacity=".15"/>
    </linearGradient>
    <clipPath id="card-clip"><rect width="${CARD_WIDTH}" height="${CARD_HEIGHT}" rx="48"/></clipPath>
  </defs>
  <g clip-path="url(#card-clip)">
    <rect width="${CARD_WIDTH}" height="${CARD_HEIGHT}" fill="url(#card-bg)"/>
    <rect width="${CARD_WIDTH}" height="14" fill="url(#accent-line)"/>
    <circle cx="1134" cy="42" r="230" fill="${copy.accentSoft}" opacity=".68"/>
    <circle cx="75" cy="720" r="180" fill="${copy.accentSoft}" opacity=".42"/>
    ${sheetWatermark(copy.accent)}
  </g>
  <rect x="1" y="1" width="${CARD_WIDTH - 2}" height="${CARD_HEIGHT - 2}" rx="47" fill="none" stroke="#ded5ca" stroke-width="2"/>

  <g font-family="Inter,Segoe UI,Arial,sans-serif">
    <text x="72" y="86" font-size="24" font-weight="800" letter-spacing="-1" fill="#25221f">Sheetify</text>
    <text x="164" y="86" font-size="18" font-weight="850" letter-spacing="2" fill="#1f63d6">IMG</text>
    <text x="72" y="172" font-size="55" font-weight="760" letter-spacing="-1.5" fill="#25221f">${escapeXml(copy.title)}</text>
    <text x="72" y="220" font-size="24" font-weight="700" fill="#4c4742">${escapeXml(copy.eyebrow)}</text>
    <text x="72" y="270" font-size="21" fill="#6f6962">${escapeXml(copy.description)}</text>

    <rect x="68" y="325" width="680" height="126" rx="22" fill="#fff" stroke="#ded5ca" stroke-width="2"/>
    <text x="102" y="365" font-size="15" font-weight="800" letter-spacing="3" fill="#8a8178">ZUGANGSCODE</text>
    <text x="102" y="415" font-family="ui-monospace,SFMono-Regular,Consolas,monospace" font-size="31" font-weight="750" letter-spacing="1.6" fill="#25221f">${escapeXml(code)}</text>

    <rect x="846" y="240" width="278" height="278" rx="28" fill="#fffdf8" stroke="#ded5ca" stroke-width="2"/>
    <image x="869" y="263" width="232" height="232" href="${qrDataUrl(qrSvg)}"/>
    <text x="985" y="552" text-anchor="middle" font-size="18" font-weight="700" fill="#4c4742">${escapeXml(copy.qrLabel)}</text>

    <text x="72" y="514" font-size="17" font-weight="650" fill="#6f6962">${escapeXml(copy.note)}</text>
    <line x1="72" y1="584" x2="1128" y2="584" stroke="#ded5ca"/>
    <text x="72" y="632" font-size="17" font-weight="700" fill="#4c4742">sheetify.jujies.app</text>
    <text x="72" y="671" font-size="15" fill="#6f6962">Support: sheetify@jujies.app</text>
    <text x="1128" y="671" text-anchor="end" font-size="15" fill="#6f6962">Digitaler Beta-Zugang</text>
  </g>
</svg>`;
  const png = await sharp(Buffer.from(svg, "utf8"))
    .png({ compressionLevel: 9, palette: true })
    .toBuffer();
  return {
    svg,
    qrSvg,
    png,
    pngDataUrl: `data:image/png;base64,${png.toString("base64")}`,
    width: CARD_WIDTH,
    height: CARD_HEIGHT
  };
}

module.exports = {
  CARD_HEIGHT,
  CARD_WIDTH,
  createBetaCard
};
