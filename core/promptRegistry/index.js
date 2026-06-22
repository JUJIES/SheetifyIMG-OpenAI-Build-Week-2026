"use strict";

const fs = require("node:fs/promises");
const path = require("node:path");

const DEFAULT_REPO_ROOT = path.resolve(__dirname, "..", "..");
const DEFAULT_PROMPT_VERSION = "v1";

const cache = new Map();

function promptFilePath(name, options = {}) {
  const repoRoot = options.repoRoot || DEFAULT_REPO_ROOT;
  const version = options.version || DEFAULT_PROMPT_VERSION;
  return path.join(repoRoot, "prompts", version, `${name}.md`);
}

async function readPrompt(name, options = {}) {
  const version = options.version || DEFAULT_PROMPT_VERSION;
  const key = `${options.repoRoot || DEFAULT_REPO_ROOT}:${version}:${name}`;
  if (cache.has(key)) {
    return cache.get(key);
  }

  const filePath = promptFilePath(name, options);
  const content = await fs.readFile(filePath, "utf8");
  const prompt = {
    name,
    version,
    content: content.trim()
  };
  cache.set(key, prompt);
  return prompt;
}

async function composePrompts(names, options = {}) {
  const prompts = [];
  for (const name of names || []) {
    const prompt = await readPrompt(name, options);
    prompts.push(`<!-- prompt:${prompt.name}@${prompt.version} -->\n${prompt.content}`);
  }
  return prompts.join("\n\n---\n\n");
}

module.exports = {
  DEFAULT_PROMPT_VERSION,
  composePrompts,
  readPrompt
};
