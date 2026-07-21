"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const net = require("node:net");
const path = require("node:path");
const { chromium } = require("@playwright/test");
const { loadEnvFile } = require("../core/localEnv");
const { generateOwnerPasswordHash } = require("../server/owner-auth");
const {
  installDemoCursor,
  movePointerTo,
  smoothClick
} = require("./demo-capture-pointer");
const {
  captureVoiceDraft,
  chromiumVoiceCaptureArgs,
  loadVoiceInputManifest
} = require("./demo-capture-voice");

const AI_ENV_KEYS = [
  "OPENAI_API_KEY",
  "OPENAI_BASE_URL",
  "SHEETIFYIMG_TEXT_MODEL",
  "SHEETIFYIMG_REASONING_MODEL",
  "SHEETIFYIMG_TRANSCRIPTION_MODEL",
  "SHEETIFYIMG_OPENAI_TIMEOUT_MS"
];

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

async function readJsonl(filePath) {
  const text = await fs.readFile(filePath, "utf8").catch((error) => {
    if (error.code === "ENOENT") return "";
    throw error;
  });
  return text.trim().split("\n").filter(Boolean).map((line) => JSON.parse(line));
}

async function findFiles(root, fileName) {
  const matches = [];
  const entries = await fs.readdir(root, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    const fullPath = path.join(root, entry.name);
    if (entry.isDirectory()) {
      matches.push(...await findFiles(fullPath, fileName));
    } else if (entry.name === fileName) {
      matches.push(fullPath);
    }
  }
  return matches;
}

async function findFilesMatching(root, pattern) {
  const matches = [];
  const entries = await fs.readdir(root, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    const fullPath = path.join(root, entry.name);
    if (entry.isDirectory()) {
      matches.push(...await findFilesMatching(fullPath, pattern));
    } else if (pattern.test(entry.name)) {
      matches.push(fullPath);
    }
  }
  return matches;
}

async function visibleCommandInventory(page) {
  return page.locator("#chatTimeline button[data-command]").evaluateAll((buttons) => buttons.map((button) => ({
    command: button.dataset.command,
    label: button.textContent?.replace(/\s+/g, " ").trim() || "",
    disabled: button.disabled,
    visible: Boolean(button.offsetWidth || button.offsetHeight || button.getClientRects().length)
  })));
}

async function firstVisibleLocator(locators = [], { timeoutMs = 30000, pollMs = 200 } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    for (const locator of locators) {
      if (await locator.count() && await locator.isVisible().catch(() => false)) {
        return locator;
      }
    }
    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }
  throw new Error(`No expected UI action became visible within ${timeoutMs} ms.`);
}

async function dismissBetaFeedback(page) {
  const feedbackLayer = page.locator("#betaFeedbackLayer:not(.hidden)");
  if (!await feedbackLayer.count() || !await feedbackLayer.isVisible().catch(() => false)) return false;
  await page.locator("#betaFeedbackClose").click();
  await feedbackLayer.waitFor({ state: "hidden", timeout: 5000 });
  return true;
}

async function smoothClickIfVisible(page, locator, options = {}) {
  if (!await locator.count() || !await locator.isVisible().catch(() => false)) {
    return false;
  }
  await smoothClick(page, locator, options);
  return true;
}

function boxesOverlap(left, right, padding = 4) {
  if (!left || !right) return false;
  return left.x < right.x + right.width + padding
    && left.x + left.width + padding > right.x
    && left.y < right.y + right.height + padding
    && left.y + left.height + padding > right.y;
}

async function moveFeedbackTriggerAwayFrom(page, target) {
  const trigger = page.locator("#betaFeedbackTrigger:not(.hidden)");
  if (!await trigger.count() || !await trigger.isVisible().catch(() => false)) return false;
  const [triggerBox, targetBox] = await Promise.all([
    trigger.boundingBox(),
    target.boundingBox()
  ]);
  if (!boxesOverlap(triggerBox, targetBox)) return false;

  const viewport = page.viewportSize() || { width: 390, height: 844 };
  const start = {
    x: triggerBox.x + triggerBox.width / 2,
    y: triggerBox.y + triggerBox.height / 2
  };
  const destination = {
    x: Math.max(triggerBox.width / 2 + 12, viewport.width - triggerBox.width / 2 - 12),
    y: Math.min(116, viewport.height - triggerBox.height / 2 - 12)
  };

  await movePointerTo(page, start, { minimumDurationMs: 220, maximumDurationMs: 420 });
  await page.mouse.down();
  await movePointerTo(page, destination, { minimumDurationMs: 360, maximumDurationMs: 620 });
  await page.mouse.up();
  await page.waitForTimeout(320);
  return true;
}

async function main() {
  const repoRoot = path.resolve(__dirname, "..");
  const appSourceRoot = path.resolve(option("app-source-root", repoRoot));
  const captureProfileName = String(option("capture-profile", "")).trim();
  const captureProfilePath = path.join(repoRoot, "tools", "devpost-video", "config", "capture-profiles.json");
  const captureProfiles = captureProfileName
    ? JSON.parse(await fs.readFile(captureProfilePath, "utf8"))
    : null;
  const captureProfile = captureProfileName
    ? captureProfiles?.profiles?.[captureProfileName]
    : null;
  if (captureProfileName) {
    assert.ok(captureProfile, `Unknown capture profile: ${captureProfileName}`);
  }
  const outputRoot = path.resolve(option("output-root", path.join(repoRoot, "tmp", "paid-devpost-demo")));
  const runtimeDir = path.resolve(option("runtime-dir", path.join(outputRoot, "runtime")));
  const reusePass = option("reuse-pass", "0") === "1";
  const configuredScenarioFile = captureProfile?.scenarioFile
    ? path.resolve(path.dirname(captureProfilePath), captureProfile.scenarioFile)
    : null;
  const scenarioFile = option("scenario-file", configuredScenarioFile);
  const scenario = scenarioFile
    ? JSON.parse(await fs.readFile(path.resolve(scenarioFile), "utf8"))
    : {};
  const captureProfileFingerprint = captureProfile
    ? crypto.createHash("sha256").update(JSON.stringify({ captureProfile, scenario })).digest("hex")
    : null;
  const journey = String(option("journey", captureProfile?.journey || scenario.journey || "first-draft")).trim();
  const betaOnboardingV2 = journey === "beta-onboarding-v2";
  const simpleDevpost = journey === "devpost-simple";
  const fullOnboarding = journey === "full-onboarding" || betaOnboardingV2;
  const firstWorksheetOnboarding = journey === "first-worksheet-onboarding";
  const firstWorksheetDialogue = journey === "first-worksheet-dialogue" || betaOnboardingV2 || simpleDevpost;
  const storesWorksheet = fullOnboarding || firstWorksheetOnboarding || (firstWorksheetDialogue && !simpleDevpost);
  const locale = String(scenario.locale || "de").trim().toLowerCase() === "en" ? "en" : "de";
  const localeTag = locale === "en" ? "en-US" : "de-DE";
  const uiCopy = locale === "en"
    ? {
        connect: "Connect",
        consent: "Agree and start the beta",
        projects: "Projects",
        conceptForward: /draft|continue working/i,
        viewConcept: "View concept",
        reviseElement: "Revise this element",
        saveWorksheet: "Save worksheet",
        anotherVariant: "New draft",
        viewDraft: "View draft"
      }
    : {
        connect: "Verbinden",
        consent: "Zustimmen und Beta starten",
        projects: "Projekte",
        conceptForward: /Entwurf|weiterarbeiten/i,
        viewConcept: "Konzept ansehen",
        reviseElement: "Dieses Element überarbeiten",
        saveWorksheet: "Arbeitsblatt ablegen",
        anotherVariant: "Neuer Entwurf",
        viewDraft: "Entwurf ansehen"
      };
  const passLabel = String(scenario.passLabel || "Paid Devpost Demo").trim();
  const projectTitle = String(scenario.projectTitle || "Fotosynthese verstehen").trim();
  const teacherPrompt = String(scenario.teacherPrompt || [
    "Ich brauche für meine 7. Klasse Biologie ein einseitiges Arbeitsblatt zur Fotosynthese.",
    "Es soll einen kurzen verständlichen Lesetext, ein einfaches Schaubild und genau drei Aufgaben enthalten:",
    "zuerst beschreiben, dann erklären und am Ende beurteilen.",
    "Bitte ruhig und übersichtlich gestalten, nicht kindlich und ohne sichtbare Lösungen.",
    "Erstelle daraus direkt ein vollständiges Arbeitsblatt-Konzept."
  ].join(" ")).trim();
  const openingPrompt = String(scenario.openingPrompt || "").trim();
  const conceptRevisionPrompt = String(scenario.conceptRevisionPrompt || [
    "Bitte formuliere die letzte Aufgabe leichter und ergänze einen kurzen Satzstarter.",
    "Alle anderen Texte, Aufgaben und die visuelle Idee sollen unverändert bleiben."
  ].join(" ")).trim();
  const draftRevisionPrompt = String(scenario.draftRevisionPrompt || [
    "Behalte alle Texte und Aufgaben unverändert.",
    "Vergrößere die zentrale Vergleichszeichnung und gib der letzten Aufgabe etwas mehr Schreibfläche.",
    "Der übrige Aufbau soll erhalten bleiben."
  ].join(" ")).trim();
  assert.ok(passLabel, "The scenario requires a non-empty passLabel.");
  assert.ok(projectTitle, "The scenario requires a non-empty projectTitle.");
  assert.ok(teacherPrompt, "The scenario requires a non-empty teacherPrompt.");
  if (firstWorksheetDialogue) {
    assert.ok(openingPrompt, "The first-worksheet dialogue journey requires a non-empty openingPrompt.");
  }
  if (fullOnboarding) {
    assert.ok(conceptRevisionPrompt, "The full onboarding journey requires a conceptRevisionPrompt.");
    assert.ok(draftRevisionPrompt, "The full onboarding journey requires a draftRevisionPrompt.");
  }
  const mobile = option("mobile", captureProfile?.mobile ? "1" : "0") === "1";
  const cursorMode = String(option("cursor", captureProfile?.cursor || "custom")).trim().toLowerCase();
  const inputMode = String(option("input-mode", captureProfile?.inputMode || "keyboard")).trim().toLowerCase();
  const cleanCapture = {
    enabled: captureProfile?.cleanCapture?.enabled === true,
    enterWorkspaceBeforeRecording: captureProfile?.cleanCapture?.enterWorkspaceBeforeRecording === true,
    dismissTutorialBeforeRecording: captureProfile?.cleanCapture?.dismissTutorialBeforeRecording === true,
    hideFeedbackUi: captureProfile?.cleanCapture?.hideFeedbackUi === true
  };
  const voiceInputManifestOption = String(option("voice-input-manifest", "") || "").trim();
  const voiceInputManifest = inputMode === "mixed"
    ? await loadVoiceInputManifest(voiceInputManifestOption)
    : null;
  assert.match(inputMode, /^(keyboard|mixed)$/, "--input-mode must be keyboard or mixed.");
  if (inputMode === "mixed") {
    assert.equal(captureProfile?.voiceInput?.turn, "teacherPrompt", "The mixed capture currently supports the teacherPrompt turn.");
  }
  const strictUiChecks = option("strict-ui-checks", captureProfile?.strictUiChecks ? "1" : "0") === "1";
  const captureQuality = Number.parseInt(option("capture-quality", String(captureProfile?.captureQuality || 94)), 10);
  const timeoutConfig = captureProfile?.timeouts || {};
  const providerTextTimeoutMs = Number(timeoutConfig.providerTextMs || 240000);
  const providerImageTimeoutMs = Number(timeoutConfig.providerImageMs || 300000);
  const advisoryTimeoutMs = Number(timeoutConfig.advisoryMs || 240000);
  const conceptTimeoutMs = Number(timeoutConfig.conceptMs || 300000);
  const conceptRevisionTimeoutMs = Number(timeoutConfig.conceptRevisionMs || 300000);
  const imageTimeoutMs = Number(timeoutConfig.imageMs || 360000);
  const uiTimeoutMs = Number(timeoutConfig.uiMs || 45000);
  const conceptTour = {
    overviewHoldMs: Number(captureProfile?.conceptTour?.overviewHoldMs || 1800),
    detailSteps: Math.max(1, Number(captureProfile?.conceptTour?.detailSteps || 2)),
    detailHoldMs: Number(captureProfile?.conceptTour?.detailHoldMs || 1300),
    returnToOverviewHoldMs: Number(captureProfile?.conceptTour?.returnToOverviewHoldMs || 0)
  };
  assert.match(cursorMode, /^(custom|playwright|none)$/, "--cursor must be custom, playwright or none.");
  assert.ok(Number.isInteger(captureQuality) && captureQuality >= 50 && captureQuality <= 100, "--capture-quality must be an integer from 50 to 100.");
  assert.equal(!(fullOnboarding || firstWorksheetOnboarding || firstWorksheetDialogue) || mobile, true, "The onboarding capture currently requires --mobile=1.");
  const viewport = mobile ? { width: 390, height: 844 } : { width: 1600, height: 900 };
  const captureSize = viewport;
  const envFile = path.resolve(option(
    "env-file",
    process.env.SHEETIFYIMG_CAPTURE_ENV_FILE || path.join(repoRoot, ".env.local")
  ));
  const capturePath = path.join(outputRoot, "paid-live-ui.webm");
  const timelinePath = path.join(outputRoot, "timeline.json");
  const summaryPath = path.join(outputRoot, "paid-run-summary.json");
  await fs.mkdir(outputRoot, { recursive: true });

  loadEnvFile(envFile, { required: true, overrideKeys: AI_ENV_KEYS });
  assert.ok(String(process.env.OPENAI_API_KEY || "").trim(), "The external runtime environment has no OpenAI API key.");

  const port = await freePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const ownerPassword = "paid-devpost-demo-owner-2026";
  const ownerHash = await generateOwnerPasswordHash(ownerPassword, { salt: Buffer.alloc(16, 47) });
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
    SHEETIFYIMG_OPENAI_TIMEOUT_MS: String(providerTextTimeoutMs),
    SHEETIFYIMG_PLANNING_FLOW: "v2",
    SHEETIFYIMG_SEMANTIC_INTERPRETER: "on",
    SHEETIFYIMG_CHAT_INTENT_INTERPRETER: "on",
    SHEETIFYIMG_CHAT_NARRATION: "on",
    SHEETIFYIMG_IMAGE_PROVIDER: "openai",
    SHEETIFYIMG_IMAGE_MODEL: "gpt-image-2",
    SHEETIFYIMG_IMAGE_PRESET: "sparsam",
    SHEETIFYIMG_IMAGE_SIZE: "1120x1584",
    SHEETIFYIMG_IMAGE_TIMEOUT_MS: String(providerImageTimeoutMs),
    SHEETIFYIMG_MAX_IMAGE_CANDIDATES: "1",
    SHEETIFYIMG_OWNER_AUTH_ENABLED: "1",
    SHEETIFYIMG_OWNER_AUTH_USERNAME: "owner",
    SHEETIFYIMG_OWNER_AUTH_PASSWORD_HASH: ownerHash,
    SHEETIFYIMG_BETA_ACCESS_ENABLED: "1",
    SHEETIFYIMG_BETA_ACCESS_SECRET: "sheetifyimg-paid-demo-isolated-secret-2026",
    SHEETIFYIMG_PAID_GENERATION_ENABLED: "1",
    SHEETIFYIMG_BETA_MAX_PAGES_PER_DRAFT: "1",
    SHEETIFYIMG_ADMIN_PRIVATE_ONLY: "1",
    SHEETIFYIMG_MAIL_INBOUND_WEBHOOK_ENABLED: "0",
    SHEETIFYIMG_EXPOSE_BILLING_STATUS: "0",
    SHEETIFYIMG_PUBLIC_URL: ""
  });

  await fs.access(path.join(appSourceRoot, "server", "dev-server.js"));
  await fs.access(path.join(appSourceRoot, "public", "app.js"));
  const { startServer } = require(path.join(appSourceRoot, "server", "dev-server"));
  let server;
  let browser;
  const pageErrors = [];
  const startedAt = Date.now();
  let screencastActive = false;
  let resolveFirstFrame;
  const firstFrameReady = new Promise((resolve) => {
    resolveFirstFrame = resolve;
  });
  const captureClock = {
    firstFrameTimestampMs: null,
    lastFrameTimestampMs: null,
    firstFrameObservedAtMs: null,
    lastFrameObservedAtMs: null,
    stoppedTimestampMs: null,
    videoDurationMs: null,
    recorderFrameNumber: null,
    encodedFrameCount: 0,
    frameCount: 0,
    viewportWidth: null,
    viewportHeight: null
  };
  const events = [];
  const actions = [];
  const uiChecks = [];
  const checkUi = (id, passed, details = {}) => {
    const row = { id, passed: Boolean(passed), ...details };
    uiChecks.push(row);
    if (strictUiChecks && !row.passed) {
      assert.fail(`Strict UI check failed: ${id}`);
    }
    return row.passed;
  };
  const currentVideoOffsetMs = () => Math.max(0, Math.round(captureClock.encodedFrameCount * 1000 / 25));
  const mark = (id, details = {}) => {
    const { videoOffsetMs = currentVideoOffsetMs(), ...publicDetails } = details;
    const row = {
      id,
      ...publicDetails,
      _wallTimestampMs: Date.now(),
      _videoOffsetMs: videoOffsetMs
    };
    events.push(row);
    return row;
  };

  const observeFrame = ({ timestamp, viewportWidth, viewportHeight }) => {
    const observedAtMs = Date.now();
    if (captureClock.firstFrameTimestampMs === null) {
      captureClock.firstFrameTimestampMs = timestamp;
      captureClock.firstFrameObservedAtMs = observedAtMs;
      captureClock.viewportWidth = viewportWidth;
      captureClock.viewportHeight = viewportHeight;
      resolveFirstFrame();
    }
    const frameNumber = Math.floor(((timestamp - captureClock.firstFrameTimestampMs) / 1000) * 25);
    if (captureClock.recorderFrameNumber !== null) {
      captureClock.encodedFrameCount += Math.max(0, frameNumber - captureClock.recorderFrameNumber);
    }
    captureClock.recorderFrameNumber = frameNumber;
    captureClock.lastFrameTimestampMs = timestamp;
    captureClock.lastFrameObservedAtMs = observedAtMs;
    captureClock.frameCount += 1;
  };

  const finalizeVideoClock = (stopRequestedAtMs) => {
    const sinceLastFrameMs = captureClock.lastFrameObservedAtMs === null
      ? 1000
      : Math.max(stopRequestedAtMs - captureClock.lastFrameObservedAtMs, 1000);
    const tailFrames = Math.max(1, Math.floor((sinceLastFrameMs / 1000) * 25));
    captureClock.videoDurationMs = currentVideoOffsetMs() + Math.round(tailFrames * 1000 / 25);
  };

  const recordAction = async (page, id, {
    perform,
    waitForResult,
    evidenceFile = null,
    details = {}
  }) => {
    const action = {
      id,
      ...details,
      status: "running",
      _startWallTimestampMs: Date.now(),
      _startVideoOffsetMs: currentVideoOffsetMs(),
      _interactionEndWallTimestampMs: null,
      _interactionEndVideoOffsetMs: null,
      _resultWallTimestampMs: null,
      _resultVideoOffsetMs: null,
      evidence: evidenceFile ? evidenceFile.replace(/\\/g, "/") : null
    };
    actions.push(action);
    try {
      const performed = await perform();
      action._interactionEndWallTimestampMs = Date.now();
      action._interactionEndVideoOffsetMs = currentVideoOffsetMs();
      const result = waitForResult ? await waitForResult(performed) : performed;
      action._resultWallTimestampMs = Date.now();
      action._resultVideoOffsetMs = currentVideoOffsetMs();
      if (evidenceFile) {
        const evidencePath = path.join(outputRoot, evidenceFile);
        await fs.mkdir(path.dirname(evidencePath), { recursive: true });
        await page.screenshot({ path: evidencePath });
      }
      action.status = "passed";
      return result;
    } catch (error) {
      action._interactionEndWallTimestampMs ||= Date.now();
      action._interactionEndVideoOffsetMs ??= currentVideoOffsetMs();
      action._resultWallTimestampMs = Date.now();
      action._resultVideoOffsetMs = currentVideoOffsetMs();
      action.status = "failed";
      action.error = error.message;
      throw error;
    }
  };

  const buildTimeline = (error = null) => {
    const wallOriginMs = captureClock.firstFrameObservedAtMs || startedAt;
    const wallOffset = (timestampMs) => Math.max(0, Math.round(Number(timestampMs || wallOriginMs) - wallOriginMs));
    const normalizedEvents = events.map(({ _wallTimestampMs, _videoOffsetMs, ...event }) => ({
      ...event,
      offsetMs: Math.max(0, Math.round(_videoOffsetMs || 0)),
      wallOffsetMs: wallOffset(_wallTimestampMs)
    }));
    const normalizedActions = actions.map(({
      _startWallTimestampMs,
      _startVideoOffsetMs,
      _interactionEndWallTimestampMs,
      _interactionEndVideoOffsetMs,
      _resultWallTimestampMs,
      _resultVideoOffsetMs,
      ...action
    }) => {
      const startMs = Math.max(0, Math.round(_startVideoOffsetMs || 0));
      const interactionEndMs = Math.max(startMs, Math.round(_interactionEndVideoOffsetMs ?? _startVideoOffsetMs ?? 0));
      const resultMs = Math.max(interactionEndMs, Math.round(_resultVideoOffsetMs ?? _interactionEndVideoOffsetMs ?? _startVideoOffsetMs ?? 0));
      const wallStartMs = wallOffset(_startWallTimestampMs);
      const wallInteractionEndMs = wallOffset(_interactionEndWallTimestampMs || _startWallTimestampMs);
      const wallResultMs = wallOffset(_resultWallTimestampMs || _interactionEndWallTimestampMs || _startWallTimestampMs);
      return {
        ...action,
        startMs,
        interactionEndMs,
        resultMs,
        endMs: resultMs,
        interactionDurationMs: Math.max(0, interactionEndMs - startMs),
        resultWaitMs: Math.max(0, resultMs - interactionEndMs),
        durationMs: Math.max(0, resultMs - startMs),
        wallStartMs,
        wallInteractionEndMs,
        wallResultMs,
        wallInteractionDurationMs: Math.max(0, wallInteractionEndMs - wallStartMs),
        wallResultWaitMs: Math.max(0, wallResultMs - wallInteractionEndMs),
        wallDurationMs: Math.max(0, wallResultMs - wallStartMs)
      };
    });
    return {
      schemaVersion: 2,
      clock: {
        origin: captureClock.firstFrameTimestampMs ? "encoded_screencast_frames" : "process_start_fallback",
        frameCount: captureClock.frameCount,
        encodedFrameCount: captureClock.encodedFrameCount,
        firstFrameTimestampMs: captureClock.firstFrameTimestampMs,
        lastFrameTimestampMs: captureClock.lastFrameTimestampMs,
        durationMs: captureClock.videoDurationMs ?? currentVideoOffsetMs(),
        wallDurationMs: captureClock.stoppedTimestampMs !== null
          ? wallOffset(captureClock.stoppedTimestampMs)
          : normalizedEvents.at(-1)?.wallOffsetMs || 0,
        viewport: captureClock.viewportWidth && captureClock.viewportHeight
          ? { width: captureClock.viewportWidth, height: captureClock.viewportHeight }
          : null
      },
      events: normalizedEvents,
      actions: normalizedActions,
      ...(error ? { error } : {})
    };
  };

  const suppressFeedbackReminder = async (page) => {
    await page.evaluate(() => {
      sessionStorage.setItem("sheetifyimg.feedback-reminder.v2", "shown");
      sessionStorage.setItem("sheetifyimg.feedback-render-nudge.v1", "shown");
      const reminder = document.querySelector("#betaFeedbackReminder");
      const close = document.querySelector(".beta-feedback-reminder-close");
      if (reminder && !reminder.classList.contains("hidden") && close instanceof HTMLElement) {
        close.click();
      }
    });
  };

  const dismissAutomaticTutorial = async (page) => {
    // A fresh Beta pass may open the normal tutorial shortly after consent.
    // Close it through its real UI before starting the captured worksheet flow.
    await page.waitForTimeout(1000);
    const modal = page.locator("#tutorialModalLayer:not(.hidden)");
    if (!await modal.isVisible().catch(() => false)) {
      return false;
    }
    const closeButton = page.locator("#tutorialModalClose");
    await closeButton.waitFor({ state: "visible", timeout: 5000 });
    await smoothClick(page, closeButton, { afterMs: 250 });
    await page.locator("#tutorialModalLayer.hidden").waitFor({ state: "attached", timeout: 5000 });
    return true;
  };

  const waitForWorksheetArchive = async (page) => {
    await page.locator("#worksheetsViewButton[aria-selected='true']").waitFor({ state: "visible", timeout: 60000 });
    const visibleWorksheet = page.locator("[data-item-id^='worksheet:']:visible").first();
    await visibleWorksheet.waitFor({ state: "visible", timeout: 60000 });

    // The worksheet list refreshes immediately after a deposit. Resolve the
    // locator again if that refresh replaces the selected row mid-click.
    let opened = false;
    for (let attempt = 0; attempt < 4 && !opened; attempt += 1) {
      try {
        await smoothClick(page, page.locator("[data-item-id^='worksheet:']:visible").first(), {
          afterMs: 300
        });
        opened = true;
      } catch (error) {
        if (!/not attached to the DOM|element is not stable/i.test(String(error?.message || error))) {
          throw error;
        }
        await page.waitForTimeout(250);
      }
    }
    assert.ok(opened, "The deposited worksheet could not be opened after the archive refreshed.");
    if (await page.locator("#mobilePreviewLayer").isVisible().catch(() => false)) {
      await page.locator("#mobilePreviewLayer:not(.hidden)").waitFor({ state: "visible", timeout: 60000 });
      await page.locator("#mobilePreviewBody .mobile-pdf-row")
        .first()
        .waitFor({ state: "visible", timeout: 60000 });
    } else if (await page.evaluate(() => window.matchMedia("(max-width: 760px)").matches)) {
      await page.locator("#mobilePreviewLayer:not(.hidden)").waitFor({ state: "visible", timeout: 60000 });
      await page.locator("#mobilePreviewBody .mobile-pdf-row")
        .first()
        .waitFor({ state: "visible", timeout: 60000 });
    } else {
      await page.locator("#projectView.worksheet-detail-view").waitFor({ state: "visible", timeout: 60000 });
    }
    return visibleWorksheet;
  };

  try {
    ({ server } = await startServer({ handleSignals: false }));
    let adminResponse;
    if (reusePass) {
      const accessState = JSON.parse(await fs.readFile(path.join(runtimeDir, "state", "beta-access.json"), "utf8"));
      const existingPass = accessState.passes.find((entry) => entry.label === passLabel);
      assert.ok(existingPass?.id, `No existing pass found with label: ${passLabel}`);
      adminResponse = await fetch(`${baseUrl}/api/admin/passes/${encodeURIComponent(existingPass.id)}/rotate`, {
        method: "POST",
        headers: {
          authorization: ownerAuthorization,
          origin: baseUrl,
          "content-type": "application/json"
        },
        body: JSON.stringify({ revokeSessions: true })
      });
    } else {
      adminResponse = await fetch(`${baseUrl}/api/admin/passes`, {
        method: "POST",
        headers: {
          authorization: ownerAuthorization,
          origin: baseUrl,
          "content-type": "application/json"
        },
        body: JSON.stringify({ label: passLabel, credits: 3, invitationLocale: locale })
      });
    }
    const createdPass = await adminResponse.json();
    assert.equal(adminResponse.ok, true, createdPass.message || adminResponse.status);

    browser = await chromium.launch({ headless: true, args: chromiumVoiceCaptureArgs(voiceInputManifest) });
    const context = await browser.newContext({
      locale: localeTag,
      viewport,
      isMobile: mobile,
      hasTouch: mobile,
      deviceScaleFactor: mobile ? 2 : 1
    });
    if (voiceInputManifest) {
      await context.grantPermissions(["microphone"], { origin: baseUrl });
    }
    await context.addInitScript(() => {
      sessionStorage.setItem("sheetifyimg.feedback-reminder.v2", "shown");
      sessionStorage.setItem("sheetifyimg.feedback-render-nudge.v1", "shown");
      sessionStorage.setItem("sheetifyimg.feedback-edge-position.v1", JSON.stringify({ y: 0.72 }));
    });
    if (cleanCapture.hideFeedbackUi) {
      await context.addInitScript(() => {
        const installCaptureStyle = () => {
          if (document.querySelector("#sheetify-clean-capture-style")) return;
          const style = document.createElement("style");
          style.id = "sheetify-clean-capture-style";
          style.textContent = [
            "#betaFeedbackTrigger",
            "#betaFeedbackReminder",
            "#betaFeedbackLayer",
            "#betaFeedbackToast"
          ].join(",") + "{display:none!important;visibility:hidden!important;pointer-events:none!important}";
          document.documentElement.append(style);
        };
        if (document.readyState === "loading") {
          document.addEventListener("DOMContentLoaded", installCaptureStyle, { once: true });
        } else {
          installCaptureStyle();
        }
      });
    }
    const page = await context.newPage();
    page.on("pageerror", (error) => pageErrors.push(error.message));
    await page.goto(createdPass.url, { waitUntil: "domcontentloaded" });
    await page.locator("#passCode").fill(createdPass.code);
    await page.getByRole("button", { name: uiCopy.connect }).click();
    await page.waitForURL(`${baseUrl}/app`, { timeout: 30000 });
    page.__sheetifyDemoCursorMode = cursorMode;
    if (cursorMode === "custom") {
      await installDemoCursor(page);
    }

    if (cleanCapture.enterWorkspaceBeforeRecording) {
      await page.getByRole("button", { name: uiCopy.consent }).click();
      await page.getByRole("heading", { name: uiCopy.projects }).waitFor({ timeout: uiTimeoutMs });
      await suppressFeedbackReminder(page);
      if (cleanCapture.dismissTutorialBeforeRecording) {
        await dismissAutomaticTutorial(page);
      }
    }

    await page.screencast.start({
      path: capturePath,
      size: captureSize,
      quality: captureQuality,
      onFrame: observeFrame
    });
    screencastActive = true;
    await Promise.race([
      firstFrameReady,
      page.waitForTimeout(5000)
    ]);
    assert.ok(captureClock.firstFrameTimestampMs, "The screencast produced no first frame within 5 seconds.");
    if (cursorMode === "playwright") {
      await page.screencast.showActions({
        cursor: "pointer",
        duration: 650,
        fontSize: 18,
        position: "top-right"
      });
    }
    mark("recording_started", { frameAligned: true });
    if (!firstWorksheetDialogue) {
      await page.screencast.showChapter(locale === "en" ? "My first worksheet with Sheetify" : "Mein erstes Arbeitsblatt mit Sheetify", {
        description: locale === "en"
          ? "A real paid journey from project to rendered draft."
          : "Ein echter bezahlter Durchgang vom Projekt bis zum gerenderten Entwurf.",
        duration: 2300
      });
    }

    if (cleanCapture.enterWorkspaceBeforeRecording) {
      await fs.mkdir(path.join(outputRoot, "sync"), { recursive: true });
      await page.screenshot({ path: path.join(outputRoot, "sync/01-workspace-entered.png") });
      mark("clean_capture_started", { consentRecorded: false, tutorialRecorded: false, feedbackUiRecorded: false });
    } else {
      await recordAction(page, "enter_workspace", {
        perform: () => smoothClick(page, page.getByRole("button", { name: uiCopy.consent })),
        waitForResult: async () => {
          await page.getByRole("heading", { name: uiCopy.projects }).waitFor();
          await suppressFeedbackReminder(page);
        },
        evidenceFile: "sync/01-workspace-entered.png"
      });
    }
    mark("workspace_entered");
    if (!cleanCapture.dismissTutorialBeforeRecording && await dismissAutomaticTutorial(page)) {
      mark("tutorial_auto_dismissed");
    }


    await recordAction(page, "create_project", {
      perform: async () => {
        await smoothClick(page, page.locator("#newWorksheetButton"));
        await smoothClick(page, page.locator("#newWorksheetTitle"), { afterMs: 120 });
        await page.locator("#newWorksheetTitle").fill("");
        await page.locator("#newWorksheetTitle").type(projectTitle, { delay: 48 });
        await smoothClick(page, page.locator("#createNewWorksheetButton"));
      },
      waitForResult: async () => {
        await page.getByRole("heading", { name: "Sheetify AI", exact: true }).waitFor();
        await suppressFeedbackReminder(page);
      },
      evidenceFile: "sync/02-project-opened.png",
      details: { projectTitle }
    });
    mark("project_created");
    mark("project_opened");

    const submittedTeacherTurns = [];
    if (firstWorksheetDialogue) {
      const assistantMessages = page.locator("#chatTimeline .chat-message.assistant");
      const advisoryAction = page.locator("#chatTimeline [data-command='generate_lessonbrief_proposal']").last();
      const assistantTextBeforeOpening = await assistantMessages.last().innerText().catch(() => "");
      await smoothClick(page, page.locator("#chatInput"), { afterMs: 120 });
      await page.locator("#chatInput").fill("");
      await page.locator("#chatInput").type(openingPrompt, { delay: 12 });
      await page.waitForTimeout(1100);
      mark("opening_prompt_ready");
      let openingResponse = "";
      await recordAction(page, "request_opening_advice", {
        perform: async () => {
          await page.locator("#chatInput").press("Enter");
          submittedTeacherTurns.push(openingPrompt);
          mark("opening_prompt_submitted");
        },
        waitForResult: async () => {
          await page.waitForFunction(({ previousText }) => {
            const input = document.querySelector("#chatInput");
            const responses = [...document.querySelectorAll("#chatTimeline .chat-message.assistant")];
            const currentText = String(responses.at(-1)?.textContent || "").replace(/\s+/g, " ").trim();
            const earlierText = String(previousText || "").replace(/\s+/g, " ").trim();
            return input && input.disabled === false && currentText.length > 20 && currentText !== earlierText;
          }, { previousText: assistantTextBeforeOpening }, { timeout: advisoryTimeoutMs });
          openingResponse = (await assistantMessages.last().innerText()).replace(/\s+/g, " ").trim();
          assert.ok(openingResponse.length > 20, "The opening advisory response should contain a meaningful answer.");
          assert.equal(await page.locator("#chatTimeline .concept-chat-card").count(), 0, "The opening advisory turn must not create a concept yet.");
        },
        evidenceFile: "sync/03-opening-advice-ready.png"
      });
      const offeredAction = await advisoryAction.isVisible().catch(() => false)
        ? (await advisoryAction.innerText()).trim()
        : null;
      mark("opening_response_ready", { openingResponse, offeredAction });
      await page.waitForTimeout(1800);
    }

    let submittedTeacherPrompt = teacherPrompt;
    let voiceInputResult = null;
    if (inputMode === "mixed") {
      voiceInputResult = await captureVoiceDraft(page, {
        manifest: voiceInputManifest,
        smoothClick,
        mark,
        transcriptionTimeoutMs: 90000
      });
      submittedTeacherPrompt = voiceInputResult.transcript;
      await page.waitForTimeout(900);
    } else {
      await smoothClick(page, page.locator("#chatInput"), { afterMs: 120 });
      await page.locator("#chatInput").fill("");
      await page.locator("#chatInput").type(teacherPrompt, { delay: 12 });
      await page.waitForTimeout(1400);
    }
    mark("prompt_ready", { inputMode });
    await suppressFeedbackReminder(page);
    const conceptButton = page.locator(
      "#chatTimeline button[data-canvas-mode='content_proposal'], #chatTimeline button[data-canvas-mode='content']"
    ).last();
    await recordAction(page, "create_concept", {
      perform: async () => {
        await page.locator("#chatInput").press("Enter");
        submittedTeacherTurns.push(submittedTeacherPrompt);
        mark("prompt_submitted", { inputMode });
      },
      waitForResult: () => conceptButton.waitFor({ state: "visible", timeout: conceptTimeoutMs }),
      evidenceFile: "sync/04-concept-ready.png"
    });
    const conceptCard = page.locator("#chatTimeline .concept-chat-card").last();
    const conceptMessage = page.locator("#chatTimeline .chat-message.assistant:has(.concept-chat-card)").last();
    const conceptDecision = conceptMessage.locator(".concept-decision-actions");
    const conceptForwardButton = conceptDecision.locator(".concept-decision-forward-button");
    const conceptViewButton = conceptDecision.locator(".concept-decision-preview-button");
    const conceptPitch = (await conceptCard.locator(".concept-pitch-copy").innerText()).replace(/\s+/g, " ").trim();
    checkUi("concept-pitch-meaningful", conceptPitch.length > 20, { observedLength: conceptPitch.length });
    checkUi(
      "concept-pitch-no-internal-review-copy",
      !/Stärke|Schwäche|noch offen|prüf(?:e|en)|\b\d+ Seiten?\b/i.test(conceptPitch)
    );
    checkUi("concept-card-no-meta-grid", await conceptCard.locator(".chat-result-meta-grid").count() === 0);
    checkUi("concept-card-no-feedback-panel", await conceptCard.locator(".concept-feedback-panel").count() === 0);
    await conceptDecision.waitFor({ state: "visible", timeout: uiTimeoutMs });
    const conceptForwardCount = await conceptForwardButton.count();
    const conceptForwardLabel = conceptForwardCount ? (await conceptForwardButton.innerText()).trim() : "";
    const conceptViewCount = await conceptViewButton.count();
    const conceptViewLabel = conceptViewCount ? (await conceptViewButton.innerText()).trim() : "";
    checkUi("concept-forward-action-present", conceptForwardCount === 1, { observed: conceptForwardCount });
    checkUi("concept-forward-action-labelled", uiCopy.conceptForward.test(conceptForwardLabel), { observed: conceptForwardLabel });
    checkUi("concept-view-action-present", conceptViewCount === 1, { observed: conceptViewCount });
    checkUi("concept-view-action-labelled", conceptViewLabel === uiCopy.viewConcept, { observed: conceptViewLabel });
    checkUi("concept-view-action-icon-present", await conceptViewButton.locator("svg, use").count() > 0);
    checkUi("concept-view-action-mode", /content/.test(await conceptViewButton.getAttribute("data-canvas-mode") || ""));
    const decisionLayout = await conceptDecision.evaluate((node) => ({
      columns: getComputedStyle(node).gridTemplateColumns,
      width: node.getBoundingClientRect().width,
      children: [...node.children].map((child) => child.getBoundingClientRect().width)
    }));
    checkUi("concept-decision-two-actions", decisionLayout.children.length === 2, { observed: decisionLayout.children.length });
    checkUi("concept-decision-actions-visible", decisionLayout.children.every((width) => width > 0));
    checkUi(
      "concept-decision-actions-balanced",
      decisionLayout.children.length === 2 && Math.abs(decisionLayout.children[0] - decisionLayout.children[1]) < 2,
      { widths: decisionLayout.children }
    );
    await conceptMessage.screenshot({ path: path.join(outputRoot, "concept-pitch-card.png") });
    mark("concept_ready");
    const conceptHost = mobile ? page.locator("#mobilePreviewSheet") : page.locator("#canvasBody");
    await recordAction(page, "open_concept", {
      perform: () => smoothClick(page, conceptButton),
      waitForResult: () => conceptHost.locator("[data-worksheet-blueprint]").waitFor({ timeout: uiTimeoutMs }),
      evidenceFile: "sync/05-concept-opened.png"
    });
    mark("concept_opened");
    mark("worksheet_plan_opened");
    await page.waitForTimeout(conceptTour.overviewHoldMs);

    const firstNode = conceptHost.locator("[data-blueprint-node]").first();
    if (await firstNode.count()) {
      await smoothClick(page, firstNode);
      mark("concept_detail_opened", { step: 1 });
      await page.waitForTimeout(conceptTour.detailHoldMs);
    }
    const nextNode = conceptHost.locator("[data-blueprint-next]");
    for (let step = 2; step <= conceptTour.detailSteps && await nextNode.count(); step += 1) {
      await smoothClick(page, nextNode);
      mark("concept_detail_opened", { step });
      await page.waitForTimeout(conceptTour.detailHoldMs);
    }
    if (conceptTour.returnToOverviewHoldMs > 0) {
      const conceptOverviewButton = conceptHost.locator("button[data-blueprint-mode='concept']");
      if (await conceptOverviewButton.count()) {
        await smoothClick(page, conceptOverviewButton);
        mark("concept_overview_returned");
        await page.waitForTimeout(conceptTour.returnToOverviewHoldMs);
      }
    }
    if (fullOnboarding) {
      await dismissBetaFeedback(page);
      const revisionConceptCount = await page.locator("#chatTimeline .concept-chat-card").count();
      const activeBlueprint = conceptHost.locator("[data-worksheet-blueprint]").last();
      const conceptOverviewButton = activeBlueprint.locator("button[data-blueprint-mode='concept']");
      if (await conceptOverviewButton.count()) {
        await smoothClick(page, conceptOverviewButton);
      }
      await dismissBetaFeedback(page);
      const taskNodes = activeBlueprint.locator("[data-blueprint-node][data-blueprint-type='task']");
      assert.ok(await taskNodes.count(), "The worksheet plan contains no task that can be revised.");
      const taskNodeChoices = await taskNodes.all();
      const revisionTaskNode = await firstVisibleLocator(taskNodeChoices.reverse(), { timeoutMs: 30000 });
      await revisionTaskNode.scrollIntoViewIfNeeded();
      await smoothClick(page, revisionTaskNode);
      const reviseElementChoices = await conceptHost.getByRole("button", { name: uiCopy.reviseElement }).all();
      const reviseElementButton = await firstVisibleLocator(reviseElementChoices, { timeoutMs: 30000 });
      mark("plan_element_revision_opened");
      await smoothClick(page, reviseElementButton);
      await page.locator("#revisionTargetPill:not(.hidden)").waitFor({ state: "visible", timeout: 30000 });
      await smoothClick(page, page.locator("#chatInput"), { afterMs: 120 });
      await page.locator("#chatInput").fill(conceptRevisionPrompt);
      await page.waitForTimeout(1500);
      mark("concept_revision_ready");
      const revisedConceptCard = page.locator("#chatTimeline .concept-chat-card").nth(revisionConceptCount);
      await recordAction(page, "revise_concept", {
        perform: async () => {
          await page.locator("#chatInput").press("Enter");
          mark("concept_revision_submitted");
        },
        waitForResult: () => revisedConceptCard.waitFor({ state: "visible", timeout: conceptRevisionTimeoutMs }),
        evidenceFile: "sync/05b-revised-concept-ready.png"
      });
      const revisedConceptMessage = page.locator("#chatTimeline .chat-message.assistant:has(.concept-chat-card)").last();
      const revisedConceptButton = revisedConceptMessage.locator(
        "button[data-canvas-mode='content_proposal'], button[data-canvas-mode='content']"
      ).last();
      await revisedConceptButton.waitFor({ state: "visible", timeout: 30000 });
      mark("revised_concept_ready");
      await smoothClick(page, revisedConceptButton);
      const revisedConceptHost = page.locator("#mobilePreviewSheet");
      await revisedConceptHost.locator("[data-worksheet-blueprint]").waitFor({ timeout: 30000 });
      mark("revised_worksheet_plan_opened");
      const revisedTasks = revisedConceptHost.locator("[data-blueprint-node][data-blueprint-type='task']");
      if (await revisedTasks.count()) {
        const revisedTaskChoices = await revisedTasks.all();
        const revisedTask = await firstVisibleLocator(revisedTaskChoices.reverse(), { timeoutMs: 30000 });
        await smoothClick(page, revisedTask);
        await page.waitForTimeout(2200);
      }
      await smoothClickIfVisible(page, page.locator("#mobilePreviewCloseIconButton"));
      mark("concept_reviewed", { revised: true });
    } else {
      if (mobile) {
        await smoothClick(page, page.locator("#mobilePreviewCloseIconButton"));
      }
      mark("concept_reviewed");
    }

    let generationAction = page.locator("#chatTimeline button[data-command='generate_candidate_from_content_proposal']").last();
    if (!await generationAction.count()) {
      const adoptAction = page.locator("#chatTimeline button[data-command='adopt_content_mirror_proposal']").last();
      if (await adoptAction.count()) {
        await smoothClick(page, adoptAction);
        mark("concept_adopted");
      }
      generationAction = page.locator(
        "#chatTimeline button[data-command='generate_image_candidate'], #chatTimeline button[data-command='generate_candidate_from_content_proposal']"
      ).last();
      await generationAction.waitFor({ state: "visible", timeout: 30000 });
    }
    await smoothClick(page, generationAction);
    await page.locator("#confirmationModal:not(.hidden)").waitFor({ timeout: 30000 });
    mark("generation_confirmation_opened");
    if (await moveFeedbackTriggerAwayFrom(page, page.locator("#confirmationAcceptButton"))) {
      mark("feedback_trigger_repositioned");
    }
    const candidateCard = page.locator("#chatTimeline .candidate-chat-card").last();
    const candidateMessage = page.locator("#chatTimeline .chat-message.assistant:has(.candidate-chat-card)").last();
    const candidateDecision = candidateMessage.locator(".candidate-decision-actions");
    const candidateDepositButton = candidateDecision.locator(".candidate-decision-deposit-button");
    const candidateVariantButton = candidateDecision.locator(".candidate-decision-variant-button");
    const failedMessagesBeforeGeneration = await page.locator("#chatTimeline .chat-message.failed").count();
    await recordAction(page, "generate_first_draft", {
      perform: async () => {
        await smoothClick(page, page.locator("#confirmationAcceptButton"));
        mark("generation_confirmed");
      },
      waitForResult: async () => {
        const generationFailure = page.locator("#chatTimeline .chat-message.failed").nth(failedMessagesBeforeGeneration);
        const generationResult = await firstVisibleLocator(
          [candidateCard, generationFailure],
          { timeoutMs: imageTimeoutMs }
        );
        if (generationResult === generationFailure) {
          throw new Error(`First draft generation failed: ${(await generationFailure.innerText()).replace(/\s+/g, " ").trim()}`);
        }
        await candidateDecision.waitFor({ state: "visible", timeout: uiTimeoutMs });
      },
      evidenceFile: "sync/06-first-draft-ready.png"
    });
    mark("candidate_ready");
    const candidateDepositCount = await candidateDepositButton.count();
    const candidateDepositLabel = candidateDepositCount ? (await candidateDepositButton.innerText()).trim() : "";
    const candidateVariantCount = await candidateVariantButton.count();
    const candidateVariantLabel = candidateVariantCount ? (await candidateVariantButton.innerText()).trim() : "";
    checkUi("candidate-deposit-action-present", candidateDepositCount === 1, { observed: candidateDepositCount });
    checkUi("candidate-deposit-action-labelled", candidateDepositLabel === uiCopy.saveWorksheet, { observed: candidateDepositLabel });
    checkUi("candidate-variant-action-present", candidateVariantCount === 1, { observed: candidateVariantCount });
    checkUi("candidate-variant-action-labelled", candidateVariantLabel === uiCopy.anotherVariant, { observed: candidateVariantLabel });
    const candidatePresentation = await candidateMessage.evaluate((node) => {
      const card = node.querySelector(".candidate-chat-card");
      const decision = node.querySelector(".candidate-decision-actions");
      const cardStyle = getComputedStyle(card);
      return {
        cardBorderWidth: cardStyle.borderTopWidth,
        cardBackground: cardStyle.backgroundColor,
        cardShadow: cardStyle.boxShadow,
        decisionWidths: [...decision.children].map((child) => child.getBoundingClientRect().width)
      };
    });
    checkUi("candidate-card-borderless", candidatePresentation.cardBorderWidth === "0px", { observed: candidatePresentation.cardBorderWidth });
    checkUi("candidate-card-transparent", /rgba\(0, 0, 0, 0\)|transparent/.test(candidatePresentation.cardBackground), { observed: candidatePresentation.cardBackground });
    checkUi("candidate-card-no-shadow", candidatePresentation.cardShadow === "none", { observed: candidatePresentation.cardShadow });
    checkUi("candidate-actions-present", candidatePresentation.decisionWidths.length >= 2, { observed: candidatePresentation.decisionWidths.length });
    checkUi("candidate-actions-visible", candidatePresentation.decisionWidths.every((width) => width > 0));
    await candidateMessage.screenshot({ path: path.join(outputRoot, "candidate-decision-card.png") });
    await recordAction(page, "open_first_draft", {
      perform: async () => {
        await smoothClick(page, candidateCard.locator("button[data-canvas-mode='candidates']"));
        if (mobile) {
          const candidateViewer = page.locator("#candidateViewerModal:not(.hidden)");
          const viewDraft = page.locator("#mobilePreviewSheet").getByRole("button", { name: uiCopy.viewDraft });
          const draftDestination = await firstVisibleLocator(
            [candidateViewer, viewDraft],
            { timeoutMs: 30000 }
          );
          if (draftDestination === viewDraft) {
            await smoothClick(page, viewDraft);
          }
        } else {
          const canvasCandidate = page.locator("#canvasBody [data-capture-kind='candidate']").last();
          await canvasCandidate.waitFor({ state: "visible", timeout: 30000 });
          await smoothClick(page, canvasCandidate);
        }
      },
      waitForResult: async () => {
        await page.locator("#candidateViewerModal:not(.hidden)").waitFor({ timeout: 30000 });
        await page.locator("#candidateViewerModal img").first().waitFor({ state: "visible", timeout: 30000 });
      },
      evidenceFile: "sync/07-first-draft-opened.png"
    });
    mark("candidate_opened");
    mark("first_draft_opened");
    await page.waitForTimeout(fullOnboarding ? 9000 : 5500);

    if (fullOnboarding) {
      await smoothClickIfVisible(page, page.locator("#candidateViewerCloseButton"));
      const mobilePreviewSheet = page.locator("#mobilePreviewSheet");
      const reviseDraftButton = await firstVisibleLocator([
        candidateMessage.locator("[data-card-action='revise-candidate']"),
        mobilePreviewSheet.locator("[data-mobile-revise-draft]").last()
      ], { timeoutMs: 30000 });
      mark("draft_revision_opened");
      await smoothClick(page, reviseDraftButton);
      await page.locator("#revisionTargetPill:not(.hidden)").waitFor({ state: "visible", timeout: 30000 });
      await smoothClick(page, page.locator("#chatInput"), { afterMs: 120 });
      await page.locator("#chatInput").fill(draftRevisionPrompt);
      await page.waitForTimeout(1600);
      mark("draft_revision_ready");
      const candidateCountBeforeRevision = await page.locator("#chatTimeline .candidate-chat-card").count();
      const confirmationModal = page.locator("#confirmationModal:not(.hidden)");
      const revisionGenerationAction = page.locator(
        "#chatTimeline button[data-command='generate_image_candidate']:not([disabled])"
      ).last();
      let nextRevisionStep;
      await recordAction(page, "prepare_visual_revision", {
        perform: async () => {
          await page.locator("#chatInput").press("Enter");
          mark("draft_revision_submitted");
        },
        waitForResult: async () => {
          nextRevisionStep = await firstVisibleLocator(
            [confirmationModal, revisionGenerationAction],
            { timeoutMs: conceptRevisionTimeoutMs }
          );
          return nextRevisionStep;
        },
        evidenceFile: "sync/08-visual-revision-ready.png"
      });
      if (nextRevisionStep !== confirmationModal) {
        // The action can become visible just before autoOpenConfirmation opens
        // the modal. Give that normal UI transition priority over a second click.
        await page.waitForTimeout(900);
      }
      if (!await confirmationModal.isVisible().catch(() => false)) {
        await smoothClick(page, revisionGenerationAction);
        await confirmationModal.waitFor({ state: "visible", timeout: 30000 });
      }
      mark("second_generation_confirmation_opened");
      if (await moveFeedbackTriggerAwayFrom(page, page.locator("#confirmationAcceptButton"))) {
        mark("feedback_trigger_repositioned");
      }
      const failedMessagesBeforeSecondGeneration = await page.locator("#chatTimeline .chat-message.failed").count();
      const revisedCandidateCard = page.locator("#chatTimeline .candidate-chat-card").nth(candidateCountBeforeRevision);
      const secondGenerationFailure = page.locator("#chatTimeline .chat-message.failed").nth(failedMessagesBeforeSecondGeneration);
      await recordAction(page, "generate_second_draft", {
        perform: async () => {
          await smoothClick(page, page.locator("#confirmationAcceptButton"));
          mark("second_generation_confirmed");
          mark("second_draft_generation_started");
        },
        waitForResult: async () => {
          const secondGenerationResult = await firstVisibleLocator(
            [revisedCandidateCard, secondGenerationFailure],
            { timeoutMs: imageTimeoutMs }
          );
          if (secondGenerationResult === secondGenerationFailure) {
            throw new Error(`Second draft generation failed: ${(await secondGenerationFailure.innerText()).replace(/\s+/g, " ").trim()}`);
          }
          return secondGenerationResult;
        },
        evidenceFile: "sync/08b-second-draft-ready.png"
      });
      const revisedCandidateMessage = page.locator("#chatTimeline .chat-message.assistant:has(.candidate-chat-card)").last();
      const revisedCandidateDecision = revisedCandidateMessage.locator(".candidate-decision-actions");
      const revisedCandidateDepositButton = revisedCandidateDecision.locator(".candidate-decision-deposit-button");
      await revisedCandidateDecision.waitFor({ state: "visible", timeout: uiTimeoutMs });
      await revisedCandidateDepositButton.waitFor({ state: "visible", timeout: uiTimeoutMs });
      mark("second_draft_ready");

      await smoothClick(page, revisedCandidateCard.locator("button[data-canvas-mode='candidates']"));
      const comparisonSheet = page.locator("#mobilePreviewSheet");
      const comparisonCandidate = comparisonSheet.locator("[data-capture-kind='candidate']").last();
      const candidateViewer = page.locator("#candidateViewerModal:not(.hidden)");
      const secondDraftDestination = await firstVisibleLocator(
        [comparisonCandidate, candidateViewer],
        { timeoutMs: 30000 }
      );
      if (secondDraftDestination === comparisonCandidate) {
        mark("draft_comparison_opened", {
          visibleDrafts: await comparisonSheet.locator("[data-capture-kind='candidate']").count()
        });
        await page.screenshot({ path: path.join(outputRoot, "draft-comparison-mobile.png") });
        const revisedDraftViewButton = comparisonSheet.getByRole("button", { name: uiCopy.viewDraft }).last();
        await revisedDraftViewButton.waitFor({ state: "visible", timeout: 30000 });
        await smoothClick(page, revisedDraftViewButton);
        await candidateViewer.waitFor({ timeout: 30000 });
      }
      mark("second_draft_opened");
      await page.waitForTimeout(9000);
      await smoothClickIfVisible(page, page.locator("#candidateViewerCloseButton"));
      const mobilePreviewCloseButton = page.locator("#mobilePreviewCloseIconButton");
      if (await mobilePreviewCloseButton.isVisible().catch(() => false)) {
        await smoothClick(page, mobilePreviewCloseButton);
      }

      mark("worksheet_store_ready");
      await recordAction(page, "deposit_worksheet", {
        perform: async () => {
          await smoothClick(page, revisedCandidateDepositButton);
          mark("worksheet_store_clicked");
        },
        waitForResult: () => waitForWorksheetArchive(page),
        evidenceFile: "sync/09-worksheet-archive-visible.png"
      });
      mark("worksheet_snapshot_ready");
      mark("worksheet_archive_visible");
      mark("worksheet_archive_opened");
      if (cursorMode === "playwright") await page.screencast.hideActions();
      await page.waitForTimeout(8500);
    } else if (storesWorksheet) {
      await smoothClickIfVisible(page, page.locator("#candidateViewerCloseButton"));
      const mobilePreviewCloseButton = page.locator("#mobilePreviewCloseIconButton");
      if (mobile && await mobilePreviewCloseButton.isVisible().catch(() => false)) {
        await smoothClick(page, mobilePreviewCloseButton);
      }
      mark("worksheet_store_ready");
      await recordAction(page, "deposit_worksheet", {
        perform: async () => {
          await smoothClick(page, candidateDepositButton);
          mark("worksheet_store_clicked");
        },
        waitForResult: () => waitForWorksheetArchive(page),
        evidenceFile: "sync/09-worksheet-archive-visible.png"
      });
      mark("worksheet_snapshot_ready");
      mark("worksheet_archive_visible");
      mark("worksheet_archive_opened");
      if (cursorMode === "playwright") await page.screencast.hideActions();
      await page.waitForTimeout(9000);
    }

    const stopRequestedAtMs = Date.now();
    mark("recording_stopping");
    finalizeVideoClock(stopRequestedAtMs);
    await page.screencast.stop();
    screencastActive = false;
    captureClock.stoppedTimestampMs = Date.now();
    mark("recording_stopped", { videoOffsetMs: captureClock.videoDurationMs });
    checkUi("no-page-errors", pageErrors.length === 0, { pageErrors });

    const timeline = buildTimeline();
    const normalizedEvents = timeline.events;

    const modelRunFiles = await findFiles(runtimeDir, "model-runs.jsonl");
    const modelRuns = (await Promise.all(modelRunFiles.map(readJsonl))).flat();
    const successfulRuns = modelRuns.filter((entry) => (
      entry.status === "success"
      && Number.isFinite(Date.parse(entry.createdAt))
      && Date.parse(entry.createdAt) >= startedAt
    ));
    const imageRuns = successfulRuns.filter((entry) => entry.model === "gpt-image-2");
    const imageRun = imageRuns.at(-1) || null;
    const candidateImages = await findFilesMatching(runtimeDir, /^candidate_\d+_page_1\.png$/i);
    const currentCandidateImages = (await Promise.all(candidateImages.map(async (filePath) => ({
      filePath,
      modifiedAt: (await fs.stat(filePath)).mtimeMs
    })))).filter((entry) => entry.modifiedAt >= startedAt)
      .sort((left, right) => left.modifiedAt - right.modifiedAt);
    const generatedImages = currentCandidateImages.map((entry) => entry.filePath);
    const generatedImage = generatedImages.at(-1) || null;
    for (const [index, filePath] of generatedImages.entries()) {
      await fs.copyFile(filePath, path.join(outputRoot, `generated-worksheet-${index + 1}.png`));
    }
    if (generatedImage) {
      await fs.copyFile(generatedImage, path.join(outputRoot, "generated-worksheet.png"));
    }

    const publicRuns = successfulRuns.map((entry) => ({
      source: entry.source || null,
      purpose: entry.purpose || null,
      route: entry.route || null,
      model: entry.model || null,
      reasoningEffort: entry.reasoningEffort || null,
      durationMs: Number(entry.durationMs || 0),
      estimatedCostUsd: Number(entry.costEstimate?.estimatedCostUsd || 0),
      generationMode: entry.metadata?.generationMode || null,
      quality: entry.metadata?.quality || null
    }));
    const totalEstimatedCostUsd = publicRuns.reduce((sum, entry) => sum + entry.estimatedCostUsd, 0);
    const summary = {
      schemaVersion: 1,
      providerPaid: true,
      realTextModels: true,
      realImageGeneration: true,
      emailsSent: false,
      externalTesterDataUsed: false,
      viewport,
      mobile,
      scenario: {
        captureProfile: captureProfileName || null,
        captureProfileFingerprint,
        passLabel,
        projectTitle,
        locale,
        reusedWorkspace: reusePass,
        journey,
        inputMode,
        voiceInput: voiceInputManifest ? {
          assetId: voiceInputManifest.assetId || null,
          voiceProfile: voiceInputManifest.voiceProfile || null,
          sourceAudio: path.basename(voiceInputManifest.sourceAudio),
          fakeMicrophoneWav: path.basename(voiceInputManifest.fakeMicrophoneWav),
          recordDurationMs: voiceInputManifest.recordDurationMs,
          mixOffsetMs: Number(voiceInputManifest.mixOffsetMs || 0),
          meaningfulWordOverlap: voiceInputResult
            ? Number(voiceInputResult.meaningfulWordOverlap.toFixed(3))
            : null
        } : null,
        cursorMode,
        strictUiChecks,
        captureQuality,
        conceptTour
      },
      submittedTeacherPrompt,
      submittedTeacherTurns,
      conceptPitch,
      uiChecks,
      pageErrors,
      captureDurationMs: timeline.clock.durationMs,
      wallCaptureDurationMs: timeline.clock.wallDurationMs,
      conceptWaitMs: (normalizedEvents.find((event) => event.id === "concept_ready")?.wallOffsetMs || 0)
        - (normalizedEvents.find((event) => event.id === "prompt_submitted")?.wallOffsetMs || 0),
      imageWaitMs: (normalizedEvents.find((event) => event.id === "candidate_ready")?.wallOffsetMs || 0)
        - (normalizedEvents.find((event) => event.id === "generation_confirmed")?.wallOffsetMs || 0),
      imageRunDurationMs: Number(imageRun?.durationMs || 0),
      imageRunDurationsMs: imageRuns.map((entry) => Number(entry.durationMs || 0)),
      imageQuality: imageRun?.metadata?.quality || null,
      totalEstimatedCostUsd: Number(totalEstimatedCostUsd.toFixed(6)),
      modelRuns: publicRuns,
      artifacts: {
        capture: path.basename(capturePath),
        conceptPitchCard: "concept-pitch-card.png",
        candidateDecisionCard: "candidate-decision-card.png",
        draftComparisonMobile: fullOnboarding ? "draft-comparison-mobile.png" : null,
        generatedWorksheet: generatedImage ? "generated-worksheet.png" : null,
        generatedWorksheets: generatedImages.map((_, index) => `generated-worksheet-${index + 1}.png`),
        timeline: path.basename(timelinePath),
        editPlan: "edit-plan.json",
        syncEvidence: timeline.actions.map((action) => action.evidence).filter(Boolean)
      }
    };
    const editPlan = {
      schemaVersion: 1,
      source: {
        video: path.basename(capturePath),
        timeline: path.basename(timelinePath)
      },
      cuts: [
        {
          id: "complete-take",
          sourceStartMs: 0,
          sourceEndMs: null
        }
      ],
      requiredEvents: [
        "workspace_entered",
        "project_opened",
        ...(firstWorksheetDialogue ? ["opening_response_ready"] : []),
        "concept_ready",
        "concept_opened",
        "generation_confirmed",
        "candidate_ready",
        "candidate_opened",
        ...(fullOnboarding ? [
          "revised_concept_ready",
          "second_draft_ready",
          "draft_comparison_opened",
          "second_draft_opened"
        ] : []),
        ...(storesWorksheet ? ["worksheet_archive_visible"] : [])
      ],
      requiredActions: [
        ...(cleanCapture.enterWorkspaceBeforeRecording ? [] : ["enter_workspace"]),
        "create_project",
        ...(firstWorksheetDialogue ? ["request_opening_advice"] : []),
        "create_concept",
        "open_concept",
        ...(fullOnboarding ? ["revise_concept"] : []),
        "generate_first_draft",
        "open_first_draft",
        ...(fullOnboarding ? ["prepare_visual_revision", "generate_second_draft"] : []),
        ...(storesWorksheet ? ["deposit_worksheet"] : [])
      ],
      narration: [],
      visualAnchors: (storesWorksheet ? [
        {
          id: "worksheet-final-zoom",
          anchor: {
            event: "worksheet_archive_visible",
            offsetMs: 800
          }
        }
      ] : []),
      syncRules: simpleDevpost ? [
        {
          id: "draft-announcement-after-visible-result",
          type: "cue_not_before_event",
          cue: "dialog-08",
          event: "candidate_ready"
        }
      ] : firstWorksheetDialogue ? [
        {
          id: "draft-announcement-after-visible-result",
          type: "cue_not_before_event",
          cue: "dialog-08",
          event: "candidate_ready"
        },
        {
          id: "deposit-narration-during-deposit-action",
          type: "cue_within_action",
          cue: "dialog-09",
          action: "deposit_worksheet"
        },
        {
          id: "archive-narration-after-visible-result",
          type: "cue_not_before_event",
          cue: "dialog-10",
          event: "worksheet_archive_visible"
        }
      ] : []
    };
    await fs.writeFile(timelinePath, `${JSON.stringify(timeline, null, 2)}\n`, "utf8");
    await fs.writeFile(path.join(outputRoot, "edit-plan.json"), `${JSON.stringify(editPlan, null, 2)}\n`, "utf8");
    await fs.writeFile(summaryPath, `${JSON.stringify(summary, null, 2)}\n`, "utf8");
    console.log(JSON.stringify(summary, null, 2));
    await context.close();
  } catch (error) {
    if (browser) {
      const pages = browser.contexts().flatMap((context) => context.pages());
      if (pages[0]) {
        if (screencastActive) {
          const stopRequestedAtMs = Date.now();
          finalizeVideoClock(stopRequestedAtMs);
          await pages[0].screencast.stop().catch(() => {});
          screencastActive = false;
          captureClock.stoppedTimestampMs = Date.now();
        }
        const inventory = await visibleCommandInventory(pages[0]).catch(() => []);
        await fs.writeFile(path.join(outputRoot, "failure-actions.json"), `${JSON.stringify(inventory, null, 2)}\n`, "utf8").catch(() => {});
        await pages[0].screenshot({ path: path.join(outputRoot, "failure.png"), fullPage: true }).catch(() => {});
      }
    }
    const failureTimeline = buildTimeline(error.message);
    await fs.writeFile(timelinePath, `${JSON.stringify(failureTimeline, null, 2)}\n`, "utf8").catch(() => {});
    const failureModelRunFiles = await findFiles(runtimeDir, "model-runs.jsonl").catch(() => []);
    const failureModelRuns = (await Promise.all(
      failureModelRunFiles.map((filePath) => readJsonl(filePath).catch(() => []))
    )).flat().filter((entry) => (
      Number.isFinite(Date.parse(entry.createdAt))
      && Date.parse(entry.createdAt) >= startedAt
    )).map((entry) => ({
      status: entry.status || null,
      purpose: entry.purpose || null,
      model: entry.model || null,
      durationMs: Number(entry.durationMs || 0),
      estimatedCostUsd: Number(entry.costEstimate?.estimatedCostUsd || 0)
    }));
    const failureSummary = {
      schemaVersion: 1,
      captureProfile: captureProfileName || null,
      captureProfileFingerprint,
      journey,
      error: error.message,
      lastEvent: failureTimeline.events.at(-1)?.id || null,
      lastAction: failureTimeline.actions.at(-1) || null,
      pageErrors,
      uiChecks,
      providerRunsObserved: failureModelRuns,
      partialCapture: screencastActive === false && await fs.stat(capturePath).then((item) => item.isFile()).catch(() => false),
      artifacts: {
        timeline: path.basename(timelinePath),
        screenshot: "failure.png",
        actions: "failure-actions.json"
      }
    };
    await fs.writeFile(
      path.join(outputRoot, "failure-summary.json"),
      `${JSON.stringify(failureSummary, null, 2)}\n`,
      "utf8"
    ).catch(() => {});
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
