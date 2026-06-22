"use strict";

function distance(left, right) {
  return Math.hypot(right.x - left.x, right.y - left.y);
}

function lerp(left, right, t) {
  return left + (right - left) * t;
}

function lerpPoint(left, right, t) {
  return {
    x: lerp(left.x, right.x, t),
    y: lerp(left.y, right.y, t)
  };
}

function cubicPoint(p0, p1, p2, p3, t) {
  const mt = 1 - t;
  return {
    x:
      mt * mt * mt * p0.x
      + 3 * mt * mt * t * p1.x
      + 3 * mt * t * t * p2.x
      + t * t * t * p3.x,
    y:
      mt * mt * mt * p0.y
      + 3 * mt * mt * t * p1.y
      + 3 * mt * t * t * p2.y
      + t * t * t * p3.y
  };
}

function appendCubic(points, p1, p2, p3, steps = 32) {
  if (points.length === 0) {
    throw new Error("appendCubic requires an existing start point.");
  }
  const p0 = points[points.length - 1];
  for (let index = 1; index <= steps; index += 1) {
    points.push(cubicPoint(p0, p1, p2, p3, index / steps));
  }
}

function appendSpiralInward(points, options) {
  const {
    center,
    radiusX,
    radiusY,
    startTheta,
    turns,
    steps = 96
  } = options;

  for (let index = 0; index <= steps; index += 1) {
    const t = index / steps;
    const radius = 1 - t;
    const theta = startTheta + turns * Math.PI * 2 * t;
    points.push({
      x: center.x + radiusX * radius * Math.cos(theta),
      y: center.y + radiusY * radius * Math.sin(theta)
    });
  }
}

function boundsOf(points) {
  if (!points.length) {
    throw new Error("Cannot calculate bounds for an empty point list.");
  }

  return points.reduce((bounds, point) => ({
    minX: Math.min(bounds.minX, point.x),
    minY: Math.min(bounds.minY, point.y),
    maxX: Math.max(bounds.maxX, point.x),
    maxY: Math.max(bounds.maxY, point.y)
  }), {
    minX: points[0].x,
    minY: points[0].y,
    maxX: points[0].x,
    maxY: points[0].y
  });
}

function cumulativeLengths(points) {
  const lengths = [0];
  for (let index = 1; index < points.length; index += 1) {
    lengths.push(lengths[index - 1] + distance(points[index - 1], points[index]));
  }
  return lengths;
}

function samplePolyline(points, targetCount) {
  if (targetCount < 2) {
    throw new Error("Dot-to-dot patterns require at least two points.");
  }
  if (points.length < 2) {
    throw new Error("Cannot sample a route with fewer than two source points.");
  }

  const lengths = cumulativeLengths(points);
  const totalLength = lengths[lengths.length - 1];
  if (totalLength <= 0) {
    throw new Error("Cannot sample a zero-length route.");
  }

  const sampled = [];
  let segmentIndex = 1;

  for (let index = 0; index < targetCount; index += 1) {
    const targetLength = totalLength * (index / (targetCount - 1));
    while (segmentIndex < lengths.length - 1 && lengths[segmentIndex] < targetLength) {
      segmentIndex += 1;
    }

    const previousLength = lengths[segmentIndex - 1];
    const nextLength = lengths[segmentIndex];
    const segmentLength = Math.max(nextLength - previousLength, Number.EPSILON);
    const t = (targetLength - previousLength) / segmentLength;
    sampled.push(lerpPoint(points[segmentIndex - 1], points[segmentIndex], t));
  }

  return sampled;
}

function drawingAreaFromFractions(page, area) {
  return {
    x: Math.round(page.width * area.x),
    y: Math.round(page.height * area.y),
    width: Math.round(page.width * area.width),
    height: Math.round(page.height * area.height)
  };
}

function transformPoints(points, drawingArea) {
  const bounds = boundsOf(points);
  const sourceWidth = bounds.maxX - bounds.minX;
  const sourceHeight = bounds.maxY - bounds.minY;
  const scale = Math.min(
    drawingArea.width / Math.max(sourceWidth, Number.EPSILON),
    drawingArea.height / Math.max(sourceHeight, Number.EPSILON)
  );
  const offsetX = drawingArea.x + (drawingArea.width - sourceWidth * scale) / 2;
  const offsetY = drawingArea.y + (drawingArea.height - sourceHeight * scale) / 2;

  return points.map((point) => ({
    x: offsetX + (point.x - bounds.minX) * scale,
    y: offsetY + (point.y - bounds.minY) * scale
  }));
}

function round(value, digits = 3) {
  return Number(value.toFixed(digits));
}

module.exports = {
  appendCubic,
  appendSpiralInward,
  boundsOf,
  distance,
  drawingAreaFromFractions,
  round,
  samplePolyline,
  transformPoints
};
