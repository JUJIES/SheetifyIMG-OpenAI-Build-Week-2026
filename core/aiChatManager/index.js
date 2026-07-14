"use strict";

const fs = require("node:fs/promises");
const path = require("node:path");
const { EVENT_TYPES } = require("../contracts");
const { appendEvent, readEvents } = require("../eventLog");
const { getAiRuntimeStatus } = require("../aiConfig");
const { appendChatRoutingTrace } = require("../chatRoutingTraceManager");
const { updateTeachingContextFromMessage } = require("../teachingContextManager");
const { saveVisualFeedbackAttachments } = require("../visualFeedbackManager");
const { createUsageAttribution } = require("../usageAttributionManager");
const {
  resolveChatActionOffer,
  resolveChatActionOfferFromIntent,
  resolveChatCommand,
  resolveChatCommandFromIntent
} = require("../chatCommandResolver");
const { interpretChatIntentDecision } = require("../chatIntentInterpreter");
const { buildWorkspace, workspaceMessagesFromEvents } = require("../workspaceManager");
const { runResolvedChatCommand } = require("./commandRunner");
const {
  appendInputGateResponse,
  appendLocalActionOfferResponse,
  appendManualCandidateFlowResponse,
  shouldOfferStarterIdeas,
  shouldUseLegacyChatFallback
} = require("./localResponses");
const {
  contradictsRequiredConfirmation,
  sendOpenAiChatResponse
} = require("./openAiResponder");

const DEFAULT_REPO_ROOT = path.resolve(__dirname, "..", "..");
const DEFAULT_PROJECTS_DIR = path.join(DEFAULT_REPO_ROOT, "projects");
const MODEL_UPLOAD_MAX_BYTES = 20 * 1024 * 1024;
const MODEL_FILE_MIME_TYPES = new Set([
  "application/json",
  "application/pdf",
  "text/csv",
  "text/markdown",
  "text/plain"
]);
const REVISION_TARGET_KINDS = new Set(["concept", "draft"]);
const REVISION_TARGET_SOURCES = new Set(["explicit", "inferred"]);

function textValue(value, max = 240) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  return text ? text.slice(0, max) : null;
}

function numberValue(value) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : null;
}

function sanitizeRevisionTarget(value = null, projectId = null) {
  if (!value || typeof value !== "object") {
    return null;
  }
  const kind = REVISION_TARGET_KINDS.has(value.kind) ? value.kind : null;
  if (!kind) {
    return null;
  }
  const target = {
    source: REVISION_TARGET_SOURCES.has(value.source) ? value.source : "explicit",
    kind,
    label: textValue(value.label, 80),
    projectId: textValue(value.projectId, 120) || textValue(projectId, 120)
  };
  if (kind === "concept") {
    return {
      ...target,
      proposalId: textValue(value.proposalId, 160),
      contentMirrorId: textValue(value.contentMirrorId || value.conceptId, 160),
      conceptVersion: numberValue(value.conceptVersion)
    };
  }
  return {
    ...target,
    runId: textValue(value.runId, 160),
    candidateId: textValue(value.candidateId, 160),
    page: numberValue(value.page)
  };
}

function sanitizeVoiceInput(value = null) {
  if (!value || typeof value !== "object") {
    return null;
  }
  return {
    voiceId: textValue(value.voiceId, 160),
    artifactId: textValue(value.artifactId, 160),
    audioPath: textValue(value.audioPath, 240),
    transcriptPath: textValue(value.transcriptPath, 240),
    model: textValue(value.model, 120),
    language: textValue(value.language, 20),
    durationMs: numberValue(value.durationMs),
    mimeType: textValue(value.mimeType, 80),
    size: numberValue(value.size)
  };
}

function projectDirFor(projectId, projectsDir) {
  return path.join(projectsDir, projectId);
}

function textOrNull(value, max = 240) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  return text ? text.slice(0, max) : null;
}

function normalizeUploadPath(value) {
  const uploadPath = String(value || "").replaceAll("\\", "/").replace(/^\/+/, "");
  return uploadPath.startsWith("source/uploads/") ? uploadPath : null;
}

function normalizeInputUploadAttachment(rawAttachment = {}) {
  if ((rawAttachment.kind || rawAttachment.type) !== "input_upload") {
    return null;
  }
  const source = rawAttachment.source || {};
  const uploadPath = normalizeUploadPath(
    rawAttachment.path
      || rawAttachment.uploadedFile?.path
      || rawAttachment.file?.path
      || source.path
      || source.sourcePath
  );
  if (!uploadPath) {
    return null;
  }
  const originalName = textOrNull(rawAttachment.originalName || source.originalName || rawAttachment.label || path.basename(uploadPath), 180);
  const mimeType = textOrNull(rawAttachment.mimeType || source.mimeType || "application/octet-stream", 120) || "application/octet-stream";
  const size = Number(rawAttachment.size || source.size || 0) || 0;
  const artifactId = textOrNull(rawAttachment.artifactId || source.artifactId, 120);
  return {
    id: textOrNull(rawAttachment.id || artifactId || uploadPath, 180),
    kind: "input_upload",
    label: originalName || path.basename(uploadPath),
    originalName,
    mimeType,
    size,
    path: uploadPath,
    artifactId,
    source: {
      kind: "input_upload",
      artifactId,
      path: uploadPath,
      originalName,
      mimeType,
      size
    }
  };
}

function normalizeInputUploadAttachments(attachments = []) {
  return (Array.isArray(attachments) ? attachments : [])
    .map(normalizeInputUploadAttachment)
    .filter(Boolean)
    .slice(0, 12);
}

function modelMimeType(value) {
  return String(value || "application/octet-stream").split(";")[0].trim().toLowerCase() || "application/octet-stream";
}

function modelUploadRef(attachment = {}, modelInput = "unknown") {
  return {
    id: attachment.id || null,
    kind: "input_upload",
    label: attachment.label || attachment.originalName || null,
    originalName: attachment.originalName || null,
    mimeType: attachment.mimeType || null,
    size: attachment.size || null,
    path: attachment.path || null,
    artifactId: attachment.artifactId || attachment.source?.artifactId || null,
    modelInput
  };
}

function modelUploadNotice(attachment = {}, reason) {
  const label = attachment.originalName || attachment.label || path.basename(attachment.path || "Anhang");
  return {
    type: "input_text",
    text: `Hinweis zum Anhang "${label}": ${reason}`
  };
}

function resolveModelUploadPath(projectDir, attachment = {}) {
  const uploadPath = normalizeUploadPath(attachment.path || attachment.source?.path);
  if (!uploadPath) {
    return null;
  }
  const uploadsRoot = path.resolve(projectDir, "source", "uploads");
  const absolutePath = path.resolve(projectDir, uploadPath);
  const relativeToUploads = path.relative(uploadsRoot, absolutePath);
  if (!relativeToUploads || relativeToUploads.startsWith("..") || path.isAbsolute(relativeToUploads)) {
    return null;
  }
  return absolutePath;
}

function dataUrlForBuffer(buffer, mimeType) {
  return `data:${mimeType};base64,${buffer.toString("base64")}`;
}

async function openAiContentItemForInputUpload(projectDir, attachment = {}) {
  const mimeType = modelMimeType(attachment.mimeType);
  const absolutePath = resolveModelUploadPath(projectDir, attachment);
  if (!absolutePath) {
    return {
      contentItem: modelUploadNotice(attachment, "Die gespeicherte Datei konnte nicht sicher im Projektordner gefunden werden."),
      ref: modelUploadRef(attachment, "unreadable")
    };
  }

  let stat;
  try {
    stat = await fs.stat(absolutePath);
  } catch {
    return {
      contentItem: modelUploadNotice(attachment, "Die gespeicherte Datei ist nicht mehr lesbar."),
      ref: modelUploadRef(attachment, "missing")
    };
  }
  if (!stat.isFile()) {
    return {
      contentItem: modelUploadNotice(attachment, "Der gespeicherte Pfad ist keine Datei."),
      ref: modelUploadRef(attachment, "unreadable")
    };
  }
  if (stat.size > MODEL_UPLOAD_MAX_BYTES) {
    return {
      contentItem: modelUploadNotice(attachment, "Die Datei ist fuer den direkten Modellkontext zu gross und bleibt nur als gespeicherter Input referenziert."),
      ref: modelUploadRef(attachment, "skipped_oversize")
    };
  }

  const filename = attachment.originalName || attachment.label || path.basename(absolutePath);
  const isImage = mimeType.startsWith("image/");
  const isFile = MODEL_FILE_MIME_TYPES.has(mimeType);
  if (!isImage && !isFile) {
    return {
      contentItem: modelUploadNotice(attachment, `Dieser Dateityp (${mimeType}) wird im Chat noch nicht direkt ausgewertet.`),
      ref: modelUploadRef(attachment, "skipped_unsupported")
    };
  }

  const buffer = await fs.readFile(absolutePath);
  const fileData = dataUrlForBuffer(buffer, mimeType);
  if (isImage) {
    return {
      contentItem: {
        type: "input_image",
        image_url: fileData,
        detail: "high"
      },
      ref: modelUploadRef(attachment, "included_image")
    };
  }
  return {
    contentItem: {
      type: "input_file",
      filename,
      file_data: fileData
    },
    ref: modelUploadRef(attachment, "included_file")
  };
}

async function prepareInputUploadModelContext(projectDir, attachments = []) {
  const inputUploads = normalizeInputUploadAttachments(attachments);
  const openAiContentItems = [];
  const inputUploadRefs = [];
  for (const attachment of inputUploads) {
    const result = await openAiContentItemForInputUpload(projectDir, attachment);
    if (result.contentItem) {
      openAiContentItems.push(result.contentItem);
    }
    if (result.ref) {
      inputUploadRefs.push(result.ref);
    }
  }
  return {
    openAiContentItems,
    inputUploadRefs
  };
}

async function readChat(projectId, options = {}) {
  const repoRoot = options.repoRoot || DEFAULT_REPO_ROOT;
  const projectsDir = options.projectsDir || DEFAULT_PROJECTS_DIR;
  const worksheetsDir = options.worksheetsDir;
  const runtime = getAiRuntimeStatus();
  const workspace = await buildWorkspace(projectId, { repoRoot, projectsDir, worksheetsDir });
  return {
    mode: runtime.mode,
    runtime,
    messages: workspace.chat?.messages || [],
    workspace
  };
}

async function appendUserChatEvent(projectDir, input = {}, message = "", attachments = [], now) {
  return appendEvent(projectDir, {
    type: EVENT_TYPES.USER_MESSAGE,
    createdAt: now,
    step: "auftrag",
    payload: {
      mode: "openai",
      message,
      uiEvent: input.uiEvent || "chat_message",
      operationId: input.operationId || null,
      canvasFocus: input.canvasFocus || null,
      revisionTarget: input.revisionTarget || null,
      voiceInput: sanitizeVoiceInput(input.voiceInput),
      attachments
    }
  }, { now });
}

async function prepareChatContext(projectId, projectDir, input = {}, options = {}) {
  const repoRoot = options.repoRoot;
  const projectsDir = options.projectsDir;
  const worksheetsDir = options.worksheetsDir;
  const now = options.now;
  const message = String(input.message || "").trim();
  if (!message) {
    throw new Error("Message is required.");
  }

  const rawAttachments = input.attachments || [];
  const visualFeedback = await saveVisualFeedbackAttachments(projectDir, rawAttachments, {
    repoRoot,
    now
  });
  const attachments = [
    ...visualFeedback.map((entry) => entry.attachment),
    ...normalizeInputUploadAttachments(rawAttachments)
  ];
  const inputUploadModelContext = await prepareInputUploadModelContext(projectDir, attachments);
  const openAiContentItems = [
    ...visualFeedback.map((entry) => entry.openAiImage),
    ...inputUploadModelContext.openAiContentItems
  ];
  const revisionTarget = sanitizeRevisionTarget(input.revisionTarget, projectId);

  const userEvent = await appendUserChatEvent(projectDir, {
    ...input,
    operationId: options.usageAttribution?.operationId || null,
    revisionTarget
  }, message, attachments, now);
  await updateTeachingContextFromMessage(projectDir, message, {
    now,
    usageAttribution: options.usageAttribution
  });

  const workspace = await buildWorkspace(projectId, { repoRoot, projectsDir, worksheetsDir });
  const events = await readEvents(projectDir);
  const messages = workspaceMessagesFromEvents(events);
  const intentDecision = await interpretChatIntentDecision(projectDir, {
    workspace,
    message,
    messages,
    revisionTarget
  }, {
    repoRoot,
    now,
    uiEvent: input.uiEvent || "chat_message",
    chatIntentInterpreter: options.chatIntentInterpreter,
    usageAttribution: options.usageAttribution
  });

  return {
    attachments,
    intent: intentDecision.intent,
    intentDecision,
    inputUploadRefs: inputUploadModelContext.inputUploadRefs,
    message,
    messages,
    openAiContentItems,
    revisionTarget,
    usageAttribution: options.usageAttribution,
    userEvent,
    workspace
  };
}

async function withChatRoutingTrace(projectId, projectDir, context, resolution, result, input = {}, now) {
  await appendChatRoutingTrace(projectDir, {
    context,
    message: context.message,
    now,
    projectId,
    resolution,
    result,
    uiEvent: input.uiEvent || "chat_message"
  });
  return result;
}

async function sendChatMessage(projectId, input = {}, options = {}) {
  const repoRoot = options.repoRoot || DEFAULT_REPO_ROOT;
  const projectsDir = options.projectsDir || DEFAULT_PROJECTS_DIR;
  const projectDir = projectDirFor(projectId, projectsDir);
  const now = input.now || options.now || new Date().toISOString();
  const usageAttribution = createUsageAttribution(options.usageAttribution, {
    projectId,
    operationKind: "chat_message"
  });
  const runtime = getAiRuntimeStatus();
  const chatOptions = {
    ...options,
    repoRoot,
    projectsDir,
    now,
    usageAttribution
  };

  const context = await prepareChatContext(projectId, projectDir, input, chatOptions);
  const resolvedCommand = resolveChatCommandFromIntent(context.workspace, context.intent, context.message)
    || (shouldUseLegacyChatFallback(context.intent) ? resolveChatCommand(context.workspace, context.message) : null);
  if (resolvedCommand) {
    const result = await runResolvedChatCommand(projectId, projectDir, resolvedCommand, {
      repoRoot,
      projectsDir,
      worksheetsDir: options.worksheetsDir,
      now,
      usageAttribution
    });
    return withChatRoutingTrace(projectId, projectDir, context, {
      kind: "command",
      command: resolvedCommand
    }, result, input, now);
  }

  const actionOffer = resolveChatActionOfferFromIntent(context.workspace, context.intent, context.message)
    || (shouldUseLegacyChatFallback(context.intent) ? resolveChatActionOffer(context.workspace, context.message) : null);
  if (actionOffer) {
    const result = await appendLocalActionOfferResponse(projectId, projectDir, actionOffer, {
      message: context.message,
      uiEvent: input.uiEvent,
      workspace: context.workspace
    }, {
      repoRoot,
      projectsDir,
      runtime,
      now,
      usageAttribution
    });
    return withChatRoutingTrace(projectId, projectDir, context, {
      kind: "action_offer",
      offer: actionOffer
    }, result, input, now);
  }

  const manualResponse = await appendManualCandidateFlowResponse(projectId, projectDir, context.intent, {
    repoRoot,
    projectsDir,
    runtime,
    now,
    usageAttribution
  });
  if (manualResponse) {
    return withChatRoutingTrace(projectId, projectDir, context, {
      kind: "manual_guidance",
      source: "manual_candidate_flow"
    }, manualResponse, input, now);
  }

  const starterIdeas = shouldOfferStarterIdeas(context.workspace, context.intent, context.message);
  if (runtime.status !== "ready") {
    await appendChatRoutingTrace(projectDir, {
      context,
      message: context.message,
      now,
      projectId,
      resolution: {
        kind: "error",
        source: "runtime_not_ready"
      },
      result: {
        mode: "openai_config_error",
        response: {
          content: runtime.fallbackReason || "OpenAI is not configured.",
          suggestedActions: []
        },
        workspace: context.workspace
      },
      uiEvent: input.uiEvent || "chat_message"
    });
    throw new Error(runtime.fallbackReason || "OpenAI is not configured.");
  }

  if (!context.workspace.inputReadiness?.ready
    && !(context.workspace.documents?.brief?.data || context.workspace.documents?.content?.data)
    && !starterIdeas) {
    const result = await appendInputGateResponse(projectId, projectDir, {
      repoRoot,
      projectsDir,
      runtime,
      now,
      usageAttribution
    });
    return withChatRoutingTrace(projectId, projectDir, context, {
      kind: "input_gate",
      source: "missing_input_readiness"
    }, result, input, now);
  }

  const result = await sendOpenAiChatResponse(projectId, projectDir, {
    attachments: context.attachments,
    inputUploadRefs: context.inputUploadRefs,
    intent: context.intent,
    messages: context.messages,
    message: context.message,
    openAiContentItems: context.openAiContentItems,
    rawInput: input,
    revisionTarget: context.revisionTarget,
    runtime,
    workspace: context.workspace
  }, {
    repoRoot,
    projectsDir,
    now,
    usageAttribution
  });
  return withChatRoutingTrace(projectId, projectDir, context, {
    kind: "none",
    source: "openai_chat"
  }, result, input, now);
}

module.exports = {
  readChat,
  sendChatMessage,
  __testing: {
    contradictsRequiredConfirmation,
    prepareInputUploadModelContext
  }
};
