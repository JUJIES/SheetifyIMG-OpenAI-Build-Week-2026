"use strict";

const assert = require("node:assert/strict");

const pointerPositions = new WeakMap();

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

function easeInOutCubic(value) {
  return value < 0.5
    ? 4 * value * value * value
    : 1 - Math.pow(-2 * value + 2, 3) / 2;
}

function boxCenter(box) {
  return {
    x: box.x + box.width / 2,
    y: box.y + box.height / 2
  };
}

async function actionablePoint(locator, box) {
  const target = locator.first();
  const candidates = [
    { x: box.x + box.width * 0.5, y: box.y + box.height * 0.5 },
    { x: box.x + box.width * 0.3, y: box.y + box.height * 0.5 },
    { x: box.x + box.width * 0.7, y: box.y + box.height * 0.5 },
    { x: box.x + box.width * 0.5, y: box.y + box.height * 0.3 },
    { x: box.x + box.width * 0.5, y: box.y + box.height * 0.7 }
  ];
  for (const point of candidates) {
    const hitsTarget = await target.evaluate((element, position) => {
      const hit = document.elementFromPoint(position.x, position.y);
      return Boolean(hit && (hit === element || element.contains(hit)));
    }, point).catch(() => false);
    if (hitsTarget) return point;
  }
  throw new Error("The demo cursor target is covered by another interface element.");
}

function boxesNear(left, right, tolerance = 1.5) {
  if (!left || !right) return false;
  return Math.abs(left.x - right.x) <= tolerance
    && Math.abs(left.y - right.y) <= tolerance
    && Math.abs(left.width - right.width) <= tolerance
    && Math.abs(left.height - right.height) <= tolerance;
}

async function installDemoCursor(page) {
  await page.addStyleTag({ content: `
    #sheetify-demo-cursor {
      position: fixed;
      left: 0;
      top: 0;
      z-index: 2147483647;
      width: 20px;
      height: 27px;
      pointer-events: none;
      opacity: 0;
      transform: translate(-3px, -2px);
      transition: opacity 180ms ease;
      filter: drop-shadow(0 2px 4px rgba(15, 23, 42, 0.38));
    }
    #sheetify-demo-cursor svg { display: block; width: 100%; height: 100%; }
  ` });
  await page.evaluate(() => {
    document.querySelector("#sheetify-demo-cursor")?.remove();
    const cursor = document.createElement("div");
    cursor.id = "sheetify-demo-cursor";
    cursor.innerHTML = '<svg viewBox="0 0 24 32" aria-hidden="true"><path d="M2 2L2 25L8.4 19.2L13 29L18 26.7L13.4 17H22L2 2Z" fill="white" stroke="#172033" stroke-width="1.8" stroke-linejoin="round"/></svg>';
    document.documentElement.append(cursor);
    document.addEventListener("mousemove", (event) => {
      cursor.style.left = `${event.clientX}px`;
      cursor.style.top = `${event.clientY}px`;
      cursor.style.opacity = "1";
    }, { passive: true });
  });
  pointerPositions.delete(page);
}

async function stableBoundingBox(locator, {
  samples = 3,
  intervalMs = 80,
  tolerance = 1.5
} = {}) {
  await locator.waitFor({ state: "visible" });
  await locator.scrollIntoViewIfNeeded();
  assert.equal(await locator.isVisible(), true, "The demo cursor target is not visible.");

  let previous = null;
  let stableSamples = 0;
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const current = await locator.boundingBox();
    assert.ok(current, "The demo cursor target has no visible bounding box.");
    if (boxesNear(previous, current, tolerance)) {
      stableSamples += 1;
      if (stableSamples >= samples - 1) return current;
    } else {
      stableSamples = 0;
    }
    previous = current;
    await locator.page().waitForTimeout(intervalMs);
  }
  return previous;
}

async function movePointerTo(page, destination, {
  minimumDurationMs = 300,
  maximumDurationMs = 760,
  pixelsPerMs = 0.72
} = {}) {
  const viewport = page.viewportSize() || { width: 1280, height: 720 };
  const current = pointerPositions.get(page) || {
    x: clamp(destination.x + 42, 18, viewport.width - 18),
    y: clamp(destination.y - 36, 18, viewport.height - 18)
  };
  const distance = Math.hypot(destination.x - current.x, destination.y - current.y);
  const durationMs = clamp(distance / pixelsPerMs, minimumDurationMs, maximumDurationMs);
  const frameMs = 1000 / 50;
  const steps = Math.max(12, Math.round(durationMs / frameMs));
  const delayMs = Math.max(12, Math.round(durationMs / steps));

  for (let step = 1; step <= steps; step += 1) {
    const progress = easeInOutCubic(step / steps);
    const x = current.x + (destination.x - current.x) * progress;
    const y = current.y + (destination.y - current.y) * progress;
    await page.mouse.move(x, y);
    if (step < steps) await page.waitForTimeout(delayMs);
  }
  pointerPositions.set(page, { x: destination.x, y: destination.y });
}

async function moveToLocator(page, locator, { holdMs = 260 } = {}) {
  let box = await stableBoundingBox(locator);
  let destination = boxCenter(box);
  if (page.__sheetifyDemoCursorMode === "custom") {
    await movePointerTo(page, destination);
    const settledBox = await stableBoundingBox(locator, { samples: 2, intervalMs: 60 });
    const settledDestination = boxCenter(settledBox);
    if (Math.hypot(settledDestination.x - destination.x, settledDestination.y - destination.y) > 2) {
      await movePointerTo(page, settledDestination, {
        minimumDurationMs: 140,
        maximumDurationMs: 260,
        pixelsPerMs: 0.9
      });
      box = settledBox;
      destination = settledDestination;
    }
  }
  await page.waitForTimeout(holdMs);
  return { box, destination };
}

async function smoothClick(page, locator, { afterMs = 520, pressMs = 70 } = {}) {
  if (page.__sheetifyDemoCursorMode !== "custom") {
    await locator.click();
    await page.waitForTimeout(afterMs);
    return;
  }

  const target = locator.first();
  const { destination } = await moveToLocator(page, target);
  const finalBox = await stableBoundingBox(target, { samples: 2, intervalMs: 50 });
  const finalDestination = await actionablePoint(target, finalBox);
  if (Math.hypot(finalDestination.x - destination.x, finalDestination.y - destination.y) > 2) {
    await movePointerTo(page, finalDestination, {
      minimumDurationMs: 120,
      maximumDurationMs: 240,
      pixelsPerMs: 0.95
    });
  }
  await page.mouse.click(finalDestination.x, finalDestination.y, { delay: pressMs });
  pointerPositions.set(page, finalDestination);
  await page.waitForTimeout(afterMs);
}

module.exports = {
  installDemoCursor,
  movePointerTo,
  moveToLocator,
  smoothClick,
  stableBoundingBox
};
