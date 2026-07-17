"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");
const { chromium } = require("@playwright/test");
const { PNG } = require("pngjs");
const { registerCandidate } = require("../core/candidateManager");
const { EVENT_TYPES } = require("../core/contracts");
const { appendEvent } = require("../core/eventLog");
const { createRun } = require("../core/runManager");
const { generateOwnerPasswordHash } = require("../server/owner-auth");

const CONTENT_CANARY = "CANARY CONTENT — DO NOT TRANSLATE";
const TEST_NOW = "2026-07-16T12:00:00.000Z";

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

function fakeWorksheetPng() {
  const png = new PNG({ width: 420, height: 594 });
  for (let y = 0; y < png.height; y += 1) {
    for (let x = 0; x < png.width; x += 1) {
      const index = (png.width * y + x) << 2;
      const paper = x > 18 && x < png.width - 18 && y > 18 && y < png.height - 18;
      png.data[index] = paper ? 246 : 31;
      png.data[index + 1] = paper ? 248 : 99;
      png.data[index + 2] = paper ? 252 : 214;
      png.data[index + 3] = 255;
    }
  }
  return PNG.sync.write(png);
}

async function pageApi(page, pathname, options = {}) {
  return page.evaluate(async ({ pathname, options }) => {
    const response = await fetch(pathname, {
      ...options,
      headers: {
        ...(options.body ? { "content-type": "application/json" } : {}),
        ...(options.headers || {})
      }
    });
    const body = await response.json().catch(() => ({}));
    return { ok: response.ok, status: response.status, body };
  }, { pathname, options });
}

async function command(page, projectId, commandId, payload) {
  const result = await pageApi(page, `/api/workspace/${encodeURIComponent(projectId)}/commands`, {
    method: "POST",
    body: JSON.stringify({ command: commandId, payload })
  });
  assert.equal(result.ok, true, `${commandId}: ${result.body.message || result.status}`);
  return result.body;
}

async function findProjectDir(root, projectId) {
  const entries = await fs.readdir(root, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const candidate = path.join(root, entry.name);
    if (entry.name === projectId) return candidate;
    const nested = await findProjectDir(candidate, projectId);
    if (nested) return nested;
  }
  return null;
}

async function seedCandidate(projectDir, { sourceImagePath = null } = {}) {
  const run = await createRun(projectDir, { now: TEST_NOW });
  const relativePath = "candidates/judge_candidate_01_page_1.png";
  const pagePath = path.join(projectDir, "runs", run.runId, relativePath);
  await fs.mkdir(path.dirname(pagePath), { recursive: true });
  if (sourceImagePath) {
    await fs.copyFile(sourceImagePath, pagePath);
  } else {
    await fs.writeFile(pagePath, fakeWorksheetPng());
  }
  await registerCandidate(projectDir, run.runId, {
    id: "judge_candidate_01",
    status: "reviewable",
    pages: [{ page: 1, role: "worksheet", path: relativePath, format: "png" }]
  }, { now: TEST_NOW });
  return run.runId;
}

async function main() {
  const repoRoot = path.resolve(__dirname, "..");
  const captureArgument = process.argv.find((value) => value.startsWith("--capture-dir="));
  const captureDir = captureArgument ? path.resolve(captureArgument.slice("--capture-dir=".length)) : null;
  const videoArgument = process.argv.find((value) => value.startsWith("--demo-video-dir="));
  const demoVideoDir = videoArgument ? path.resolve(videoArgument.slice("--demo-video-dir=".length)) : null;
  const demoMode = Boolean(demoVideoDir);
  const demoProjectTitle = demoMode ? "Archaeopteryx — a transitional fossil" : "Judge English Core Flow";
  if (captureDir) await fs.mkdir(captureDir, { recursive: true });
  if (demoVideoDir) await fs.mkdir(demoVideoDir, { recursive: true });

  const demoPause = async (milliseconds = 900) => {
    if (demoMode) await new Promise((resolve) => setTimeout(resolve, milliseconds));
  };

  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "sheetifyimg-judge-app-"));
  const runtimeDir = path.join(tempRoot, "runtime");
  const projectsDir = path.join(tempRoot, "projects");
  const worksheetsDir = path.join(tempRoot, "worksheets");
  const port = await freePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const ownerPassword = "judge-app-smoke-password-2026";
  const ownerHash = await generateOwnerPasswordHash(ownerPassword, { salt: Buffer.alloc(16, 31) });
  const ownerAuthorization = `Basic ${Buffer.from(`owner:${ownerPassword}`, "utf8").toString("base64")}`;

  Object.assign(process.env, {
    NODE_ENV: "development",
    SHEETIFYIMG_RUNTIME_MODE: "development",
    SHEETIFYIMG_RUNTIME_DIR: runtimeDir,
    SHEETIFYIMG_BIND_HOST: "127.0.0.1",
    PORT: String(port),
    PROJECTS_DIR: projectsDir,
    WORKSHEETS_DIR: worksheetsDir,
    SHEETIFYIMG_SKIP_LOCAL_ENV: "1",
    SHEETIFYIMG_AI_MODE: "disabled",
    SHEETIFYIMG_REQUIRE_OPENAI: "0",
    OPENAI_API_KEY: "",
    RESEND_API_KEY: "",
    SHEETIFYIMG_OWNER_AUTH_ENABLED: "1",
    SHEETIFYIMG_OWNER_AUTH_USERNAME: "owner",
    SHEETIFYIMG_OWNER_AUTH_PASSWORD_HASH: ownerHash,
    SHEETIFYIMG_BETA_ACCESS_ENABLED: "1",
    SHEETIFYIMG_BETA_ACCESS_SECRET: "sheetifyimg-judge-app-smoke-secret-2026",
    SHEETIFYIMG_PAID_GENERATION_ENABLED: "0",
    SHEETIFYIMG_ADMIN_PRIVATE_ONLY: "1",
    SHEETIFYIMG_MAIL_INBOUND_WEBHOOK_ENABLED: "0",
    SHEETIFYIMG_EXPOSE_BILLING_STATUS: "0",
    SHEETIFYIMG_PUBLIC_URL: ""
  });

  const { startServer } = require("../server/dev-server");
  let server;
  let browser;
  const pageErrors = [];
  try {
    ({ server } = await startServer({ handleSignals: false }));
    const adminResponse = await fetch(`${baseUrl}/api/admin/passes`, {
      method: "POST",
      headers: {
        authorization: ownerAuthorization,
        origin: baseUrl,
        "content-type": "application/json"
      },
      body: JSON.stringify({ label: "Devpost Judge Pass", credits: 50, invitationLocale: "en" })
    });
    const createdPass = await adminResponse.json();
    assert.equal(adminResponse.ok, true, createdPass.message || adminResponse.status);

    browser = await chromium.launch({ headless: true });
    const englishContext = await browser.newContext({
      locale: "en-US",
      viewport: { width: 1440, height: 1000 },
      ...(demoVideoDir ? { recordVideo: { dir: demoVideoDir, size: { width: 1440, height: 1000 } } } : {})
    });
    const englishPage = await englishContext.newPage();
    const englishVideo = englishPage.video();
    englishPage.on("pageerror", (error) => pageErrors.push(error.message));
    await englishPage.goto(createdPass.url, { waitUntil: "domcontentloaded" });
    await demoPause(1200);
    await englishPage.locator("#passCode").waitFor();
    assert.equal(await englishPage.locator("#passCode").inputValue(), "");
    const sessionBeforeManualEntry = await englishPage.evaluate(() => fetch("/api/auth/session").then((response) => response.json()));
    assert.equal(sessionBeforeManualEntry.authenticated, false);
    await englishPage.locator("#passCode").fill(createdPass.code);
    await englishPage.locator("#connectButton").click();
    await englishPage.waitForURL(`${baseUrl}/app`, { timeout: 30000 });
    await demoPause(900);
    await englishPage.getByRole("button", { name: "Agree and start the beta" }).click();
    await englishPage.locator("#betaConsentLayer").waitFor({ state: "hidden" });
    await englishPage.getByRole("heading", { name: "Projects" }).waitFor();
    await demoPause(1000);

    const createdProject = await pageApi(englishPage, "/api/projects/single", {
      method: "POST",
      body: JSON.stringify({
        projectId: "devpost-judge-english-core",
        title: demoProjectTitle,
        subject: demoMode ? "Biology" : "English",
        topic: demoMode ? "Evidence for evolution" : "Summer snapshot",
        targetGroup: demoMode ? "Grade 10" : "Grade 7"
      })
    });
    assert.equal(createdProject.ok, true, createdProject.body.message || createdProject.status);
    const projectId = createdProject.body.project.projectId;
    const projectDir = await findProjectDir(tempRoot, projectId);
    assert.ok(projectDir, `Project directory not found for ${projectId}`);
    await appendEvent(projectDir, {
      type: EVENT_TYPES.USER_MESSAGE,
      createdAt: TEST_NOW,
      step: "auftrag",
      payload: {
        mode: "test",
        message: demoMode
          ? "Create a concise Biology worksheet for Grade 10 about Archaeopteryx. Goal: Students explain why Archaeopteryx is evidence for evolution. First compare bird and reptile traits, then justify the term transitional fossil."
          : `Ich brauche ein einseitiges Englisch-Arbeitsblatt für Klasse 7 zum Thema Summer Snapshot. Die Lernenden sollen einen kurzen Ferienbericht lesen, Informationen entnehmen und danach eine eigene kurze Antwort schreiben. Bitte klar und ohne besondere Zusatzanforderungen. ${CONTENT_CANARY}`,
        uiEvent: "chat_message",
        attachments: []
      }
    }, { now: TEST_NOW });
    await command(englishPage, projectId, "create_brief_draft", {
      brief: {
        subject: demoMode ? "Biology" : "English",
        topic: demoMode ? "Archaeopteryx as a transitional fossil" : "Summer snapshot",
        targetGroup: demoMode ? "Grade 10" : "Grade 7",
        goal: CONTENT_CANARY,
        outputPreference: { pages: 1, format: "A4" }
      }
    });
    await command(englishPage, projectId, "create_content_draft", {
      content: {
        title: demoMode ? "Archaeopteryx — evidence for evolution" : CONTENT_CANARY,
        readingTexts: [{
          id: "text_1",
          title: demoMode ? "Transitional fossils" : "Judge text",
          body: demoMode
            ? "Archaeopteryx combines characteristics associated with birds and reptiles."
            : CONTENT_CANARY
        }],
        tasks: demoMode ? [
          {
            id: "task_1",
            prompt: "Identify the bird and reptile characteristics shown in the material.",
            expectedAnswer: CONTENT_CANARY
          },
          {
            id: "task_2",
            prompt: "Explain why Archaeopteryx can be described as a transitional fossil.",
            expectedAnswer: "Uses evidence from both characteristic groups."
          }
        ] : [{ id: "task_1", prompt: CONTENT_CANARY, expectedAnswer: CONTENT_CANARY }],
        imageMaterials: [{
          id: "image_1",
          prompt: demoMode ? "Scientific Archaeopteryx illustration with labelled traits" : "Simple summer icons"
        }]
      }
    });
    await command(englishPage, projectId, "approve_current_content", {});
    const demoWorksheetPath = path.join(
      repoRoot,
      "fixtures",
      "image_first_poc",
      "brueckentiere_archaeopteryx_poc",
      "runs",
      "run_2026-06-18_001",
      "candidates",
      "candidate_01_page_1_tasks.png"
    );
    const runId = await seedCandidate(projectDir, {
      sourceImagePath: demoMode ? demoWorksheetPath : null
    });

    await englishPage.reload({ waitUntil: "domcontentloaded" });
    await demoPause(900);
    await englishPage.getByRole("button", {
      name: demoProjectTitle
    }).click();
    await demoPause(650);
    await englishPage.getByRole("button", { name: "Open project" }).click();
    await englishPage.getByRole("heading", { name: "Sheetify AI" }).waitFor();
    await demoPause(1400);
    const runtimeLabel = (await englishPage.locator(".chat-runtime").textContent()).trim();
    assert.match(runtimeLabel, /^(AI ready|OpenAI key missing|OpenAI not ready)$/);
    assert.equal(await englishPage.locator("html").getAttribute("lang"), "en");
    assert.ok(await englishPage.getByRole("button", { name: "Add input" }).count() >= 1);
    await englishPage.getByRole("button", { name: /Worksheet concept/ }).first().click();
    assert.ok(await englishPage.getByText(CONTENT_CANARY, { exact: true }).count() > 0);
    await demoPause(1800);
    if (demoMode) {
      const visibleContent = englishPage.getByRole("button", { name: /Visible content/i }).first();
      if (await visibleContent.count()) {
        await visibleContent.click();
        await demoPause(1300);
      }
      await englishPage.locator("#productionStepList [data-canvas-mode='candidates']").dispatchEvent("click");
      await englishPage.getByText("Draft 01", { exact: true }).first().waitFor();
      await demoPause(2200);
    }
    if (captureDir) await englishPage.screenshot({ path: path.join(captureDir, "judge-app-desktop-en.png"), fullPage: true });

    const beforeSwitch = await pageApi(englishPage, `/api/workspace/${encodeURIComponent(projectId)}`);
    assert.equal(beforeSwitch.ok, true);
    const beforeDocuments = JSON.stringify(beforeSwitch.body.workspace.documents);

    await englishPage.getByRole("button", { name: "Settings" }).click();
    const passLanguageOptions = englishPage.locator("#settingsLanguageOptions .pass-ui-language-option");
    assert.equal(await passLanguageOptions.count(), 2);
    assert.deepEqual(
      await passLanguageOptions.locator("img").evaluateAll((images) => images.map((image) => image.getAttribute("src"))),
      ["/icons/flags/de.svg", "/icons/flags/gb.svg"]
    );
    await englishPage.locator("#settingsCloseButton").click();
    await englishPage.getByRole("button", { name: "My SheetifyIMG Pass" }).click();
    await englishPage.getByRole("heading", { name: "My SheetifyIMG Pass" }).waitFor();
    const grantResponse = await fetch(`${baseUrl}/api/admin/passes/${createdPass.pass.id}/grant`, {
      method: "POST",
      headers: {
        authorization: ownerAuthorization,
        origin: baseUrl,
        "content-type": "application/json"
      },
      body: JSON.stringify({ amount: 3 })
    });
    const granted = await grantResponse.json();
    assert.equal(grantResponse.ok, true, granted.message || grantResponse.status);
    assert.equal(granted.pass.balance, 53);
    await englishPage.evaluate(() => window.dispatchEvent(new Event("focus")));
    const creditLayer = englishPage.locator("#betaCreditLayer");
    await creditLayer.getByRole("heading", { name: "3 draft pages have been added." }).waitFor();
    assert.equal((await creditLayer.getByText("Your new balance: 53 draft pages.").count()), 1);
    if (captureDir) await englishPage.screenshot({ path: path.join(captureDir, "judge-credit-grant-notice-en.png"), fullPage: true });
    await creditLayer.getByRole("button", { name: "Got it" }).click();
    await creditLayer.waitFor({ state: "hidden" });
    assert.equal(await englishPage.locator("#passModal .pass-balance-badge strong").textContent(), "53");
    assert.equal((await pageApi(englishPage, "/api/pass/credit-notice")).body.notice, null);
    const syncedAdminOverview = await fetch(`${baseUrl}/api/admin/overview`, {
      headers: { authorization: ownerAuthorization }
    }).then((response) => response.json());
    assert.equal(syncedAdminOverview.passes.find((entry) => entry.id === createdPass.pass.id).balance, 53);
    const pairing = await pageApi(englishPage, "/api/pass/pairings", { method: "POST", body: "{}" });
    assert.equal(pairing.ok, true);

    const germanContext = await browser.newContext({ locale: "de-DE", viewport: { width: 1180, height: 900 } });
    const germanPage = await germanContext.newPage();
    germanPage.on("pageerror", (error) => pageErrors.push(error.message));
    await germanPage.goto(pairing.body.pairing.url, { waitUntil: "domcontentloaded" });
    await germanPage.waitForURL(`${baseUrl}/app`, { timeout: 30000 });
    await germanPage.getByRole("button", { name: "Agree and start the beta" }).click();
    await germanPage.locator("#betaConsentLayer").waitFor({ state: "hidden" });
    await germanPage.getByRole("button", { name: "Settings" }).click();
    await germanPage.getByRole("button", { name: "German" }).click();
    await germanPage.locator("#settingsTitle").filter({ hasText: "SheetifyIMG" }).waitFor();
    assert.equal(await germanPage.locator("html").getAttribute("lang"), "de");
    assert.equal(await englishPage.locator("html").getAttribute("lang"), "en");
    await germanPage.locator("#settingsCloseButton").click();
    await germanPage.getByRole("button", { name: "Mein SheetifyIMG Pass" }).click();
    await germanPage.getByRole("heading", { name: "Mein SheetifyIMG Pass" }).waitFor();
    const germanGrantResponse = await fetch(`${baseUrl}/api/admin/passes/${createdPass.pass.id}/grant`, {
      method: "POST",
      headers: {
        authorization: ownerAuthorization,
        origin: baseUrl,
        "content-type": "application/json"
      },
      body: JSON.stringify({ amount: 2 })
    });
    assert.equal(germanGrantResponse.ok, true);
    await germanPage.evaluate(() => window.dispatchEvent(new Event("focus")));
    const germanCreditLayer = germanPage.locator("#betaCreditLayer");
    await germanCreditLayer.getByRole("heading", { name: "Dir wurden 2 Entwurfsseiten freigeschaltet." }).waitFor();
    assert.equal((await germanCreditLayer.getByText("Dein neues Guthaben: 55 Entwurfsseiten.").count()), 1);
    if (captureDir) await germanPage.screenshot({ path: path.join(captureDir, "judge-credit-grant-notice-de.png"), fullPage: true });
    await germanCreditLayer.getByRole("button", { name: "Verstanden" }).click();
    assert.equal(await germanPage.locator("#passModal .pass-balance-badge strong").textContent(), "55");
    await englishPage.evaluate(() => window.dispatchEvent(new Event("focus")));
    await creditLayer.getByRole("heading", { name: "2 draft pages have been added." }).waitFor();
    await creditLayer.getByRole("button", { name: "Got it" }).click();
    assert.equal(await englishPage.locator("#passModal .pass-balance-badge strong").textContent(), "55");
    await germanPage.locator("#passModal [data-pass-close]").last().click();
    await germanPage.getByRole("button", { name: demoProjectTitle }).click();
    await germanPage.getByRole("button", { name: "Projekt öffnen" }).click();
    await germanPage.getByRole("heading", { name: "Sheetify AI" }).waitFor();
    assert.equal(await germanPage.locator("#chatInput").getAttribute("placeholder"), "Nachricht an Sheetify AI …");

    const englishSession = await pageApi(englishPage, "/api/auth/session");
    const germanSession = await pageApi(germanPage, "/api/auth/session");
    assert.equal(englishSession.body.session.uiLocale, "en");
    assert.equal(germanSession.body.session.uiLocale, "de");

    const afterSwitch = await pageApi(englishPage, `/api/workspace/${encodeURIComponent(projectId)}`);
    assert.equal(JSON.stringify(afterSwitch.body.workspace.documents), beforeDocuments);
    assert.match(beforeDocuments, new RegExp(CONTENT_CANARY));

    const mobileContext = await browser.newContext({ locale: "en-US", viewport: { width: 390, height: 844 } });
    const mobilePage = await mobileContext.newPage();
    mobilePage.on("pageerror", (error) => pageErrors.push(error.message));
    const mobilePairing = await pageApi(englishPage, "/api/pass/pairings", { method: "POST", body: "{}" });
    await mobilePage.goto(mobilePairing.body.pairing.url, { waitUntil: "domcontentloaded" });
    await mobilePage.waitForURL(`${baseUrl}/app`, { timeout: 30000 });
    await mobilePage.getByRole("button", { name: "Agree and start the beta" }).click();
    await mobilePage.locator("#betaConsentLayer").waitFor({ state: "hidden" });
    await mobilePage.getByRole("button", { name: demoProjectTitle }).click();
    await mobilePage.getByRole("button", { name: "Open project" }).click();
    await mobilePage.locator("#productionStepList [data-canvas-mode='candidates']").dispatchEvent("click");
    await mobilePage.locator("#mobilePreviewSheet").getByText("Draft 01", { exact: true }).waitFor();
    assert.equal(await mobilePage.locator("#mobilePreviewSheet").getByRole("button", { name: "View draft" }).count(), 1);
    if (captureDir) await mobilePage.screenshot({ path: path.join(captureDir, "judge-app-mobile-en.png"), fullPage: true });

    assert.deepEqual(pageErrors, []);
    await englishContext.close();
    let capturedVideoPath = null;
    if (englishVideo) {
      const recordedPath = await englishVideo.path();
      capturedVideoPath = path.join(demoVideoDir, "sheetify-ui-flow.webm");
      if (path.resolve(recordedPath) !== path.resolve(capturedVideoPath)) {
        await fs.copyFile(recordedPath, capturedVideoPath);
      }
    }
    await Promise.all([germanContext.close(), mobileContext.close()]);
    console.log(JSON.stringify({
      ok: true,
      providerFree: true,
      realEmailSent: false,
      paidGenerationTriggered: false,
      projectId,
      runId,
      englishDesktop: true,
      englishMobile: true,
      translatedAccessibilityLabels: true,
      samePassDeviceLocaleIsolation: true,
      creditGrantSync: true,
      bilingualCreditGrantSync: true,
      germanWorkflowRegression: true,
      worksheetContentUnchanged: true,
      contentCanary: CONTENT_CANARY,
      capturedVideoPath,
      pageErrors
    }, null, 2));
  } finally {
    if (browser) await browser.close().catch(() => {});
    if (server) await new Promise((resolve) => server.close(resolve));
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
