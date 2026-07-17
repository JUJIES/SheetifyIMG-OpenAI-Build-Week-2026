"use strict";

const { spawn } = require("node:child_process");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");

const DEFAULT_TIMEOUT_MS = 300000;
const MAX_CAPTURE_BYTES = 256 * 1024;

function truncate(value, maxLength = 4000) {
  const text = String(value || "");
  return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text;
}

function appendCapture(current, chunk) {
  const next = `${current}${chunk}`;
  return next.length > MAX_CAPTURE_BYTES ? next.slice(next.length - MAX_CAPTURE_BYTES) : next;
}

function processEnvWithoutApiKeys(overrides = {}) {
  const env = { ...process.env, ...overrides };
  delete env.OPENAI_API_KEY;
  delete env.CODEX_API_KEY;
  return env;
}

function executableCommand(command, args = []) {
  const executable = String(command || "").trim();
  if (/\.(?:cjs|mjs|js)$/i.test(executable)) {
    return {
      command: process.execPath,
      args: [executable, ...args]
    };
  }
  return { command: executable, args };
}

function runProcess(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const timeoutMs = Number(options.timeoutMs) > 0 ? Number(options.timeoutMs) : DEFAULT_TIMEOUT_MS;
    const executable = executableCommand(command, args);
    const child = spawn(executable.command, executable.args, {
      cwd: options.cwd,
      env: processEnvWithoutApiKeys(options.env),
      stdio: ["pipe", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) {
        return;
      }
      settled = true;
      child.kill("SIGTERM");
      reject(new Error(`Codex image worker timed out after ${timeoutMs} ms.`));
    }, timeoutMs);

    child.stdout?.on("data", (chunk) => {
      stdout = appendCapture(stdout, chunk.toString("utf8"));
    });
    child.stderr?.on("data", (chunk) => {
      stderr = appendCapture(stderr, chunk.toString("utf8"));
    });
    if (options.stdin !== undefined) {
      child.stdin?.end(String(options.stdin));
    } else {
      child.stdin?.end();
    }
    child.on("error", (error) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code, signal) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      resolve({ code, signal, stdout, stderr });
    });
  });
}

async function writeText(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${String(value || "")}\n`, "utf8");
}

async function pathExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function listPngFilesRecursive(dirPath, result = []) {
  let entries;
  try {
    entries = await fs.readdir(dirPath, { withFileTypes: true });
  } catch {
    return result;
  }
  for (const entry of entries) {
    const entryPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      await listPngFilesRecursive(entryPath, result);
    } else if (entry.isFile() && /\.png$/i.test(entry.name)) {
      result.push(entryPath);
    }
  }
  return result;
}

async function fileInfo(filePath) {
  const stat = await fs.stat(filePath);
  return {
    path: filePath,
    byteLength: stat.size,
    mtimeMs: stat.mtimeMs
  };
}

async function newestPngAfter(dirPath, startedAtMs) {
  const files = await listPngFilesRecursive(dirPath);
  const infos = [];
  for (const filePath of files) {
    try {
      const info = await fileInfo(filePath);
      if (info.byteLength > 0 && info.mtimeMs >= startedAtMs - 2000) {
        infos.push(info);
      }
    } catch {
      // Ignore files that disappear while the worker is scanning.
    }
  }
  infos.sort((left, right) => right.mtimeMs - left.mtimeMs);
  return infos[0]?.path || null;
}

function parseSessionId(output) {
  return String(output || "").match(/\bsession id:\s*([a-z0-9-]+)/i)?.[1] || null;
}

function codexGeneratedImagesDir(config = {}) {
  return config.codexGeneratedImagesDir
    ? path.resolve(config.codexGeneratedImagesDir)
    : path.join(os.homedir(), ".codex", "generated_images");
}

async function assertChatGptCodexLogin(config = {}) {
  const codexBin = config.codexBin || "codex";
  const result = await runProcess(codexBin, ["login", "status"], {
    cwd: config.cwd,
    timeoutMs: Math.min(Number(config.timeoutMs) || 15000, 30000)
  });
  const statusText = `${result.stdout}\n${result.stderr}`.trim();
  if (result.code !== 0) {
    throw new Error(`Codex login status failed: ${truncate(statusText || result.signal || "unknown error", 800)}`);
  }
  if (!/ChatGPT/i.test(statusText)) {
    throw new Error("Codex Usage requires Codex to be logged in with ChatGPT.");
  }
  return statusText;
}

function codexExecPrompt({ targetPath, prompt, requestedSize }) {
  const size = String(requestedSize || "").trim();
  const sizeInstruction = size
    ? `Target pixel canvas: exactly ${size} px. Keep the full PNG output at exactly ${size} pixels if the image tool allows explicit pixel dimensions.`
    : "Target pixel canvas: use the closest available A4 portrait pixel canvas.";
  return [
    "$imagegen",
    "Use Codex built-in image generation, not the OpenAI API.",
    "Create exactly one PNG image for the SheetifyIMG worksheet candidate.",
    sizeInstruction,
    "Target aspect ratio: DIN A4 portrait, exactly 210:297 / 0.7071. Avoid square output, 2:3 poster output, 16:9, or landscape.",
    "If exact pixels are not possible, preserve the 210:297 A4 aspect ratio as the hard priority and report the actual detected pixel size.",
    `Save or copy the final generated PNG to this exact absolute path: ${targetPath}`,
    "If the image is first stored under ~/.codex/generated_images, copy the newest generated PNG to that target path.",
    "After saving, reply with only the saved path and detected pixel size if available.",
    "",
    "Worksheet image prompt:",
    prompt
  ].join("\n");
}

function codexExecArgs({ config, cwd, referenceImages = [], finalMessagePath }) {
  const args = [
    "exec",
    "--sandbox",
    "workspace-write",
    "--skip-git-repo-check",
    "--cd",
    cwd,
    "--model",
    config.codexModel || "gpt-5.4",
    "-c",
    `model_reasoning_effort="${config.codexReasoningEffort || "low"}"`,
    "--output-last-message",
    finalMessagePath
  ];

  for (const reference of referenceImages) {
    if (reference.absolutePath) {
      args.push("--image", reference.absolutePath);
    }
  }

  args.push("-");

  return args;
}

async function resolveGeneratedImage({ targetPath, generatedImagesDir, sessionId, startedAtMs }) {
  if (await pathExists(targetPath)) {
    const info = await fileInfo(targetPath);
    if (info.byteLength > 0) {
      return targetPath;
    }
  }

  if (sessionId) {
    const sessionDir = path.join(generatedImagesDir, sessionId);
    const sessionImage = await newestPngAfter(sessionDir, startedAtMs);
    if (sessionImage) {
      return sessionImage;
    }
  }

  return newestPngAfter(generatedImagesDir, startedAtMs);
}

async function runCodexImageJob({ projectDir, runDir, candidateId, pageNumber, prompt, referenceImages = [], requestConfig = {}, now }) {
  const codexBin = requestConfig.codexBin || "codex";
  const timeoutMs = requestConfig.codexTimeoutMs || DEFAULT_TIMEOUT_MS;
  const jobId = `${candidateId}_page_${pageNumber}`;
  const jobDir = path.join(runDir, "codex-jobs", jobId);
  const targetPath = path.join(jobDir, "output.png");
  const promptPath = path.join(jobDir, "prompt.md");
  const finalMessagePath = path.join(jobDir, "final-message.txt");
  const stdoutPath = path.join(jobDir, "stdout.log");
  const stderrPath = path.join(jobDir, "stderr.log");
  const generatedImagesDir = codexGeneratedImagesDir(requestConfig);

  await fs.mkdir(jobDir, { recursive: true });
  const codexPrompt = codexExecPrompt({
    targetPath,
    requestedSize: requestConfig.imageSize,
    prompt
  });
  await writeText(promptPath, codexPrompt);
  await assertChatGptCodexLogin({ ...requestConfig, cwd: projectDir, timeoutMs: 15000 });

  const startedAtMs = Date.now();
  const startedAt = now || new Date(startedAtMs).toISOString();
  const result = await runProcess(codexBin, codexExecArgs({
    config: requestConfig,
    cwd: projectDir,
    referenceImages,
    finalMessagePath
  }), {
    cwd: projectDir,
    timeoutMs,
    stdin: codexPrompt,
    env: {
      SHEETIFYIMG_CODEX_GENERATED_IMAGES_DIR: generatedImagesDir
    }
  });
  await writeText(stdoutPath, result.stdout);
  await writeText(stderrPath, result.stderr);

  if (result.code !== 0) {
    const detail = truncate(`${result.stderr}\n${result.stdout}`.trim() || result.signal || "unknown error", 1400);
    throw new Error(`Codex image generation failed: ${detail}`);
  }

  const sessionId = parseSessionId(`${result.stdout}\n${result.stderr}`);
  const sourcePath = await resolveGeneratedImage({
    targetPath,
    generatedImagesDir,
    sessionId,
    startedAtMs
  });

  if (!sourcePath) {
    throw new Error("Codex image generation finished but no PNG output could be found.");
  }

  return {
    provider: "codex_cli",
    model: requestConfig.codexModel || "gpt-5.4",
    imagePath: sourcePath,
    jobDir,
    jobPath: path.relative(runDir, jobDir).split(path.sep).join("/"),
    targetPath,
    generatedImagesDir,
    sessionId,
    startedAt,
    durationMs: Date.now() - startedAtMs,
    finalMessage: truncate(await fs.readFile(finalMessagePath, "utf8").catch(() => ""), 1200),
    stdoutPath: path.relative(runDir, stdoutPath).split(path.sep).join("/"),
    stderrPath: path.relative(runDir, stderrPath).split(path.sep).join("/")
  };
}

module.exports = {
  runCodexImageJob
};
