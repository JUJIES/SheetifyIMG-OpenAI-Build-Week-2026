"use strict";

const { distance } = require("./geometry");

const DIGIT_WIDTH = 3;
const DIGIT_HEIGHT = 5;

function measureLabel(label, scale) {
  const text = String(label);
  const gap = scale;
  return {
    width: text.length * DIGIT_WIDTH * scale + Math.max(0, text.length - 1) * gap,
    height: DIGIT_HEIGHT * scale
  };
}

function normalize(vector, fallback = { x: 1, y: 0 }) {
  const length = Math.hypot(vector.x, vector.y);
  if (length < Number.EPSILON) {
    return fallback;
  }
  return {
    x: vector.x / length,
    y: vector.y / length
  };
}

function boxIntersects(left, right, padding = 0) {
  return !(
    left.x + left.width + padding < right.x
    || right.x + right.width + padding < left.x
    || left.y + left.height + padding < right.y
    || right.y + right.height + padding < left.y
  );
}

function outsidePenalty(box, page) {
  let penalty = 0;
  if (box.x < 0) {
    penalty += Math.abs(box.x);
  }
  if (box.y < 0) {
    penalty += Math.abs(box.y);
  }
  if (box.x + box.width > page.width) {
    penalty += box.x + box.width - page.width;
  }
  if (box.y + box.height > page.height) {
    penalty += box.y + box.height - page.height;
  }
  return penalty;
}

function labelCandidates(point, size, directions, offset) {
  return directions.map((direction) => {
    const centerX = point.x + direction.x * offset;
    const centerY = point.y + direction.y * offset;
    return {
      x: centerX - size.width / 2,
      y: centerY - size.height / 2,
      width: size.width,
      height: size.height
    };
  });
}

function uniqueDirections(directions) {
  const seen = new Set();
  return directions.filter((direction) => {
    const key = `${direction.x.toFixed(2)},${direction.y.toFixed(2)}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function layoutLabels(points, options) {
  const {
    page,
    dotRadius,
    labelScale,
    labelPadding
  } = options;
  const center = points.reduce((sum, point) => ({
    x: sum.x + point.x,
    y: sum.y + point.y
  }), { x: 0, y: 0 });
  center.x /= points.length;
  center.y /= points.length;

  const dotBoxes = points.map((point) => ({
    x: point.x - dotRadius,
    y: point.y - dotRadius,
    width: dotRadius * 2,
    height: dotRadius * 2
  }));
  const placed = [];
  let overlapCount = 0;

  for (let index = 0; index < points.length; index += 1) {
    const point = points[index];
    const previous = points[Math.max(0, index - 1)];
    const next = points[Math.min(points.length - 1, index + 1)];
    const tangent = normalize({ x: next.x - previous.x, y: next.y - previous.y });
    const normal = normalize({ x: -tangent.y, y: tangent.x });
    const outward = normalize({ x: point.x - center.x, y: point.y - center.y }, normal);
    const label = String(index + 1);
    const size = measureLabel(label, labelScale);
    const offset = dotRadius + labelPadding + Math.max(size.width, size.height) / 2;
    const directions = uniqueDirections([
      outward,
      normal,
      { x: -normal.x, y: -normal.y },
      { x: 1, y: 0 },
      { x: -1, y: 0 },
      { x: 0, y: -1 },
      { x: 0, y: 1 },
      normalize({ x: 1, y: -1 }),
      normalize({ x: -1, y: -1 }),
      normalize({ x: 1, y: 1 }),
      normalize({ x: -1, y: 1 })
    ]);

    const candidates = labelCandidates(point, size, directions, offset);
    const scored = candidates.map((box, candidateIndex) => {
      const placedOverlap = placed.filter((other) => boxIntersects(box, other, 2)).length;
      const dotOverlap = dotBoxes.filter((dotBox, dotIndex) => (
        dotIndex !== index && boxIntersects(box, dotBox, 2)
      )).length;
      const anchor = {
        x: box.x + box.width / 2,
        y: box.y + box.height / 2
      };
      return {
        box,
        score:
          outsidePenalty(box, page) * 10000
          + placedOverlap * 1000
          + dotOverlap * 120
          + distance(point, anchor) * 0.01
          + candidateIndex
      };
    }).sort((left, right) => left.score - right.score);

    const selected = scored[0].box;
    if (
      placed.some((other) => boxIntersects(selected, other, 2))
      || dotBoxes.some((dotBox, dotIndex) => dotIndex !== index && boxIntersects(selected, dotBox, 2))
      || outsidePenalty(selected, page) > 0
    ) {
      overlapCount += 1;
    }
    placed.push({
      ...selected,
      label
    });
  }

  return {
    labels: placed,
    overlapCount
  };
}

module.exports = {
  layoutLabels,
  measureLabel
};
