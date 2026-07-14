"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { resolveServerConfig } = require("../server/runtime-config");

const repoRoot = path.resolve(__dirname, "..");

async function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close((error) => error ? reject(error) : resolve(address.port));
    });
  });
}

async function waitForHealth(baseUrl, child, output, timeoutMs = 8000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`Hosting server exited early (${child.exitCode}).\n${output()}`);
    }
    try {
      const response = await fetch(`${baseUrl}/health/ready`);
      if (response.status === 200) {
        return response.json();
      }
    } catch {
      // The listener may not be ready yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Hosting server did not become ready.\n${output()}`);
}

async function waitForExit(child, timeoutMs = 6000) {
  if (child.exitCode !== null) {
    return child.exitCode;
  }
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("Hosting server did not stop in time.")), timeoutMs);
    child.once("exit", (code) => {
      clearTimeout(timeout);
      resolve(code);
    });
  });
}

function productionEnv(runtimeDir, overrides = {}) {
  return {
    SHEETIFYIMG_RUNTIME_MODE: "production",
    NODE_ENV: "production",
    SHEETIFYIMG_RUNTIME_DIR: runtimeDir,
    SHEETIFYIMG_BIND_HOST: "127.0.0.1",
    PORT: "5700",
    OPENAI_API_KEY: "sk-hosting-config-test",
    ...overrides
  };
}

async function main() {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "sheetifyimg-hosting-"));
  const runtimeDir = path.join(tempRoot, "runtime");
  const envFile = path.join(tempRoot, "sheetifyimg.env");
  const port = await freePort();
  const fakeSecret = "sk-hosting-smoke-not-a-real-key";

  assert.throws(
    () => resolveServerConfig({ repoRoot, env: productionEnv("", { SHEETIFYIMG_RUNTIME_DIR: "" }) }),
    /SHEETIFYIMG_RUNTIME_DIR is required/
  );
  assert.throws(
    () => resolveServerConfig({ repoRoot, env: productionEnv(path.join(repoRoot, ".runtime")) }),
    /outside the release directory/
  );
  assert.throws(
    () => resolveServerConfig({ repoRoot, env: productionEnv(runtimeDir, { SHEETIFYIMG_BIND_HOST: "0.0.0.0" }) }),
    /must bind/
  );
  assert.throws(
    () => resolveServerConfig({ repoRoot, env: productionEnv(runtimeDir, { SHEETIFYIMG_PUBLIC_URL: "http://example.test" }) }),
    /must use HTTPS/
  );

  const config = resolveServerConfig({ repoRoot, env: productionEnv(runtimeDir) });
  assert.equal(config.production, true);
  assert.equal(config.projectsDir, path.join(runtimeDir, "projects"));
  assert.equal(config.worksheetsDir, path.join(runtimeDir, "worksheets"));
  assert.equal(config.exposeBillingStatus, false);
  assert.equal(config.planningFlow, "v2");
  assert.equal(resolveServerConfig({
    repoRoot,
    env: productionEnv(runtimeDir, { SHEETIFYIMG_PLANNING_FLOW: "legacy" })
  }).planningFlow, "legacy");
  assert.throws(
    () => resolveServerConfig({
      repoRoot,
      env: productionEnv(runtimeDir, { SHEETIFYIMG_PLANNING_FLOW: "v3" })
    }),
    /must be "v2" or "legacy"/
  );

  await fs.writeFile(envFile, [
    `OPENAI_API_KEY=${fakeSecret}`,
    "SHEETIFYIMG_IMAGE_PROVIDER=openai",
    "SHEETIFYIMG_CODEX_IMAGE_ENABLED=0",
    "SHEETIFYIMG_IMAGE_PRESET=sparsam",
    ""
  ].join("\n"), { mode: 0o600 });

  const env = { ...process.env };
  for (const key of [
    "OPENAI_API_KEY",
    "OPENAI_ADMIN_KEY",
    "PROJECTS_DIR",
    "WORKSHEETS_DIR",
    "SHEETIFYIMG_PLANNING_FLOW",
    "SHEETIFYIMG_HTTPS_KEY",
    "SHEETIFYIMG_HTTPS_CERT"
  ]) {
    delete env[key];
  }
  Object.assign(env, {
    NODE_ENV: "production",
    SHEETIFYIMG_RUNTIME_MODE: "production",
    SHEETIFYIMG_RUNTIME_DIR: runtimeDir,
    SHEETIFYIMG_ENV_FILE: envFile,
    SHEETIFYIMG_BIND_HOST: "127.0.0.1",
    SHEETIFYIMG_PUBLIC_URL: "https://sheetify.example.test",
    SHEETIFYIMG_MAX_JSON_BODY_BYTES: "256",
    SHEETIFYIMG_SHUTDOWN_TIMEOUT_MS: "2000",
    SHEETIFYIMG_EXPOSE_BILLING_STATUS: "0",
    PORT: String(port)
  });

  let stdout = "";
  let stderr = "";
  const child = spawn(process.execPath, ["server/production-server.js"], {
    cwd: repoRoot,
    env,
    stdio: ["ignore", "pipe", "pipe"]
  });
  child.stdout.on("data", (chunk) => { stdout += chunk.toString("utf8"); });
  child.stderr.on("data", (chunk) => { stderr += chunk.toString("utf8"); });
  const output = () => `${stdout}\n${stderr}`;
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    const ready = await waitForHealth(baseUrl, child, output);
    assert.equal(ready.status, "ready");
    assert.deepEqual(ready.checks, {
      state: "ready",
      projects: "ready",
      worksheets: "ready",
      logs: "ready"
    });

    const liveResponse = await fetch(`${baseUrl}/health/live`);
    assert.equal(liveResponse.status, 200);
    assert.equal(liveResponse.headers.get("x-content-type-options"), "nosniff");

    const rootResponse = await fetch(`${baseUrl}/`);
    assert.equal(rootResponse.status, 200);
    assert.match(rootResponse.headers.get("content-type") || "", /text\/html/);

    const serviceWorkerResponse = await fetch(`${baseUrl}/service-worker.js`);
    assert.equal(serviceWorkerResponse.status, 200);
    assert.match(serviceWorkerResponse.headers.get("content-type") || "", /javascript/);

    const projectResponse = await fetch(`${baseUrl}/api/projects/single`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        title: "Hosting Smoke",
        subject: "Test",
        topic: "Externe Runtime"
      })
    });
    assert.equal(projectResponse.status, 201);
    const created = await projectResponse.json();
    assert.equal(created.project.projectId, "hosting-smoke");
    await fs.access(path.join(runtimeDir, "projects", "hosting-smoke", "project-manifest.json"));

    const listResponse = await fetch(`${baseUrl}/api/projects`);
    assert.equal(listResponse.status, 200);
    assert.equal(listResponse.headers.get("cache-control"), "no-store");
    assert.equal((await listResponse.json()).projects.length, 1);

    const invalidJson = await fetch(`${baseUrl}/api/projects/single`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{invalid"
    });
    assert.equal(invalidJson.status, 400);

    const oversizedJson = await fetch(`${baseUrl}/api/projects/single`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "x".repeat(400) })
    });
    assert.equal(oversizedJson.status, 413);

    const billingResponse = await fetch(`${baseUrl}/api/billing/status`);
    assert.equal(billingResponse.status, 404);

    assert.match(output(), /"planningFlow":"v2"/);
    assert.doesNotMatch(output(), new RegExp(fakeSecret.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  } finally {
    if (child.exitCode === null) {
      child.kill("SIGTERM");
    }
    const exitCode = await waitForExit(child).catch(async (error) => {
      child.kill("SIGKILL");
      throw error;
    });
    assert.equal(exitCode, 0, output());
    await fs.rm(tempRoot, { recursive: true, force: true });
  }

  console.log("Hosting runtime smoke passed.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
