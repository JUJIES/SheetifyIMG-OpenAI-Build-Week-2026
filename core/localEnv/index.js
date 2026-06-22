"use strict";

const fs = require("node:fs");
const path = require("node:path");

function loadLocalEnv(rootDir, options = {}) {
  const protectedKeys = new Set(Object.keys(process.env));
  const overrideKeys = new Set(options.overrideKeys || []);
  const fileNames = options.fileNames || [".env", ".env.local"];

  for (const fileName of fileNames) {
    const filePath = path.join(rootDir, fileName);
    if (!fs.existsSync(filePath)) {
      continue;
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
  }
}

module.exports = {
  loadLocalEnv
};
