"use strict";

function landmarkSnail() {
  return [
    { x: 0.07, y: 0.75 },
    { x: 0.15, y: 0.80 },
    { x: 0.34, y: 0.82 },
    { x: 0.56, y: 0.80 },
    { x: 0.78, y: 0.77 },
    { x: 0.89, y: 0.67 },
    { x: 0.90, y: 0.56 },
    { x: 0.84, y: 0.48 },
    { x: 0.79, y: 0.42 },
    { x: 0.83, y: 0.30 },
    { x: 0.94, y: 0.24 },
    { x: 0.76, y: 0.38 },
    { x: 0.70, y: 0.25 },
    { x: 0.67, y: 0.42 },
    { x: 0.60, y: 0.30 },
    { x: 0.48, y: 0.20 },
    { x: 0.30, y: 0.20 },
    { x: 0.15, y: 0.32 },
    { x: 0.09, y: 0.50 },
    { x: 0.14, y: 0.66 },
    { x: 0.29, y: 0.73 },
    { x: 0.47, y: 0.72 },
    { x: 0.62, y: 0.63 },
    { x: 0.61, y: 0.47 },
    { x: 0.52, y: 0.35 },
    { x: 0.38, y: 0.31 },
    { x: 0.27, y: 0.40 },
    { x: 0.25, y: 0.54 },
    { x: 0.34, y: 0.64 },
    { x: 0.48, y: 0.63 },
    { x: 0.54, y: 0.53 },
    { x: 0.47, y: 0.46 }
  ];
}

function reduced(points, indexes) {
  return indexes.map((index) => points[index]);
}

function buildSnailSimplePoints(pointCount) {
  const full = landmarkSnail();
  if (pointCount <= 24) {
    return reduced(full, [
      0, 2, 4, 6, 8, 10, 12, 13, 15, 17, 18, 20,
      22, 24, 26, 27, 29, 31
    ]);
  }
  return full;
}

module.exports = {
  id: "snail-simple",
  label: "Simple cartoon snail",
  recommendedPoints: {
    easy: 18,
    medium: 32,
    dense: 32,
    very_dense: 32
  },
  preferredDrawingArea: {
    x: 0.08,
    y: 0.17,
    width: 0.84,
    height: 0.58
  },
  buildPoints: buildSnailSimplePoints,
  reference: {
    source: "imagegen",
    path: "projects/punkt-zu-punkt-schnecke-cartoon/reference/snail-reference-imagegen-preferred.png"
  }
};
