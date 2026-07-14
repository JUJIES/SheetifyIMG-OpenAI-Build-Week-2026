"use strict";

const fs = require("node:fs");
const path = require("node:path");

function loadEnvFile(filePath, options = {}) {
  const protectedKeys = options.protectedKeys || new Set(Object.keys(process.env));
  const overrideKeys = new Set(options.overrideKeys || []);
  if (!fs.existsSync(filePath)) {
    if (options.required) {
      throw new Error(`Environment file does not exist: ${filePath}`);
    }
    return false;
  }

  const lines = fs.readFileSync(filePath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const equalsIndex = trimmed.indexOf("=");
    if (equalsIndex <= 0) {
      continue;
    }

    const key = trimmed.slice(0, equalsIndex).trim();
    const rawValue = trimmed.slice(equalsIndex + 1).trim();
    if (!key || (protectedKeys.has(key) && !overrideKeys.has(key))) {
      continue;
    }

    process.env[key] = rawValue.replace(/^['"]|['"]$/g, "");
  }
  return true;
}

function loadLocalEnv(rootDir, options = {}) {
  if (process.env.SHEETIFYIMG_SKIP_LOCAL_ENV === "1") {
    return false;
  }

  const protectedKeys = new Set(Object.keys(process.env));
  const fileNames = options.fileNames || [".env", ".env.local"];

  for (const fileName of fileNames) {
    loadEnvFile(path.join(rootDir, fileName), {
      protectedKeys,
      overrideKeys: options.overrideKeys
    });
  }

  return true;
}

module.exports = {
  loadEnvFile,
  loadLocalEnv
};
