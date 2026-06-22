"use strict";

const crypto = require("node:crypto");

const LABEL_MODES = Object.freeze({
  SEQUENCE: "sequence",
  SHUFFLED: "shuffled",
  ANSWER_CODE: "answer-code"
});

function seedToInteger(seed) {
  const digest = crypto.createHash("sha256").update(String(seed)).digest();
  return digest.readUInt32BE(0);
}

function seededRandom(seed) {
  let state = seedToInteger(seed);
  return function nextRandom() {
    state += 0x6D2B79F5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffled(values, seed) {
  const random = seededRandom(seed);
  const result = [...values];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    [result[index], result[swapIndex]] = [result[swapIndex], result[index]];
  }
  return result;
}

function integerRange(min, max) {
  return Array.from({ length: max - min + 1 }, (_, index) => min + index);
}

function buildLabels(options) {
  const {
    pointCount,
    mode = LABEL_MODES.SHUFFLED,
    seed = "sheetifyimg-dot-to-dot",
    answerMin = 1,
    answerMax = pointCount
  } = options;

  if (!Object.values(LABEL_MODES).includes(mode)) {
    throw new Error(`Unsupported label mode: ${mode}`);
  }

  if (mode === LABEL_MODES.SEQUENCE) {
    return Array.from({ length: pointCount }, (_, index) => String(index + 1));
  }

  const min = Number(answerMin);
  const max = Number(answerMax);
  if (!Number.isInteger(min) || !Number.isInteger(max) || min > max) {
    throw new Error("answerMin and answerMax must be valid integers.");
  }
  if (max - min + 1 < pointCount) {
    throw new Error(`Answer label range ${min}-${max} is too small for ${pointCount} points.`);
  }

  const values = integerRange(min, max);
  const selected = shuffled(values, `${seed}:${mode}:${pointCount}:${min}:${max}`).slice(0, pointCount);

  if (mode === LABEL_MODES.SHUFFLED) {
    return selected.map(String);
  }

  return selected.map(String);
}

module.exports = {
  LABEL_MODES,
  buildLabels
};
