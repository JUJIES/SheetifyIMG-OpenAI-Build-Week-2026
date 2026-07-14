"use strict";

const fsConstants = require("node:fs").constants;
const fs = require("node:fs/promises");
const path = require("node:path");

function runtimeDirectories(config) {
  return [config.runtimeDir, config.stateDir, config.logsDir, config.projectsDir, config.worksheetsDir]
    .filter(Boolean);
}

async function prepareRuntime(config) {
  for (const directory of runtimeDirectories(config)) {
    await fs.mkdir(directory, { recursive: true });
  }
  return checkRuntimeReadiness(config);
}

async function checkWritable(directory) {
  await fs.access(directory, fsConstants.R_OK | fsConstants.W_OK);
}

async function checkRuntimeReadiness(config) {
  const checks = {};
  const entries = {
    state: config.stateDir,
    projects: config.projectsDir,
    worksheets: config.worksheetsDir,
    logs: config.logsDir
  };
  let ready = true;

  for (const [name, directory] of Object.entries(entries)) {
    try {
      await checkWritable(directory);
      checks[name] = "ready";
    } catch {
      checks[name] = "unavailable";
      ready = false;
    }
  }

  return {
    status: ready ? "ready" : "not_ready",
    checks
  };
}

async function writeRuntimeProbe(config) {
  const probePath = path.join(config.stateDir, `.runtime-probe-${process.pid}-${Date.now()}`);
  try {
    await fs.writeFile(probePath, "ok\n", { flag: "wx" });
    await fs.rm(probePath, { force: true });
    return true;
  } catch {
    await fs.rm(probePath, { force: true }).catch(() => {});
    return false;
  }
}

module.exports = {
  checkRuntimeReadiness,
  prepareRuntime,
  runtimeDirectories,
  writeRuntimeProbe
};
