"use strict";

const fs = require("node:fs/promises");
const path = require("node:path");
const { renderDotToDotPng } = require("./pngRenderer");
const { renderDotToDotSvg } = require("./svgRenderer");
const { layoutLabels } = require("./labelLayout");
const { LABEL_MODES, buildLabels } = require("./labelPlan");
const {
  drawingAreaFromFractions,
  round,
  samplePolyline,
  transformPoints
} = require("./geometry");
const snailCartoon = require("./motifs/snailCartoon");
const snailSimple = require("./motifs/snailSimple");

const SCHEMA_VERSION = 1;
const GENERATOR_ID = "sheetifyimg-dot-to-dot";

const DEFAULT_PAGE = Object.freeze({
  format: "a4_portrait",
  width: 1240,
  height: 1754,
  units: "px"
});

const DEFAULT_RENDER = Object.freeze({
  dotRadius: 7,
  labelScale: 4,
  labelPadding: 13,
  lineWidth: 4,
  svgFontSize: 20
});

const MOTIFS = Object.freeze({
  [snailCartoon.id]: snailCartoon,
  [snailSimple.id]: snailSimple
});

function availableMotifs() {
  return Object.values(MOTIFS).map((motif) => ({
    id: motif.id,
    label: motif.label,
    recommendedPoints: motif.recommendedPoints
  }));
}

function resolveMotif(motifId) {
  const id = motifId || snailCartoon.id;
  const motif = MOTIFS[id];
  if (!motif) {
    throw new Error(`Unsupported dot-to-dot motif: ${id}`);
  }
  return motif;
}

function resolvePointCount(motif, options) {
  if (options.pointCount) {
    const pointCount = Number(options.pointCount);
    if (!Number.isInteger(pointCount) || pointCount < 2) {
      throw new Error("pointCount must be an integer greater than 1.");
    }
    return pointCount;
  }

  const density = options.density || "medium";
  const pointCount = motif.recommendedPoints[density];
  if (!pointCount) {
    throw new Error(`Unsupported point density: ${density}`);
  }
  return pointCount;
}

function outputFileMap() {
  return {
    worksheetPng: "worksheet.png",
    solutionPng: "solution.png",
    worksheetSvg: "worksheet.svg",
    solutionSvg: "solution.svg",
    manifest: "pattern-manifest.json",
    sequenceCsv: "sequence.csv"
  };
}

function addPointContracts(points, page, labelLayout, visibleLabels) {
  return points.map((point, index) => {
    const order = index + 1;
    const id = `dot_${String(order).padStart(3, "0")}`;
    const nextOrder = order < points.length ? order + 1 : null;
    const labelPosition = labelLayout.labels[index];
    const label = visibleLabels[index];

    return {
      id,
      order,
      sequenceLabel: String(order),
      label,
      x: round(point.x),
      y: round(point.y),
      normalized: {
        x: round(point.x / page.width, 6),
        y: round(point.y / page.height, 6)
      },
      labelPosition: {
        x: round(labelPosition.x),
        y: round(labelPosition.y),
        width: round(labelPosition.width),
        height: round(labelPosition.height)
      },
      nextId: nextOrder ? `dot_${String(nextOrder).padStart(3, "0")}` : null
    };
  });
}

function buildTaskSequence(points) {
  return {
    mode: "ordered_single_path",
    breaks: [],
    slots: points.map((point) => ({
      slotId: `task_${String(point.order).padStart(3, "0")}`,
      order: point.order,
      targetDotId: point.id,
      answerLabel: point.label,
      sequenceLabel: point.sequenceLabel,
      x: point.x,
      y: point.y,
      normalized: point.normalized,
      connectsTo: point.nextId
    }))
  };
}

function buildDotToDotPattern(options = {}) {
  const motif = resolveMotif(options.motif);
  const requestedPointCount = resolvePointCount(motif, options);
  const labelMode = options.labelMode || LABEL_MODES.SHUFFLED;
  const sampledRoute = motif.buildPoints
    ? motif.buildPoints(requestedPointCount)
    : samplePolyline(motif.buildRoute(), requestedPointCount);
  const pointCount = sampledRoute.length;
  const labelSeed = options.labelSeed || `${motif.id}:${pointCount}`;
  const visibleLabels = buildLabels({
    pointCount,
    mode: labelMode,
    seed: labelSeed,
    answerMin: options.answerMin || 1,
    answerMax: options.answerMax || pointCount
  });
  const page = {
    ...DEFAULT_PAGE,
    ...(options.page || {})
  };
  const render = {
    ...DEFAULT_RENDER,
    ...(options.render || {})
  };
  const drawingArea = drawingAreaFromFractions(page, options.drawingArea || motif.preferredDrawingArea);
  const transformedPoints = transformPoints(sampledRoute, drawingArea);
  const labelLayout = layoutLabels(transformedPoints, {
    page,
    dotRadius: render.dotRadius,
    labelScale: render.labelScale,
    labelPadding: render.labelPadding
  });
  const points = addPointContracts(transformedPoints, page, labelLayout, visibleLabels);
  const warnings = [];

  if (pointCount < 24) {
    warnings.push({
      code: "low_point_count",
      message: "The motif may be too abstract with fewer than 24 dots."
    });
  }
  if (labelLayout.overlapCount > 0) {
    warnings.push({
      code: "label_layout_pressure",
      message: `${labelLayout.overlapCount} labels could not be placed without layout pressure. Use fewer points or a larger page.`
    });
  }

  return {
    schemaVersion: SCHEMA_VERSION,
    generator: GENERATOR_ID,
    createdAt: options.now || new Date().toISOString(),
    motif: {
      id: motif.id,
      label: motif.label,
      reference: motif.reference || null
    },
    page,
    drawingArea,
    options: {
      density: options.density || null,
      requestedPointCount,
      pointCount,
      labelMode,
      labelSeed,
      answerMin: labelMode === LABEL_MODES.SEQUENCE ? null : Number(options.answerMin || 1),
      answerMax: labelMode === LABEL_MODES.SEQUENCE ? null : Number(options.answerMax || pointCount)
    },
    render,
    path: {
      type: "single_ordered_path",
      pointCount,
      closed: false
    },
    points,
    taskSequence: buildTaskSequence(points),
    warnings
  };
}

function sequenceCsv(pattern) {
  const header = "order,id,sequence_label,visible_label,answer_label,x,y,normalized_x,normalized_y,connects_to";
  const rows = pattern.points.map((point) => [
    point.order,
    point.id,
    point.sequenceLabel,
    point.label,
    point.label,
    point.x,
    point.y,
    point.normalized.x,
    point.normalized.y,
    point.nextId || ""
  ].join(","));
  return `${[header, ...rows].join("\n")}\n`;
}

async function writeJson(filePath, value) {
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function writeDotToDotPackage(outDir, options = {}) {
  const files = outputFileMap();
  const pattern = buildDotToDotPattern(options);
  const manifest = {
    ...pattern,
    outputs: files
  };

  await fs.mkdir(outDir, { recursive: true });
  await fs.writeFile(path.join(outDir, files.worksheetPng), renderDotToDotPng(pattern), "binary");
  await fs.writeFile(path.join(outDir, files.solutionPng), renderDotToDotPng(pattern, { solution: true }), "binary");
  await fs.writeFile(path.join(outDir, files.worksheetSvg), renderDotToDotSvg(pattern), "utf8");
  await fs.writeFile(path.join(outDir, files.solutionSvg), renderDotToDotSvg(pattern, { solution: true }), "utf8");
  await fs.writeFile(path.join(outDir, files.sequenceCsv), sequenceCsv(pattern), "utf8");
  await writeJson(path.join(outDir, files.manifest), manifest);

  return {
    outDir,
    manifest,
    files
  };
}

module.exports = {
  LABEL_MODES,
  availableMotifs,
  buildDotToDotPattern,
  outputFileMap,
  writeDotToDotPackage
};
