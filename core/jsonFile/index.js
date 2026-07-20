"use strict";

const fs = require("node:fs/promises");
const path = require("node:path");

function transientJsonRead(error) {
  return error instanceof SyntaxError && /Unexpected end of JSON input/.test(error.message || "");
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function readJsonFile(filePath, options = {}) {
  const retries = Number.isInteger(options.retries) ? options.retries : 2;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      return JSON.parse(await fs.readFile(filePath, "utf8"));
    } catch (error) {
      if (!transientJsonRead(error) || attempt >= retries) {
        throw error;
      }
      await delay(10 * (attempt + 1));
    }
  }
  throw new Error(`Could not read JSON file: ${filePath}`);
}

async function readJsonFileIfExists(filePath, options = {}) {
  try {
    return await readJsonFile(filePath, options);
  } catch (error) {
    if (error?.code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

async function writeJsonFile(filePath, value, options = {}) {
  const dir = path.dirname(filePath);
  const base = path.basename(filePath);
  const renameFile = typeof options.renameFile === "function" ? options.renameFile : fs.rename;
  const renameRetries = Number.isInteger(options.renameRetries) ? options.renameRetries : 8;
  const renameDelayMs = Number.isFinite(options.renameDelayMs) ? Math.max(1, options.renameDelayMs) : 25;
  const tempPath = path.join(
    dir,
    `.${base}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`
  );
  await fs.mkdir(dir, { recursive: true });
  try {
    await fs.writeFile(tempPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
    for (let attempt = 0; ; attempt += 1) {
      try {
        await renameFile(tempPath, filePath);
        break;
      } catch (error) {
        const transientWindowsRename = process.platform === "win32"
          && ["EACCES", "EBUSY", "EPERM"].includes(error?.code)
          && attempt < renameRetries;
        if (!transientWindowsRename) throw error;
        await delay(Math.min(renameDelayMs * (2 ** attempt), 500));
      }
    }
  } catch (error) {
    await fs.rm(tempPath, { force: true }).catch(() => {});
    throw error;
  }
}

module.exports = {
  readJsonFile,
  readJsonFileIfExists,
  writeJsonFile
};
