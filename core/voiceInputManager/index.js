"use strict";

const fs = require("node:fs/promises");
const path = require("node:path");
const {
  ARTIFACT_STATUSES,
  ARTIFACT_TYPES,
  EVENT_TYPES,
  PRODUCTION_SCHEMA_VERSION
} = require("../contracts");
const { getTranscriptionRequestConfig } = require("../aiConfig");
const { createAudioTranscription } = require("../openaiClient");
const { appendEvent } = require("../eventLog");
const {
  artifactIdFor,
  nextArtifactVersion,
  readArtifactIndex,
  registerArtifact
} = require("../artifactManager");
const { openProject } = require("../projectManager");
const { logModelRun, sanitizeErrorMessage } = require("../modelRunLogger");
const { estimateOpenAiTranscriptionCost } = require("../imageCostManager");
const { createUsageAttribution } = require("../usageAttributionManager");
const { writeJsonFile } = require("../jsonFile");
const { safeFileName } = require("../inputManager");

const DEFAULT_REPO_ROOT = path.resolve(__dirname, "..", "..");
const DEFAULT_PROJECTS_DIR = path.join(DEFAULT_REPO_ROOT, "projects");
const MAX_AUDIO_BYTES = 25 * 1024 * 1024;

function extensionForMimeType(mimeType = "") {
  const normalized = String(mimeType || "").toLowerCase();
  if (normalized.includes("mp4")) {
    return "mp4";
  }
  if (normalized.includes("mpeg") || normalized.includes("mp3")) {
    return "mp3";
  }
  if (normalized.includes("wav")) {
    return "wav";
  }
  if (normalized.includes("ogg")) {
    return "ogg";
  }
  if (normalized.includes("webm")) {
    return "webm";
  }
  return "webm";
}

function normalizedDurationMs(value) {
  const duration = Number(value);
  return Number.isFinite(duration) && duration >= 0 ? Math.round(duration) : null;
}

function transcriptionPrompt() {
  return [
    "Sprache: Deutsch.",
    "Kontext: Eine Lehrkraft diktiert Arbeitsanweisungen fuer SheetifyIMG, eine App zur Erstellung von Arbeitsblaettern.",
    "Wichtige Begriffe: Arbeitsblatt, Entwurf, Entwurfsvariante, Konzept, Arbeitsblatt-Konzept, Input, Bild, PDF, Schwarz-Weiss, druckerfreundlich, Klasse, Aufgabe, Material, Blaubeere, SheetifyIMG.",
    "Gib den gesprochenen Inhalt als normalen deutschen Chattext zurueck. Wiederhole keine Zwischenstaende."
  ].join(" ");
}

async function updateProjectTimestamp(projectDir, now) {
  const manifestPath = path.join(projectDir, "project-manifest.json");
  try {
    const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
    await writeJsonFile(manifestPath, {
      ...manifest,
      updatedAt: now
    });
  } catch (error) {
    if (error.code !== "ENOENT") {
      throw error;
    }
  }
}

async function transcribeProjectAudio(projectId, input = {}, options = {}) {
  const repoRoot = options.repoRoot || DEFAULT_REPO_ROOT;
  const projectsDir = options.projectsDir || DEFAULT_PROJECTS_DIR;
  const projectDir = path.join(projectsDir, projectId);
  await openProject(projectId, { projectsDir });

  const buffer = Buffer.isBuffer(input.buffer) ? input.buffer : Buffer.from(input.buffer || "");
  if (!buffer.length) {
    throw new Error("Die Audioaufnahme ist leer.");
  }
  if (buffer.length > MAX_AUDIO_BYTES) {
    throw new Error("Die Audioaufnahme ist zu gross. Bitte maximal 25 MB aufnehmen.");
  }

  const now = options.now || new Date().toISOString();
  const usageAttribution = createUsageAttribution(options.usageAttribution, {
    projectId,
    operationKind: "voice_transcription"
  });
  const requestConfig = options.requestConfig || getTranscriptionRequestConfig();
  if (requestConfig.status !== "ready") {
    throw new Error("Spracheingabe braucht den OpenAI API-Key.");
  }

  const index = await readArtifactIndex(projectDir);
  const version = nextArtifactVersion(index, ARTIFACT_TYPES.VOICE_INPUT);
  const artifactId = artifactIdFor(ARTIFACT_TYPES.VOICE_INPUT, version);
  const voiceId = artifactId;
  const mimeType = String(input.mimeType || "audio/webm");
  const extension = extensionForMimeType(mimeType);
  const originalName = safeFileName(input.fileName || `aufnahme.${extension}`);
  const fileName = `audio.${extension}`;
  const relativeDir = path.posix.join("source", "voice", voiceId);
  const relativeAudioPath = path.posix.join(relativeDir, fileName);
  const relativeTranscriptPath = path.posix.join(relativeDir, "transcript.json");
  const voiceDir = path.join(projectDir, "source", "voice", voiceId);
  const audioPath = path.join(voiceDir, fileName);
  const transcriptPath = path.join(voiceDir, "transcript.json");
  const durationMs = normalizedDurationMs(input.durationMs);

  await fs.mkdir(voiceDir, { recursive: true });
  await fs.writeFile(audioPath, buffer);
  await appendEvent(projectDir, {
    type: EVENT_TYPES.VOICE_INPUT_CREATED,
    createdAt: now,
    step: "input",
    artifactId,
    payload: {
      voiceId,
      path: relativeAudioPath,
      mimeType,
      size: buffer.length,
      durationMs,
      originalName,
      operationId: usageAttribution.operationId
    }
  }, { now });

  const startedAt = Date.now();
  let modelCallLogged = false;
  try {
    const transcriptionClient = options.createAudioTranscription || createAudioTranscription;
    const transcription = await transcriptionClient({
      model: requestConfig.model,
      language: requestConfig.language,
      prompt: transcriptionPrompt(),
      response_format: "json",
      file: {
        bytes: buffer,
        mimeType,
        fileName: originalName
      }
    }, requestConfig);
    const usage = transcription?.usage && typeof transcription.usage === "object"
      ? transcription.usage
      : null;
    const costEstimate = estimateOpenAiTranscriptionCost({
      usage,
      model: requestConfig.model,
      durationMs
    });
    await logModelRun(projectDir, {
      status: "success",
      source: "voice_input",
      purpose: "transcription",
      model: requestConfig.model,
      provider: "openai",
      durationMs: Date.now() - startedAt,
      usage,
      costEstimate,
      attribution: usageAttribution,
      metadata: {
        voiceId,
        audioBytes: buffer.length,
        audioMimeType: mimeType,
        audioDurationMs: durationMs
      }
    }, { now });
    modelCallLogged = true;
    const text = String(transcription?.text || "").replace(/\s+/g, " ").trim();
    if (!text) {
      throw new Error("Die Aufnahme konnte nicht transkribiert werden.");
    }

    const transcriptDocument = {
      schemaVersion: 1,
      voiceId,
      artifactId,
      createdAt: now,
      source: {
        path: relativeAudioPath,
        originalName,
        mimeType,
        size: buffer.length,
        durationMs
      },
      transcription: {
        provider: "openai",
        model: requestConfig.model,
        language: requestConfig.language,
        text,
        responseFormat: "json"
      },
      usage: {
        status: "draft_chat_input",
        sentAsChatEventId: null
      }
    };
    await writeJsonFile(transcriptPath, transcriptDocument);

    const artifact = await registerArtifact(projectDir, {
      id: artifactId,
      type: ARTIFACT_TYPES.VOICE_INPUT,
      version,
      path: relativeTranscriptPath,
      status: ARTIFACT_STATUSES.CURRENT,
      step: "input",
      createdAt: now,
      metadata: {
        voiceId,
        audioPath: relativeAudioPath,
        transcriptPath: relativeTranscriptPath,
        mimeType,
        size: buffer.length,
        durationMs,
        model: requestConfig.model
      }
    }, { now });

    await appendEvent(projectDir, {
      type: EVENT_TYPES.VOICE_TRANSCRIBED,
      createdAt: now,
      step: "input",
      artifactId,
      payload: {
        voiceId,
        transcriptPath: relativeTranscriptPath,
        model: requestConfig.model,
        language: requestConfig.language,
        text,
        operationId: usageAttribution.operationId
      }
    }, { now });
    await updateProjectTimestamp(projectDir, now);

    return {
      artifact,
      voice: {
        voiceId,
        artifactId,
        audioPath: relativeAudioPath,
        transcriptPath: relativeTranscriptPath,
        transcript: text,
        model: requestConfig.model,
        language: requestConfig.language,
        durationMs,
        mimeType,
        size: buffer.length
      },
      transcript: transcriptDocument
    };
  } catch (error) {
    if (!modelCallLogged) {
      await logModelRun(projectDir, {
        status: "error",
        source: "voice_input",
        purpose: "transcription",
        model: requestConfig.model,
        provider: "openai",
        durationMs: Date.now() - startedAt,
        attribution: usageAttribution,
        metadata: {
          voiceId,
          audioBytes: buffer.length,
          audioMimeType: mimeType,
          audioDurationMs: durationMs
        },
        error: sanitizeErrorMessage(error)
      }, { now });
    }
    throw error;
  }
}

module.exports = {
  transcribeProjectAudio
};
