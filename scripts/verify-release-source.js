#!/usr/bin/env node

"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const repoRoot = path.resolve(__dirname, "..");
const requiredFiles = [
  "package-lock.json",
  "public/index.html",
  "server/owner-auth.js",
  "server/production-server.js",
  "server/runtime-config.js",
  "server/runtime-health.js"
];

function javascriptFiles(relativeRoot) {
  const absoluteRoot = path.join(repoRoot, relativeRoot);
  const files = [];
  const visit = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const absolutePath = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(absolutePath);
      if (entry.isFile() && entry.name.endsWith(".js")) files.push(absolutePath);
    }
  };
  visit(absoluteRoot);
  return files;
}

function main() {
  for (const relativePath of requiredFiles) {
    assert.ok(fs.existsSync(path.join(repoRoot, relativePath)), `${relativePath} is required`);
  }

  const files = [
    ...javascriptFiles("core"),
    ...javascriptFiles("server"),
    ...fs.readdirSync(path.join(repoRoot, "public"), { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith(".js"))
      .map((entry) => path.join(repoRoot, "public", entry.name))
  ].sort();

  for (const filePath of files) {
    const result = spawnSync(process.execPath, ["--check", filePath], {
      cwd: repoRoot,
      encoding: "utf8"
    });
    assert.equal(result.status, 0, result.stderr || `Syntax check failed: ${filePath}`);
  }

  process.stdout.write(`${JSON.stringify({
    ok: true,
    kind: "buildless-release-validation",
    nodeVersion: process.versions.node,
    checkedJavaScriptFiles: files.length
  })}\n`);
}

main();
