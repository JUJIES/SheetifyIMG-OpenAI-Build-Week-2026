"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const net = require("node:net");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { chromium } = require("@playwright/test");
const { loadEnvFile } = require("../core/localEnv");
const { generateOwnerPasswordHash } = require("../server/owner-auth");

const FFPROBE = process.env.FFPROBE_PATH || "ffprobe";

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

function audioDurationMs(file) {
  const result = spawnSync(FFPROBE, [
    "-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", file
  ], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr || "ffprobe failed");
  return Math.round(Number.parseFloat(result.stdout.trim()) * 1000);
}

async function installCursor(page) {
  await page.addStyleTag({ content: `
    #sheetify-demo-cursor {
      position: fixed; left: 0; top: 0; z-index: 2147483647;
      width: 20px; height: 27px; pointer-events: none; opacity: 0;
      transform: translate(-3px, -2px); transition: opacity 180ms ease;
      filter: drop-shadow(0 2px 4px rgba(15, 23, 42, 0.38));
    }
    #sheetify-demo-cursor svg { display: block; width: 100%; height: 100%; }
  ` });
  await page.evaluate(() => {
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
}

async function smoothClick(page, locator, afterMs = 420) {
  await locator.scrollIntoViewIfNeeded();
  const box = await locator.boundingBox();
  assert.ok(box, "Click target has no visible bounding box.");
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 32 });
  await page.waitForTimeout(260);
  await locator.click();
  await page.waitForTimeout(afterMs);
}

async function main() {
  const repoRoot = path.resolve(__dirname, "..");
  const outputRoot = path.resolve(option(
    "output-root",
    path.join(repoRoot, "tmp", "voice-input-demo")
  ));
  const fakeAudioPath = path.resolve(option("audio"));
  const envFile = path.resolve(option(
    "env-file",
    process.env.SHEETIFYIMG_CAPTURE_ENV_FILE || path.join(repoRoot, ".env.local")
  ));
  assert.ok(fakeAudioPath && await fs.stat(fakeAudioPath).then((item) => item.isFile()).catch(() => false), "Fake microphone WAV is missing.");
  const fakeAudioDurationMs = audioDurationMs(fakeAudioPath);
  const recordDurationMs = Number.parseInt(option("record-ms", String(fakeAudioDurationMs)), 10);
  assert.ok(Number.isFinite(recordDurationMs) && recordDurationMs > 500, "Invalid recording duration.");
  assert.ok(recordDurationMs < fakeAudioDurationMs - 500, "Fake microphone audio needs at least 500 ms of trailing silence.");
  const runtimeDir = path.join(outputRoot, "runtime");
  const capturePath = path.join(outputRoot, "voice-input-ui.webm");
  const timelinePath = path.join(outputRoot, "timeline.json");
  const summaryPath = path.join(outputRoot, "summary.json");
  await fs.mkdir(outputRoot, { recursive: true });

  loadEnvFile(envFile, { required: true, overrideKeys: [
    "OPENAI_API_KEY", "OPENAI_BASE_URL", "SHEETIFYIMG_TRANSCRIPTION_MODEL", "SHEETIFYIMG_OPENAI_TIMEOUT_MS"
  ] });
  assert.ok(String(process.env.OPENAI_API_KEY || "").trim(), "The external runtime environment has no OpenAI API key.");

  const port = await freePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const ownerPassword = "voice-input-demo-owner-2026";
  const ownerHash = await generateOwnerPasswordHash(ownerPassword, { salt: Buffer.alloc(16, 53) });
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
    SHEETIFYIMG_AI_MODE: "openai",
    SHEETIFYIMG_REQUIRE_OPENAI: "1",
    SHEETIFYIMG_OWNER_AUTH_ENABLED: "1",
    SHEETIFYIMG_OWNER_AUTH_USERNAME: "owner",
    SHEETIFYIMG_OWNER_AUTH_PASSWORD_HASH: ownerHash,
    SHEETIFYIMG_BETA_ACCESS_ENABLED: "1",
    SHEETIFYIMG_BETA_ACCESS_SECRET: "sheetifyimg-voice-demo-isolated-secret-2026",
    SHEETIFYIMG_PAID_GENERATION_ENABLED: "0",
    SHEETIFYIMG_ADMIN_PRIVATE_ONLY: "1",
    SHEETIFYIMG_MAIL_INBOUND_WEBHOOK_ENABLED: "0",
    SHEETIFYIMG_EXPOSE_BILLING_STATUS: "0",
    SHEETIFYIMG_PUBLIC_URL: ""
  });

  const { startServer } = require("../server/dev-server");
  let server;
  let browser;
  let context;
  const events = [];
  let recordingStartedAt = 0;
  const mark = (id, details = {}) => {
    const row = { id, offsetMs: recordingStartedAt ? Date.now() - recordingStartedAt : 0, ...details };
    events.push(row);
    return row;
  };

  try {
    ({ server } = await startServer({ handleSignals: false }));
    const passResponse = await fetch(`${baseUrl}/api/admin/passes`, {
      method: "POST",
      headers: { authorization: ownerAuthorization, origin: baseUrl, "content-type": "application/json" },
      body: JSON.stringify({ label: "Voice Input Demo", credits: 0, invitationLocale: "de" })
    });
    const createdPass = await passResponse.json();
    assert.equal(passResponse.ok, true, createdPass.message || passResponse.status);

    browser = await chromium.launch({
      headless: true,
      args: [
        "--use-fake-ui-for-media-stream",
        "--use-fake-device-for-media-stream",
        `--use-file-for-fake-audio-capture=${fakeAudioPath}`
      ]
    });
    context = await browser.newContext({
      locale: "de-DE",
      viewport: { width: 390, height: 844 },
      isMobile: true,
      hasTouch: true,
      deviceScaleFactor: 2
    });
    await context.grantPermissions(["microphone"], { origin: baseUrl });
    await context.addInitScript(() => sessionStorage.setItem("sheetifyimg.feedback-reminder.v1", "shown"));
    const page = await context.newPage();
    await page.goto(createdPass.url, { waitUntil: "domcontentloaded" });
    await page.waitForURL(`${baseUrl}/app`, { timeout: 30000 });
    await smoothClick(page, page.getByRole("button", { name: "Zustimmen und Beta starten" }));
    await page.getByRole("heading", { name: "Projekte" }).waitFor();
    await smoothClick(page, page.locator("#newWorksheetButton"));
    await page.locator("#newWorksheetTitle").fill("Fotosynthese verstehen");
    await smoothClick(page, page.locator("#createNewWorksheetButton"));
    await page.getByRole("heading", { name: "Sheetify IMG AI" }).waitFor();
    await installCursor(page);

    await page.screencast.start({ path: capturePath, size: { width: 780, height: 1688 }, quality: 94 });
    recordingStartedAt = Date.now();
    mark("capture_started", { recordDurationMs, fakeAudioDurationMs });
    const voiceButton = page.locator("#chatVoiceButton");
    await page.waitForTimeout(700);
    await smoothClick(page, voiceButton, 120);
    await voiceButton.waitFor({ state: "visible" });
    await page.waitForFunction(() => document.querySelector("#chatVoiceButton")?.classList.contains("listening"));
    mark("recording_started");
    const voiceButtonBox = await voiceButton.boundingBox();
    assert.ok(voiceButtonBox, "Voice button has no recording-state bounding box.");
    await page.mouse.move(
      Math.max(18, voiceButtonBox.x - 38),
      Math.max(18, voiceButtonBox.y - 52),
      { steps: 22 }
    );
    await page.waitForTimeout(140);
    await page.waitForTimeout(recordDurationMs);
    await smoothClick(page, voiceButton, 80);
    mark("recording_stopped");
    await page.waitForFunction(() => document.querySelector("#chatVoiceButton")?.classList.contains("transcribing"), null, { timeout: 10000 }).catch(() => {});
    mark("transcribing_visible");
    await page.waitForFunction(() => (document.querySelector("#chatInput")?.value || "").trim().length > 20, null, { timeout: 90000 });
    const transcript = await page.locator("#chatInput").inputValue();
    mark("transcript_ready", { transcript });
    await page.waitForTimeout(2800);
    await page.screenshot({ path: path.join(outputRoot, "transcript-ready.png") });
    await page.screencast.stop();
    mark("capture_stopped");

    const summary = {
      schemaVersion: 1,
      realTranscription: true,
      virtualMicrophoneSource: true,
      recordDurationMs,
      fakeAudioDurationMs,
      captureDurationMs: events.at(-1)?.offsetMs || 0,
      transcript,
      capture: path.basename(capturePath),
      timeline: path.basename(timelinePath)
    };
    await fs.writeFile(timelinePath, `${JSON.stringify({ schemaVersion: 1, events }, null, 2)}\n`, "utf8");
    await fs.writeFile(summaryPath, `${JSON.stringify(summary, null, 2)}\n`, "utf8");
    console.log(JSON.stringify(summary, null, 2));
  } catch (error) {
    await fs.writeFile(timelinePath, `${JSON.stringify({ schemaVersion: 1, events, error: error.message }, null, 2)}\n`, "utf8").catch(() => {});
    if (context?.pages?.()[0]) {
      await context.pages()[0].screenshot({ path: path.join(outputRoot, "failure.png"), fullPage: true }).catch(() => {});
    }
    throw error;
  } finally {
    if (browser) await browser.close().catch(() => {});
    if (server) await new Promise((resolve) => server.close(resolve));
  }
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
