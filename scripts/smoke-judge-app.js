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
  const mobileVideoArgument = process.argv.find((value) => value.startsWith("--mobile-demo-video-dir="));
  const mobileDemoVideoDir = mobileVideoArgument
    ? path.resolve(mobileVideoArgument.slice("--mobile-demo-video-dir=".length))
    : null;
  const presentationOnly = process.argv.includes("--presentation-only");
  const demoMode = Boolean(demoVideoDir || mobileDemoVideoDir);
  const demoProjectTitle = demoMode ? "Archaeopteryx — a transitional fossil" : "Judge English Core Flow";
  if (captureDir) await fs.mkdir(captureDir, { recursive: true });
  if (demoVideoDir) await fs.mkdir(demoVideoDir, { recursive: true });
  if (mobileDemoVideoDir) await fs.mkdir(mobileDemoVideoDir, { recursive: true });

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
    await englishPage.getByLabel("Pass or pairing code").fill(createdPass.code);
    await englishPage.getByRole("button", { name: "Connect" }).click();
    await englishPage.waitForURL(`${baseUrl}/app`, { timeout: 30000 });
    await demoPause(900);
    await Promise.all([
      englishPage.waitForResponse((response) => response.url().endsWith("/api/beta/consent") && response.request().method() === "POST"),
      englishPage.getByRole("button", { name: "Agree and start the beta" }).click()
    ]);
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
    const contentDraft = {
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
    };
    await command(englishPage, projectId, "create_content_draft", { content: contentDraft });
    await command(englishPage, projectId, "approve_current_content", {});
    if (demoMode) {
      await appendEvent(projectDir, {
        type: EVENT_TYPES.ASSISTANT_MESSAGE,
        createdAt: TEST_NOW,
        step: "content",
        payload: {
          mode: "demo_fixture",
          message: "The Worksheet Blueprint is ready. Review its texts, tasks, and visual material before creating a draft.",
          proposal: {
            proposalId: "demo_adopted_content_01",
            kind: "content_mirror",
            status: "adopted",
            createdAt: TEST_NOW,
            title: contentDraft.title,
            summary: "Approved concept prepared for a controlled draft review.",
            data: contentDraft,
            source: { projectId, mode: "demo_fixture" },
            model: "demo_fixture"
          },
          suggestedActions: []
        }
      }, { now: TEST_NOW });
    }
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
    await englishPage.getByRole("heading", { name: /Sheetify\s*AI/ }).waitFor();
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

    if (presentationOnly) {
      const englishWorkspaceText = await englishPage.locator("#workspaceView").innerText();
      assert.doesNotMatch(englishWorkspaceText, /Ja, Konzept schreiben|Entwurf läuft bereits|Ich kann daraus jetzt einen Entwurf erstellen/);
      await englishPage.evaluate(() => document.querySelector("#workspaceMobileLibraryButton")?.click());
      await englishPage.locator("#projectView").waitFor({ state: "visible" });
      await englishPage.locator("#worksheetsViewButton").click();
      await englishPage.getByRole("button", { name: "Worksheets", exact: true }).last().waitFor();
      assert.doesNotMatch(await englishPage.locator("#libraryTree").innerText(), /Arbeitsblätter/);

      await englishPage.evaluate(() => {
        window.sheetifyLocale.set("de");
        window.dispatchEvent(new CustomEvent("sheetify:localechange", { detail: { locale: "de" } }));
      });
      assert.equal(await englishPage.locator("html").getAttribute("lang"), "de");
      await englishPage.getByRole("button", { name: "Arbeitsblätter", exact: true }).last().waitFor();

      await englishPage.evaluate(() => {
        window.sheetifyLocale.set("en");
        window.dispatchEvent(new CustomEvent("sheetify:localechange", { detail: { locale: "en" } }));
      });
      assert.equal(await englishPage.locator("html").getAttribute("lang"), "en");
      await englishPage.getByRole("button", { name: "Worksheets", exact: true }).last().waitFor();
      console.log(JSON.stringify({
        ok: true,
        providerFree: true,
        presentationOnly: true,
        englishWorkspace: true,
        englishWorksheetRoot: true,
        germanRoundTrip: true,
        englishRoundTrip: true,
        pageErrors
      }, null, 2));
      return;
    }

    const beforeSwitch = await pageApi(englishPage, `/api/workspace/${encodeURIComponent(projectId)}`);
    assert.equal(beforeSwitch.ok, true);
    const beforeDocuments = JSON.stringify(beforeSwitch.body.workspace.documents);

    await englishPage.getByRole("button", { name: "My SheetifyIMG Pass" }).click();
    await englishPage.getByRole("heading", { name: "My SheetifyIMG Pass" }).waitFor();
    const pairing = await pageApi(englishPage, "/api/pass/pairings", { method: "POST", body: "{}" });
    assert.equal(pairing.ok, true);

    const germanContext = await browser.newContext({ locale: "de-DE", viewport: { width: 1180, height: 900 } });
    const germanPage = await germanContext.newPage();
    germanPage.on("pageerror", (error) => pageErrors.push(error.message));
    await germanPage.goto(pairing.body.pairing.url, { waitUntil: "domcontentloaded" });
    await germanPage.waitForURL(`${baseUrl}/app`, { timeout: 30000 });
    await Promise.all([
      germanPage.waitForResponse((response) => response.url().endsWith("/api/beta/consent") && response.request().method() === "POST"),
      germanPage.getByRole("button", { name: "Agree and start the beta" }).click()
    ]);
    await germanPage.evaluate(() => {
      window.sheetifyLocale.set("de");
      window.dispatchEvent(new CustomEvent("sheetify:localechange", { detail: { locale: "de" } }));
    });
    assert.equal(await germanPage.locator("html").getAttribute("lang"), "de");
    assert.equal(await englishPage.locator("html").getAttribute("lang"), "en");
    await germanPage.getByRole("button", { name: demoProjectTitle }).click();
    await germanPage.getByRole("button", { name: "Projekt öffnen" }).click();
    await germanPage.getByRole("heading", { name: /Sheetify\s*AI/ }).waitFor();
    assert.equal(await germanPage.locator("#chatInput").getAttribute("placeholder"), "Nachricht an Sheetify AI …");

    const englishSession = await pageApi(englishPage, "/api/auth/session");
    const germanSession = await pageApi(germanPage, "/api/auth/session");
    assert.equal(englishSession.body.session.uiLocale, "en");
    assert.equal(germanSession.body.session.uiLocale, "de");

    const afterSwitch = await pageApi(englishPage, `/api/workspace/${encodeURIComponent(projectId)}`);
    assert.equal(JSON.stringify(afterSwitch.body.workspace.documents), beforeDocuments);
    assert.match(beforeDocuments, new RegExp(CONTENT_CANARY));

    const mobileTutorialLocale = mobileDemoVideoDir ? "de" : "en";
    const mobileContext = await browser.newContext({
      locale: mobileTutorialLocale === "de" ? "de-DE" : "en-US",
      viewport: { width: 390, height: 844 },
      isMobile: true,
      hasTouch: true,
      deviceScaleFactor: 2
    });
    const mobilePage = await mobileContext.newPage();
    mobilePage.on("pageerror", (error) => pageErrors.push(error.message));
    const mobilePairing = await pageApi(englishPage, "/api/pass/pairings", { method: "POST", body: "{}" });
    await mobilePage.goto(mobilePairing.body.pairing.url, { waitUntil: "domcontentloaded" });
    await mobilePage.waitForURL(`${baseUrl}/app`, { timeout: 30000 });
    if (mobileTutorialLocale === "de") {
      const localeUpdate = await pageApi(mobilePage, "/api/auth/session", {
        method: "PATCH",
        body: JSON.stringify({ uiLocale: "de" })
      });
      assert.equal(localeUpdate.ok, true, localeUpdate.body.message || localeUpdate.status);
      await mobilePage.evaluate(() => localStorage.setItem("sheetifyimg.ui-locale.v1", "de"));
      await mobilePage.reload({ waitUntil: "domcontentloaded" });
      await mobilePage.waitForURL(`${baseUrl}/app`, { timeout: 30000 });
    }
    if (mobileDemoVideoDir) {
      await mobilePage.evaluate(() => sessionStorage.setItem("sheetifyimg.feedback-reminder.v1", "shown"));
    }
    let mobileActionAnnotations = null;
    let mobileCapturedVideoPath = null;
    if (mobileDemoVideoDir) {
      mobileCapturedVideoPath = path.join(mobileDemoVideoDir, "sheetify-mobile-product-flow.webm");
      await mobilePage.screencast.start({
        path: mobileCapturedVideoPath,
        size: { width: 390, height: 844 },
        quality: 92
      });
      mobileActionAnnotations = await mobilePage.screencast.showActions({
        cursor: "pointer",
        duration: 1050,
        fontSize: 17,
        position: "bottom"
      });
      await mobilePage.screencast.showChapter("Von der Unterrichtsidee zum Arbeitsblatt", {
        description: "Erst den Bauplan prüfen, dann den erzeugten Entwurf ansehen.",
        duration: 2300
      });
      await demoPause(700);
    }
    await Promise.all([
      mobilePage.waitForResponse((response) => response.url().endsWith("/api/beta/consent") && response.request().method() === "POST"),
      mobilePage.getByRole("button", {
        name: mobileTutorialLocale === "de" ? "Zustimmen und Beta starten" : "Agree and start the beta"
      }).click()
    ]);
    await mobilePage.getByRole("heading", {
      name: mobileTutorialLocale === "de" ? "Projekte" : "Projects"
    }).waitFor();
    await demoPause(1400);
    if (mobileDemoVideoDir) {
      await mobilePage.screencast.showChapter("Arbeitsblatt-Projekt auswählen", {
        description: "Im privaten Arbeitsbereich bleiben Ideen und Entwürfe zusammen.",
        duration: 1900
      });
      await demoPause(500);
    }
    await mobilePage.getByRole("button", { name: demoProjectTitle }).click();
    await mobilePage.getByRole("heading", { name: "Sheetify IMG AI" }).waitFor();
    await demoPause(1300);
    if (mobileDemoVideoDir) {
      await mobilePage.screencast.showChapter("Vor der Generierung prüfen", {
        description: "Der Arbeitsblatt-Bauplan macht Inhalt und Aufgabenlogik sichtbar.",
        duration: 2300
      });
      await demoPause(500);
    }
    if (mobileDemoVideoDir) {
      const mobileConceptButton = mobilePage.locator(
        "#chatTimeline button[data-canvas-mode='content'], #chatTimeline button[data-canvas-mode='content_proposal'], #chatTimeline button[data-canvas-mode='concept']"
      ).last();
      if (!await mobileConceptButton.count()) {
        const mobileCanvasActions = await mobilePage.locator("button[data-canvas-mode]").evaluateAll((buttons) => buttons.map((button) => ({
          mode: button.dataset.canvasMode,
          label: button.getAttribute("aria-label"),
          text: button.textContent?.replace(/\s+/g, " ").trim(),
          visible: Boolean(button.offsetWidth || button.offsetHeight || button.getClientRects().length),
          host: button.closest("#chatTimeline") ? "chat" : button.closest("#productionStepList") ? "sidebar" : "other"
        })));
        console.error(JSON.stringify({ mobileCanvasActions }, null, 2));
      }
      assert.ok(await mobileConceptButton.count(), "Visible mobile concept preview action was not found in the chat timeline.");
      await mobileConceptButton.scrollIntoViewIfNeeded();
      await demoPause(650);
      await mobileConceptButton.click();
      const mobileBlueprint = mobilePage.locator("#mobilePreviewSheet [data-worksheet-blueprint]");
      await mobileBlueprint.waitFor();
      assert.equal(await mobileBlueprint.getAttribute("data-blueprint-mode"), "concept");
      await demoPause(1800);
      const firstBlueprintNode = mobilePage.locator("#mobilePreviewSheet [data-blueprint-node]").first();
      if (await firstBlueprintNode.count()) {
        await firstBlueprintNode.click();
        assert.equal(await mobileBlueprint.getAttribute("data-blueprint-mode"), "details");
        await mobileBlueprint.locator("[data-blueprint-mode='concept']").click();
        assert.equal(await mobileBlueprint.getAttribute("data-blueprint-mode"), "concept");
        await mobileBlueprint.locator("[data-blueprint-mode='details']").click();
        assert.equal(await mobileBlueprint.getAttribute("data-blueprint-mode"), "details");
        await demoPause(1700);
      }
      const nextBlueprintNode = mobilePage.locator("#mobilePreviewSheet [data-blueprint-next]");
      if (await nextBlueprintNode.count()) {
        await nextBlueprintNode.click();
        await demoPause(1500);
      }
      await mobilePage.locator("#mobilePreviewCloseIconButton").click();
      await demoPause(700);
      await mobilePage.screencast.showChapter("Den erzeugten Entwurf prüfen", {
        description: "Das erste Bild bleibt ein Entwurf zur Prüfung, kein automatisches Endergebnis.",
        duration: 2400
      });
      await demoPause(500);
      const mobileDraftButton = mobilePage.locator(
        "#chatTimeline button[data-canvas-mode='candidates']"
      ).last();
      assert.ok(await mobileDraftButton.count(), "Visible mobile draft preview action was not found in the chat timeline.");
      await mobileDraftButton.scrollIntoViewIfNeeded();
      await demoPause(650);
      await mobileDraftButton.click();
      const mobileDraftLabel = mobileTutorialLocale === "de" ? "Entwurf 01" : "Draft 01";
      const mobileViewDraftLabel = mobileTutorialLocale === "de" ? "Entwurf ansehen" : "View draft";
      await mobilePage.locator("#mobilePreviewSheet").getByText(mobileDraftLabel, { exact: true }).waitFor();
      assert.equal(await mobilePage.locator("#mobilePreviewSheet").getByRole("button", { name: mobileViewDraftLabel }).count(), 1);
      await demoPause(1500);
      await mobilePage.locator("#mobilePreviewSheet").getByRole("button", { name: mobileViewDraftLabel }).click();
      await mobilePage.locator("#candidateViewerModal").waitFor({ state: "visible" });
      await demoPause(4200);
    } else {
      await mobilePage.locator("#productionStepList [data-canvas-mode='candidates']").dispatchEvent("click");
      await mobilePage.locator("#mobilePreviewSheet").getByText("Draft 01", { exact: true }).waitFor();
      assert.equal(
        await mobilePage.locator("#mobilePreviewSheet").getByRole("button", { name: "View draft" }).count(),
        1
      );
    }
    if (captureDir) {
      const mobileScreenshotName = mobileTutorialLocale === "de"
        ? "product-app-mobile-de.png"
        : "judge-app-mobile-en.png";
      await mobilePage.screenshot({ path: path.join(captureDir, mobileScreenshotName), fullPage: true });
    }
    if (mobileDemoVideoDir) {
      await mobilePage.screencast.stop();
      await mobileActionAnnotations?.[Symbol.asyncDispose]?.();
    }

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
      englishMobile: mobileTutorialLocale === "en",
      germanMobileTutorial: mobileTutorialLocale === "de",
      translatedAccessibilityLabels: true,
      samePassDeviceLocaleIsolation: true,
      germanWorkflowRegression: true,
      worksheetContentUnchanged: true,
      contentCanary: CONTENT_CANARY,
      capturedVideoPath,
      mobileCapturedVideoPath,
      mobileTutorialLocale,
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
