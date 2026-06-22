"use strict";

function escapeXml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function renderDotToDotSvg(pattern, options = {}) {
  const solution = Boolean(options.solution);
  const polyline = pattern.points
    .map((point) => `${point.x.toFixed(2)},${point.y.toFixed(2)}`)
    .join(" ");
  const lineMarkup = solution
    ? `  <polyline points="${polyline}" fill="none" stroke="#78808a" stroke-width="${pattern.render.lineWidth}" stroke-linecap="round" stroke-linejoin="round"/>\n`
    : "";
  const dots = pattern.points.map((point) => [
    `  <circle cx="${point.x.toFixed(2)}" cy="${point.y.toFixed(2)}" r="${pattern.render.dotRadius}" fill="#1c1f24"/>`,
    `  <text x="${(point.labelPosition.x + point.labelPosition.width / 2).toFixed(2)}" y="${(point.labelPosition.y + point.labelPosition.height / 2).toFixed(2)}" text-anchor="middle" dominant-baseline="central" font-family="Arial, Helvetica, sans-serif" font-size="${pattern.render.svgFontSize}" font-weight="700" fill="#1c1f24">${escapeXml(point.label)}</text>`
  ].join("\n")).join("\n");

  return [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<svg xmlns="http://www.w3.org/2000/svg" width="${pattern.page.width}" height="${pattern.page.height}" viewBox="0 0 ${pattern.page.width} ${pattern.page.height}" role="img" aria-label="${escapeXml(pattern.motif.label)} dot-to-dot pattern">`,
    `  <rect width="100%" height="100%" fill="#ffffff"/>`,
    lineMarkup.trimEnd(),
    dots,
    `</svg>`,
    ""
  ].filter((line) => line !== "").join("\n");
}

module.exports = {
  renderDotToDotSvg
};
