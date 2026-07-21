"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const net = require("node:net");
const path = require("node:path");
const { chromium } = require("@playwright/test");
const { generateOwnerPasswordHash } = require("../server/owner-auth");

function option(name, fallback = null) {
  const prefix = `--${name}=`;
  const value = process.argv.find((argument) => argument.startsWith(prefix));
  return value ? value.slice(prefix.length) : fallback;
}

async function freePort() {
  return new Promise((resolve, reject) => {
    const listener = net.createServer();
    listener.once("error", reject);
    listener.listen(0, "127.0.0.1", () => {
      const { port } = listener.address();
      listener.close((error) => error ? reject(error) : resolve(port));
    });
  });
}

async function main() {
  const runtimeDir = path.resolve(option("runtime-dir"));
  const outputRoot = path.resolve(option("output-root"));
  assert.ok(runtimeDir && outputRoot, "--runtime-dir and --output-root are required");
  const state = JSON.parse(await fs.readFile(path.join(runtimeDir, "state", "beta-access.json"), "utf8"));
  const pass = state.passes.find((entry) => entry.label === "Paid Devpost Demo") || state.passes[0];
  assert.ok(pass?.id, "No beta pass found in the paid demo runtime");
  await fs.mkdir(outputRoot, { recursive: true });

  const port = await freePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const ownerPassword = "paid-devpost-replay-owner-2026";
  const ownerHash = await generateOwnerPasswordHash(ownerPassword, { salt: Buffer.alloc(16, 61) });
  const ownerAuthorization = `Basic ${Buffer.from(`owner:${ownerPassword}`, "utf8").toString("base64")}`;

  delete process.env.RESEND_API_KEY;
  Object.assign(process.env, {
    NODE_ENV: "development",
    SHEETIFYIMG_RUNTIME_MODE: "development",
    SHEETIFYIMG_RUNTIME_DIR: runtimeDir,
    PROJECTS_DIR: path.join(runtimeDir, "projects"),
    WORKSHEETS_DIR: path.join(runtimeDir, "worksheets"),
    SHEETIFYIMG_BIND_HOST: "127.0.0.1",
    PORT: String(port),
    SHEETIFYIMG_SKIP_LOCAL_ENV: "1",
    SHEETIFYIMG_AI_MODE: "fake",
    SHEETIFYIMG_IMAGE_PROVIDER: "fake",
    SHEETIFYIMG_OWNER_AUTH_ENABLED: "1",
    SHEETIFYIMG_OWNER_AUTH_USERNAME: "owner",
    SHEETIFYIMG_OWNER_AUTH_PASSWORD_HASH: ownerHash,
    SHEETIFYIMG_BETA_ACCESS_ENABLED: "1",
    SHEETIFYIMG_BETA_ACCESS_SECRET: "sheetifyimg-paid-demo-isolated-secret-2026",
    SHEETIFYIMG_PAID_GENERATION_ENABLED: "0",
    SHEETIFYIMG_ADMIN_PRIVATE_ONLY: "1",
    SHEETIFYIMG_MAIL_INBOUND_WEBHOOK_ENABLED: "0",
    SHEETIFYIMG_PUBLIC_URL: ""
  });

  const { startServer } = require("../server/dev-server");
  let server;
  let browser;
  let actions;
  const events = [];
  const startedAt = Date.now();
  const mark = (id) => events.push({ id, offsetMs: Date.now() - startedAt });
  try {
    ({ server } = await startServer({ handleSignals: false }));
    const rotateResponse = await fetch(`${baseUrl}/api/admin/passes/${encodeURIComponent(pass.id)}/rotate`, {
      method: "POST",
      headers: { authorization: ownerAuthorization, origin: baseUrl, "content-type": "application/json" },
      body: JSON.stringify({ revokeSessions: true })
    });
    const rotated = await rotateResponse.json();
    assert.equal(rotateResponse.ok, true, rotated.message || rotateResponse.status);

    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({
      locale: "de-DE",
      viewport: { width: 1600, height: 900 },
      deviceScaleFactor: 1
    });
    await context.addInitScript(() => {
      sessionStorage.setItem("sheetifyimg.feedback-reminder.v1", "shown");
    });
    const page = await context.newPage();
    await page.goto(rotated.url, { waitUntil: "domcontentloaded" });
    const capturePath = path.join(outputRoot, "paid-run-ui-replay.webm");
    await page.screencast.start({ path: capturePath, size: { width: 1600, height: 900 }, quality: 94 });
    actions = await page.screencast.showActions({ cursor: "pointer", duration: 900, fontSize: 18, position: "bottom" });
    mark("recording_started");
    await page.screencast.showChapter("Ein echter Sheetify-Durchgang", {
      description: "Reproduzierbare UI-Aufnahme des zuvor bezahlten GPT-5.6- und gpt-image-2-Laufs.",
      duration: 2400
    });

    await page.getByRole("button", { name: "Zustimmen und Beta starten" }).click();
    await page.getByRole("heading", { name: "Projekte" }).waitFor();
    mark("workspace_entered");
    await page.waitForTimeout(1200);
    await page.getByRole("button", { name: "Fotosynthese verstehen" }).click();
    await page.getByRole("button", { name: "Projekt öffnen" }).click();
    await page.getByRole("heading", { name: "Sheetify IMG AI" }).waitFor();
    mark("project_opened");
    await page.waitForTimeout(1800);

    const conceptButton = page.locator(
      "#chatTimeline button[data-canvas-mode='content_proposal'], #chatTimeline button[data-canvas-mode='content']"
    ).last();
    await conceptButton.waitFor({ state: "visible", timeout: 30000 });
    await conceptButton.click();
    await page.locator("#canvasBody [data-worksheet-blueprint]").waitFor({ timeout: 30000 });
    mark("concept_opened");
    await page.waitForTimeout(2600);
    const nodes = page.locator("#canvasBody [data-blueprint-node]");
    if (await nodes.count()) {
      await nodes.first().click();
      await page.waitForTimeout(1600);
      if (await nodes.count() > 1) {
        await nodes.nth(1).click();
        await page.waitForTimeout(1600);
      }
    }

    const candidateCard = page.locator("#chatTimeline .candidate-chat-card").last();
    await candidateCard.waitFor({ state: "visible", timeout: 30000 });
    await candidateCard.scrollIntoViewIfNeeded();
    await candidateCard.locator("button[data-canvas-mode='candidates']").click();
    const canvasCandidate = page.locator("#canvasBody [data-capture-kind='candidate']").last();
    await canvasCandidate.waitFor({ state: "visible", timeout: 30000 });
    await canvasCandidate.click();
    await page.locator("#candidateViewerModal:not(.hidden) img").first().waitFor({ state: "visible", timeout: 30000 });
    mark("candidate_opened");
    await page.waitForTimeout(6500);

    await page.screencast.stop();
    await actions?.[Symbol.asyncDispose]?.();
    actions = null;
    mark("recording_stopped");
    await fs.writeFile(path.join(outputRoot, "replay-timeline.json"), `${JSON.stringify({ schemaVersion: 1, events }, null, 2)}\n`, "utf8");
    await context.close();
    console.log(JSON.stringify({ capturePath, durationMs: events.at(-1).offsetMs, paidSourceRuntime: runtimeDir }, null, 2));
  } finally {
    if (actions) await actions?.[Symbol.asyncDispose]?.().catch(() => {});
    if (browser) await browser.close().catch(() => {});
    if (server) await new Promise((resolve) => server.close(resolve));
  }
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
