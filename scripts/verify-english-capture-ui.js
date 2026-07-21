"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const net = require("node:net");
const path = require("node:path");
const { chromium } = require("@playwright/test");
const { generateOwnerPasswordHash } = require("../server/owner-auth");

function option(name, fallback = "") {
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
  const outputDir = path.resolve(option("output-dir"));
  const passLabel = option("pass-label", "Devpost Demo Clean Capture");
  const projectTitle = option("project-title", "Earthquakes: When the Ground Moves");
  assert.ok(option("runtime-dir"), "--runtime-dir is required");
  assert.ok(option("output-dir"), "--output-dir is required");
  await fs.access(path.join(runtimeDir, "state", "beta-access.json"));
  await fs.mkdir(outputDir, { recursive: true });

  const port = await freePort();
  const password = "local-capture-ui-verification";
  const ownerHash = await generateOwnerPasswordHash(password, { salt: Buffer.alloc(16, 31) });
  Object.assign(process.env, {
    NODE_ENV: "development",
    SHEETIFYIMG_RUNTIME_MODE: "development",
    SHEETIFYIMG_RUNTIME_DIR: runtimeDir,
    PROJECTS_DIR: path.join(runtimeDir, "projects"),
    WORKSHEETS_DIR: path.join(runtimeDir, "worksheets"),
    SHEETIFYIMG_BIND_HOST: "127.0.0.1",
    PORT: String(port),
    SHEETIFYIMG_SKIP_LOCAL_ENV: "1",
    SHEETIFYIMG_AI_MODE: "stub",
    SHEETIFYIMG_REQUIRE_OPENAI: "0",
    SHEETIFYIMG_OWNER_AUTH_ENABLED: "1",
    SHEETIFYIMG_OWNER_AUTH_USERNAME: "owner",
    SHEETIFYIMG_OWNER_AUTH_PASSWORD_HASH: ownerHash,
    SHEETIFYIMG_BETA_ACCESS_ENABLED: "1",
    SHEETIFYIMG_BETA_ACCESS_SECRET: "sheetifyimg-capture-ui-verification",
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
    const baseUrl = `http://127.0.0.1:${port}`;
    const accessState = JSON.parse(await fs.readFile(path.join(runtimeDir, "state", "beta-access.json"), "utf8"));
    const existingPass = accessState.passes.find((entry) => entry.label === passLabel);
    assert.ok(existingPass?.id, `No saved pass found with label: ${passLabel}`);
    const authorization = `Basic ${Buffer.from(`owner:${password}`, "utf8").toString("base64")}`;
    const response = await fetch(`${baseUrl}/api/admin/passes/${encodeURIComponent(existingPass.id)}/rotate`, {
      method: "POST",
      headers: { authorization, origin: baseUrl, "content-type": "application/json" },
      body: JSON.stringify({ revokeSessions: true })
    });
    const rotatedPass = await response.json();
    assert.equal(response.ok, true, rotatedPass.message || String(response.status));

    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({
      locale: "en-US",
      viewport: { width: 390, height: 844 },
      isMobile: true,
      hasTouch: true,
      deviceScaleFactor: 2
    });
    await context.addInitScript(() => {
      sessionStorage.setItem("sheetifyimg.feedback-reminder.v2", "shown");
      sessionStorage.setItem("sheetifyimg.feedback-render-nudge.v1", "shown");
    });
    const page = await context.newPage();
    page.on("pageerror", (error) => pageErrors.push(error.message));
    await page.goto(rotatedPass.url, { waitUntil: "domcontentloaded" });
    await page.locator("#passCode").fill(rotatedPass.code);
    await page.getByRole("button", { name: "Connect", exact: true }).click();
    await page.waitForURL(`${baseUrl}/app`, { timeout: 30000 });
    await page.getByRole("button", { name: "Agree and start the beta", exact: true }).click();
    await page.getByRole("heading", { name: "Projects", exact: true }).waitFor({ timeout: 30000 });
    const tutorialModal = page.locator("#tutorialModalLayer:not(.hidden)");
    if (await tutorialModal.isVisible().catch(() => false)) {
      await page.locator("#tutorialModalClose").click();
      await page.locator("#tutorialModalLayer.hidden").waitFor({ state: "attached", timeout: 5000 });
    }

    const projectButton = page.locator("button.tree-item").filter({ hasText: projectTitle }).first();
    await projectButton.waitFor({ state: "visible", timeout: 30000 });
    await projectButton.click();
    await page.waitForTimeout(800);
    await page.screenshot({ path: path.join(outputDir, "00-project-selection.png"), fullPage: true });
    const mobileOpenProject = page.getByRole("button", { name: "Open project", exact: true });
    const mobileProjectVisible = await mobileOpenProject.waitFor({ state: "visible", timeout: 5000 })
      .then(() => true)
      .catch(() => false);
    if (mobileProjectVisible) {
      await mobileOpenProject.click();
    }
    await page.getByRole("heading", { name: "Sheetify AI", exact: true }).waitFor({ state: "visible", timeout: 30000 }).catch(async (error) => {
      const visibleButtons = await page.locator("button:visible").allInnerTexts();
      throw new Error(`${error.message}\nVisible buttons: ${JSON.stringify(visibleButtons)}`);
    });
    await page.waitForTimeout(1200);

    const runtimeLabels = await page.evaluate(() => {
      const decisionLabel = decisionButtonLabel({
        id: "generate_lessonbrief_proposal",
        decisionLabel: "Ja, Konzept schreiben"
      });
      const taskCountLabel = worksheetScopeLabel({}, { tasks: [{}, {}, {}] });
      showCandidateGenerationToast("success", {
        projectId: "capture-ui-verification",
        projectLabel: "Earthquakes",
        candidateGeneration: {
          latestCompletion: {
            completedAt: "2026-07-21T12:00:00.000Z",
            candidateId: "candidate_verification",
            pageCount: 1
          }
        }
      });
      return { decisionLabel, taskCountLabel };
    });
    const result = {
      providerCallsAllowed: false,
      decisionLabel: runtimeLabels.decisionLabel,
      taskCountLabel: runtimeLabels.taskCountLabel,
      germanDecisionButtons: await page.getByRole("button", { name: "Ja, Konzept schreiben", exact: true }).count(),
      completionToast: await page.getByText("Draft for \"Earthquakes\" is ready.", { exact: true }).count(),
      pageErrors
    };
    await page.screenshot({ path: path.join(outputDir, "01-chat-buttons-en.png"), fullPage: true });
    assert.equal(result.decisionLabel, "Yes, write the concept", "English concept decision label is incorrect");
    assert.equal(result.taskCountLabel, "3 Tasks", "English task count label is incorrect");
    assert.equal(result.germanDecisionButtons, 0, "German concept decision button is still rendered");
    assert.equal(result.completionToast, 1, "English completion toast was not rendered");

    await page.evaluate(() => openMobilePreviewMode("content"));
    await page.getByRole("heading", { name: "Worksheet concept", exact: true }).waitFor({ timeout: 30000 });
    const visibleText = await page.locator("body").innerText();
    result.hasEnglishScope = /\b(?:1 page|3 Tasks)\b/.test(visibleText);
    result.hasGermanTaskCount = /\b3 Aufgaben\b/.test(visibleText);
    await page.screenshot({ path: path.join(outputDir, "02-concept-en.png"), fullPage: true });
    assert.equal(result.hasGermanTaskCount, false, "German task count is still rendered");
    assert.equal(result.hasEnglishScope, true, "English concept scope is missing");
    assert.deepEqual(pageErrors, []);
    console.log(JSON.stringify({ ok: true, ...result, outputDir }, null, 2));
  } finally {
    if (browser) await browser.close();
    if (server) await new Promise((resolve) => server.close(resolve));
  }
}

main().catch((error) => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
