"use strict";

const { appendCubic, appendSpiralInward } = require("../geometry");

function buildSnailCartoonRoute() {
  const points = [{ x: 0.18, y: 0.66 }];

  appendCubic(points, { x: 0.27, y: 0.72 }, { x: 0.55, y: 0.72 }, { x: 0.74, y: 0.66 }, 44);
  appendCubic(points, { x: 0.84, y: 0.63 }, { x: 0.87, y: 0.52 }, { x: 0.78, y: 0.47 }, 34);
  appendCubic(points, { x: 0.75, y: 0.44 }, { x: 0.72, y: 0.44 }, { x: 0.69, y: 0.46 }, 20);

  appendCubic(points, { x: 0.70, y: 0.40 }, { x: 0.73, y: 0.34 }, { x: 0.78, y: 0.31 }, 22);
  appendCubic(points, { x: 0.83, y: 0.30 }, { x: 0.83, y: 0.36 }, { x: 0.78, y: 0.36 }, 18);
  appendCubic(points, { x: 0.74, y: 0.37 }, { x: 0.71, y: 0.43 }, { x: 0.69, y: 0.46 }, 22);

  appendCubic(points, { x: 0.64, y: 0.39 }, { x: 0.58, y: 0.35 }, { x: 0.52, y: 0.34 }, 32);
  appendCubic(points, { x: 0.38, y: 0.27 }, { x: 0.23, y: 0.35 }, { x: 0.22, y: 0.49 }, 42);
  appendCubic(points, { x: 0.21, y: 0.62 }, { x: 0.31, y: 0.70 }, { x: 0.43, y: 0.66 }, 40);
  appendCubic(points, { x: 0.53, y: 0.63 }, { x: 0.59, y: 0.59 }, { x: 0.626, y: 0.569 }, 28);

  appendSpiralInward(points, {
    center: { x: 0.44, y: 0.51 },
    radiusX: 0.20,
    radiusY: 0.16,
    startTheta: 0.12 * Math.PI,
    turns: 2.2,
    steps: 124
  });

  return points;
}

module.exports = {
  id: "snail-cartoon",
  label: "Cartoon snail",
  recommendedPoints: {
    easy: 28,
    medium: 46,
    dense: 70,
    very_dense: 96
  },
  preferredDrawingArea: {
    x: 0.09,
    y: 0.20,
    width: 0.82,
    height: 0.54
  },
  buildRoute: buildSnailCartoonRoute
};
