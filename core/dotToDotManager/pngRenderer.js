"use strict";

const { PNG } = require("pngjs");
const { measureLabel } = require("./labelLayout");

const DIGIT_FONT = Object.freeze({
  "0": ["111", "101", "101", "101", "111"],
  "1": ["010", "110", "010", "010", "111"],
  "2": ["111", "001", "111", "100", "111"],
  "3": ["111", "001", "111", "001", "111"],
  "4": ["101", "101", "111", "001", "001"],
  "5": ["111", "100", "111", "001", "111"],
  "6": ["111", "100", "111", "101", "111"],
  "7": ["111", "001", "010", "010", "010"],
  "8": ["111", "101", "111", "101", "111"],
  "9": ["111", "101", "111", "001", "111"]
});

const COLORS = Object.freeze({
  white: { r: 255, g: 255, b: 255, a: 255 },
  dot: { r: 28, g: 31, b: 36, a: 255 },
  line: { r: 120, g: 128, b: 138, a: 255 }
});

function createPng(width, height, background = COLORS.white) {
  const png = new PNG({ width, height });
  for (let offset = 0; offset < png.data.length; offset += 4) {
    png.data[offset] = background.r;
    png.data[offset + 1] = background.g;
    png.data[offset + 2] = background.b;
    png.data[offset + 3] = background.a;
  }
  return png;
}

function setPixel(png, x, y, color) {
  const px = Math.round(x);
  const py = Math.round(y);
  if (px < 0 || py < 0 || px >= png.width || py >= png.height) {
    return;
  }
  const offset = (py * png.width + px) * 4;
  png.data[offset] = color.r;
  png.data[offset + 1] = color.g;
  png.data[offset + 2] = color.b;
  png.data[offset + 3] = color.a;
}

function fillRect(png, x, y, width, height, color) {
  const minX = Math.max(0, Math.floor(x));
  const minY = Math.max(0, Math.floor(y));
  const maxX = Math.min(png.width - 1, Math.ceil(x + width));
  const maxY = Math.min(png.height - 1, Math.ceil(y + height));
  for (let py = minY; py <= maxY; py += 1) {
    for (let px = minX; px <= maxX; px += 1) {
      setPixel(png, px, py, color);
    }
  }
}

function fillCircle(png, cx, cy, radius, color) {
  const minX = Math.floor(cx - radius);
  const maxX = Math.ceil(cx + radius);
  const minY = Math.floor(cy - radius);
  const maxY = Math.ceil(cy + radius);
  const radiusSquared = radius * radius;

  for (let y = minY; y <= maxY; y += 1) {
    for (let x = minX; x <= maxX; x += 1) {
      const dx = x - cx;
      const dy = y - cy;
      if (dx * dx + dy * dy <= radiusSquared) {
        setPixel(png, x, y, color);
      }
    }
  }
}

function drawLine(png, start, end, width, color) {
  const length = Math.max(Math.hypot(end.x - start.x, end.y - start.y), 1);
  const steps = Math.ceil(length);
  for (let index = 0; index <= steps; index += 1) {
    const t = index / steps;
    fillCircle(
      png,
      start.x + (end.x - start.x) * t,
      start.y + (end.y - start.y) * t,
      width / 2,
      color
    );
  }
}

function drawBitmapText(png, label, x, y, scale, color) {
  let cursorX = Math.round(x);
  const top = Math.round(y);
  const gap = scale;

  for (const character of String(label)) {
    const glyph = DIGIT_FONT[character];
    if (!glyph) {
      cursorX += 4 * scale;
      continue;
    }

    for (let row = 0; row < glyph.length; row += 1) {
      for (let column = 0; column < glyph[row].length; column += 1) {
        if (glyph[row][column] === "1") {
          fillRect(
            png,
            cursorX + column * scale,
            top + row * scale,
            scale,
            scale,
            color
          );
        }
      }
    }
    cursorX += measureLabel(character, scale).width + gap;
  }
}

function renderDotToDotPng(pattern, options = {}) {
  const solution = Boolean(options.solution);
  const page = pattern.page;
  const png = createPng(page.width, page.height);

  if (solution) {
    for (let index = 1; index < pattern.points.length; index += 1) {
      drawLine(png, pattern.points[index - 1], pattern.points[index], pattern.render.lineWidth, COLORS.line);
    }
  }

  for (const point of pattern.points) {
    fillCircle(png, point.x, point.y, pattern.render.dotRadius, COLORS.dot);
  }

  for (const point of pattern.points) {
    drawBitmapText(
      png,
      point.label,
      point.labelPosition.x,
      point.labelPosition.y,
      pattern.render.labelScale,
      COLORS.dot
    );
  }

  return PNG.sync.write(png);
}

module.exports = {
  renderDotToDotPng
};
