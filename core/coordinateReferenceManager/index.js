"use strict";

const fs = require("node:fs/promises");
const { PNG } = require("pngjs");

const COLORS = Object.freeze({
  white: [255, 255, 255, 255],
  black: [17, 24, 39, 255],
  gray: [148, 163, 184, 255],
  paleBlue: [239, 246, 255, 255],
  blue: [37, 99, 235, 255],
  red: [220, 38, 38, 255],
  green: [22, 163, 74, 255],
  orange: [234, 88, 12, 255]
});

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function color(value, fallback = COLORS.black) {
  if (Array.isArray(value) && value.length >= 3) {
    return [
      clamp(Number(value[0]) || 0, 0, 255),
      clamp(Number(value[1]) || 0, 0, 255),
      clamp(Number(value[2]) || 0, 0, 255),
      clamp(Number(value[3]) || 255, 0, 255)
    ];
  }
  return COLORS[value] || fallback;
}

function setPixel(png, x, y, rgba) {
  const xx = Math.round(x);
  const yy = Math.round(y);
  if (xx < 0 || yy < 0 || xx >= png.width || yy >= png.height) {
    return;
  }
  const index = (png.width * yy + xx) << 2;
  png.data[index] = rgba[0];
  png.data[index + 1] = rgba[1];
  png.data[index + 2] = rgba[2];
  png.data[index + 3] = rgba[3];
}

function fillRect(png, x, y, width, height, rgba) {
  for (let yy = Math.floor(y); yy < Math.ceil(y + height); yy += 1) {
    for (let xx = Math.floor(x); xx < Math.ceil(x + width); xx += 1) {
      setPixel(png, xx, yy, rgba);
    }
  }
}

function strokeRect(png, x, y, width, height, rgba, thickness = 1) {
  fillRect(png, x, y, width, thickness, rgba);
  fillRect(png, x, y + height - thickness, width, thickness, rgba);
  fillRect(png, x, y, thickness, height, rgba);
  fillRect(png, x + width - thickness, y, thickness, height, rgba);
}

function drawLine(png, x1, y1, x2, y2, rgba, thickness = 1) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const steps = Math.max(Math.abs(dx), Math.abs(dy), 1);
  for (let step = 0; step <= steps; step += 1) {
    const t = step / steps;
    const x = x1 + dx * t;
    const y = y1 + dy * t;
    fillRect(png, x - thickness / 2, y - thickness / 2, thickness, thickness, rgba);
  }
}

function drawDashedLine(png, x1, y1, x2, y2, rgba, thickness = 1, dash = 20, gap = 14) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const length = Math.max(Math.hypot(dx, dy), 1);
  let offset = 0;
  while (offset < length) {
    const start = offset / length;
    const end = Math.min(offset + dash, length) / length;
    drawLine(
      png,
      x1 + dx * start,
      y1 + dy * start,
      x1 + dx * end,
      y1 + dy * end,
      rgba,
      thickness
    );
    offset += dash + gap;
  }
}

function fillCircle(png, cx, cy, radius, rgba) {
  const r = Math.max(1, Math.round(radius));
  for (let y = -r; y <= r; y += 1) {
    for (let x = -r; x <= r; x += 1) {
      if (x * x + y * y <= r * r) {
        setPixel(png, cx + x, cy + y, rgba);
      }
    }
  }
}

function normalizeRange(range = {}) {
  const xMin = Number.isFinite(Number(range.xMin)) ? Number(range.xMin) : -4;
  const xMax = Number.isFinite(Number(range.xMax)) ? Number(range.xMax) : 4;
  const yMin = Number.isFinite(Number(range.yMin)) ? Number(range.yMin) : -4;
  const yMax = Number.isFinite(Number(range.yMax)) ? Number(range.yMax) : 4;
  return {
    xMin: Math.min(xMin, xMax - 1),
    xMax: Math.max(xMax, xMin + 1),
    yMin: Math.min(yMin, yMax - 1),
    yMax: Math.max(yMax, yMin + 1)
  };
}

function pointKey(point = {}) {
  return `${point.x},${point.y}`;
}

function mirrorPoint(point = {}, axis = "y") {
  if (axis === "x") {
    return {
      ...point,
      y: -Number(point.y),
      label: point.mirrorLabel || `${point.label || ""}'`
    };
  }
  return {
    ...point,
    x: -Number(point.x),
    label: point.mirrorLabel || `${point.label || ""}'`
  };
}

function defaultCoordinatePlan() {
  const original = [
    { label: "A", x: 1, y: 1 },
    { label: "B", x: 3, y: 1 },
    { label: "C", x: 2, y: 3 }
  ];
  const mirrored = original.map((point) => mirrorPoint(point, "y"));
  return {
    range: { xMin: -4, xMax: 4, yMin: -4, yMax: 4 },
    mirrorAxis: "y",
    points: [
      ...original.map((point) => ({ ...point, group: "original", color: "blue" })),
      ...mirrored.map((point) => ({ ...point, group: "mirror", color: "red" }))
    ],
    segments: [
      { from: "1,1", to: "3,1", color: "blue" },
      { from: "3,1", to: "2,3", color: "blue" },
      { from: "2,3", to: "1,1", color: "blue" },
      { from: "-1,1", to: "-3,1", color: "red" },
      { from: "-3,1", to: "-2,3", color: "red" },
      { from: "-2,3", to: "-1,1", color: "red" }
    ]
  };
}

function createCoordinateReferencePngBuffer(plan = {}, options = {}) {
  const normalizedPlan = {
    ...defaultCoordinatePlan(),
    ...plan,
    range: normalizeRange(plan.range || defaultCoordinatePlan().range)
  };
  const width = Number(options.width) || 1120;
  const height = Number(options.height) || 1584;
  const png = new PNG({ width, height, colorType: 6 });
  fillRect(png, 0, 0, width, height, COLORS.white);

  const gridSize = Math.min(900, width - 220);
  const left = Math.round((width - gridSize) / 2);
  const top = 260;
  const range = normalizedPlan.range;
  const xUnits = range.xMax - range.xMin;
  const yUnits = range.yMax - range.yMin;
  const stepX = gridSize / xUnits;
  const stepY = gridSize / yUnits;
  const toPixel = (point) => ({
    x: left + (Number(point.x) - range.xMin) * stepX,
    y: top + (range.yMax - Number(point.y)) * stepY
  });

  fillRect(png, 110, 96, width - 220, 86, COLORS.paleBlue);
  strokeRect(png, 110, 96, width - 220, 86, COLORS.blue, 4);
  fillRect(png, left, top, gridSize, gridSize, COLORS.white);
  strokeRect(png, left, top, gridSize, gridSize, COLORS.black, 4);

  for (let x = Math.ceil(range.xMin); x <= Math.floor(range.xMax); x += 1) {
    const px = toPixel({ x, y: 0 }).x;
    fillRect(png, px - 1, top, 2, gridSize, COLORS.gray);
  }
  for (let y = Math.ceil(range.yMin); y <= Math.floor(range.yMax); y += 1) {
    const py = toPixel({ x: 0, y }).y;
    fillRect(png, left, py - 1, gridSize, 2, COLORS.gray);
  }
  if (range.xMin <= 0 && range.xMax >= 0) {
    const px = toPixel({ x: 0, y: 0 }).x;
    fillRect(png, px - 3, top, 6, gridSize, COLORS.black);
  }
  if (range.yMin <= 0 && range.yMax >= 0) {
    const py = toPixel({ x: 0, y: 0 }).y;
    fillRect(png, left, py - 3, gridSize, 6, COLORS.black);
  }
  if (normalizedPlan.mirrorAxis === "y") {
    const px = toPixel({ x: 0, y: 0 }).x;
    drawDashedLine(png, px, top, px, top + gridSize, COLORS.green, 8);
  } else if (normalizedPlan.mirrorAxis === "x") {
    const py = toPixel({ x: 0, y: 0 }).y;
    drawDashedLine(png, left, py, left + gridSize, py, COLORS.green, 8);
  }

  const points = Array.isArray(normalizedPlan.points) ? normalizedPlan.points : [];
  const pointMap = new Map(points.map((point) => [pointKey(point), point]));
  for (const segment of normalizedPlan.segments || []) {
    const from = pointMap.get(segment.from) || null;
    const to = pointMap.get(segment.to) || null;
    if (!from || !to) {
      continue;
    }
    const a = toPixel(from);
    const b = toPixel(to);
    drawLine(png, a.x, a.y, b.x, b.y, color(segment.color, COLORS.blue), 9);
  }
  for (const point of points) {
    const px = toPixel(point);
    const fill = color(point.color, point.group === "mirror" ? COLORS.red : COLORS.blue);
    fillCircle(png, px.x, px.y, 16, fill);
    fillCircle(png, px.x, px.y, 7, COLORS.white);
  }

  fillRect(png, 110, 1240, width - 220, 180, COLORS.paleBlue);
  strokeRect(png, 110, 1240, width - 220, 180, COLORS.blue, 4);
  return PNG.sync.write(png);
}

async function writeCoordinateReferencePng(filePath, plan = {}, options = {}) {
  const buffer = createCoordinateReferencePngBuffer(plan, options);
  await fs.writeFile(filePath, buffer);
  return {
    byteLength: buffer.length,
    plan: {
      ...defaultCoordinatePlan(),
      ...plan,
      range: normalizeRange(plan.range || defaultCoordinatePlan().range)
    }
  };
}

module.exports = {
  createCoordinateReferencePngBuffer,
  defaultCoordinatePlan,
  mirrorPoint,
  writeCoordinateReferencePng
};
