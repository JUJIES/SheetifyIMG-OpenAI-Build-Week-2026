"use strict";

const { createQrSvg } = require("../qrCodeManager");

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

async function createBetaCard(input = {}) {
  const kind = input.kind === "topup" ? "topup" : "pass";
  const title = kind === "topup" ? "Entwurfsguthaben" : "Sheetify Pass";
  const eyebrow = kind === "topup" ? `${Number(input.credits || 0)} Entwurfsseiten` : "Gemeinsamer Arbeitsbereich";
  const description = kind === "topup"
    ? "Code einlösen und direkt weitergestalten."
    : "Scannen oder Code eingeben und gemeinsam loslegen.";
  const code = String(input.code || "").trim();
  const qrSvg = await createQrSvg(input.qrContent || code, {
    margin: 1,
    errorCorrectionLevel: "M",
    dark: "#101827",
    light: "#ffffff"
  });
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="720" viewBox="0 0 1200 720" role="img" aria-label="${escapeXml(title)}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#f8fbff"/>
      <stop offset="1" stop-color="${kind === "topup" ? "#e8f6ef" : "#eaf1ff"}"/>
    </linearGradient>
    <filter id="shadow" x="-20%" y="-20%" width="140%" height="140%">
      <feDropShadow dx="0" dy="22" stdDeviation="26" flood-color="#101827" flood-opacity=".13"/>
    </filter>
  </defs>
  <rect width="1200" height="720" fill="#f5f6f8"/>
  <rect x="52" y="52" width="1096" height="616" rx="46" fill="url(#bg)" filter="url(#shadow)"/>
  <circle cx="1060" cy="126" r="92" fill="${kind === "topup" ? "#168b4f" : "#1f63d6"}" opacity=".09"/>
  <text x="116" y="146" font-family="Inter,Segoe UI,Arial,sans-serif" font-size="24" font-weight="700" letter-spacing="4" fill="${kind === "topup" ? "#168b4f" : "#1f63d6"}">SHEETIFYIMG</text>
  <text x="116" y="236" font-family="Inter,Segoe UI,Arial,sans-serif" font-size="62" font-weight="760" fill="#101827">${escapeXml(title)}</text>
  <text x="116" y="292" font-family="Inter,Segoe UI,Arial,sans-serif" font-size="28" font-weight="650" fill="#334155">${escapeXml(eyebrow)}</text>
  <text x="116" y="350" font-family="Inter,Segoe UI,Arial,sans-serif" font-size="24" fill="#667085">${escapeXml(description)}</text>
  <rect x="110" y="420" width="620" height="112" rx="24" fill="#ffffff" stroke="#d9dee7" stroke-width="2"/>
  <text x="144" y="458" font-family="Inter,Segoe UI,Arial,sans-serif" font-size="17" font-weight="700" letter-spacing="2" fill="#8b95a5">CODE</text>
  <text x="144" y="505" font-family="ui-monospace,SFMono-Regular,Consolas,monospace" font-size="31" font-weight="700" letter-spacing="2" fill="#101827">${escapeXml(code)}</text>
  <rect x="804" y="164" width="274" height="274" rx="30" fill="#ffffff"/>
  <image x="827" y="187" width="228" height="228" href="${qrDataUrl(qrSvg)}"/>
  <text x="941" y="478" text-anchor="middle" font-family="Inter,Segoe UI,Arial,sans-serif" font-size="19" font-weight="650" fill="#334155">Mit dem Handy scannen</text>
  <text x="116" y="606" font-family="Inter,Segoe UI,Arial,sans-serif" font-size="18" fill="#8b95a5">sheetify.jujies.app</text>
</svg>`;
  return { svg, qrSvg };
}

module.exports = {
  createBetaCard
};
