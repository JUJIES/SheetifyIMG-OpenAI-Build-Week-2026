"use strict";

const fs = require("node:fs/promises");
const path = require("node:path");

function openAiErrorMessage(payload, status) {
  const message = payload?.error?.message || payload?.message || `OpenAI request failed with status ${status}.`;
  const code = payload?.error?.code ? ` (${payload.error.code})` : "";
  return `${message}${code}`;
}

async function readJsonSafe(response) {
  const text = await response.text();
  if (!text) {
    return null;
  }
  try {
    return JSON.parse(text);
  } catch {
    return { message: text.slice(0, 500) };
  }
}

async function createResponse(body, requestConfig) {
  if (!requestConfig?.apiKey) {
    throw new Error("OPENAI_API_KEY is missing.");
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), requestConfig.timeoutMs || 45000);

  try {
    const response = await fetch(`${requestConfig.baseUrl.replace(/\/$/, "")}/responses`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${requestConfig.apiKey}`,
        "content-type": "application/json"
      },
      body: JSON.stringify(body),
      signal: controller.signal
    });

    const payload = await readJsonSafe(response);
    if (!response.ok) {
      throw new Error(openAiErrorMessage(payload, response.status));
    }
    return payload;
  } catch (error) {
    if (error.name === "AbortError") {
      throw new Error("OpenAI request timed out.");
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function createImageGeneration(body, requestConfig) {
  if (!requestConfig?.apiKey) {
    throw new Error("OPENAI_API_KEY is missing.");
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), requestConfig.timeoutMs || 180000);

  try {
    const response = await fetch(`${requestConfig.baseUrl.replace(/\/$/, "")}/images/generations`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${requestConfig.apiKey}`,
        "content-type": "application/json"
      },
      body: JSON.stringify(body),
      signal: controller.signal
    });

    const payload = await readJsonSafe(response);
    if (!response.ok) {
      throw new Error(openAiErrorMessage(payload, response.status));
    }
    return payload;
  } catch (error) {
    if (error.name === "AbortError") {
      throw new Error("OpenAI image request timed out.");
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function mimeTypeForFile(filePath) {
  const extension = path.extname(String(filePath || "")).toLowerCase();
  if (extension === ".jpg" || extension === ".jpeg") {
    return "image/jpeg";
  }
  if (extension === ".webp") {
    return "image/webp";
  }
  return "image/png";
}

function appendFormField(form, key, value) {
  if (value === undefined || value === null || value === "") {
    return;
  }
  form.append(key, String(value));
}

async function appendImageFiles(form, imagePaths = []) {
  for (const imagePath of imagePaths) {
    const bytes = await fs.readFile(imagePath);
    const blob = new Blob([bytes], {
      type: mimeTypeForFile(imagePath)
    });
    form.append("image[]", blob, path.basename(imagePath));
  }
}

async function createImageEdit(body, requestConfig) {
  if (!requestConfig?.apiKey) {
    throw new Error("OPENAI_API_KEY is missing.");
  }
  const imagePaths = Array.isArray(body.imagePaths) ? body.imagePaths : [];
  if (!imagePaths.length) {
    throw new Error("Image edit requires at least one reference image.");
  }

  const form = new FormData();
  appendFormField(form, "model", body.model);
  appendFormField(form, "prompt", body.prompt);
  appendFormField(form, "n", body.n);
  appendFormField(form, "size", body.size);
  appendFormField(form, "quality", body.quality);
  appendFormField(form, "output_format", body.output_format);
  appendFormField(form, "background", body.background);
  appendFormField(form, "moderation", body.moderation);
  await appendImageFiles(form, imagePaths);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), requestConfig.timeoutMs || 180000);

  try {
    const response = await fetch(`${requestConfig.baseUrl.replace(/\/$/, "")}/images/edits`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${requestConfig.apiKey}`
      },
      body: form,
      signal: controller.signal
    });

    const payload = await readJsonSafe(response);
    if (!response.ok) {
      throw new Error(openAiErrorMessage(payload, response.status));
    }
    return payload;
  } catch (error) {
    if (error.name === "AbortError") {
      throw new Error("OpenAI image edit request timed out.");
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function textFromContentItem(item) {
  if (!item) {
    return "";
  }
  if (typeof item === "string") {
    return item;
  }
  if (typeof item.text === "string") {
    return item.text;
  }
  if (typeof item.output_text === "string") {
    return item.output_text;
  }
  if (typeof item.content === "string") {
    return item.content;
  }
  return "";
}

function extractOutputText(response) {
  if (typeof response?.output_text === "string") {
    return response.output_text.trim();
  }

  const parts = [];
  for (const item of response?.output || []) {
    if (Array.isArray(item.content)) {
      for (const contentItem of item.content) {
        const text = textFromContentItem(contentItem);
        if (text) {
          parts.push(text);
        }
      }
    } else {
      const text = textFromContentItem(item);
      if (text && item.type !== "function_call") {
        parts.push(text);
      }
    }
  }

  return parts.join("\n").trim();
}

function extractToolCalls(response) {
  const calls = [];
  for (const item of response?.output || []) {
    if (item?.type === "function_call") {
      calls.push({
        id: item.call_id || item.id || null,
        name: item.name,
        arguments: item.arguments || "{}"
      });
      continue;
    }

    if (item?.function?.name) {
      calls.push({
        id: item.id || null,
        name: item.function.name,
        arguments: item.function.arguments || "{}"
      });
    }
  }
  return calls.filter((call) => call.name);
}

module.exports = {
  createImageEdit,
  createImageGeneration,
  createResponse,
  extractOutputText,
  extractToolCalls
};
