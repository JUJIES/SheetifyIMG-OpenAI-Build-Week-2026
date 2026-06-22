"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const path = require("node:path");

function toPosix(filePath) {
  return filePath.split(path.sep).join("/");
}

function dataUrlParts(dataUrl) {
  const match = String(dataUrl || "").match(/^data:(image\/(?:png|jpeg|webp));base64,([a-z0-9+/=\s]+)$/i);
  if (!match) {
    return null;
  }
  return {
    mimeType: match[1].toLowerCase(),
    base64: match[2].replace(/\s/g, "")
  };
}

function extensionForMimeType(mimeType) {
  if (mimeType === "image/jpeg") {
    return "jpg";
  }
  if (mimeType === "image/webp") {
    return "webp";
  }
  return "png";
}

function safeFeedbackId(now) {
  const stamp = String(now || new Date().toISOString()).replace(/[^0-9a-z]/gi, "").slice(0, 15);
  return `feedback_${stamp}_${crypto.randomUUID().slice(0, 8)}`;
}

function normalizeSource(attachment = {}) {
  const source = attachment.source || {};
  return {
    projectId: source.projectId || attachment.projectId || null,
    runId: source.runId || attachment.runId || null,
    candidateId: source.candidateId || attachment.candidateId || null,
    page: Number(source.page || attachment.page || 1),
    role: source.role || attachment.role || null,
    sourcePath: source.sourcePath || attachment.sourcePath || null,
    sourceUrl: source.sourceUrl || attachment.sourceUrl || null,
    selectionRect: source.selectionRect || attachment.selectionRect || null,
    naturalSize: source.naturalSize || attachment.naturalSize || null,
    displaySize: source.displaySize || attachment.displaySize || null
  };
}

async function saveVisualFeedbackAttachments(projectDir, attachments = [], options = {}) {
  const now = options.now || new Date().toISOString();
  const repoRoot = options.repoRoot || path.resolve(projectDir, "..", "..");
  const saved = [];

  for (const rawAttachment of attachments.slice(0, 4)) {
    if ((rawAttachment.kind || rawAttachment.type) !== "visual_feedback") {
      continue;
    }

    const parts = dataUrlParts(rawAttachment.dataUrl);
    if (!parts) {
      throw new Error("Der Screenshot-Anhang konnte nicht gelesen werden.");
    }

    const buffer = Buffer.from(parts.base64, "base64");
    if (buffer.length > 8 * 1024 * 1024) {
      throw new Error("Der Screenshot-Ausschnitt ist zu gross. Bitte einen kleineren Bereich markieren.");
    }

    const feedbackId = safeFeedbackId(now);
    const feedbackDir = path.join(projectDir, "feedback", feedbackId);
    const extension = extensionForMimeType(parts.mimeType);
    const cropFileName = `crop.${extension}`;
    const cropPath = path.join(feedbackDir, cropFileName);
    const source = normalizeSource(rawAttachment);
    const label = rawAttachment.label
      || [source.candidateId, source.page ? `Seite ${source.page}` : null].filter(Boolean).join(" · ")
      || "Screenshot-Ausschnitt";

    await fs.mkdir(feedbackDir, { recursive: true });
    await fs.writeFile(cropPath, buffer);

    const manifest = {
      schemaVersion: 1,
      id: feedbackId,
      kind: "visual_feedback",
      createdAt: now,
      label,
      mimeType: parts.mimeType,
      cropPath: toPosix(path.relative(projectDir, cropPath)),
      source,
      userInstructionRequired: true
    };
    await fs.writeFile(path.join(feedbackDir, "feedback-manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

    const repoRelativeCropPath = toPosix(path.relative(repoRoot, cropPath));
    saved.push({
      attachment: {
        id: feedbackId,
        kind: "visual_feedback",
        label,
        mimeType: parts.mimeType,
        path: manifest.cropPath,
        url: `/files/${repoRelativeCropPath}`,
        source,
        userInstructionRequired: true
      },
      openAiImage: {
        type: "input_image",
        image_url: `data:${parts.mimeType};base64,${parts.base64}`,
        detail: "high"
      }
    });
  }

  return saved;
}

module.exports = {
  saveVisualFeedbackAttachments
};
