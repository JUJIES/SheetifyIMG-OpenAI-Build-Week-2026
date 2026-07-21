"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const DEFAULT_FFPROBE = process.env.FFPROBE_PATH || "ffprobe";

function audioDurationMs(filePath, ffprobePath = DEFAULT_FFPROBE) {
  const result = spawnSync(ffprobePath, [
    "-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", filePath
  ], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr || `ffprobe failed for ${filePath}`);
  return Math.round(Number.parseFloat(result.stdout.trim()) * 1000);
}

async function loadVoiceInputManifest(filePath) {
  assert.ok(filePath, "The mixed-input capture requires --voice-input-manifest.");
  const manifestPath = path.resolve(filePath);
  const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
  assert.equal(manifest.schemaVersion, 1, "Unsupported voice-input manifest schema.");
  const fakeMicrophoneWav = path.resolve(path.dirname(manifestPath), manifest.fakeMicrophoneWav);
  const sourceAudio = path.resolve(path.dirname(manifestPath), manifest.sourceAudio);
  for (const requiredPath of [fakeMicrophoneWav, sourceAudio]) {
    assert.equal(await fs.stat(requiredPath).then((item) => item.isFile()).catch(() => false), true, `Missing voice-input audio: ${requiredPath}`);
  }
  const fakeAudioDurationMs = audioDurationMs(fakeMicrophoneWav);
  const recordDurationMs = Number(manifest.recordDurationMs);
  assert.ok(Number.isFinite(recordDurationMs) && recordDurationMs > 500, "Invalid voice-input recordDurationMs.");
  assert.ok(recordDurationMs < fakeAudioDurationMs - 250, "The fake microphone WAV needs at least 250 ms trailing silence after recordDurationMs.");
  assert.ok(String(manifest.expectedTranscript || "").trim().length > 20, "The voice-input manifest needs expectedTranscript.");
  return {
    ...manifest,
    manifestPath,
    fakeMicrophoneWav,
    sourceAudio,
    fakeAudioDurationMs,
    recordDurationMs
  };
}

function chromiumVoiceCaptureArgs(manifest) {
  if (!manifest) return [];
  return [
    "--use-fake-ui-for-media-stream",
    "--use-fake-device-for-media-stream",
    `--use-file-for-fake-audio-capture=${manifest.fakeMicrophoneWav}`
  ];
}

function meaningfulWordOverlap(expected, actual) {
  const words = (value) => new Set(String(value || "")
    .toLocaleLowerCase("de-DE")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .split(/\s+/)
    .filter((word) => word.length >= 4));
  const expectedWords = words(expected);
  const actualWords = words(actual);
  if (!expectedWords.size) return 1;
  return [...expectedWords].filter((word) => actualWords.has(word)).length / expectedWords.size;
}

async function stopVoiceCaptureWithoutPointerTravel(page, voiceButton, { pressMs = 70 } = {}) {
  // The pointer is already resting on the voice button after recording starts.
  // Running the full stabilized travel routine again can take long enough for
  // Chromium's finite fake-microphone file to loop back to its beginning.
  const box = await voiceButton.boundingBox();
  assert.ok(box, "Voice button has no recording-state bounding box.");
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2, { delay: pressMs });
}

async function captureVoiceDraft(page, {
  manifest,
  smoothClick,
  mark = () => {},
  transcriptionTimeoutMs = 90000
}) {
  assert.ok(manifest, "Voice capture requires a loaded manifest.");
  const voiceButton = page.locator("#chatVoiceButton");
  await smoothClick(page, voiceButton, { afterMs: 120 });
  await page.waitForFunction(() => document.querySelector("#chatVoiceButton")?.classList.contains("listening"));
  mark("voice_recording_started", {
    assetId: manifest.assetId || null,
    mixOffsetMs: Number(manifest.mixOffsetMs || 0)
  });
  await page.waitForTimeout(manifest.recordDurationMs);
  await stopVoiceCaptureWithoutPointerTravel(page, voiceButton);
  await page.waitForTimeout(80);
  mark("voice_recording_stopped", { assetId: manifest.assetId || null });
  await page.waitForFunction(() => (
    document.querySelector("#chatVoiceButton")?.classList.contains("transcribing")
    || (document.querySelector("#chatInput")?.value || "").trim().length > 20
  ), null, { timeout: 10000 });
  mark("voice_transcribing_visible", { assetId: manifest.assetId || null });
  await page.waitForFunction(() => (document.querySelector("#chatInput")?.value || "").trim().length > 20, null, {
    timeout: transcriptionTimeoutMs
  });
  const transcript = (await page.locator("#chatInput").inputValue()).replace(/\s+/g, " ").trim();
  const overlap = meaningfulWordOverlap(manifest.expectedTranscript, transcript);
  assert.ok(overlap >= Number(manifest.minimumWordOverlap || 0.80), `Voice transcript diverged from the prepared track (word overlap ${overlap.toFixed(2)}).`);
  mark("voice_transcript_ready", {
    assetId: manifest.assetId || null,
    transcript,
    meaningfulWordOverlap: Number(overlap.toFixed(3))
  });
  return { transcript, meaningfulWordOverlap: overlap };
}

module.exports = {
  DEFAULT_FFPROBE,
  audioDurationMs,
  captureVoiceDraft,
  chromiumVoiceCaptureArgs,
  loadVoiceInputManifest,
  meaningfulWordOverlap,
  stopVoiceCaptureWithoutPointerTravel
};
