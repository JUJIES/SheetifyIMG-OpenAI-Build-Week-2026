"use strict";

const SETTINGS_STORAGE_KEY = "sheetifyimg.settings.v1";
const imageProviderSettingIds = new Set(["codex_cli", "openai"]);

function normalizeImageProviderSetting(value) {
  return imageProviderSettingIds.has(value) ? value : null;
}

function loadSettings() {
  try {
    const raw = window.localStorage.getItem(SETTINGS_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    const imageProviderConfigured = parsed.imageProviderConfigured === true;
    return {
      imageProvider: imageProviderConfigured ? normalizeImageProviderSetting(parsed.imageProvider) : null
    };
  } catch {
    return { imageProvider: null };
  }
}

function saveSettings(settings = {}) {
  try {
    const imageProvider = normalizeImageProviderSetting(settings.imageProvider);
    window.localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify({
      imageProvider,
      imageProviderConfigured: Boolean(imageProvider)
    }));
  } catch {
    // Browser storage can be unavailable in restricted contexts. The current session still works.
  }
}

const state = {
  mode: "library",
  query: "",
  selectedId: null,
  selectedItem: null,
  workspace: null,
  settings: loadSettings(),
  settingsModal: {
    lastFocusedElement: null
  },
  activeStatusStep: null,
  activeCanvasMode: "content",
  tree: null,
  collapsedFolders: new Set(),
  draggingTreeNodeId: null,
  pendingChat: null,
  pendingCommand: null,
  commandError: null,
  chatStreamTimer: null,
  voiceInput: {
    recognition: null,
    listening: false,
    starting: false,
    stopRequested: false,
    baseText: "",
    lastError: null
  },
  focusCandidateId: null,
  candidateViewer: {
    items: [],
    index: 0,
    lastFocusedElement: null
  },
  candidateInfo: {
    lastFocusedElement: null
  },
  composerAttachments: [],
  inputUploadReceipts: [],
  canvasCapture: {
    active: false,
    dragging: false,
    pointerId: null,
    targetCard: null,
    startX: 0,
    startY: 0,
    currentX: 0,
    currentY: 0
  },
  debugSnapshot: null,
  canvasLayout: {
    collapsed: true,
    docked: false,
    width: 520,
    lastExpandedWidth: 520,
    resizing: false,
    pointerId: null,
    startX: 0,
    suppressClick: false
  },
  mobilePreview: {
    mode: null,
    source: "workspace",
    presentation: "sheet",
    minimized: false,
    lastFocusedElement: null
  }
};

const spriteHref = "/icons/lucide-sprite.svg?v=12";
const initialUrlParams = new URLSearchParams(window.location.search);
const initialProjectId = initialUrlParams.get("project") || "";
let pendingInitialSelectedId = initialProjectId ? `project:${initialProjectId}` : null;

const elements = {
  topbarProject: document.querySelector("#topbarProject"),
  workspaceProjectTitle: document.querySelector("#workspaceProjectTitle"),
  workspaceLibraryButton: document.querySelector("#workspaceLibraryButton"),
  workspaceCopyButton: document.querySelector("#workspaceCopyButton"),
  backToLibraryButton: document.querySelector("#backToLibraryButton"),
  librarySidebar: document.querySelector("#librarySidebar"),
  productionSidebar: document.querySelector("#productionSidebar"),
  productionSidebarTitle: document.querySelector("#productionSidebarTitle"),
  productionStepList: document.querySelector("#productionStepList"),
  productionArtifactList: document.querySelector("#productionArtifactList"),
  tree: document.querySelector("#libraryTree"),
  searchInput: document.querySelector("#librarySearchInput"),
  emptyState: document.querySelector("#emptyState"),
  projectView: document.querySelector("#projectView"),
  workspaceView: document.querySelector("#workspaceView"),
  chatPanel: document.querySelector(".chat-panel"),
  mobileStatusStrip: document.querySelector("#mobileStatusStrip"),
  mobilePreviewLayer: document.querySelector("#mobilePreviewLayer"),
  mobilePreviewBackdrop: document.querySelector("#mobilePreviewBackdrop"),
  mobilePreviewSheet: document.querySelector("#mobilePreviewSheet"),
  mobilePreviewEyebrow: document.querySelector("#mobilePreviewEyebrow"),
  mobilePreviewTitle: document.querySelector("#mobilePreviewTitle"),
  mobilePreviewSubtitle: document.querySelector("#mobilePreviewSubtitle"),
  mobilePreviewBody: document.querySelector("#mobilePreviewBody"),
  mobilePreviewFooter: document.querySelector("#mobilePreviewFooter"),
  mobilePreviewMinimizeButton: document.querySelector("#mobilePreviewMinimizeButton"),
  mobilePreviewCloseButton: document.querySelector("#mobilePreviewCloseButton"),
  mobilePreviewMini: document.querySelector("#mobilePreviewMini"),
  mobilePreviewMiniLabel: document.querySelector("#mobilePreviewMiniLabel"),
  projectTitle: document.querySelector("#projectTitle"),
  statusList: document.querySelector("#statusList"),
  previewGrid: document.querySelector("#previewGrid"),
  previewTitle: document.querySelector("#previewTitle"),
  previewEyebrow: document.querySelector("#previewEyebrow"),
  openPreviewButton: document.querySelector("#openPreviewButton"),
  downloadButton: document.querySelector("#downloadButton"),
  refreshButton: document.querySelector("#refreshButton"),
  settingsButton: document.querySelector("#settingsButton"),
  settingsModal: document.querySelector("#settingsModal"),
  settingsCloseButton: document.querySelector("#settingsCloseButton"),
  imageProviderSettings: document.querySelector("#imageProviderSettings"),
  newWorksheetButton: document.querySelector("#newWorksheetButton"),
  newWorksheetForm: document.querySelector("#newWorksheetForm"),
  newWorksheetTitle: document.querySelector("#newWorksheetTitle"),
  newWorksheetSubject: document.querySelector("#newWorksheetSubject"),
  newWorksheetTopic: document.querySelector("#newWorksheetTopic"),
  newWorksheetTargetGroup: document.querySelector("#newWorksheetTargetGroup"),
  cancelNewWorksheetButton: document.querySelector("#cancelNewWorksheetButton"),
  createNewWorksheetButton: document.querySelector("#createNewWorksheetButton"),
  loadProjectButton: document.querySelector("#loadProjectButton"),
  loadProjectButtonLabel: document.querySelector("#loadProjectButtonLabel"),
  copyContentButton: document.querySelector("#copyContentButton"),
  chatTimeline: document.querySelector("#chatTimeline"),
  teachingContextPanel: document.querySelector("#teachingContextPanel"),
  chatComposer: document.querySelector("#chatComposer"),
  chatInput: document.querySelector("#chatInput"),
  chatInputShell: document.querySelector("#chatInputShell"),
  chatSendButton: document.querySelector(".chat-send-button"),
  chatVoiceButton: document.querySelector("#chatVoiceButton"),
  chatAttachmentButton: document.querySelector("#chatAttachmentButton"),
  chatAttachmentInput: document.querySelector("#chatAttachmentInput"),
  refreshChatButton: document.querySelector("#refreshChatButton"),
  canvasTitle: document.querySelector("#canvasTitle"),
  canvasResizeHandle: document.querySelector("#canvasResizeHandle"),
  canvasBody: document.querySelector("#canvasBody"),
  canvasCaptureButton: document.querySelector("#canvasCaptureButton"),
  canvasDownloadButton: document.querySelector("#canvasDownloadButton"),
  canvasOpenButton: document.querySelector("#canvasOpenButton"),
  confirmationModal: document.querySelector("#confirmationModal"),
  confirmationEyebrow: document.querySelector("#confirmationEyebrow"),
  confirmationTitle: document.querySelector("#confirmationTitle"),
  confirmationMessage: document.querySelector("#confirmationMessage"),
  confirmationCancelButton: document.querySelector("#confirmationCancelButton"),
  confirmationAcceptButton: document.querySelector("#confirmationAcceptButton"),
  candidateViewerModal: document.querySelector("#candidateViewerModal"),
  candidateViewerCounter: document.querySelector("#candidateViewerCounter"),
  candidateViewerTitle: document.querySelector("#candidateViewerTitle"),
  candidateViewerMeta: document.querySelector("#candidateViewerMeta"),
  candidateViewerImage: document.querySelector("#candidateViewerImage"),
  candidateViewerCopyButton: document.querySelector("#candidateViewerCopyButton"),
  candidateViewerCloseButton: document.querySelector("#candidateViewerCloseButton"),
  candidateViewerPreviousButton: document.querySelector("#candidateViewerPreviousButton"),
  candidateViewerNextButton: document.querySelector("#candidateViewerNextButton"),
  candidateInfoModal: document.querySelector("#candidateInfoModal"),
  candidateInfoTitle: document.querySelector("#candidateInfoTitle"),
  candidateInfoMeta: document.querySelector("#candidateInfoMeta"),
  candidateInfoBody: document.querySelector("#candidateInfoBody"),
  candidateInfoCloseButton: document.querySelector("#candidateInfoCloseButton"),
  toast: document.querySelector("#toast")
};

const statusLabels = {
  concept: "Arbeitsblatt-Konzept",
  candidates: "Kandidaten",
  drafts: "Kandidaten",
  has_candidates: "Kandidaten",
  selected: "Kandidaten",
  exported: "Kandidaten",
  ready_for_generation: "Arbeitsblatt-Konzept",
  needs_approval: "Arbeitsblatt-Konzept",
  draft: "Input",
  error: "Prüfen",
  export: "Kandidaten",
  input: "Input"
};

const canvasLabels = {
  assignment: "Input",
  brief: "Arbeitsblatt-Konzept",
  content: "Arbeitsblatt-Konzept",
  warnings: "Arbeitsblatt-Konzept",
  candidates: "Kandidaten",
  selection: "Kandidaten",
  export: "Kandidaten",
  series: "Reihe",
  lessonbrief_proposal: "Konzept-Vorschlag",
  content_proposal: "Konzept-Vorschlag",
  warnings_proposal: "Prüfvorschlag",
  image_spec_proposal: "Interne ImageSpec"
};

const CANVAS_DEFAULT_WIDTH = 520;
const CANVAS_MIN_WIDTH = 360;
const CANVAS_MIN_CHAT_WIDTH = 340;
const CANVAS_SNAP_THRESHOLD = 120;
const CANVAS_COLLAPSE_THRESHOLD = 160;
const CANVAS_HANDLE_WIDTH = 18;

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function renderIcon(name, extraClass = "") {
  const classes = ["icon", extraClass].filter(Boolean).join(" ");
  return `<svg class="${classes}" aria-hidden="true"><use href="${spriteHref}#${name}"></use></svg>`;
}

const icon = renderIcon;

function renderStepMarkerContent(step) {
  if (step.tone === "done") {
    return renderIcon("check", "step-marker-icon");
  }
  return step.number;
}

function normalizeGermanDisplayText(value) {
  return String(value ?? "")
    .replaceAll("Arbeitsblaetter", "Arbeitsblätter")
    .replaceAll("arbeitsblaetter", "arbeitsblätter")
    .replaceAll("Loesungsblatt", "Lösungsblatt")
    .replaceAll("loesungsblatt", "lösungsblatt")
    .replaceAll("Loesungsblaetter", "Lösungsblätter")
    .replaceAll("loesungsblaetter", "lösungsblätter")
    .replaceAll("Loesung", "Lösung")
    .replaceAll("loesung", "lösung")
    .replaceAll("Pruef", "Prüf")
    .replaceAll("pruef", "prüf")
    .replaceAll("geprueft", "geprüft")
    .replaceAll("fuer", "für")
    .replaceAll("Fuer", "Für")
    .replaceAll("ueber", "über")
    .replaceAll("Ueber", "Über")
    .replaceAll("naechst", "nächst")
    .replaceAll("Naechst", "Nächst")
    .replaceAll("klaere", "kläre")
    .replaceAll("Klaere", "Kläre")
    .replaceAll("wofuer", "wofür")
    .replaceAll("Wofuer", "Wofür")
    .replaceAll("bestaet", "bestät")
    .replaceAll("Bestaet", "Bestät")
    .replaceAll("haenge", "hänge")
    .replaceAll("Haenge", "Hänge")
    .replaceAll("moeg", "mög")
    .replaceAll("Moeg", "Mög")
    .replaceAll("oeff", "öff")
    .replaceAll("Oeff", "Öff")
    .replaceAll("fuehr", "führ")
    .replaceAll("Fuehr", "Führ")
    .replaceAll("Eintraege", "Einträge")
    .replaceAll("eintraege", "einträge");
}

function renderInlineRichText(value) {
  const placeholders = [];
  let html = escapeHtml(normalizeGermanDisplayText(value));
  html = html.replace(/`([^`\n]+)`/g, (_, code) => {
    const index = placeholders.push(`<code>${code}</code>`) - 1;
    return `__CODE_${index}__`;
  });
  html = html.replace(/\*\*([^*\n][^*\n]*?)\*\*/g, "<strong>$1</strong>");
  html = html.replace(/(^|[\s([{"'“])\*([^*\n][^*\n]*?)\*(?=($|[\s)\]}".,!?;:'”]))/g, "$1<em>$2</em>");
  return html.replace(/__CODE_(\d+)__/g, (_, index) => placeholders[Number(index)] || "");
}

function hasFileDrag(event) {
  return Array.from(event.dataTransfer?.types || []).includes("Files");
}

function setComposerDragActive(active) {
  elements.chatComposer.classList.toggle("drag-active", active);
}

function speechRecognitionConstructor() {
  return window.SpeechRecognition || window.webkitSpeechRecognition || null;
}

function voiceInputUnavailableReason() {
  if (!window.isSecureContext) {
    return "Mikrofon braucht HTTPS oder localhost.";
  }
  if (!speechRecognitionConstructor()) {
    return "Spracheingabe wird von diesem Browser nicht unterstützt.";
  }
  return "";
}

function preferredSpeechLanguage() {
  const languages = [
    ...(navigator.languages || []),
    navigator.language
  ].filter(Boolean);
  return languages.find((language) => /^de\b/i.test(language)) || "de-DE";
}

function cleanSpeechTranscript(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function mergeSpeechTranscript(baseText, transcript) {
  const base = String(baseText || "");
  const spoken = cleanSpeechTranscript(transcript);
  if (!spoken) {
    return base;
  }
  if (!base.trim()) {
    return spoken;
  }
  const separator = /\s$/.test(base) || /^[.,!?;:]/.test(spoken) ? "" : " ";
  return `${base}${separator}${spoken}`;
}

function setChatInputValue(value) {
  elements.chatInput.value = value;
  const caretPosition = elements.chatInput.value.length;
  elements.chatInput.setSelectionRange?.(caretPosition, caretPosition);
}

function mapMicrophonePermissionError(error = {}) {
  if (error.name === "NotAllowedError" || error.name === "SecurityError") {
    return "Mikrofonzugriff wurde nicht erlaubt.";
  }
  if (error.name === "NotFoundError" || error.name === "DevicesNotFoundError") {
    return "Kein Mikrofon gefunden.";
  }
  if (error.name === "NotReadableError" || error.name === "TrackStartError") {
    return "Mikrofon ist gerade nicht verfügbar.";
  }
  return error.message || "Mikrofon konnte nicht gestartet werden.";
}

function mapSpeechRecognitionError(errorName) {
  const messages = {
    "audio-capture": "Kein Mikrofon gefunden.",
    "network": "Spracherkennung ist gerade nicht erreichbar.",
    "no-speech": "Ich habe nichts erkannt.",
    "not-allowed": "Mikrofonzugriff wurde nicht erlaubt.",
    "service-not-allowed": "Spracherkennung wurde vom Browser blockiert."
  };
  return messages[errorName] || "Spracheingabe wurde beendet.";
}

async function requestMicrophoneAccess() {
  if (!navigator.mediaDevices?.getUserMedia) {
    return;
  }
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  stream.getTracks().forEach((track) => track.stop());
}

function applySpeechResult(event) {
  const finalParts = [];
  const interimParts = [];
  for (let index = 0; index < event.results.length; index += 1) {
    const result = event.results[index];
    const transcript = cleanSpeechTranscript(result?.[0]?.transcript || "");
    if (!transcript) {
      continue;
    }
    if (result.isFinal) {
      finalParts.push(transcript);
    } else {
      interimParts.push(transcript);
    }
  }
  setChatInputValue(mergeSpeechTranscript(
    state.voiceInput.baseText,
    [...finalParts, ...interimParts].join(" ")
  ));
}

function updateVoiceButton() {
  const button = elements.chatVoiceButton;
  if (!button) {
    return;
  }
  const unavailableReason = voiceInputUnavailableReason();
  const listening = state.voiceInput.listening;
  const starting = state.voiceInput.starting;
  const label = listening ? "Spracheingabe stoppen" : "Spracheingabe starten";

  button.classList.toggle("listening", listening);
  button.classList.toggle("starting", starting);
  button.setAttribute("aria-pressed", listening ? "true" : "false");
  button.setAttribute("aria-label", unavailableReason || label);
  button.title = unavailableReason || label;
  button.disabled = Boolean(unavailableReason) || starting || (isChatBusy() && !listening);
}

function createSpeechRecognition() {
  const Recognition = speechRecognitionConstructor();
  if (!Recognition) {
    return null;
  }
  const recognition = new Recognition();
  recognition.lang = preferredSpeechLanguage();
  recognition.continuous = true;
  recognition.interimResults = true;
  recognition.maxAlternatives = 1;

  recognition.onstart = () => {
    state.voiceInput.starting = false;
    state.voiceInput.listening = true;
    state.voiceInput.lastError = null;
    updateVoiceButton();
  };
  recognition.onresult = applySpeechResult;
  recognition.onerror = (event) => {
    state.voiceInput.lastError = event.error || "unknown";
    state.voiceInput.starting = false;
    if (!state.voiceInput.stopRequested && event.error !== "aborted") {
      showToast(mapSpeechRecognitionError(event.error), event.error === "no-speech" ? "default" : "error");
    }
    updateVoiceButton();
  };
  recognition.onend = () => {
    state.voiceInput.recognition = null;
    state.voiceInput.listening = false;
    state.voiceInput.starting = false;
    state.voiceInput.stopRequested = false;
    updateVoiceButton();
  };
  return recognition;
}

async function startVoiceInput() {
  const unavailableReason = voiceInputUnavailableReason();
  if (unavailableReason) {
    showToast(unavailableReason, "error");
    updateVoiceButton();
    return;
  }
  if (state.voiceInput.listening || state.voiceInput.starting) {
    return;
  }

  state.voiceInput.starting = true;
  state.voiceInput.stopRequested = false;
  state.voiceInput.baseText = elements.chatInput.value;
  state.voiceInput.lastError = null;
  updateVoiceButton();

  try {
    await requestMicrophoneAccess();
    const recognition = createSpeechRecognition();
    if (!recognition) {
      throw new Error("Spracheingabe wird von diesem Browser nicht unterstützt.");
    }
    state.voiceInput.recognition = recognition;
    recognition.start();
  } catch (error) {
    state.voiceInput.recognition = null;
    state.voiceInput.listening = false;
    state.voiceInput.starting = false;
    state.voiceInput.stopRequested = false;
    updateVoiceButton();
    showToast(mapMicrophonePermissionError(error), "error");
  }
}

function stopVoiceInput() {
  const recognition = state.voiceInput.recognition;
  state.voiceInput.stopRequested = true;
  state.voiceInput.starting = false;
  if (!recognition) {
    state.voiceInput.listening = false;
    updateVoiceButton();
    return;
  }
  try {
    recognition.stop();
  } catch {
    recognition.abort?.();
  }
  updateVoiceButton();
}

function toggleVoiceInput() {
  if (state.voiceInput.listening || state.voiceInput.starting) {
    stopVoiceInput();
    elements.chatInput.focus();
    return;
  }
  startVoiceInput();
}

function resetCanvasLayout() {
  state.canvasLayout = {
    collapsed: true,
    docked: false,
    width: CANVAS_DEFAULT_WIDTH,
    lastExpandedWidth: CANVAS_DEFAULT_WIDTH,
    resizing: false,
    pointerId: null,
    startX: 0,
    suppressClick: false
  };
}

function canvasWorkspaceWidth() {
  return elements.workspaceView.getBoundingClientRect().width || 0;
}

function clampCanvasWidth(width) {
  const workspaceWidth = canvasWorkspaceWidth();
  const maxWidth = Math.max(CANVAS_MIN_WIDTH, workspaceWidth - CANVAS_MIN_CHAT_WIDTH - CANVAS_HANDLE_WIDTH);
  return Math.max(CANVAS_MIN_WIDTH, Math.min(width, maxWidth));
}

function applyCanvasLayout() {
  const layout = state.canvasLayout;
  const width = clampCanvasWidth(layout.docked ? layout.lastExpandedWidth : layout.width);
  elements.workspaceView.style.setProperty("--canvas-panel-width", `${width}px`);
  elements.workspaceView.classList.toggle("canvas-collapsed", layout.collapsed);
  elements.workspaceView.classList.toggle("canvas-docked", layout.docked && !layout.collapsed);
  elements.workspaceView.classList.toggle("canvas-resizing", layout.resizing);
  elements.canvasResizeHandle.setAttribute(
    "aria-label",
    layout.collapsed ? "Canvas aufziehen" : layout.docked ? "Canvas zurückziehen" : "Canvasgröße verändern"
  );
}

function expandCanvas(width = state.canvasLayout.lastExpandedWidth || CANVAS_DEFAULT_WIDTH) {
  state.canvasLayout.collapsed = false;
  state.canvasLayout.docked = false;
  state.canvasLayout.width = clampCanvasWidth(width);
  state.canvasLayout.lastExpandedWidth = state.canvasLayout.width;
  applyCanvasLayout();
}

function collapseCanvas() {
  if (!state.canvasLayout.collapsed && !state.canvasLayout.docked) {
    state.canvasLayout.lastExpandedWidth = clampCanvasWidth(state.canvasLayout.width);
  }
  state.canvasLayout.collapsed = true;
  state.canvasLayout.docked = false;
  applyCanvasLayout();
}

function dockCanvas() {
  state.canvasLayout.collapsed = false;
  state.canvasLayout.docked = true;
  applyCanvasLayout();
}

function updateCanvasFromPointer(clientX) {
  const rect = elements.workspaceView.getBoundingClientRect();
  const nextWidth = rect.right - clientX;
  const dockWidth = rect.width - CANVAS_HANDLE_WIDTH;

  if (nextWidth <= CANVAS_COLLAPSE_THRESHOLD) {
    state.canvasLayout.collapsed = true;
    state.canvasLayout.docked = false;
    applyCanvasLayout();
    return;
  }

  if (nextWidth >= dockWidth - CANVAS_SNAP_THRESHOLD) {
    dockCanvas();
    return;
  }

  state.canvasLayout.collapsed = false;
  state.canvasLayout.docked = false;
  state.canvasLayout.width = clampCanvasWidth(nextWidth);
  state.canvasLayout.lastExpandedWidth = state.canvasLayout.width;
  applyCanvasLayout();
}

function startCanvasResize(event) {
  if (event.button !== 0) {
    return;
  }
  event.preventDefault();
  state.canvasLayout.resizing = true;
  state.canvasLayout.pointerId = event.pointerId;
  state.canvasLayout.startX = event.clientX;
  state.canvasLayout.suppressClick = false;
  elements.canvasResizeHandle.setPointerCapture?.(event.pointerId);
  applyCanvasLayout();
}

function moveCanvasResize(event) {
  if (!state.canvasLayout.resizing) {
    return;
  }
  if (Math.abs(event.clientX - state.canvasLayout.startX) > 3) {
    state.canvasLayout.suppressClick = true;
  }
  updateCanvasFromPointer(event.clientX);
}

function endCanvasResize() {
  if (!state.canvasLayout.resizing) {
    return;
  }
  state.canvasLayout.resizing = false;
  state.canvasLayout.pointerId = null;
  if (!state.canvasLayout.docked && !state.canvasLayout.collapsed && state.canvasLayout.width < CANVAS_COLLAPSE_THRESHOLD) {
    collapseCanvas();
    return;
  }
  applyCanvasLayout();
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      ...(options.body && !(options.body instanceof FormData) ? { "content-type": "application/json; charset=utf-8" } : {}),
      ...(options.headers || {})
    }
  });
  const text = await response.text();
  let payload;

  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    throw new Error(apiUnavailableMessage());
  }

  if (!response.ok) {
    throw new Error(payload?.message || `Request failed: ${response.status}`);
  }
  if (!payload) {
    throw new Error(apiUnavailableMessage());
  }
  return payload;
}

function apiUnavailableMessage() {
  if (window.location.protocol === "file:") {
    return "Bitte über den Dev-Server öffnen: http://127.0.0.1:4173/";
  }
  return "Die App-API antwortet nicht korrekt.";
}

function showToast(message, kind = "default") {
  elements.toast.textContent = message;
  elements.toast.classList.remove("success", "error");
  if (kind !== "default") {
    elements.toast.classList.add(kind);
  }
  elements.toast.classList.add("visible");
  window.clearTimeout(showToast.timer);
  showToast.timer = window.setTimeout(() => {
    elements.toast.classList.remove("visible");
  }, 2600);
}

function openUrl(url) {
  if (!url) {
    return;
  }
  if (/\.(png|jpe?g|webp|gif|svg)(?:\?|$)/i.test(String(url))) {
    const viewerUrl = `/preview.html?${new URLSearchParams({
      project: currentProjectId() || "",
      asset: url,
      assetType: "image",
      assetLabel: fileName(url)
    })}`;
    window.open(viewerUrl, "_blank", "noopener");
    return;
  }
  window.open(url, "_blank", "noopener");
}

function downloadUrl(url, fileNameHint) {
  if (!url) {
    return;
  }
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileNameHint || "";
  anchor.rel = "noopener";
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
}

async function writeClipboardText(text) {
  if (navigator.clipboard?.writeText && window.isSecureContext) {
    await navigator.clipboard.writeText(text);
    return;
  }

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.left = "-9999px";
  textarea.style.top = "0";
  document.body.append(textarea);
  textarea.select();
  const copied = document.execCommand("copy");
  textarea.remove();
  if (!copied) {
    throw new Error("Clipboard fallback failed.");
  }
}

function imageFromUrl(url) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.crossOrigin = "anonymous";
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Bild konnte nicht geladen werden."));
    image.src = url;
  });
}

function canvasToBlob(canvas, type = "image/png", quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) {
        resolve(blob);
        return;
      }
      reject(new Error("Bild konnte nicht erzeugt werden."));
    }, type, quality);
  });
}

async function copyImageToClipboard(url) {
  const image = await imageFromUrl(url);
  const canvas = document.createElement("canvas");
  canvas.width = image.naturalWidth || image.width;
  canvas.height = image.naturalHeight || image.height;
  const context = canvas.getContext("2d");
  context.drawImage(image, 0, 0);
  const blob = await canvasToBlob(canvas, "image/png");

  if (navigator.clipboard?.write && window.ClipboardItem && window.isSecureContext) {
    await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
    return;
  }

  downloadUrl(url, fileName(url));
  throw new Error("Bild-Clipboard ist in diesem Browser nicht freigegeben. Das Bild wurde stattdessen heruntergeladen.");
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function imagePointFromEvent(event, image) {
  const rect = image.getBoundingClientRect();
  return {
    x: clamp(event.clientX - rect.left, 0, rect.width),
    y: clamp(event.clientY - rect.top, 0, rect.height)
  };
}

function captureRect() {
  const startX = state.canvasCapture.startX;
  const startY = state.canvasCapture.startY;
  const currentX = state.canvasCapture.currentX;
  const currentY = state.canvasCapture.currentY;
  return {
    x: Math.min(startX, currentX),
    y: Math.min(startY, currentY),
    width: Math.abs(currentX - startX),
    height: Math.abs(currentY - startY)
  };
}

function removeCaptureSelection() {
  elements.canvasBody?.querySelectorAll(".canvas-capture-selection").forEach((node) => node.remove());
}

function resetCanvasCaptureDrag() {
  removeCaptureSelection();
  state.canvasCapture.dragging = false;
  state.canvasCapture.pointerId = null;
  state.canvasCapture.targetCard = null;
}

function setCanvasCaptureActive(active) {
  resetCanvasCaptureDrag();
  state.canvasCapture.active = Boolean(active);
  elements.canvasBody?.classList.toggle("capture-mode", state.canvasCapture.active);
  elements.canvasCaptureButton?.classList.toggle("active", state.canvasCapture.active);
  elements.canvasCaptureButton?.setAttribute("aria-pressed", state.canvasCapture.active ? "true" : "false");
  if (state.canvasCapture.active) {
    showToast("Ausschnitt auf einem Kandidaten markieren.");
  }
}

function renderCaptureSelection() {
  const card = state.canvasCapture.targetCard;
  if (!card) {
    return;
  }
  const image = card.querySelector("[data-capture-image]");
  if (!image) {
    return;
  }
  const imageRect = image.getBoundingClientRect();
  const cardRect = card.getBoundingClientRect();
  const rect = captureRect();
  let selection = card.querySelector(".canvas-capture-selection");
  if (!selection) {
    selection = document.createElement("div");
    selection.className = "canvas-capture-selection";
    card.append(selection);
  }
  selection.style.left = `${imageRect.left - cardRect.left + rect.x}px`;
  selection.style.top = `${imageRect.top - cardRect.top + rect.y}px`;
  selection.style.width = `${rect.width}px`;
  selection.style.height = `${rect.height}px`;
}

function feedbackAttachmentLabel(source = {}) {
  return [
    source.candidateId || "Kandidat",
    source.page ? `Seite ${source.page}` : null
  ].filter(Boolean).join(" · ");
}

async function attachVisualFeedbackFromSelection(card, displayRect) {
  const image = card.querySelector("[data-capture-image]");
  if (!image) {
    throw new Error("Kein Kandidatenbild gefunden.");
  }
  if (!image.naturalWidth || !image.naturalHeight) {
    throw new Error("Das Kandidatenbild ist noch nicht bereit.");
  }

  const scaleX = image.naturalWidth / image.getBoundingClientRect().width;
  const scaleY = image.naturalHeight / image.getBoundingClientRect().height;
  const sourceRect = {
    x: Math.round(displayRect.x * scaleX),
    y: Math.round(displayRect.y * scaleY),
    width: Math.max(1, Math.round(displayRect.width * scaleX)),
    height: Math.max(1, Math.round(displayRect.height * scaleY))
  };

  const sourceImage = await imageFromUrl(card.dataset.sourceUrl || image.currentSrc || image.src);
  const canvas = document.createElement("canvas");
  canvas.width = sourceRect.width;
  canvas.height = sourceRect.height;
  const context = canvas.getContext("2d");
  context.drawImage(
    sourceImage,
    sourceRect.x,
    sourceRect.y,
    sourceRect.width,
    sourceRect.height,
    0,
    0,
    sourceRect.width,
    sourceRect.height
  );
  const dataUrl = canvas.toDataURL("image/png");
  const source = {
    projectId: currentProjectId(),
    runId: card.dataset.runId || null,
    candidateId: card.dataset.candidateId || null,
    page: Number(card.dataset.page || 1),
    role: card.dataset.pageRole || null,
    sourcePath: card.dataset.sourcePath || null,
    sourceUrl: card.dataset.sourceUrl || image.currentSrc || image.src,
    selectionRect: sourceRect,
    displaySize: {
      width: Math.round(image.getBoundingClientRect().width),
      height: Math.round(image.getBoundingClientRect().height)
    },
    naturalSize: {
      width: image.naturalWidth,
      height: image.naturalHeight
    }
  };

  const attachment = {
    id: `local_feedback_${Date.now()}`,
    kind: "visual_feedback",
    label: feedbackAttachmentLabel(source),
    mimeType: "image/png",
    dataUrl,
    previewUrl: dataUrl,
    source,
    userInstructionRequired: true
  };
  state.composerAttachments = [...state.composerAttachments, attachment];
  renderComposerAttachments();
  elements.chatInput.placeholder = state.composerAttachments.length > 1
    ? "Was soll an diesen Ausschnitten geändert werden?"
    : "Was soll an diesem Ausschnitt geändert werden?";
  elements.chatInput.focus();
  showToast(state.composerAttachments.length > 1
    ? `${state.composerAttachments.length} Ausschnitte angehängt.`
    : "Ausschnitt angehängt.", "success");
}

function startCanvasCapture(event) {
  if (!state.canvasCapture.active || event.button !== 0) {
    return;
  }
  const card = event.target.closest("[data-capture-kind='candidate']");
  if (!card || !elements.canvasBody.contains(card)) {
    showToast("Bitte direkt auf einem Kandidatenbild markieren.", "error");
    return;
  }
  const image = card.querySelector("[data-capture-image]");
  if (!image) {
    showToast("Dieser Kandidat kann nicht markiert werden.", "error");
    return;
  }
  event.preventDefault();
  event.stopPropagation();
  const point = imagePointFromEvent(event, image);
  state.canvasCapture.dragging = true;
  state.canvasCapture.pointerId = event.pointerId;
  state.canvasCapture.targetCard = card;
  state.canvasCapture.startX = point.x;
  state.canvasCapture.startY = point.y;
  state.canvasCapture.currentX = point.x;
  state.canvasCapture.currentY = point.y;
  card.setPointerCapture?.(event.pointerId);
  renderCaptureSelection();
}

function moveCanvasCapture(event) {
  if (!state.canvasCapture.dragging || event.pointerId !== state.canvasCapture.pointerId) {
    return;
  }
  const image = state.canvasCapture.targetCard?.querySelector("[data-capture-image]");
  if (!image) {
    resetCanvasCaptureDrag();
    return;
  }
  event.preventDefault();
  const point = imagePointFromEvent(event, image);
  state.canvasCapture.currentX = point.x;
  state.canvasCapture.currentY = point.y;
  renderCaptureSelection();
}

async function endCanvasCapture(event) {
  if (!state.canvasCapture.dragging || event.pointerId !== state.canvasCapture.pointerId) {
    return;
  }
  event.preventDefault();
  const card = state.canvasCapture.targetCard;
  const rect = captureRect();
  resetCanvasCaptureDrag();
  setCanvasCaptureActive(false);

  if (!card || rect.width < 8 || rect.height < 8) {
    showToast("Der Ausschnitt ist zu klein.", "error");
    return;
  }

  try {
    await attachVisualFeedbackFromSelection(card, rect);
  } catch (error) {
    showToast(error.message, "error");
  }
}

function visualFeedbackCanvasFocus(attachments = []) {
  const source = attachments.find((attachment) => attachment.kind === "visual_feedback")?.source || null;
  if (!source) {
    return {};
  }
  return {
    mode: state.activeCanvasMode,
    runId: source.runId,
    candidateId: source.candidateId,
    page: source.page,
    selectionType: "visual_region",
    selectionRect: source.selectionRect
  };
}

function attachmentsForRequest(attachments = []) {
  return attachments.map((attachment) => ({
    id: attachment.id,
    kind: attachment.kind,
    label: attachment.label,
    mimeType: attachment.mimeType,
    dataUrl: attachment.dataUrl,
    source: attachment.source,
    userInstructionRequired: attachment.userInstructionRequired === true
  }));
}

function fileSizeLabel(size) {
  const bytes = Number(size) || 0;
  if (bytes >= 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(bytes >= 10 * 1024 * 1024 ? 0 : 1)} MB`;
  }
  if (bytes >= 1024) {
    return `${Math.round(bytes / 1024)} KB`;
  }
  return `${bytes || 0} B`;
}

function isPreviewableImageType(mimeType) {
  return /^image\/(png|jpe?g|webp|gif)$/i.test(String(mimeType || ""));
}

function createInputUploadReceipts(files = []) {
  return files.map((file, index) => ({
    id: `upload_${Date.now()}_${index}`,
    kind: "input_upload",
    label: file.name || "Datei",
    mimeType: file.type || "application/octet-stream",
    size: file.size || 0,
    previewUrl: isPreviewableImageType(file.type) ? URL.createObjectURL(file) : null,
    status: "uploading",
    uploadedFile: null
  }));
}

function clearInputUploadReceipts() {
  for (const receipt of state.inputUploadReceipts) {
    if (receipt.previewUrl?.startsWith("blob:")) {
      URL.revokeObjectURL(receipt.previewUrl);
    }
  }
  state.inputUploadReceipts = [];
}

function removeInputUploadReceipt(receiptId) {
  const receipt = state.inputUploadReceipts.find((entry) => entry.id === receiptId);
  if (receipt?.previewUrl?.startsWith("blob:")) {
    URL.revokeObjectURL(receipt.previewUrl);
  }
  state.inputUploadReceipts = state.inputUploadReceipts.filter((entry) => entry.id !== receiptId);
  renderComposerAttachments();
}

function composerAttachmentCount() {
  return state.composerAttachments.length + state.inputUploadReceipts.length;
}

function fileName(filePath) {
  return String(filePath || "").split("/").pop() || "Datei";
}

function conceptLabel(reference = {}) {
  if (!reference || (!reference.conceptId && !reference.conceptVersion)) {
    return "";
  }
  if (reference.label) {
    return reference.label;
  }
  return reference.conceptVersion ? `Konzept v${reference.conceptVersion}` : "Arbeitsblatt-Konzept";
}

function sourceFilesFrom(source = {}) {
  return Array.isArray(source.manifest?.files) ? source.manifest.files : [];
}

function sourceFileUrl(projectId, file = {}) {
  if (!projectId || !file.path) {
    return null;
  }
  return `/files/${encodeURI(`projects/${projectId}/${file.path}`)}`;
}

function isImageInput(file = {}) {
  return String(file.mimeType || "").startsWith("image/");
}

function formatBytes(size) {
  const bytes = Number(size) || 0;
  if (bytes >= 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }
  if (bytes >= 1024) {
    return `${Math.ceil(bytes / 1024)} KB`;
  }
  return `${bytes} B`;
}

function renderInputFile(file, projectId) {
  const url = sourceFileUrl(projectId, file);
  const name = file.originalName || fileName(file.path);
  const meta = [file.mimeType, file.size ? formatBytes(file.size) : null].filter(Boolean).join(" · ");
  if (url && isImageInput(file)) {
    return `
      <figure class="input-file-card image-input" data-open-url="${escapeHtml(url)}">
        <img src="${escapeHtml(url)}" alt="${escapeHtml(name)}">
        <figcaption>
          <strong>${escapeHtml(name)}</strong>
          ${meta ? `<span>${escapeHtml(meta)}</span>` : ""}
        </figcaption>
      </figure>
    `;
  }
  return `
    <article class="input-file-card">
      <div>
        <strong>${escapeHtml(name)}</strong>
        ${meta ? `<span>${escapeHtml(meta)}</span>` : ""}
      </div>
      ${url ? `<button class="secondary-button mini-button" type="button" data-open-url="${escapeHtml(url)}">Öffnen</button>` : ""}
    </article>
  `;
}

function renderRawInputMessages(messages = []) {
  if (!messages.length) {
    return "";
  }
  return `
    <section class="detail-section">
      <p class="detail-label">Chat</p>
      ${messages.map((message) => `<pre class="input-message">${escapeHtml(message.content)}</pre>`).join("")}
    </section>
  `;
}

function renderSourceInputs({ source = {}, projectId, includeLegacyText = true }) {
  const files = sourceFilesFrom(source);
  const parts = [];
  if (files.length) {
    parts.push(`
      <section class="detail-section">
        <p class="detail-label">Dateien</p>
        <div class="input-file-list">${files.map((file) => renderInputFile(file, projectId)).join("")}</div>
      </section>
    `);
  }
  if (!files.length && includeLegacyText && source.transferCard) {
    parts.push(`
      <section class="detail-section">
        <p class="detail-label">Importierter Input</p>
        <pre class="input-message">${escapeHtml(source.transferCard)}</pre>
      </section>
    `);
  }
  return parts.join("");
}

function labelForStatus(status) {
  return statusLabels[status] || status || "Unklar";
}

function productStageOfProject(project = {}) {
  if (project.productStage) {
    return project.productStage;
  }
  if (project.status === "exported") {
    return "export";
  }
  if (project.status === "selected" || project.status === "has_candidates") {
    return "drafts";
  }
  if (project.status === "needs_approval" || project.status === "ready_for_generation" || project.status === "draft" || project.status === "in_progress") {
    return "concept";
  }
  return "input";
}

function productStageLabel(stage) {
  return statusLabels[stage] || "Input";
}

function productStageSignalLabel(stage) {
  if (stage === "error") {
    return `Fehler: ${productStageLabel(stage)}`;
  }
  if (stage === "export" || stage === "selected" || stage === "exported") {
    return `Fertig: ${productStageLabel(stage)}`;
  }
  if (stage === "concept" || stage === "drafts" || stage === "has_candidates" || stage === "needs_approval" || stage === "ready_for_generation") {
    return `In Arbeit: ${productStageLabel(stage)}`;
  }
  return `Offen: ${productStageLabel(stage)}`;
}

function projectIdFromItemId(itemId) {
  return String(itemId || "").replace(/^project:/, "");
}

function currentProjectId() {
  return state.workspace?.project?.projectId || state.selectedItem?.project?.projectId || projectIdFromItemId(state.selectedId);
}

function isFolderCollapsed(folderId) {
  return state.collapsedFolders.has(folderId);
}

function toggleFolder(folderId) {
  if (state.collapsedFolders.has(folderId)) {
    state.collapsedFolders.delete(folderId);
  } else {
    state.collapsedFolders.add(folderId);
  }
  renderTree(state.tree);
}

function treeInteractionsEnabled() {
  return !state.query.trim() && state.tree?.id !== "library:search";
}

function findTreeNodeById(tree, nodeId, parentId = null) {
  for (const node of tree?.children || []) {
    const found = findTreeNodeInChildren(node, nodeId, parentId);
    if (found) {
      return found;
    }
  }
  return null;
}

function findTreeNodeInChildren(node, nodeId, parentId) {
  if (node.id === nodeId) {
    return { node, parentId };
  }
  for (const child of node.children || []) {
    const found = findTreeNodeInChildren(child, nodeId, node.id);
    if (found) {
      return found;
    }
  }
  return null;
}

function renderTreeFolder(folder, depth = 0) {
  const children = folder.children || [];
  const collapsed = isFolderCollapsed(folder.id);
  const interactive = treeInteractionsEnabled();
  const canDrag = interactive && folder.draggable;
  const contextAttrs = interactive ? ` data-tree-node-id="${escapeHtml(folder.id)}"` : "";
  const dragAttrs = canDrag ? ' draggable="true"' : "";
  const rootClass = folder.locked ? " root-folder" : " nested-folder";
  return `
    <section class="tree-group${rootClass}" style="--tree-depth: ${escapeHtml(depth)}" data-drop-folder-id="${escapeHtml(folder.id)}">
      <button class="tree-folder${collapsed ? " collapsed" : ""}" type="button" data-toggle-folder-id="${escapeHtml(folder.id)}"${contextAttrs}${dragAttrs}>
        ${renderIcon("chevron-right", "tree-chevron")}
        ${renderIcon(collapsed ? "folder" : "folder-open", "folder-glyph")}
        <span>${escapeHtml(folder.label)}</span>
      </button>
      <div class="tree-children${collapsed ? " collapsed" : ""}">
        ${children.length ? children.map((child) => renderTreeNode(child, folder.id, depth + 1)).join("") : '<div class="tree-item empty"><span class="tree-item-label muted">Noch leer</span></div>'}
      </div>
    </section>
  `;
}

function renderTreeNode(node, parentId, depth) {
  if (node.type === "folder") {
    return renderTreeFolder(node, depth);
  }
  return renderTreeItem(node, parentId, depth);
}

function renderTreeItem(item, parentId, depth = 0) {
  const active = item.id === state.selectedId ? " active" : "";
  const stage = item.productStage || "input";
  const signalStage = item.status === "selected"
    ? "selected"
    : item.status === "exported"
      ? "exported"
      : item.status === "has_candidates"
        ? "has_candidates"
        : stage;
  const interactive = treeInteractionsEnabled();
  const dragAttrs = interactive && item.draggable ? ' draggable="true"' : "";
  const contextAttrs = interactive ? ` data-tree-node-id="${escapeHtml(item.id)}"` : "";
  return `
    <button class="tree-item${active}" type="button" style="--tree-depth: ${escapeHtml(depth)}" data-item-id="${escapeHtml(item.id)}" data-parent-folder-id="${escapeHtml(parentId)}"${contextAttrs}${dragAttrs}>
      ${renderIcon(item.type === "series" ? "folder" : "file", "file-glyph")}
      <span class="tree-item-label">${escapeHtml(item.label)}</span>
      <span class="tree-status ${escapeHtml(stage)}" title="${escapeHtml(productStageSignalLabel(signalStage))}"></span>
    </button>
  `;
}

function renderTree(tree) {
  if (!tree) {
    return;
  }
  closeTreeContextMenu();
  elements.tree.innerHTML = (tree.children || []).map((folder) => renderTreeFolder(folder, 0)).join("");
  elements.tree.querySelectorAll("[data-toggle-folder-id]").forEach((button) => {
    button.addEventListener("click", () => toggleFolder(button.dataset.toggleFolderId));
  });
  elements.tree.querySelectorAll("[data-item-id]").forEach((button) => {
    button.addEventListener("click", () => selectItem(button.dataset.itemId, { openMobileSheet: isMobileViewport() }));
  });
  bindTreeOrganizationEvents();
}

function clearTreeDropIndicators() {
  elements.tree.querySelectorAll(".drag-over, .drop-before, .drop-after").forEach((entry) => {
    entry.classList.remove("drag-over", "drop-before", "drop-after");
  });
}

function treeItemDropPosition(event, node) {
  const rect = node.getBoundingClientRect();
  return event.clientY - rect.top < rect.height / 2 ? "before" : "after";
}

function markTreeItemDropPosition(node, position) {
  elements.tree.querySelectorAll(".tree-item.drop-before, .tree-item.drop-after").forEach((entry) => {
    entry.classList.remove("drop-before", "drop-after", "drag-over");
  });
  node.classList.add("drag-over", position === "before" ? "drop-before" : "drop-after");
}

function beforeIdForTreeDrop(targetFolderId, targetItemId, position, draggedItemId) {
  if (position === "before") {
    return targetItemId;
  }
  const targetFolder = findTreeNodeById(state.tree, targetFolderId)?.node;
  const siblingIds = (targetFolder?.children || [])
    .map((child) => child.id)
    .filter((id) => id !== draggedItemId);
  const targetIndex = siblingIds.indexOf(targetItemId);
  return targetIndex >= 0 ? siblingIds[targetIndex + 1] || null : null;
}

function projectIdsFromTree(tree) {
  const ids = [];
  function walk(node) {
    if (node.id?.startsWith("project:")) {
      ids.push(node.id);
    }
    for (const child of node.children || []) {
      walk(child);
    }
  }
  for (const folder of tree?.children || []) {
    walk(folder);
  }
  return ids;
}

function findDefaultProject(tree) {
  const items = [];
  function walk(node) {
    if (node.id?.startsWith("project:")) {
      items.push(node);
    }
    for (const child of node.children || []) {
      walk(child);
    }
  }
  for (const folder of tree?.children || []) {
    walk(folder);
  }
  return items.find((item) => item.previewType === "selected_pages" || item.previewType === "pdf")?.id
    || items.find((item) => item.previewType === "candidates")?.id
    || projectIdsFromTree(tree)[0]
    || null;
}

function bindTreeOrganizationEvents() {
  if (!treeInteractionsEnabled()) {
    return;
  }

  elements.tree.querySelectorAll("[data-tree-node-id]").forEach((node) => {
    node.addEventListener("contextmenu", (event) => {
      event.preventDefault();
      event.stopPropagation();
      openTreeContextMenu(node.dataset.treeNodeId, event.clientX, event.clientY);
    });
    if (node.draggable) {
      node.addEventListener("dragstart", (event) => {
        state.draggingTreeNodeId = node.dataset.treeNodeId;
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData("text/plain", state.draggingTreeNodeId);
        node.classList.add("dragging");
      });
      node.addEventListener("dragend", () => {
        state.draggingTreeNodeId = null;
        node.classList.remove("dragging");
        clearTreeDropIndicators();
      });
    }
  });

  elements.tree.querySelectorAll("[data-drop-folder-id]").forEach((node) => {
    node.addEventListener("dragover", (event) => {
      if (!state.draggingTreeNodeId) {
        return;
      }
      const hoveredItem = event.target.closest("[data-item-id]");
      if (hoveredItem && node.contains(hoveredItem)) {
        return;
      }
      event.preventDefault();
      elements.tree.querySelectorAll(".tree-item.drop-before, .tree-item.drop-after").forEach((entry) => {
        entry.classList.remove("drop-before", "drop-after", "drag-over");
      });
      node.classList.add("drag-over");
    });
    node.addEventListener("dragleave", (event) => {
      if (!node.contains(event.relatedTarget)) {
        node.classList.remove("drag-over");
      }
    });
    node.addEventListener("drop", (event) => {
      const itemId = event.dataTransfer.getData("text/plain") || state.draggingTreeNodeId;
      if (!itemId) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      node.classList.remove("drag-over");
      moveTreeItem(itemId, node.dataset.dropFolderId, null);
    });
  });

  elements.tree.querySelectorAll("[data-item-id]").forEach((node) => {
    node.addEventListener("dragover", (event) => {
      if (!state.draggingTreeNodeId || state.draggingTreeNodeId === node.dataset.itemId) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      markTreeItemDropPosition(node, treeItemDropPosition(event, node));
    });
    node.addEventListener("dragleave", (event) => {
      if (!node.contains(event.relatedTarget)) {
        node.classList.remove("drag-over", "drop-before", "drop-after");
      }
    });
    node.addEventListener("drop", (event) => {
      const itemId = event.dataTransfer.getData("text/plain") || state.draggingTreeNodeId;
      if (!itemId || itemId === node.dataset.itemId) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      const position = treeItemDropPosition(event, node);
      const beforeId = beforeIdForTreeDrop(node.dataset.parentFolderId, node.dataset.itemId, position, itemId);
      clearTreeDropIndicators();
      moveTreeItem(itemId, node.dataset.parentFolderId, beforeId);
    });
  });
}

function closeTreeContextMenu() {
  document.querySelector(".tree-context-menu")?.remove();
}

function openTreeContextMenu(nodeId, clientX, clientY) {
  const found = findTreeNodeById(state.tree, nodeId);
  if (!found) {
    return;
  }
  closeTreeContextMenu();
  const { node } = found;
  const menu = document.createElement("div");
  menu.className = "tree-context-menu";
  menu.setAttribute("role", "menu");
  menu.innerHTML = treeContextMenuActions(node).map((action) => `
    <button type="button" role="menuitem" data-tree-action="${escapeHtml(action.id)}" class="${action.danger ? "danger" : ""}">
      ${escapeHtml(action.label)}
    </button>
  `).join("");
  document.body.append(menu);
  const rect = menu.getBoundingClientRect();
  const left = Math.min(clientX, window.innerWidth - rect.width - 8);
  const top = Math.min(clientY, window.innerHeight - rect.height - 8);
  menu.style.left = `${Math.max(8, left)}px`;
  menu.style.top = `${Math.max(8, top)}px`;
  menu.querySelectorAll("[data-tree-action]").forEach((button) => {
    button.addEventListener("click", () => {
      const action = button.dataset.treeAction;
      closeTreeContextMenu();
      handleTreeContextAction(action, nodeId);
    });
  });
}

function treeContextMenuActions(node) {
  if (node.type === "folder") {
    const actions = [{ id: "new_folder", label: "Neuer Ordner" }];
    if (node.canRename) {
      actions.push({ id: "rename_folder", label: "Umbenennen" });
    }
    if (node.canDelete) {
      actions.push({ id: "delete_folder", label: "Ordner löschen", danger: true });
    }
    return actions;
  }
  return [
    { id: "rename_project", label: "Umbenennen" },
    { id: "delete_project", label: "Arbeitsblatt löschen", danger: true }
  ];
}

function handleTreeContextAction(action, nodeId) {
  if (action === "new_folder") {
    createLibraryFolder(nodeId);
  } else if (action === "rename_folder") {
    renameLibraryFolder(nodeId);
  } else if (action === "delete_folder") {
    deleteLibraryFolder(nodeId);
  } else if (action === "rename_project") {
    renameProjectFromTree(projectIdFromItemId(nodeId));
  } else if (action === "delete_project") {
    deleteProjectFromTree(projectIdFromItemId(nodeId));
  }
}

async function moveTreeItem(itemId, targetFolderId, beforeId) {
  if (!itemId || !targetFolderId || itemId === targetFolderId) {
    return;
  }
  try {
    await fetchJson("/api/library/move", {
      method: "POST",
      body: JSON.stringify({ itemId, targetFolderId, beforeId })
    });
    state.collapsedFolders.delete(targetFolderId);
    await loadTree({ keepSelection: true, selectAfterLoad: false });
  } catch (error) {
    showToast(error.message, "error");
  }
}

async function createLibraryFolder(parentId) {
  const label = window.prompt("Name für den neuen Ordner");
  if (!label?.trim()) {
    return;
  }
  try {
    await fetchJson("/api/library/folders", {
      method: "POST",
      body: JSON.stringify({ parentId, label: label.trim() })
    });
    state.collapsedFolders.delete(parentId);
    await loadTree({ keepSelection: true, selectAfterLoad: false });
    showToast("Ordner angelegt", "success");
  } catch (error) {
    showToast(error.message, "error");
  }
}

async function renameLibraryFolder(folderId) {
  const found = findTreeNodeById(state.tree, folderId);
  const label = window.prompt("Ordner umbenennen", found?.node?.label || "");
  if (!label?.trim()) {
    return;
  }
  try {
    await fetchJson(`/api/library/folders/${encodeURIComponent(folderId)}`, {
      method: "PATCH",
      body: JSON.stringify({ label: label.trim() })
    });
    await loadTree({ keepSelection: true, selectAfterLoad: false });
    showToast("Ordner umbenannt", "success");
  } catch (error) {
    showToast(error.message, "error");
  }
}

async function deleteLibraryFolder(folderId) {
  const found = findTreeNodeById(state.tree, folderId);
  const confirmed = await requestConfirmation({
    title: "Ordner löschen?",
    message: `Der Ordner "${found?.node?.label || "Ordner"}" wird entfernt. Enthaltene Arbeitsblätter bleiben erhalten und wandern eine Ebene nach oben.`,
    acceptLabel: "Ordner löschen",
    danger: true
  });
  if (!confirmed) {
    return;
  }
  try {
    await fetchJson(`/api/library/folders/${encodeURIComponent(folderId)}`, { method: "DELETE" });
    await loadTree({ keepSelection: true, selectAfterLoad: false });
    showToast("Ordner gelöscht", "success");
  } catch (error) {
    showToast(error.message, "error");
  }
}

async function renameProjectFromTree(projectId) {
  const found = findTreeNodeById(state.tree, `project:${projectId}`);
  const title = window.prompt("Arbeitsblatt umbenennen", found?.node?.label || "");
  if (!title?.trim()) {
    return;
  }
  try {
    await fetchJson(`/api/projects/${encodeURIComponent(projectId)}`, {
      method: "PATCH",
      body: JSON.stringify({ title: title.trim() })
    });
    if (state.workspace?.project?.projectId === projectId) {
      state.workspace.project.title = title.trim();
      renderWorkspace();
    }
    await loadTree({ keepSelection: true, selectAfterLoad: state.mode === "library" });
    showToast("Arbeitsblatt umbenannt", "success");
  } catch (error) {
    showToast(error.message, "error");
  }
}

async function deleteProjectFromTree(projectId) {
  const found = findTreeNodeById(state.tree, `project:${projectId}`);
  const confirmed = await requestConfirmation({
    title: "Arbeitsblatt löschen?",
    message: `Das Arbeitsblatt "${found?.node?.label || projectId}" wird dauerhaft aus diesem Workspace gelöscht.`,
    acceptLabel: "Arbeitsblatt löschen",
    danger: true
  });
  if (!confirmed) {
    return;
  }
  try {
    await fetchJson(`/api/projects/${encodeURIComponent(projectId)}`, { method: "DELETE" });
    if (state.selectedId === `project:${projectId}`) {
      state.selectedId = null;
      state.selectedItem = null;
      state.workspace = null;
      elements.projectView.classList.add("hidden");
      elements.workspaceView.classList.add("hidden");
      elements.emptyState.classList.remove("hidden");
    }
    await loadTree({ keepSelection: true, selectAfterLoad: state.mode === "library" });
    showToast("Arbeitsblatt gelöscht", "success");
  } catch (error) {
    showToast(error.message, "error");
  }
}

async function loadTree({ keepSelection = false, selectAfterLoad = true } = {}) {
  elements.tree.innerHTML = '<div class="tree-loading">Lade Arbeitsblätter...</div>';
  try {
    const query = state.query.trim();
    const url = query ? `/api/library/tree?q=${encodeURIComponent(query)}` : "/api/library/tree";
    const payload = await fetchJson(url);
    state.tree = payload.tree;
    const availableIds = new Set(projectIdsFromTree(state.tree));
    if (pendingInitialSelectedId && availableIds.has(pendingInitialSelectedId)) {
      state.selectedId = pendingInitialSelectedId;
      pendingInitialSelectedId = null;
      if (window.history?.replaceState) {
        window.history.replaceState({}, document.title, window.location.pathname);
      }
    }
    if (!keepSelection || !availableIds.has(state.selectedId)) {
      state.selectedId = findDefaultProject(state.tree);
    }
    renderTree(state.tree);
    if (selectAfterLoad && state.mode === "library" && state.selectedId) {
      await selectItem(state.selectedId, { openMobileSheet: false });
    }
  } catch (error) {
    elements.tree.innerHTML = `<div class="tree-error">${escapeHtml(error.message)}</div>`;
  }
}

async function selectItem(itemId, options = {}) {
  state.selectedId = itemId;
  state.activeStatusStep = null;
  renderTree(state.tree);

  if (state.mode === "workspace") {
    await openWorkspace(projectIdFromItemId(itemId));
    return;
  }

  elements.emptyState.classList.add("hidden");
  elements.projectView.classList.remove("hidden");
  elements.workspaceView.classList.add("hidden");
  elements.previewGrid.innerHTML = '<div class="no-preview">Lade Vorschau...</div>';

  try {
    const payload = await fetchJson(`/api/library/items/${encodeURIComponent(itemId)}`);
    state.selectedItem = payload.item;
    renderProject(payload.item);
    if (options.openMobileSheet && isMobileViewport()) {
      openMobilePreview("project", { source: "library", presentation: "sheet" });
    }
  } catch (error) {
    elements.previewGrid.innerHTML = `<div class="no-preview">${escapeHtml(error.message)}</div>`;
  }
}

function renderProject(item, requestedStep = null) {
  const project = item.project;
  elements.projectTitle.textContent = project.title;
  elements.loadProjectButtonLabel.textContent = editButtonLabel(item);
  const activeStep = requestedStep || state.activeStatusStep || defaultStatusStep(item);
  state.activeStatusStep = activeStep;
  elements.statusList.innerHTML = buildStatusRows(item).map(renderStatusRow).join("");
  elements.statusList.querySelectorAll("[data-status-step]").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.preventDefault();
      renderProject(item, button.dataset.statusStep);
    });
  });
  renderActions(item);
  renderPreviewForStep(item, activeStep);
}

function editButtonLabel(item) {
  if (item?.project?.projectType === "series" || item?.type === "series") {
    return "Reihe bearbeiten";
  }
  return "Arbeitsblatt bearbeiten";
}

function defaultStatusStep(item) {
  const previewType = item.preview?.previewType;
  if (previewType === "pdf" || previewType === "selected_pages") {
    return "candidates";
  }
  if (previewType === "candidates") {
    return "candidates";
  }
  if (item.documents?.brief?.data || item.documents?.content?.data) {
    return "concept";
  }
  return "input";
}

function buildStatusRows(item) {
  const derived = item.project?.derivedStatus || {};
  const latestRun = Array.isArray(derived.runs) ? derived.runs[derived.runs.length - 1] : null;
  const candidateGenerationPending = isCandidateGenerationPendingForProject(item.project?.projectId);
  const plannedCandidateCount = latestRun?.candidateCount || countPreviewCandidates(item.preview);
  const renderedCandidateCount = latestRun?.renderedCandidateCount || item.preview?.previewMeta?.renderedCandidateCount || 0;
  const renderedCandidatePages = countPreviewCandidatePages(item.preview);
  const candidatePdfCount = countPreviewCandidatePdfs(item.preview);
  const hasInput = Boolean(item.documents?.source?.manifest || item.documents?.source?.transferCard || item.documents?.brief?.data || item.documents?.content?.data);
  const hasBrief = Boolean(derived.hasEffectiveApprovedBrief || item.documents?.brief?.data);
  const hasContent = Boolean(derived.hasEffectiveApprovedContent || item.documents?.content?.data);
  const hasCandidates = Boolean(renderedCandidateCount || plannedCandidateCount);
  const candidateState = candidateGenerationPending
    ? "Wird erstellt"
    : candidatePdfCount
      ? `${candidatePdfCount} PDF${candidatePdfCount === 1 ? "" : "s"} bereit`
      : renderedCandidatePages > renderedCandidateCount
        ? `${renderedCandidatePages} Seiten sichtbar`
        : renderedCandidateCount
          ? `${renderedCandidateCount} sichtbar`
          : plannedCandidateCount
            ? `${plannedCandidateCount} geplant`
            : "Offen";
  return [
    { id: "input", number: 1, title: "Input", state: hasInput ? "Vorhanden" : "Offen", tone: hasInput ? "done" : "active" },
    { id: "concept", number: 2, title: "Arbeitsblatt-Konzept", state: hasContent || hasBrief ? "Vorhanden" : "Offen", tone: hasContent ? "done" : hasBrief ? "active" : "pending" },
    { id: "candidates", number: 3, title: "Kandidaten", state: candidateState, tone: candidateGenerationPending ? "working" : hasCandidates ? "done" : "pending" }
  ];
}

function renderStatusRow(row) {
  const active = row.id === state.activeStatusStep ? " active" : "";
  const toneClass = row.tone ? ` ${escapeHtml(row.tone)}` : "";
  return `
    <button class="status-row${toneClass}${active}" type="button" data-status-step="${escapeHtml(row.id)}">
      <span class="step-marker ${escapeHtml(row.tone)}">${renderStepMarkerContent(row)}</span>
      <span class="step-title">${escapeHtml(row.title)}</span>
      <span class="step-state">${escapeHtml(row.state)}</span>
      ${renderIcon("chevron-right", "row-arrow")}
    </button>
  `;
}

function renderActions(item) {
  const actions = new Set(item.actions || []);
  const firstPdf = item.preview?.pdfs?.[0] || null;
  elements.copyContentButton.disabled = !(actions.has("copy_content_mirror") || actions.has("copy_series_context"));
  elements.downloadButton.disabled = !firstPdf?.url;
}

function countPreviewCandidates(preview) {
  return Array.isArray(preview?.candidates) ? preview.candidates.length : 0;
}

function countPreviewCandidatePages(preview) {
  const candidates = Array.isArray(preview?.candidates) ? preview.candidates : [];
  return candidates.reduce((total, candidate) => {
    const renderedPages = (candidate.pages || []).filter((page) => page.url).length;
    const plannedPages = Number(candidate.generation?.generatedPageCount || candidate.generation?.pageCount || 0) || 0;
    return total + (renderedPages || plannedPages);
  }, 0);
}

function countPreviewCandidatePdfs(preview) {
  const candidates = Array.isArray(preview?.candidates) ? preview.candidates : [];
  return candidates.filter((candidate) => candidate.pdf?.url).length;
}

function renderPreviewForStep(item, step) {
  elements.previewGrid.dataset.previewStep = step || "";
  if (step === "input" || step === "assignment") {
    renderAssignmentPreview(item);
    return;
  }
  if (step === "concept") {
    renderConceptPreview(item);
    return;
  }
  renderPreview(previewForStep(item.preview, step));
}

function previewForStep(preview, step) {
  if (!preview) {
    return null;
  }
  if (step === "drafts") {
    if (preview.pages?.length) {
      return { ...preview, previewType: "selected_pages", pdfs: [], pages: preview.pages || [], candidates: [] };
    }
    return { ...preview, previewType: "candidates", pdfs: [], pages: [], candidates: preview.candidates || [] };
  }
  if (step === "candidates") {
    if (preview.candidates?.length) {
      return { ...preview, previewType: "candidates", pdfs: [], pages: [], candidates: preview.candidates || [] };
    }
    if (preview.pdfs?.length) {
      return { ...preview, previewType: "pdf", pages: [], candidates: [], pdfs: preview.pdfs || [] };
    }
    return { ...preview, previewType: "candidates", pdfs: [], pages: [], candidates: [] };
  }
  if (step === "selection") {
    return { ...preview, previewType: "selected_pages", pdfs: [], pages: preview.pages || [], candidates: [] };
  }
  if (step === "export") {
    return { ...preview, previewType: "pdf", pages: [], candidates: [], pdfs: preview.pdfs || [] };
  }
  return preview;
}

function applyPreviewLayout(preview) {
  elements.previewGrid.classList.remove("preview-kind-pdf", "preview-kind-pages", "preview-kind-candidates");
  if (!preview?.previewType) {
    return;
  }
  elements.previewGrid.classList.add(`preview-kind-${preview.previewType === "selected_pages" ? "pages" : preview.previewType}`);
}

function hasPreviewContent(preview) {
  return Boolean(preview?.pdfs?.length || preview?.pages?.length || preview?.candidates?.some((candidate) => candidate.pages?.some((page) => page.url)));
}

function previewRouteStep(preview, step) {
  if (step === "drafts") {
    return preview?.pages?.length ? "selection" : "candidates";
  }
  if (step === "input" || step === "concept") {
    return preview?.previewType === "pdf"
      ? "export"
      : preview?.previewType === "selected_pages"
        ? "selection"
        : "candidates";
  }
  return step || "candidates";
}

function bindPreviewOpenActions(preview) {
  const projectId = state.selectedItem?.project?.projectId;
  const previewUrl = projectId && hasPreviewContent(preview)
    ? `/preview.html?${new URLSearchParams({ project: projectId, step: previewRouteStep(preview, state.activeStatusStep) })}`
    : null;
  elements.openPreviewButton.disabled = !previewUrl;
  elements.openPreviewButton.onclick = () => openUrl(previewUrl);
  bindPreviewCardActions(elements.previewGrid);
}

function renderPreview(preview) {
  elements.previewEyebrow.textContent = "Vorschau";
  elements.previewTitle.textContent = titleForPreview(preview);
  elements.previewGrid.dataset.previewType = preview?.previewType || "";
  applyPreviewLayout(preview);
  if (!preview || preview.previewType === "project_status") {
    elements.previewGrid.innerHTML = '<div class="no-preview">Noch keine Bild- oder PDF-Vorschau vorhanden.</div>';
    bindPreviewOpenActions(preview);
    return;
  }
  if (preview.previewType === "pdf") {
    elements.previewGrid.innerHTML = preview.pdfs?.length
      ? preview.pdfs.map(renderPdfCard).join("")
      : '<div class="no-preview">Noch kein PDF vorhanden.</div>';
  } else if (preview.previewType === "selected_pages") {
    elements.previewGrid.innerHTML = preview.pages?.length
      ? preview.pages.map(renderPageCard).join("")
      : '<div class="no-preview">Noch keine Kandidatenvorschau vorhanden.</div>';
  } else if (preview.previewType === "candidates") {
    elements.previewGrid.innerHTML = preview.candidates?.length
      ? preview.candidates.map(renderCandidateCard).join("")
      : '<div class="no-preview">Noch keine Kandidaten vorhanden.</div>';
  }
  bindPreviewOpenActions(preview);
}

function titleForPreview(preview) {
  const titles = {
    candidates: "Kandidaten",
    pdf: "PDF",
    project_status: "Input",
    selected_pages: "Kandidaten"
  };
  return titles[preview?.previewType] || "Vorschau";
}

function renderPageCard(page) {
  const meta = [page.role || "Arbeitsblatt", page.sourceCandidateId ? `aus ${page.sourceCandidateId}` : null]
    .filter(Boolean)
    .join(" · ");
  return `
    <figure class="preview-card is-openable" data-open-url="${escapeHtml(page.url)}">
      <img src="${escapeHtml(page.url)}" alt="Seite ${escapeHtml(page.page)}">
      <figcaption class="preview-caption">
        <span>Seite ${escapeHtml(page.page)}</span>
        <span>${escapeHtml(meta)}</span>
      </figcaption>
    </figure>
  `;
}

function renderPdfCard(pdf) {
  const exportKind = pdf.solutionSheet?.included
    ? "PDF mit Lösungsblatt"
    : "PDF";
  const meta = [
    pdf.pageCount ? `${pdf.pageCount} Seite${pdf.pageCount === 1 ? "" : "n"}` : null,
    conceptLabel(pdf.concept)
  ].filter(Boolean).join(" · ");
  return `
    <figure class="preview-card is-openable" data-open-url="${escapeHtml(pdf.url)}">
      <iframe src="${escapeHtml(pdf.url)}" title="PDF-Vorschau"></iframe>
      <figcaption class="preview-caption">
        <span>${escapeHtml(exportKind)}</span>
        <span>${escapeHtml(meta || fileName(pdf.path))}</span>
      </figcaption>
    </figure>
  `;
}

function renderCandidateCard(candidate) {
  const pages = (candidate.pages || []).filter((page) => page.url);
  const firstPage = pages[0];
  const foundation = conceptLabel(candidate.concept || candidate);
  if (!firstPage) {
    return `<div class="missing-preview"><div><strong>${escapeHtml(candidate.id)}</strong><br>${escapeHtml(foundation || "Keine Bilddatei gefunden.")}</div></div>`;
  }
  const plannedPageCount = Number(candidate.generation?.pageCount || candidate.generation?.plannedPageCount || pages.length) || pages.length;
  const candidateKind = plannedPageCount > 1
    ? pages.length >= plannedPageCount ? "Kandidatenreihe" : "Seitenvariante"
    : "Kandidat";
  const pageLabel = pages.length > 1 ? `${pages.length} Seiten` : "1 Seite";
  const pdf = candidate.pdf?.url ? candidate.pdf : null;
  return `
    <figure
      class="preview-card is-openable candidate-preview-card"
      data-open-url="${escapeHtml(firstPage.url)}"
      data-capture-kind="candidate"
      data-run-id="${escapeHtml(candidate.runId || "")}"
      data-candidate-id="${escapeHtml(candidate.id)}"
      data-page="${escapeHtml(firstPage.page || 1)}"
      data-page-role="${escapeHtml(firstPage.role || "worksheet")}"
      data-source-path="${escapeHtml(firstPage.path || "")}"
      data-source-url="${escapeHtml(firstPage.url)}"
    >
      <div class="preview-paper-meta">
        <span class="preview-paper-kind">${escapeHtml(candidateKind)}</span>
        <span class="preview-paper-id">
          ${escapeHtml(candidate.id)}
          <button class="candidate-info-button" type="button" data-card-action="candidate-info" data-candidate-id="${escapeHtml(candidate.id)}" data-run-id="${escapeHtml(candidate.runId || "")}" aria-label="Generierungsinfo anzeigen" title="Generierungsinfo anzeigen">
            ${icon("info", "icon icon-small")}
          </button>
        </span>
      </div>
      <button class="preview-card-copy" type="button" data-card-action="copy-image" data-copy-image-url="${escapeHtml(firstPage.url)}" aria-label="Bild kopieren" title="Bild kopieren">
        ${icon("copy", "icon icon-small")}
      </button>
      ${pdf ? `
        <div class="candidate-row-actions">
          <button class="mini-button primary-button" type="button" data-card-action="download-candidate-pdf" data-download-url="${escapeHtml(pdf.url)}" data-download-name="${escapeHtml(fileName(pdf.path || pdf.url))}">
            ${icon("download", "icon icon-small")}
            <span>PDF herunterladen</span>
          </button>
        </div>
      ` : ""}
      <div class="candidate-page-stack ${pages.length > 1 ? "multi" : ""}">
        ${pages.map((page, index) => `
          <div class="candidate-page-tile">
            <div class="candidate-page-label">Seite ${escapeHtml(page.page || index + 1)}</div>
            <img
              ${index === 0 ? "data-capture-image" : ""}
              src="${escapeHtml(page.url)}"
              alt="${escapeHtml(`${candidate.id} Seite ${page.page || index + 1}`)}"
              loading="lazy"
            >
          </div>
        `).join("")}
      </div>
      <figcaption class="preview-caption">
        <span>${escapeHtml(candidate.id)}</span>
        <span>${escapeHtml([pageLabel, foundation || candidate.status || "Kandidat"].filter(Boolean).join(" · "))}</span>
      </figcaption>
    </figure>
  `;
}

function bindPreviewCardActions(container) {
  container.querySelectorAll("[data-card-action='candidate-info']").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      openCandidateInfo(button.dataset.candidateId, button.dataset.runId);
    });
  });
  container.querySelectorAll("[data-copy-image-url]").forEach((button) => {
    button.addEventListener("click", async (event) => {
      event.preventDefault();
      event.stopPropagation();
      try {
        await copyImageToClipboard(button.dataset.copyImageUrl);
        showToast("Bild kopiert", "success");
      } catch (error) {
        showToast(error.message, "error");
      }
    });
  });
  container.querySelectorAll("[data-card-action='download-candidate-pdf']").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (button.dataset.downloadUrl) {
        downloadUrl(button.dataset.downloadUrl, button.dataset.downloadName);
      }
    });
  });
  container.querySelectorAll("[data-open-url]").forEach((node) => {
    node.addEventListener("click", (event) => {
      if (event.target.closest("[data-card-action]") || state.canvasCapture.active) {
        return;
      }
      if (isMobileViewport() && node.closest(".chat-timeline") && node.dataset.captureKind === "candidate") {
        event.preventDefault();
        openMobilePreview("candidates");
        return;
      }
      if (node.dataset.captureKind === "candidate") {
        event.preventDefault();
        openCandidateViewerFromCard(node, container);
        return;
      }
      openUrl(node.dataset.openUrl);
    });
  });
}

function currentPreviewCandidates() {
  return state.mode === "workspace"
    ? state.workspace?.preview?.candidates || []
    : state.selectedItem?.preview?.candidates || [];
}

function findCandidatePreview(candidateId, runId) {
  return currentPreviewCandidates().find((candidate) => {
    return candidate.id === candidateId && (!runId || candidate.runId === runId);
  }) || null;
}

function formatDuration(durationMs) {
  const value = Number(durationMs);
  if (!Number.isFinite(value) || value <= 0) {
    return null;
  }
  if (value < 1000) {
    return `${Math.round(value)} ms`;
  }
  return `${(value / 1000).toFixed(value < 10000 ? 1 : 0)} s`;
}

function compactJson(value) {
  if (!value) {
    return "";
  }
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function candidateUsageLabel(candidate) {
  const usage = (candidate.pages || []).map((page) => page.metadata?.usage).find(Boolean);
  if (!usage) {
    return null;
  }
  const tokenParts = [
    usage.input_tokens ? `${usage.input_tokens} Input-Token` : null,
    usage.output_tokens ? `${usage.output_tokens} Output-Token` : null,
    usage.total_tokens ? `${usage.total_tokens} gesamt` : null
  ].filter(Boolean);
  return tokenParts.length ? tokenParts.join(" · ") : compactJson(usage);
}

function renderInfoRow(label, value) {
  return value ? `<div><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>` : "";
}

function referencePolicyLabel(policy = {}) {
  if (!policy || policy.level === "none") {
    return "Keine Referenz nötig";
  }
  return policy.label || {
    deterministic: "App-Vorlage nötig",
    required: "Referenz sinnvoll",
    recommended: "Referenz empfohlen",
    optional: "Referenz optional"
  }[policy.level] || "Referenzhinweis";
}

function referencePolicySummary(policy = {}) {
  if (!policy || policy.level === "none") {
    return "Das Bildmodell kann diese Visualisierung voraussichtlich ohne spezielle Vorlage erzeugen.";
  }
  const source = policy.preferredSource === "app_template"
    ? "Am besten als App-Vorlage oder feste Vorlage."
    : policy.preferredSource === "user_upload_or_reference_search"
      ? "Am besten mit hochgeladener Referenz oder späterer Referenzsuche."
      : policy.preferredSource === "app_template_or_user_upload"
        ? "Am besten als App-Vorlage oder hochgeladene Referenz."
        : "";
  const action = policy.suggestedAction || "";
  return [policy.reason, source, action].filter(Boolean).join(" ");
}

function renderCandidateInfo(candidate) {
  const firstPage = (candidate.pages || []).find((page) => page.url) || (candidate.pages || [])[0] || {};
  const generation = candidate.generation || {};
  const metadata = firstPage.metadata || {};
  const referencePolicy = generation.referencePolicy || metadata.referencePolicy || null;
  const duration = formatDuration(metadata.durationMs);
  const usage = candidateUsageLabel(candidate);
  const prompt = firstPage.prompt || metadata.revisedPrompt || "";
  return `
    <section class="candidate-info-grid">
      ${renderInfoRow("Modell", generation.model || metadata.model)}
      ${renderInfoRow("Qualität", generation.qualityLabel || generation.qualityPreset || metadata.qualityPreset || metadata.quality)}
      ${renderInfoRow("Größe", generation.size || metadata.size)}
      ${renderInfoRow("Format", generation.outputFormat || firstPage.format || metadata.format)}
      ${renderInfoRow("Dauer", duration)}
      ${renderInfoRow("Nutzung", usage)}
      ${renderInfoRow("ImageSpec", generation.imageSpecSummary || generation.imageSpecProposalId)}
      ${renderInfoRow("Referenz", referencePolicy ? referencePolicyLabel(referencePolicy) : "")}
      ${renderInfoRow("Konzept", conceptLabel(candidate.concept || candidate))}
    </section>
    ${referencePolicy ? `
      <section class="candidate-info-section">
        <p class="detail-label">Referenzentscheidung</p>
        <p>${escapeHtml(referencePolicySummary(referencePolicy))}</p>
      </section>
    ` : ""}
    ${generation.imageSpecProposalId ? `
      <section class="candidate-info-section">
        <p class="detail-label">ImageSpec-ID</p>
        <p>${escapeHtml(generation.imageSpecProposalId)}</p>
      </section>
    ` : ""}
    <section class="candidate-info-section">
      <p class="detail-label">Bildprompt</p>
      <pre>${escapeHtml(prompt || "Kein Prompt im Kandidatenmanifest gefunden.")}</pre>
    </section>
    ${metadata.revisedPrompt ? `
      <section class="candidate-info-section">
        <p class="detail-label">Revised Prompt vom Modell</p>
        <pre>${escapeHtml(metadata.revisedPrompt)}</pre>
      </section>
    ` : ""}
    ${usage && !/Token/.test(usage) ? `
      <section class="candidate-info-section">
        <p class="detail-label">Rohdaten Nutzung</p>
        <pre>${escapeHtml(usage)}</pre>
      </section>
    ` : ""}
  `;
}

function openCandidateInfo(candidateId, runId) {
  const candidate = findCandidatePreview(candidateId, runId);
  if (!candidate || !elements.candidateInfoModal) {
    showToast("Keine Generierungsinfos für diesen Kandidaten gefunden.", "error");
    return;
  }
  state.candidateInfo.lastFocusedElement = document.activeElement;
  elements.candidateInfoTitle.textContent = candidate.id;
  elements.candidateInfoMeta.textContent = [
    candidate.runId,
    candidate.generation?.provider || "openai",
    candidate.status
  ].filter(Boolean).join(" · ");
  elements.candidateInfoBody.innerHTML = renderCandidateInfo(candidate);
  elements.candidateInfoModal.classList.remove("hidden");
  elements.candidateInfoCloseButton?.focus();
}

function closeCandidateInfo() {
  if (!elements.candidateInfoModal || elements.candidateInfoModal.classList.contains("hidden")) {
    return;
  }
  elements.candidateInfoModal.classList.add("hidden");
  elements.candidateInfoBody.innerHTML = "";
  const lastFocusedElement = state.candidateInfo.lastFocusedElement;
  state.candidateInfo.lastFocusedElement = null;
  lastFocusedElement?.focus?.();
}

function isCandidateInfoOpen() {
  return !elements.candidateInfoModal?.classList.contains("hidden");
}

function candidateViewerItemFromCard(card) {
  const image = card.querySelector("[data-capture-image]");
  const source = {
    runId: card.dataset.runId || null,
    candidateId: card.dataset.candidateId || null,
    page: Number(card.dataset.page || 1),
    role: card.dataset.pageRole || null,
    sourcePath: card.dataset.sourcePath || null,
    sourceUrl: card.dataset.sourceUrl || card.dataset.openUrl || image?.currentSrc || image?.src || null
  };
  return {
    url: source.sourceUrl,
    candidateId: source.candidateId || "Kandidat",
    runId: source.runId,
    page: source.page,
    role: source.role,
    path: source.sourcePath,
    meta: conceptLabel({ label: card.querySelector(".preview-caption span:last-child")?.textContent || "" }),
    source
  };
}

function candidateViewerItemsFromCandidate(candidate) {
  return (candidate.pages || [])
    .filter((entry) => entry.url)
    .map((page) => {
      const source = {
        runId: candidate.runId || null,
        candidateId: candidate.id || null,
        page: Number(page.page || 1),
        role: page.role || null,
        sourcePath: page.path || null,
        sourceUrl: page.url
      };
      return {
        url: page.url,
        candidateId: candidate.id || "Kandidat",
        runId: candidate.runId,
        page: page.page || 1,
        role: page.role,
        path: page.path,
        meta: conceptLabel(candidate.concept || candidate),
        source
      };
    });
}

function candidateViewerItemsFromCard(card) {
  const candidate = findCandidatePreview(card.dataset.candidateId, card.dataset.runId);
  const items = candidate ? candidateViewerItemsFromCandidate(candidate) : [];
  if (items.length) {
    return items;
  }
  const item = candidateViewerItemFromCard(card);
  return item?.url ? [item] : [];
}

function candidateViewerItemsFrom(container) {
  return Array.from(container.querySelectorAll("[data-capture-kind='candidate']"))
    .flatMap(candidateViewerItemsFromCard)
    .filter((item) => item.url);
}

function openCandidateViewerFromCard(card, container) {
  const host = container || card.closest(".canvas-body, .preview-grid, .mobile-preview-body") || document;
  if (host === elements.chatTimeline || card.closest(".chat-timeline")) {
    const items = (state.workspace?.preview?.candidates || [])
      .flatMap(candidateViewerItemsFromCandidate)
      .filter(Boolean);
    const index = Math.max(0, items.findIndex((item) => {
      return item.candidateId === card.dataset.candidateId && (!card.dataset.runId || item.runId === card.dataset.runId);
    }));
    openCandidateViewer(items, index);
    return;
  }
  const cards = Array.from(host.querySelectorAll("[data-capture-kind='candidate']"));
  const items = [];
  let index = 0;
  for (const entry of cards) {
    if (entry === card) {
      index = items.length;
    }
    items.push(...candidateViewerItemsFromCard(entry));
  }
  openCandidateViewer(items, index);
}

function currentCandidateViewerItem() {
  return state.candidateViewer.items[state.candidateViewer.index] || null;
}

function isCandidateViewerOpen() {
  return !elements.candidateViewerModal?.classList.contains("hidden");
}

function openCandidateViewer(items, index = 0) {
  if (!items.length || !elements.candidateViewerModal) {
    return;
  }
  state.candidateViewer = {
    items,
    index: clamp(index, 0, items.length - 1),
    lastFocusedElement: document.activeElement
  };
  elements.candidateViewerModal.classList.remove("hidden");
  document.body.classList.add("candidate-viewer-open");
  renderCandidateViewer();
  elements.candidateViewerCloseButton?.focus();
}

function closeCandidateViewer() {
  if (!elements.candidateViewerModal || elements.candidateViewerModal.classList.contains("hidden")) {
    return;
  }
  elements.candidateViewerModal.classList.add("hidden");
  document.body.classList.remove("candidate-viewer-open");
  elements.candidateViewerImage.removeAttribute("src");
  const lastFocusedElement = state.candidateViewer.lastFocusedElement;
  state.candidateViewer = {
    items: [],
    index: 0,
    lastFocusedElement: null
  };
  lastFocusedElement?.focus?.();
}

function showCandidateViewerAt(index) {
  if (!state.candidateViewer.items.length) {
    return;
  }
  state.candidateViewer.index = clamp(index, 0, state.candidateViewer.items.length - 1);
  renderCandidateViewer();
}

function renderCandidateViewer() {
  const item = currentCandidateViewerItem();
  if (!item) {
    closeCandidateViewer();
    return;
  }
  const total = state.candidateViewer.items.length;
  const current = state.candidateViewer.index + 1;
  elements.candidateViewerCounter.textContent = `Kandidat ${current} / ${total}`;
  elements.candidateViewerTitle.textContent = item.candidateId;
  elements.candidateViewerMeta.textContent = [
    item.runId,
    item.page ? `Seite ${item.page}` : null,
    item.role || null
  ].filter(Boolean).join(" · ");
  elements.candidateViewerImage.src = item.url;
  elements.candidateViewerImage.alt = item.candidateId;
  elements.candidateViewerPreviousButton.disabled = state.candidateViewer.index <= 0;
  elements.candidateViewerNextButton.disabled = state.candidateViewer.index >= total - 1;
}

async function copyCurrentCandidateViewerImage() {
  const item = currentCandidateViewerItem();
  if (!item?.url) {
    return;
  }
  try {
    await copyImageToClipboard(item.url);
    showToast("Bild kopiert", "success");
  } catch (error) {
    showToast(error.message, "error");
  }
}

function markdownToHtml(markdown) {
  const lines = String(markdown || "").split(/\r?\n/);
  const html = [];
  let listOpen = false;
  function closeList() {
    if (listOpen) {
      html.push("</ul>");
      listOpen = false;
    }
  }
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const trimmed = line.trim();
    if (!trimmed) {
      closeList();
    } else if (trimmed.startsWith("# ")) {
      closeList();
      html.push(`<h4>${renderInlineRichText(trimmed.slice(2))}</h4>`);
    } else if (trimmed.startsWith("## ")) {
      closeList();
      html.push(`<h4>${renderInlineRichText(trimmed.slice(3))}</h4>`);
    } else if (trimmed.startsWith("- ")) {
      if (!listOpen) {
        html.push("<ul>");
        listOpen = true;
      }
      html.push(`<li>${renderInlineRichText(trimmed.slice(2))}</li>`);
    } else {
      closeList();
      html.push(`<p>${renderInlineRichText(trimmed)}</p>`);
    }
  }
  closeList();
  return html.join("");
}

function renderStreamingInlineText(value, lineOffset, revealStart) {
  const text = String(value || "");
  const splitAt = Math.max(0, Math.min(text.length, revealStart - lineOffset));
  if (splitAt <= 0) {
    return `<span class="streaming-flow">${renderInlineRichText(text)}</span>`;
  }
  if (splitAt >= text.length) {
    return renderInlineRichText(text);
  }
  return `${renderInlineRichText(text.slice(0, splitAt))}<span class="streaming-flow">${renderInlineRichText(text.slice(splitAt))}</span>`;
}

function streamingLineHtml(line, lineOffset, revealStart, includeCursor = false) {
  const trimmed = line.trim();
  const trimStart = line.search(/\S/);
  const contentOffset = lineOffset + Math.max(trimStart, 0);
  const cursor = includeCursor ? '<span class="streaming-cursor"></span>' : "";
  if (trimmed.startsWith("# ")) {
    return {
      html: `<h4>${renderStreamingInlineText(trimmed.slice(2), contentOffset + 2, revealStart)}${cursor}</h4>`,
      list: false
    };
  }
  if (trimmed.startsWith("## ")) {
    return {
      html: `<h4>${renderStreamingInlineText(trimmed.slice(3), contentOffset + 3, revealStart)}${cursor}</h4>`,
      list: false
    };
  }
  if (trimmed.startsWith("- ")) {
    return {
      html: `<li>${renderStreamingInlineText(trimmed.slice(2), contentOffset + 2, revealStart)}${cursor}</li>`,
      list: true
    };
  }
  return {
    html: `<p>${renderStreamingInlineText(trimmed, contentOffset, revealStart)}${cursor}</p>`,
    list: false
  };
}

function streamingMarkdownToHtml(markdown, revealStart = 0, includeCursor = false) {
  const text = String(markdown || "");
  const lines = text.split(/\r?\n/);
  const cursorLineIndex = includeCursor
    ? lines.reduce((lastIndex, line, index) => line.trim() ? index : lastIndex, -1)
    : -1;
  const html = [];
  let listOpen = false;
  let offset = 0;
  function closeList() {
    if (listOpen) {
      html.push("</ul>");
      listOpen = false;
    }
  }
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const trimmed = line.trim();
    if (!trimmed) {
      closeList();
      offset += line.length + 1;
      continue;
    }
    const rendered = streamingLineHtml(line, offset, revealStart, index === cursorLineIndex);
    if (rendered.list) {
      if (!listOpen) {
        html.push("<ul>");
        listOpen = true;
      }
      html.push(rendered.html);
    } else {
      closeList();
      html.push(rendered.html);
    }
    offset += line.length + 1;
  }
  closeList();
  return html.join("");
}

function listItems(values) {
  const items = (values || []).filter(Boolean);
  if (!items.length) {
    return '<p class="detail-muted">Keine Einträge vorhanden.</p>';
  }
  return `<ul>${items.map((value) => `<li>${escapeHtml(value.prompt || value.text || value.body || value)}</li>`).join("")}</ul>`;
}

function rawValueText(value, seen = new Set()) {
  if (value == null) {
    return "";
  }
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return String(value).trim();
  }
  if (Array.isArray(value)) {
    return value.map((entry) => rawValueText(entry, seen)).filter(Boolean).join(" · ");
  }
  if (typeof value === "object") {
    if (seen.has(value)) {
      return "";
    }
    seen.add(value);
    const preferredKeys = ["label", "title", "name", "value", "text", "body", "prompt", "description"];
    for (const key of preferredKeys) {
      const text = rawValueText(value[key], seen);
      if (text) {
        return text;
      }
    }
    return Object.values(value).map((entry) => rawValueText(entry, seen)).filter(Boolean).join(" · ");
  }
  return String(value).trim();
}

function valueText(value) {
  return normalizeGermanDisplayText(rawValueText(value).trim());
}

function firstNonEmpty(...values) {
  for (const value of values) {
    const text = valueText(value);
    if (text) {
      return text;
    }
  }
  return "";
}

function joinTextParts(...values) {
  return values.map(valueText).filter(Boolean).join(" · ");
}

function stripLeadingTaskNumber(value) {
  return valueText(value).replace(/^\s*(?:aufgabe\s*)?\d+\s*[\).:-]\s*/i, "");
}

function compactConceptText(value, maxLength = 92) {
  const text = valueText(value).replace(/\s+/g, " ");
  if (!text || text.length <= maxLength) {
    return text;
  }
  return `${text.slice(0, maxLength - 3).trim()}...`;
}

function teachingContextFieldValue(context = {}, id) {
  return valueText(context.fields?.[id]?.value);
}

function countLabel(count, singular, plural) {
  const value = Number(count) || 0;
  return `${value} ${value === 1 ? singular : plural}`;
}

function worksheetPagesValue(brief = {}, content = {}) {
  return Number(content.pageCount || brief.outputPreference?.pages || 0) || null;
}

function worksheetScopeLabel(brief = {}, content = {}) {
  const pages = worksheetPagesValue(brief, content);
  if (pages && pages > 1) {
    return `${pages} Blätter`;
  }
  if (pages === 1) {
    return "1 Blatt";
  }
  const taskCount = Array.isArray(content.tasks) ? content.tasks.length : 0;
  return taskCount ? countLabel(taskCount, "Aufgabe", "Aufgaben") : "";
}

function worksheetConceptTitle(project = {}, brief = {}, content = {}, teachingContext = {}) {
  return firstNonEmpty(
    content.title,
    brief.topic,
    teachingContextFieldValue(teachingContext, "topic"),
    project.title,
    "Arbeitsblatt-Konzept"
  );
}

function worksheetConceptSubtitle(brief = {}, content = {}, teachingContext = {}) {
  return joinTextParts(
    worksheetScopeLabel(brief, content),
    teachingContextFieldValue(teachingContext, "worksheetType"),
    brief.outputPreference?.layout
  );
}

function taskPromptText(task = {}) {
  return stripLeadingTaskNumber(firstNonEmpty(task.prompt, task.text));
}

function taskActionLabel(task = {}) {
  const text = normalizeGermanDisplayText(taskPromptText(task)).toLowerCase();
  if (/phrase|satzstarter|sprachmittel|useful phrase/.test(text)) {
    return /zuordn/.test(text) ? "Phrasen zuordnen" : "Phrasen sichern";
  }
  if (/bilddetail|foreground|background|vordergrund|hintergrund/.test(text)) {
    return "Bilddetails beschreiben";
  }
  if (/pruefungsantwort|prüfungsantwort|muendlich|mündlich|frei sprechen|sprechen/.test(text)) {
    return "Mini-Prüfungsantwort";
  }
  if (/zuordn|matching|match/.test(text)) {
    return "Zuordnen";
  }
  if (/beschreib|describe/.test(text)) {
    return "Beschreiben";
  }
  if (/begruen|begründ|opinion|meinung|reason/.test(text)) {
    return "Begründen";
  }
  if (/vergleich|compare/.test(text)) {
    return "Vergleichen";
  }
  if (/schreib|write/.test(text)) {
    return "Schreiben";
  }
  if (/lies|lese|read/.test(text)) {
    return "Lesen";
  }
  return compactConceptText(text, 42) || "Bearbeiten";
}

function conceptFrameItems(project = {}, teachingContext = {}, brief = {}, content = {}) {
  const output = brief.outputPreference || {};
  return [
    {
      kicker: "Titel",
      title: worksheetConceptTitle(project, brief, content, teachingContext),
      meta: firstNonEmpty(project.subject, brief.subject)
    },
    {
      kicker: "Zielgruppe",
      title: firstNonEmpty(brief.targetGroup, teachingContextFieldValue(teachingContext, "targetGroup"))
    },
    {
      kicker: "Ziel",
      title: firstNonEmpty(brief.goal, teachingContextFieldValue(teachingContext, "lessonGoal"))
    },
    {
      kicker: "Typ",
      title: teachingContextFieldValue(teachingContext, "worksheetType")
    },
    {
      kicker: "Format",
      title: joinTextParts(output.format, worksheetScopeLabel(brief, content), output.layout),
      meta: firstNonEmpty(output.style)
    }
  ].filter((item) => item.title || item.body || item.meta);
}

function conceptStructureItems(content = {}, brief = {}) {
  const tasks = Array.isArray(content.tasks) ? content.tasks : [];
  const readingTexts = Array.isArray(content.readingTexts) ? content.readingTexts : [];
  const imageMaterials = Array.isArray(content.imageMaterials) ? content.imageMaterials : [];
  const pages = worksheetPagesValue(brief, content);
  const taskPrefix = pages && pages > 1 && tasks.length <= pages ? "Blatt" : "Aufgabe";
  const taskItems = tasks.map((task, index) => ({
    kicker: `${taskPrefix} ${index + 1}`,
    title: taskActionLabel(task),
    meta: firstNonEmpty(task.difficulty)
  })).filter((item) => item.title);

  if (taskItems.length) {
    return taskItems;
  }

  return [
    readingTexts.length ? {
      kicker: "Material",
      title: countLabel(readingTexts.length, "Textblock", "Textblöcke")
    } : null,
    imageMaterials.length ? {
      kicker: "Bild",
      title: countLabel(imageMaterials.length, "Bildidee", "Bildideen")
    } : null
  ].filter(Boolean);
}

function conceptLogicItems(content = {}, brief = {}) {
  const tasks = Array.isArray(content.tasks) ? content.tasks : [];
  const readingTexts = Array.isArray(content.readingTexts) ? content.readingTexts : [];
  const imageMaterials = Array.isArray(content.imageMaterials) ? content.imageMaterials : [];
  const actionFlow = tasks.map(taskActionLabel).filter(Boolean);
  const uniqueFlow = actionFlow.filter((label, index) => actionFlow.indexOf(label) === index);
  const items = [];

  if (uniqueFlow.length >= 2) {
    items.push({
      kicker: "Ablauf",
      title: uniqueFlow.join(" -> ")
    });
  }

  if (tasks.length || readingTexts.length || imageMaterials.length) {
    items.push({
      kicker: "Umfang",
      title: joinTextParts(
        tasks.length ? countLabel(tasks.length, "Aufgabe", "Aufgaben") : "",
        readingTexts.length ? countLabel(readingTexts.length, "Text", "Texte") : "",
        imageMaterials.length ? countLabel(imageMaterials.length, "Bildidee", "Bildideen") : ""
      )
    });
  }

  if (firstNonEmpty(brief.goal)) {
    items.push({
      kicker: "Zielbezug",
      title: compactConceptText(brief.goal, 120)
    });
  }

  return items.filter((item) => item.title || item.body || item.meta);
}

function conceptVisibleContentItems(content = {}) {
  const readingTexts = Array.isArray(content.readingTexts) ? content.readingTexts : [];
  const tasks = Array.isArray(content.tasks) ? content.tasks : [];
  const solutionNotes = Array.isArray(content.solutionNotes) ? content.solutionNotes : [];
  const items = [];

  readingTexts.forEach((text, index) => {
    const title = firstNonEmpty(text.title, `Text ${index + 1}`);
    const body = firstNonEmpty(text.body, text.text);
    if (title || body) {
      items.push({
        kicker: `Text ${index + 1}`,
        title,
        body
      });
    }
  });

  tasks.forEach((task, index) => {
    const body = taskPromptText(task);
    const expected = firstNonEmpty(task.expectedAnswer);
    if (body || expected) {
      items.push({
        kicker: `Aufgabe ${index + 1}`,
        title: taskActionLabel(task),
        body,
        expected,
        meta: firstNonEmpty(task.difficulty)
      });
    }
  });

  solutionNotes.forEach((note, index) => {
    const body = valueText(note);
    if (body) {
      items.push({
        kicker: `Lösung ${index + 1}`,
        title: "Erwartung",
        body
      });
    }
  });

  return items;
}

function conceptLayoutItems(content = {}, brief = {}) {
  const imageMaterials = Array.isArray(content.imageMaterials) ? content.imageMaterials : [];
  const output = brief.outputPreference || {};
  const items = imageMaterials.map((material, index) => ({
    kicker: `Bild ${index + 1}`,
    title: firstNonEmpty(material.title, material.purpose, `Bildidee ${index + 1}`),
    body: firstNonEmpty(material.prompt, material.description),
    meta: joinTextParts(material.purpose, material.placement)
  })).filter((item) => item.title || item.body || item.meta);

  const layoutTitle = joinTextParts(output.format, output.layout, output.style);
  if (layoutTitle) {
    items.unshift({
      kicker: "Layout",
      title: layoutTitle
    });
  }

  return items;
}

function richParagraphs(value, emptyText = "") {
  const lines = valueText(value)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (!lines.length) {
    return emptyText ? `<p class="detail-muted">${escapeHtml(emptyText)}</p>` : "";
  }
  return lines.map((line) => `<p>${renderInlineRichText(line)}</p>`).join("");
}

function conceptSectionsFromContent(content = {}, options = {}) {
  const brief = options.brief || {};
  const teachingContext = options.teachingContext || {};
  const project = options.project || {};
  const sections = [
    { title: "Rahmen", items: conceptFrameItems(project, teachingContext, brief, content) },
    { title: "Blattaufbau", items: conceptStructureItems(content, brief) },
    { title: "Aufgabenlogik", items: conceptLogicItems(content, brief) },
    { title: "Sichtbarer Inhalt", items: conceptVisibleContentItems(content) },
    { title: "Bild & Layout", items: conceptLayoutItems(content, brief) }
  ];
  return sections.filter((section) => section.items.length);
}

function renderConceptItem(item = {}, options = {}) {
  const compact = options.compact !== false;
  const title = firstNonEmpty(item.title, item.kicker);
  const kicker = item.kicker && item.kicker !== title ? item.kicker : "";
  return `
    <article class="concept-item${compact ? "" : " detail-concept-item"}">
      <div class="concept-item-heading">
        ${kicker ? `<span>${escapeHtml(kicker)}</span>` : ""}
        ${title ? `<strong>${renderInlineRichText(title)}</strong>` : ""}
      </div>
      ${item.body ? `<div class="concept-item-body">${richParagraphs(item.body)}</div>` : ""}
      ${item.expected ? `<div class="concept-item-expected"><span>Erwartung</span>${richParagraphs(item.expected)}</div>` : ""}
      ${item.meta ? `<p class="concept-item-meta">${renderInlineRichText(item.meta)}</p>` : ""}
    </article>
  `;
}

function renderConceptSections(sections = [], options = {}) {
  if (!sections.length) {
    return '<p class="detail-muted">Keine Konzeptdetails vorhanden.</p>';
  }
  const compact = options.compact !== false;
  return `
    <div class="${compact ? "concept-chat-sections" : "concept-detail-sections"}">
      ${sections.map((section) => `
        <section>
          <div class="concept-section-heading">
            <h4>${escapeHtml(section.title)}</h4>
            <span>${escapeHtml(section.items.length)} ${section.items.length === 1 ? "Eintrag" : "Einträge"}</span>
          </div>
          <div class="concept-items">
            ${section.items.map((item) => renderConceptItem(item, { compact })).join("")}
          </div>
        </section>
      `).join("")}
    </div>
  `;
}

function statusWord(value) {
  if (value === "approved") {
    return "bestätigt";
  }
  if (value === "draft") {
    return "in Arbeit";
  }
  return "nicht vorhanden";
}

function renderAssignmentPreview(item) {
  const source = item.documents?.source || {};
  const hasSourceInput = Boolean(sourceFilesFrom(source).length || source.transferCard);
  elements.previewGrid.dataset.previewType = "input";
  elements.previewEyebrow.textContent = "Vorschau";
  elements.previewTitle.textContent = "Input";
  if (!hasSourceInput) {
    elements.previewGrid.innerHTML = `
      <article class="detail-panel">
        <section class="detail-section">
          <p class="detail-label">Start</p>
          <h4>${escapeHtml(item.project?.title || "Neues Arbeitsblatt")}</h4>
          <p class="detail-muted">Noch kein Input vorhanden. Schreibe im Chat, was entstehen soll, oder lade Material dazu.</p>
        </section>
      </article>
    `;
    applyPreviewLayout(null);
    bindPreviewOpenActions(null);
    return;
  }
  elements.previewGrid.innerHTML = `
    <article class="detail-panel">
      <section class="detail-section">
        <p class="detail-label">Input</p>
        <h4>${escapeHtml(item.project?.title || "Input")}</h4>
      </section>
      ${renderSourceInputs({ source, projectId: item.project?.projectId })}
    </article>
  `;
  applyPreviewLayout(null);
  bindPreviewCardActions(elements.previewGrid);
  bindPreviewOpenActions(null);
}

function renderConceptPreview(item) {
  const brief = item.documents?.brief || {};
  const content = item.documents?.content || {};
  const briefData = brief.data || {};
  const contentData = content.data || {};
  const sections = conceptSectionsFromContent(contentData, {
    brief: briefData,
    project: item.project || {},
    teachingContext: item.teachingContext || {}
  });
  elements.previewGrid.dataset.previewType = "concept";
  elements.previewEyebrow.textContent = "Vorschau";
  elements.previewTitle.textContent = "Arbeitsblatt-Konzept";
  elements.previewGrid.innerHTML = `
    <article class="detail-panel">
      <section class="detail-section">
        <p class="detail-label">Kurzüberblick</p>
        <h4>${escapeHtml(worksheetConceptTitle(item.project || {}, briefData, contentData, item.teachingContext || {}))}</h4>
        <div class="detail-grid">
          <div><span>Fach</span><strong>${escapeHtml(briefData.subject || "offen")}</strong></div>
          <div><span>Ziel</span><strong>${escapeHtml(briefData.goal || "offen")}</strong></div>
          <div><span>Konzept</span><strong>${escapeHtml(statusWord(brief.status))}</strong></div>
          <div><span>Aufgaben</span><strong>${escapeHtml(statusWord(content.status))}</strong></div>
        </div>
      </section>
      ${renderConceptSections(sections, { compact: false })}
    </article>
  `;
  applyPreviewLayout(null);
  bindPreviewOpenActions(null);
}

async function openWorkspace(projectId) {
  if (!projectId) {
    return;
  }
  stopVoiceInput();
  resetCanvasLayout();
  setCanvasCaptureActive(false);
  closeCandidateViewer();
  closeCandidateInfo();
  closeMobilePreview();
  state.pendingCommand = null;
  state.composerAttachments = [];
  clearInputUploadReceipts();
  elements.chatInput.placeholder = "Nachricht an SheetifyIMG AI...";
  renderComposerAttachments();
  state.mode = "workspace";
  document.body.classList.add("production-mode");
  elements.emptyState.classList.add("hidden");
  elements.projectView.classList.add("hidden");
  elements.workspaceView.classList.remove("hidden");
  elements.librarySidebar.classList.add("hidden");
  elements.productionSidebar.classList.remove("hidden");
  elements.topbarProject.classList.remove("hidden");
  state.selectedId = `project:${projectId}`;
  renderTree(state.tree);

  elements.chatTimeline.innerHTML = '<div class="chat-loading">Workspace wird geladen...</div>';
  elements.canvasBody.innerHTML = '<div class="no-preview">Canvas wird geladen...</div>';
  applyCanvasLayout();

  try {
    const payload = await fetchJson(`/api/workspace/${encodeURIComponent(projectId)}`);
    state.workspace = payload.workspace;
    state.activeCanvasMode = defaultCanvasMode(state.workspace);
    renderWorkspace();
  } catch (error) {
    elements.chatTimeline.innerHTML = `<div class="chat-error">${escapeHtml(error.message)}</div>`;
  }
}

function closeWorkspace() {
  stopVoiceInput();
  state.mode = "library";
  state.workspace = null;
  setCanvasCaptureActive(false);
  closeCandidateViewer();
  closeCandidateInfo();
  closeMobilePreview();
  state.pendingCommand = null;
  state.composerAttachments = [];
  clearInputUploadReceipts();
  elements.chatInput.placeholder = "Nachricht an SheetifyIMG AI...";
  renderComposerAttachments();
  resetCanvasLayout();
  document.body.classList.remove("production-mode");
  elements.topbarProject.classList.add("hidden");
  elements.productionSidebar.classList.add("hidden");
  elements.librarySidebar.classList.remove("hidden");
  elements.workspaceView.classList.add("hidden");
  if (state.selectedId) {
    selectItem(state.selectedId);
  } else {
    elements.emptyState.classList.remove("hidden");
  }
}

function defaultCanvasMode(workspace) {
  if (workspace.project.projectType === "series") {
    return "series";
  }
  if (workspace.latestRun?.candidateCount) {
    return "candidates";
  }
  if (workspace.preview?.pdfs?.length || workspace.latestRun?.selectedPageCount) {
    return "candidates";
  }
  if (workspace.documents?.content?.data) {
    return "content";
  }
  if (workspace.documents?.brief?.data) {
    return "brief";
  }
  return "assignment";
}

function renderWorkspace() {
  const workspace = state.workspace;
  if (!workspace) {
    return;
  }
  if (!state.canvasLayout.collapsed && !state.canvasLayout.docked) {
    state.canvasLayout.width = clampCanvasWidth(state.canvasLayout.width);
    state.canvasLayout.lastExpandedWidth = state.canvasLayout.width;
  }
  applyCanvasLayout();
  elements.workspaceProjectTitle.textContent = workspace.project.title;
  elements.productionSidebarTitle.textContent = workspace.project.title;
  renderProductionSidebar(workspace);
  renderMobileStatusStrip(workspace);
  updateWorkspaceDebugSnapshot(workspace);
  renderTeachingContextPanel(workspace);
  renderChat(workspace);
  renderCanvas(workspace, state.activeCanvasMode);
  if (isSettingsOpen()) {
    renderSettings();
  }
  if (state.mobilePreview.mode && !state.mobilePreview.minimized && isMobileViewport()) {
    renderMobilePreview();
  }
}

function productionSteps(workspace) {
  const docs = workspace.documents || {};
  const candidateGenerationPending = isCandidateGenerationPendingForWorkspace(workspace);
  const hasInput = hasInputArtifact(workspace);
  const hasBrief = Boolean(docs.brief?.data);
  const hasContent = Boolean(docs.content?.data);
  const hasApprovedContent = Boolean(workspace.approval?.canGenerate);
  const hasCandidates = Boolean(workspace.latestRun?.candidateCount || workspace.preview?.previewMeta?.renderedCandidateCount);
  const checks = [
    { id: "input", number: 1, label: "Input", complete: hasInput, active: !hasInput, canvasMode: "assignment" },
    { id: "concept", number: 2, label: "Arbeitsblatt-Konzept", complete: hasApprovedContent, active: (hasBrief || hasContent) && !hasApprovedContent, canvasMode: "content" },
    { id: "candidates", number: 3, label: "Kandidaten", complete: hasCandidates, active: candidateGenerationPending, state: candidateGenerationPending ? "Wird erstellt" : "", canvasMode: "candidates" }
  ];
  const firstActive = checks.find((step) => step.active) || checks.find((step) => !step.complete);
  return checks.map((step) => ({
    ...step,
    tone: step.id === "candidates" && candidateGenerationPending ? "working" : step.complete ? "done" : firstActive?.id === step.id ? "active" : "pending"
  }));
}

function productionStepStateLabel(step) {
  if (step.tone === "done") {
    return "Fertig";
  }
  if (step.tone === "working") {
    return step.state || "Wird erstellt";
  }
  if (step.tone === "active") {
    return step.state || "Aktiv";
  }
  return "";
}

function renderProductionStep(step) {
  const stateLabel = productionStepStateLabel(step);
  return `
    <button class="production-step ${escapeHtml(step.tone)} ${state.activeCanvasMode === step.canvasMode ? "selected" : ""}" type="button" data-canvas-mode="${escapeHtml(step.canvasMode)}">
      <span class="step-marker ${escapeHtml(step.tone)}">${renderStepMarkerContent(step)}</span>
      <span class="production-step-copy">
        <span class="production-step-line">
          <span class="production-step-label">${escapeHtml(step.label)}</span>
          ${stateLabel ? `<span class="production-step-state">${escapeHtml(stateLabel)}</span>` : ""}
        </span>
      </span>
    </button>
  `;
}

function renderProductionSidebar(workspace) {
  if (workspace.project.projectType === "series") {
    elements.productionStepList.innerHTML = (workspace.steps || []).map((step, index) => `
      <button class="production-step ${step.complete ? "done" : "active"}" type="button" data-canvas-mode="series">
        <span class="step-marker ${step.complete ? "done" : "active"}">${step.complete ? renderIcon("check", "step-marker-icon") : index + 1}</span>
        <span class="production-step-copy">
          <span class="production-step-line">
            <span class="production-step-label">${escapeHtml(step.label)}</span>
            <span class="production-step-state">${escapeHtml(step.complete ? "Fertig" : step.state || "Aktiv")}</span>
          </span>
        </span>
      </button>
    `).join("");
  } else {
    elements.productionStepList.innerHTML = productionSteps(workspace).map(renderProductionStep).join("");
  }
  elements.productionStepList.querySelectorAll("[data-canvas-mode]").forEach((button) => {
    button.addEventListener("click", () => handleCanvasModeRequest(button.dataset.canvasMode));
  });
  elements.productionArtifactList.innerHTML = artifactRows(workspace).map(renderArtifactRow).join("");
  elements.productionArtifactList.querySelectorAll("[data-canvas-mode]").forEach((button) => {
    button.addEventListener("click", () => handleCanvasModeRequest(button.dataset.canvasMode));
  });
}

function isMobileViewport() {
  return window.matchMedia?.("(max-width: 760px)").matches;
}

function mobileConceptMode(workspace = {}) {
  if (workspace.proposals?.latestContentMirror && !workspace.documents?.content?.data) {
    return "content_proposal";
  }
  if (workspace.documents?.content?.data) {
    return "content";
  }
  if (workspace.proposals?.latestLessonBrief && !workspace.documents?.brief?.data) {
    return "lessonbrief_proposal";
  }
  if (workspace.documents?.brief?.data) {
    return "brief";
  }
  return "content";
}

function concreteMobileMode(mode, workspace = state.workspace) {
  if (mode === "concept" || mode === "content" || mode === "brief" || mode === "lessonbrief_proposal" || mode === "content_proposal") {
    return mobileConceptMode(workspace || {});
  }
  if (mode === "assignment") {
    return "input";
  }
  return mode || "content";
}

function shortStepLabel(step = {}) {
  const labels = {
    input: "Input",
    concept: "Konzept",
    candidates: "Kandidaten"
  };
  return labels[step.id] || step.label || "Status";
}

function mobileStatusPreviewChip(workspace = {}) {
  const candidateCount = workspace.latestRun?.candidateCount || workspace.preview?.previewMeta?.renderedCandidateCount || 0;
  if (candidateCount) {
    const candidatePages = countPreviewCandidatePages(workspace.preview);
    const candidatePdfs = countPreviewCandidatePdfs(workspace.preview);
    if (candidatePdfs) {
      return { label: `${candidatePdfs} PDF${candidatePdfs === 1 ? "" : "s"}`, mode: "candidates", tone: "done" };
    }
    if (candidatePages > candidateCount) {
      return { label: `${candidatePages} Seiten`, mode: "candidates", tone: "active" };
    }
    return { label: `${candidateCount} Kandidat${candidateCount === 1 ? "" : "en"}`, mode: "candidates", tone: "active" };
  }
  if (hasConceptArtifact(workspace)) {
    return { label: "Konzept öffnen", mode: mobileConceptMode(workspace), tone: "active" };
  }
  return null;
}

function renderMobileStatusStrip(workspace = {}) {
  if (!elements.mobileStatusStrip) {
    return;
  }
  const steps = productionSteps(workspace);
  const activeStep = steps.find((step) => step.tone === "active") || steps.find((step) => !step.complete) || steps[0];
  const activeMode = activeStep?.id === "concept" ? mobileConceptMode(workspace) : activeStep?.canvasMode || "input";
  const contextReady = Boolean(workspace.teachingContext?.readiness?.ready || workspace.teachingContext?.readiness?.conceptAllowed);
  const chips = [
    activeStep ? {
      label: `${activeStep.number}/3 ${shortStepLabel(activeStep)} ${activeStep.tone === "done" ? "fertig" : "aktiv"}`,
      mode: activeMode,
      tone: activeStep.tone
    } : null,
    workspace.teachingContext && workspace.project?.projectType !== "series" ? {
      label: contextReady ? "Rahmen bereit" : "Rahmen offen",
      mode: "context",
      tone: contextReady ? "done" : "pending"
    } : null,
    mobileStatusPreviewChip(workspace)
  ].filter(Boolean);

  elements.mobileStatusStrip.innerHTML = chips.map((chip) => `
    <button class="mobile-status-chip ${escapeHtml(chip.tone || "pending")}" type="button" data-mobile-preview-mode="${escapeHtml(chip.mode)}">
      ${escapeHtml(chip.label)}
    </button>
  `).join("");
  elements.mobileStatusStrip.querySelectorAll("[data-mobile-preview-mode]").forEach((button) => {
    button.addEventListener("click", () => openMobilePreview(button.dataset.mobilePreviewMode));
  });
}

function handleCanvasModeRequest(mode) {
  if (isMobileViewport()) {
    openMobilePreview(concreteMobileMode(mode));
    return;
  }
  setCanvasMode(mode);
}

function artifactRows(workspace) {
  if (workspace.project.projectType === "series") {
    const worksheetCount = workspace.series?.worksheets?.length || 0;
    return [
      worksheetCount ? { label: "Input", meta: `${worksheetCount} Arbeitsblaetter`, tag: "IN", mode: "series" } : null,
      worksheetCount ? { label: "Arbeitsblatt-Konzept", meta: "vorhanden", tag: "AB", mode: "series" } : null,
      worksheetCount ? { label: "Kandidaten", meta: `${worksheetCount} Arbeitsblaetter`, tag: "KAN", mode: "series" } : null
    ].filter(Boolean);
  }
  const rows = [];
  if (hasInputArtifact(workspace)) {
    rows.push({ label: "Input", meta: inputArtifactMeta(workspace), tag: "IN", mode: "assignment" });
  }
  const conceptStatus = workspace.approval?.canGenerate
    ? "freigegeben"
    : workspace.documents?.content?.data
      ? "in Arbeit"
      : workspace.documents?.brief?.data || workspace.proposals?.latestLessonBrief || workspace.proposals?.latestContentMirror
        ? "in Arbeit"
        : null;
  if (conceptStatus) {
    rows.push({ label: "Arbeitsblatt-Konzept", meta: conceptStatus, tag: "AB", mode: "content" });
  }
  const candidateCount = workspace.latestRun?.candidateCount || workspace.preview?.previewMeta?.renderedCandidateCount || 0;
  if (candidateCount) {
    const pdfCount = countPreviewCandidatePdfs(workspace.preview);
    const meta = pdfCount
      ? `${candidateCount} vorhanden · ${pdfCount} PDF${pdfCount === 1 ? "" : "s"}`
      : `${candidateCount} vorhanden`;
    rows.push({ label: "Kandidaten", meta: withConceptMeta(meta, workspace), tag: "KAN", mode: "candidates" });
  }
  return rows;
}

function hasInputArtifact(workspace) {
  return Boolean(workspace.inputReadiness?.ready);
}

function inputArtifactMeta(workspace) {
  const messageCount = (workspace.chat?.messages || []).filter((message) => message.role === "user").length;
  const meaningfulMessageCount = workspace.inputReadiness?.evidence?.meaningfulUserMessageCount || 0;
  const fileCount = sourceFilesFrom(workspace.documents?.source || {}).length;
  if (fileCount && meaningfulMessageCount) {
    return `${fileCount} Datei${fileCount === 1 ? "" : "en"} · ${meaningfulMessageCount} verwertbare Nachricht${meaningfulMessageCount === 1 ? "" : "en"}`;
  }
  if (fileCount) {
    return `${fileCount} Datei${fileCount === 1 ? "" : "en"}`;
  }
  if (workspace.documents?.source?.transferCard) {
    return "Import";
  }
  if (meaningfulMessageCount) {
    return meaningfulMessageCount === 1 ? "1 verwertbare Nachricht" : `${meaningfulMessageCount} verwertbare Nachrichten`;
  }
  return messageCount ? "noch nicht verwertbar" : "offen";
}

function workspaceConceptLabel(workspace) {
  return conceptLabel(
    workspace.latestRun?.selectedCandidateConcept
    || workspace.latestRun?.concept
    || workspace.preview?.candidates?.[0]?.concept
    || workspace.preview?.pdfs?.[0]?.concept
    || {}
  );
}

function withConceptMeta(meta, workspace) {
  const foundation = workspaceConceptLabel(workspace);
  return foundation ? `${meta} · ${foundation}` : meta;
}

function renderArtifactRow(row) {
  return `
    <button class="artifact-row ${row.warning ? "warning" : ""}" type="button" data-canvas-mode="${escapeHtml(row.mode)}">
      ${renderIcon(row.warning ? "file-text" : "file", "artifact-icon")}
      <span>
        <strong>${escapeHtml(row.label)}</strong>
        <small>${escapeHtml(row.meta)}</small>
      </span>
      <em>${escapeHtml(row.tag)}</em>
    </button>
  `;
}

function enabledCommandIds(workspace) {
  return (workspace.commands || [])
    .filter((command) => command.enabled)
    .map((command) => command.id);
}

function blockedCommands(workspace) {
  return (workspace.commands || [])
    .filter((command) => !command.enabled && command.reason)
    .map((command) => ({
      id: command.id,
      label: command.label,
      reason: command.reason
    }));
}

function debugSnapshot(workspace) {
  return {
    project: workspace.project,
    approval: workspace.approval || null,
    image: workspace.image || null,
    latestRun: workspace.latestRun || null,
    activeCanvasMode: state.activeCanvasMode,
    enabledCommands: enabledCommandIds(workspace),
    blockedCommands: blockedCommands(workspace),
    proposalCounts: workspace.proposals?.counts || null,
    artifactCounts: workspace.artifacts?.counts || null,
    steps: workspace.steps || []
  };
}

function updateWorkspaceDebugSnapshot(workspace) {
  state.debugSnapshot = debugSnapshot(workspace);
  window.__sheetifyDebug = {
    workspace,
    snapshot: state.debugSnapshot
  };
}

function primaryCommand(workspace) {
  const priorities = [
    "adopt_lessonbrief_proposal",
    "adopt_content_mirror_proposal",
    "adopt_content_warnings_proposal",
    "adopt_image_spec",
    "prepare_reference_asset",
    "prepare_web_reference_asset",
    "generate_lessonbrief_proposal",
    "generate_content_mirror_proposal",
    "generate_content_warnings_proposal",
    "approve_current_content",
    "prepare_image_spec",
    "create_run",
    "generate_image_candidate",
    "prepare_series_export",
    "approve_current_brief",
    "create_content_draft",
    "create_brief_draft"
  ];
  const commands = visibleCommands(workspace);
  return priorities.map((id) => commands.find((command) => command.id === id)).find(Boolean)
    || commands[0]
    || null;
}

function hasConversationInput(workspace) {
  return (workspace.chat?.messages || []).some((message) => {
    return message.role === "user" && String(message.content || "").trim();
  });
}

function hasConceptArtifact(workspace) {
  return Boolean(
    workspace.documents?.brief?.data
    || workspace.documents?.content?.data
    || workspace.proposals?.latestLessonBrief
    || workspace.proposals?.latestContentMirror
  );
}

function firstVisibleCommand(commands, ids) {
  return ids.map((id) => commands.find((command) => command.id === id)).find(Boolean) || null;
}

function visibleCommands(workspace) {
  if (!hasInputArtifact(workspace) && !hasConceptArtifact(workspace) && !workspace.latestRun) {
    return [];
  }

  const commands = enabledCommands(workspace);
  const policyActions = Array.isArray(workspace.workflowActions) ? workspace.workflowActions : [];
  if (policyActions.length) {
    return policyActions
      .map((action) => commands.find((command) => command.id === (action.id || action.command)))
      .filter(Boolean);
  }

  const hasBrief = Boolean(workspace.documents?.brief?.data);
  const hasContent = Boolean(workspace.documents?.content?.data);
  const hasConcept = hasBrief || hasContent || Boolean(workspace.proposals?.latestLessonBrief || workspace.proposals?.latestContentMirror);
  const hasSelection = Boolean(workspace.latestRun?.selectedPageCount);
  const hasExport = Boolean(workspace.workspaceEntry?.availability?.hasExport || workspace.preview?.pdfs?.length);
  const approveContentCommand = commands.find((command) => command.id === "approve_current_content");
  const contentNeedsRepair = hasContent
    && workspace.documents?.content?.status === "draft"
    && !approveContentCommand
    && !hasSelection
    && !hasExport;
  const commandOrder = [
    "adopt_lessonbrief_proposal",
    "adopt_content_mirror_proposal",
    "adopt_content_warnings_proposal",
    "prepare_reference_asset",
    "prepare_web_reference_asset",
    "adopt_image_spec",
    ...(hasConcept ? [] : ["generate_lessonbrief_proposal"]),
    ...(hasBrief && (!hasContent || contentNeedsRepair) ? ["generate_content_mirror_proposal"] : []),
    ...(hasContent ? ["approve_current_content"] : []),
    ...(!hasBrief ? ["create_brief_draft"] : []),
    ...(hasBrief && (!hasContent || contentNeedsRepair) ? ["create_content_draft"] : []),
    ...(workspace.proposals?.latestImageSpec ? ["prepare_reference_asset", "prepare_web_reference_asset", "adopt_image_spec"] : []),
    ...(commands.find((command) => command.id === "prepare_image_spec")?.referencePreflight ? ["prepare_image_spec"] : []),
    ...(workspace.proposals?.activeImageSpec ? ["prepare_reference_asset", "prepare_web_reference_asset"] : []),
    ...(hasContent ? ["generate_image_candidate"] : [])
  ];
  const next = firstVisibleCommand(commands, commandOrder);

  if (!next) {
    return [];
  }

  const companionIds = {
    generate_lessonbrief_proposal: ["create_brief_draft"],
    generate_content_mirror_proposal: ["create_content_draft"],
    prepare_reference_asset: next.referencePolicy?.canProceedWithoutReference !== false ? ["adopt_image_spec", "generate_image_candidate"] : ["adopt_image_spec"],
    prepare_web_reference_asset: next.referencePolicy?.canProceedWithoutReference !== false ? ["adopt_image_spec", "generate_image_candidate"] : ["adopt_image_spec"]
  };
  const companion = firstVisibleCommand(commands, companionIds[next.id] || []);
  return [next, companion].filter(Boolean);
}

function enabledCommands(workspace) {
  const priorities = [
    "adopt_lessonbrief_proposal",
    "adopt_content_mirror_proposal",
    "adopt_content_warnings_proposal",
    "generate_lessonbrief_proposal",
    "generate_content_mirror_proposal",
    "generate_content_warnings_proposal",
    "prepare_image_spec",
    "prepare_reference_asset",
    "prepare_web_reference_asset",
    "adopt_image_spec",
    "approve_current_content",
    "generate_image_candidate",
    "prepare_series_export",
    "approve_current_brief",
    "create_content_draft",
    "create_brief_draft"
  ];
  return (workspace.commands || [])
    .filter((command) => command.enabled && command.id !== "copy_context")
    .sort((left, right) => {
      const leftIndex = priorities.indexOf(left.id);
      const rightIndex = priorities.indexOf(right.id);
      return (leftIndex === -1 ? 999 : leftIndex) - (rightIndex === -1 ? 999 : rightIndex);
    });
}

function commandPayload(command = {}) {
  if (command.defaultPayload) {
    return command.defaultPayload;
  }
  if (command.defaultCandidateId) {
    return { candidateId: command.defaultCandidateId };
  }
  return {};
}

function workspaceCommandById(commandId) {
  return (state.workspace?.commands || []).find((command) => command.id === commandId) || null;
}

function fallbackImageProviders() {
  return [
    {
      id: "codex_cli",
      label: "Codex Usage",
      enabled: true,
      description: "Nutzt den lokalen Codex-Login und erzeugt Bilder über Codex."
    },
    {
      id: "openai",
      label: "OpenAI API",
      enabled: true,
      description: "Nutzt den OpenAI API-Key und kann API-Kosten verursachen."
    }
  ];
}

function imageProviderCommand(workspace = state.workspace) {
  return (workspace?.commands || []).find((command) => Array.isArray(command.imageProviders) && command.imageProviders.length) || null;
}

function imageProviderOptions(workspace = state.workspace, command = null) {
  if (Array.isArray(command?.imageProviders) && command.imageProviders.length) {
    return command.imageProviders;
  }
  const runtimeProviders = workspace?.image?.imageProviders;
  if (Array.isArray(runtimeProviders) && runtimeProviders.length) {
    return runtimeProviders;
  }
  const workspaceCommand = imageProviderCommand(workspace);
  if (Array.isArray(workspaceCommand?.imageProviders) && workspaceCommand.imageProviders.length) {
    return workspaceCommand.imageProviders;
  }
  return fallbackImageProviders();
}

function providerById(providerId, workspace = state.workspace, command = null) {
  return imageProviderOptions(workspace, command).find((provider) => provider.id === providerId) || null;
}

function defaultImageProviderForCommand(command = null, workspace = state.workspace) {
  const codexProvider = imageProviderOptions(workspace, command)
    .find((provider) => provider.id === "codex_cli" && provider.enabled !== false);
  if (codexProvider) {
    return "codex_cli";
  }
  const commandDefault = normalizeImageProviderSetting(command?.defaultPayload?.imageProvider);
  if (commandDefault) {
    return commandDefault;
  }
  const runtimeDefault = normalizeImageProviderSetting(workspace?.image?.provider || workspace?.image?.mode);
  if (runtimeDefault) {
    return runtimeDefault;
  }
  const enabledProvider = imageProviderOptions(workspace, command).find((provider) => provider.enabled !== false);
  return normalizeImageProviderSetting(enabledProvider?.id) || "openai";
}

function configuredImageProviderId(command = null, workspace = state.workspace) {
  return normalizeImageProviderSetting(state.settings.imageProvider)
    || defaultImageProviderForCommand(command, workspace);
}

function commandUsesImageProvider(command = {}) {
  return command.id === "generate_image_candidate" || command.confirmationKind === "image_generation_provider";
}

function withConfiguredImageProvider(command = {}, payload = {}) {
  if (!commandUsesImageProvider(command)) {
    return payload;
  }
  return {
    ...payload,
    imageProvider: configuredImageProviderId(command, state.workspace)
  };
}

function imageProviderUnavailableReason(command = {}, providerId = "") {
  const provider = providerById(providerId, state.workspace, command);
  if (!provider || provider.enabled !== false) {
    return "";
  }
  return `${provider.label || providerId} ist in diesem Setup gerade nicht verfügbar. Bitte wähle in den Einstellungen einen verfügbaren Bildanbieter.`;
}

function providerBillingDescription(provider = {}) {
  if (provider.id === "codex_cli") {
    return "Verbraucht Codex/ChatGPT-Kontingent. Es entstehen keine OpenAI-API-Kosten über deinen API-Key.";
  }
  if (provider.id === "openai") {
    return "Verwendet den hinterlegten OpenAI API-Key und kann API-Kosten verursachen.";
  }
  return provider.description || "Wird für neue Bildkandidaten verwendet.";
}

function commandPageCount(command = {}, payload = {}) {
  const explicit = Number(payload.pageCount || command?.defaultPayload?.pageCount || 0);
  if (explicit > 1) {
    return explicit;
  }
  const text = [
    command?.confirmationMessage,
    command?.label,
    payload?.message
  ].filter(Boolean).join(" ");
  const match = text.match(/(\d+)\s+Seiten/i);
  return match ? Number(match[1]) : explicit;
}

function isSettingsOpen() {
  return Boolean(elements.settingsModal && !elements.settingsModal.classList.contains("hidden"));
}

function renderSettings() {
  const container = elements.imageProviderSettings;
  if (!container) {
    return;
  }
  const command = imageProviderCommand(state.workspace);
  const selectedProviderId = configuredImageProviderId(command, state.workspace);
  const providers = imageProviderOptions(state.workspace, command);
  container.innerHTML = providers.map((provider) => {
    const providerId = normalizeImageProviderSetting(provider.id) || provider.id;
    const enabled = provider.enabled !== false;
    const selected = providerId === selectedProviderId;
    const description = providerBillingDescription(provider);
    const availability = enabled ? "" : " Aktuell nicht verfügbar.";
    return `
      <label class="provider-setting-option ${selected ? "selected" : ""} ${enabled ? "" : "unavailable"}" aria-disabled="${enabled ? "false" : "true"}">
        <input type="radio" name="imageProviderSetting" value="${escapeHtml(providerId)}" data-image-provider="${escapeHtml(providerId)}" ${selected ? "checked" : ""} ${enabled ? "" : "disabled"}>
        <span class="provider-setting-copy">
          <strong>${escapeHtml(provider.label || providerId)}</strong>
          <span>${escapeHtml(`${description}${availability}`.trim())}</span>
        </span>
      </label>
    `;
  }).join("");
  container.querySelectorAll("[data-image-provider]").forEach((input) => {
    input.addEventListener("change", () => {
      const providerId = normalizeImageProviderSetting(input.dataset.imageProvider);
      if (!providerId) {
        return;
      }
      state.settings = {
        ...state.settings,
        imageProvider: providerId
      };
      saveSettings(state.settings);
      renderSettings();
      if (state.workspace) {
        renderWorkspace();
      }
      showToast(providerId === "codex_cli" ? "Bildanbieter: Codex Usage" : "Bildanbieter: OpenAI API", "success");
    });
  });
}

function openSettings() {
  if (!elements.settingsModal) {
    return;
  }
  state.settingsModal.lastFocusedElement = document.activeElement;
  renderSettings();
  elements.settingsModal.classList.remove("hidden");
  elements.settingsModal.setAttribute("aria-hidden", "false");
  window.setTimeout(() => {
    const focusTarget = elements.imageProviderSettings?.querySelector("input:checked:not(:disabled), input:not(:disabled)")
      || elements.settingsCloseButton;
    focusTarget?.focus();
  }, 0);
}

function closeSettings() {
  if (!elements.settingsModal || elements.settingsModal.classList.contains("hidden")) {
    return;
  }
  elements.settingsModal.classList.add("hidden");
  elements.settingsModal.setAttribute("aria-hidden", "true");
  state.settingsModal.lastFocusedElement?.focus?.();
  state.settingsModal.lastFocusedElement = null;
}

function requestConfirmation(options = {}) {
  return new Promise((resolve) => {
    const modal = elements.confirmationModal;
    const eyebrow = elements.confirmationEyebrow;
    const title = elements.confirmationTitle;
    const message = elements.confirmationMessage;
    const accept = elements.confirmationAcceptButton;
    const cancel = elements.confirmationCancelButton;
    if (!modal || !title || !message || !accept || !cancel) {
      resolve(false);
      return;
    }

    if (eyebrow) {
      eyebrow.textContent = options.eyebrow || "Bestätigung";
    }
    title.textContent = options.title || "Aktion bestätigen?";
    message.textContent = options.message || "Diese Aktion kann nicht automatisch rückgängig gemacht werden.";
    accept.textContent = options.acceptLabel || "Bestätigen";
    accept.classList.toggle("danger-button", Boolean(options.danger));
    modal.classList.remove("hidden");
    accept.focus();

    const cleanup = (value) => {
      modal.classList.add("hidden");
      accept.classList.remove("danger-button");
      accept.removeEventListener("click", onAccept);
      cancel.removeEventListener("click", onCancel);
      modal.removeEventListener("click", onBackdrop);
      document.removeEventListener("keydown", onKeydown);
      resolve(value);
    };
    const onAccept = () => cleanup(true);
    const onCancel = () => cleanup(false);
    const onBackdrop = (event) => {
      if (event.target === modal) {
        cleanup(false);
      }
    };
    const onKeydown = (event) => {
      if (event.key === "Escape") {
        cleanup(false);
      }
    };

    accept.addEventListener("click", onAccept);
    cancel.addEventListener("click", onCancel);
    modal.addEventListener("click", onBackdrop);
    document.addEventListener("keydown", onKeydown);
  });
}

function requestCommandConfirmation(command = {}, payload = {}) {
  if (command.confirmationKind === "concept_with_assumptions") {
    return requestConfirmation({
      eyebrow: "Prüfung",
      title: command.confirmationTitle || "Konzept mit Annahmen erstellen?",
      message: command.confirmationMessage
        || "Der Unterrichtsrahmen ist noch nicht vollständig geklärt. Dadurch kann die Arbeitsblattqualität leiden. Trotzdem fortfahren?",
      acceptLabel: command.confirmationAcceptLabel || command.label || "Trotzdem fortfahren"
    });
  }
  if (command.id === "generate_image_candidate" && Number(payload.pageNumber || payload.page)) {
    const page = Number(payload.pageNumber || payload.page);
    if (payload.imageProvider === "codex_cli") {
      return requestConfirmation({
        eyebrow: "Usage-Verbrauch",
        title: `Seite ${page} mit Codex Usage neu erzeugen?`,
        message: "Dieser Schritt nutzt deinen lokalen Codex-Login und verbraucht Codex/ChatGPT-Kontingent. Es entstehen keine OpenAI-API-Kosten über deinen API-Key. Die Datei wird danach technisch geprüft.",
        acceptLabel: `Seite ${page} mit Codex erzeugen`
      });
    }
    return requestConfirmation({
      eyebrow: "API-Kosten",
      title: `Seite ${page} mit OpenAI API neu erzeugen?`,
      message: `Dieser Schritt nutzt den hinterlegten OpenAI API-Key und kann API-Kosten verursachen. Er erzeugt nur Seite ${page} als neue Bildvariante.`,
      acceptLabel: `Seite ${page} mit OpenAI API erzeugen`
    });
  }
  if (commandUsesImageProvider(command) && payload.imageProvider === "codex_cli") {
    return requestConfirmation({
      eyebrow: "Usage-Verbrauch",
      title: command.id === "generate_image_candidate" ? "Kandidat mit Codex Usage erzeugen?" : "Bildschritt mit Codex Usage ausführen?",
      message: "Dieser Schritt nutzt deinen lokalen Codex-Login und verbraucht Codex/ChatGPT-Kontingent. Es entstehen keine OpenAI-API-Kosten über deinen API-Key. SheetifyIMG importiert das Bild danach als normalen Kandidaten und prüft die Datei.",
      acceptLabel: "Mit Codex Usage erzeugen"
    });
  }
  if (commandUsesImageProvider(command)) {
    return requestConfirmation({
      eyebrow: "API-Kosten",
      title: command.id === "generate_image_candidate" ? "Kandidat mit OpenAI API erzeugen?" : "Bildschritt mit OpenAI API ausführen?",
      message: "Dieser Schritt nutzt den hinterlegten OpenAI API-Key und kann API-Kosten verursachen. SheetifyIMG importiert das Bild danach als normalen Kandidaten und prüft die Datei.",
      acceptLabel: "Mit OpenAI API erzeugen"
    });
  }
  return requestConfirmation({
    eyebrow: command.confirmationKind === "paid_image_generation" ? "API-Kosten" : "Bestätigung",
    title: command.confirmationTitle || "Kandidat erzeugen?",
    message: command.confirmationMessage
      || "Dieser Schritt erzeugt ein Bild über die OpenAI Image API und kann Kosten verursachen.",
    acceptLabel: command.confirmationAcceptLabel || command.label || "Kandidat erzeugen"
  });
}

function pendingCommandMessage(commandId, command = {}, payload = {}) {
  if (commandId === "generate_image_candidate") {
    const providerText = payload.imageProvider === "codex_cli" ? " per Codex Usage" : "";
    const pageCount = commandPageCount(command, payload);
    if (Number(payload.pageNumber || payload.page)) {
      return `Seite ${Number(payload.pageNumber || payload.page)} wird${providerText} neu gerendert.`;
    }
    if (pageCount > 1) {
      return `Kandidatenreihe mit ${pageCount} Seiten wird${providerText} gerendert. Das kann einen Moment dauern.`;
    }
    return `Kandidat wird${providerText} gerendert. Das kann einen Moment dauern.`;
  }
  if (commandId === "generate_lessonbrief_proposal" || commandId === "generate_content_mirror_proposal") {
    return "Konzept-Vorschlag wird vorbereitet.";
  }
  return `${command?.label || "Aktion"} wird ausgeführt.`;
}

function pendingChatForWorkspace(workspace) {
  return state.pendingChat?.projectId === workspace.project?.projectId ? state.pendingChat : null;
}

function pendingCommandForWorkspace(workspace) {
  return state.pendingCommand?.projectId === workspace.project?.projectId ? state.pendingCommand : null;
}

function isCandidateGenerationPendingForProject(projectId) {
  return Boolean(projectId && state.pendingCommand?.projectId === projectId && state.pendingCommand?.commandId === "generate_image_candidate");
}

function isCandidateGenerationPendingForWorkspace(workspace) {
  return isCandidateGenerationPendingForProject(workspace?.project?.projectId);
}

function commandErrorForWorkspace(workspace) {
  return state.commandError?.projectId === workspace.project?.projectId ? state.commandError : null;
}

function isChatBusy() {
  return state.pendingChat?.status === "sending" || state.pendingChat?.status === "streaming";
}

function chatMessagesForWorkspace(workspace) {
  const messages = [...(workspace.chat?.messages || [])];
  const pendingCommand = pendingCommandForWorkspace(workspace);
  if (pendingCommand) {
    messages.push({
      role: "assistant",
      content: "",
      createdAt: pendingCommand.createdAt,
      pending: true,
      productionCard: {
        kind: "command_pending",
        commandId: pendingCommand.commandId,
        label: pendingCommand.label,
        message: pendingCommand.message
      }
    });
  }
  const commandError = commandErrorForWorkspace(workspace);
  if (commandError && !pendingCommand) {
    messages.push({
      role: "assistant",
      content: commandError.message || "Der Produktionsschritt konnte nicht abgeschlossen werden.",
      createdAt: commandError.createdAt,
      failed: true
    });
  }
  const pending = pendingChatForWorkspace(workspace);
  if (!pending) {
    return messages;
  }

  messages.push({
    role: "user",
    content: pending.message,
    createdAt: pending.createdAt,
    attachments: pending.attachments || [],
    pending: pending.status === "sending",
    failed: pending.status === "error"
  });

  messages.push({
    role: "assistant",
    content: pending.status === "error"
      ? pending.errorMessage || "Die Antwort konnte nicht geladen werden."
      : pending.status === "streaming"
        ? pending.assistantText || ""
        : "",
    pending: pending.status === "sending",
    streaming: pending.status === "streaming",
    streamRevealStart: pending.streamRevealStart || 0,
    failed: pending.status === "error"
  });

  return messages;
}

function trailingDecisionCommands(workspace) {
  if (pendingChatForWorkspace(workspace) || pendingCommandForWorkspace(workspace)) {
    return [];
  }
  const commands = visibleCommands(workspace);
  if (!commands.length || latestAssistantAlreadyOffers(workspace, commands) || latestAssistantIsWaiting(workspace)) {
    return [];
  }
  return commands;
}

function latestAssistantIndex(messages) {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index].role !== "user" && !messages[index].pending && !messages[index].failed) {
      return index;
    }
  }
  return -1;
}

function latestStableMessageIndex(messages) {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (!messages[index].pending && !messages[index].failed) {
      return index;
    }
  }
  return -1;
}

function renderChat(workspace) {
  const messages = chatMessagesForWorkspace(workspace);
  const visibleCommandIds = new Set(visibleCommands(workspace).map((command) => command.id));
  const extraCommands = trailingDecisionCommands(workspace);
  const latestStableIndex = latestStableMessageIndex(messages);
  const latestMessage = messages[messages.length - 1] || null;
  const actionHostIndex = latestMessage?.role !== "user" && latestStableIndex >= 0 && messages[latestStableIndex].role !== "user"
    ? latestAssistantIndex(messages)
    : -1;
  elements.chatTimeline.innerHTML = `
    ${renderChatRuntime(workspace.chat)}
    ${messages.length ? messages.map((message, index) => renderChatMessage(
      message,
      visibleCommandIds,
      index === actionHostIndex ? extraCommands : [],
      workspace,
      index === actionHostIndex
    )).join("") : renderChatIntro(workspace)}
  `;
  elements.chatTimeline.querySelectorAll("[data-command]").forEach((button) => {
    button.addEventListener("click", () => executeCommand(button.dataset.command, parsePayload(button.dataset.payload)));
  });
  elements.chatTimeline.querySelectorAll("[data-canvas-mode]").forEach((button) => {
    button.addEventListener("click", () => handleCanvasModeRequest(button.dataset.canvasMode));
  });
  elements.chatTimeline.querySelectorAll("[data-chat-message]").forEach((button) => {
    button.addEventListener("click", () => sendChatMessage(button.dataset.chatMessage || "", {
      uiEvent: "concept_revision_option"
    }));
  });
  bindPreviewCardActions(elements.chatTimeline);
  elements.chatTimeline.scrollTop = elements.chatTimeline.scrollHeight;
  updateComposerState();
}

function renderChatRuntime(chat = {}) {
  const status = chat.status || chat.mode || "missing_key";
  const modeClass = status === "ready" ? "openai" : "error";
  const label = chat.mode === "openai" && status === "ready"
    ? `OpenAI aktiv · ${chat.textModel || "Textmodell"}`
    : status === "missing_key"
      ? "OpenAI-Key fehlt"
      : "OpenAI nicht bereit";
  return `<div class="chat-runtime ${modeClass}">${escapeHtml(label)}</div>`;
}

function teachingContextVisible(workspace = {}) {
  if (!workspace.teachingContext || workspace.project?.projectType === "series") {
    return false;
  }
  return !workspace.documents?.brief?.data
    && !workspace.documents?.content?.data
    && !workspace.proposals?.latestLessonBrief
    && !workspace.proposals?.latestContentMirror;
}

function teachingContextFieldRows(context = {}) {
  const fields = context.fields || {};
  const order = ["topic", "targetGroup", "lessonGoal", "worksheetType", "specialRequirements"];
  return order.map((id) => fields[id]).filter(Boolean).map((field) => {
    const status = field.status || "missing";
    const ready = Boolean(field.value);
    const iconName = ready ? "check" : "";
    const statusClass = field.assumption ? "assumed" : ready ? "known" : "missing";
    const value = field.value || "offen";
    return `
      <li class="teaching-context-field ${escapeHtml(statusClass)}">
        <span class="teaching-context-status" aria-hidden="true">${iconName ? renderIcon(iconName, "teaching-context-check") : ""}</span>
        <span class="teaching-context-label">${escapeHtml(field.label || id)}</span>
        <strong>${escapeHtml(value)}</strong>
        ${field.assumption || status === "assumed" ? '<em>Annahme</em>' : ""}
      </li>
    `;
  }).join("");
}

function teachingContextNote(context = {}) {
  const readiness = context.readiness || {};
  if (readiness.ready) {
    return "Genug Infos für ein erstes Arbeitsblatt-Konzept.";
  }
  if (readiness.forcedWithAssumptions) {
    return "Vorschlag mit sichtbaren Annahmen ist erlaubt.";
  }
  return context.nextQuestion || "Ich kläre kurz, wofür das Arbeitsblatt im Unterricht funktionieren soll.";
}

function renderTeachingContextPanel(workspace = {}) {
  const panel = elements.teachingContextPanel;
  if (!panel) {
    return;
  }
  if (!teachingContextVisible(workspace)) {
    panel.classList.add("hidden");
    panel.innerHTML = "";
    return;
  }
  const context = workspace.teachingContext || {};
  const readiness = context.readiness || {};
  panel.classList.remove("hidden");
  panel.innerHTML = `
    <div class="teaching-context-header">
      <div>
        <p>Unterrichtsrahmen</p>
        <strong>${escapeHtml(readiness.conceptAllowed ? "bereit" : "wird geklärt")}</strong>
      </div>
    </div>
    <ul>${teachingContextFieldRows(context)}</ul>
    <div class="teaching-context-next">
      <span>Nächste Klärung</span>
      <p>${escapeHtml(teachingContextNote(context))}</p>
    </div>
    ${readiness.conceptAllowed ? "" : `
      <button class="secondary-button mini-button teaching-context-force" type="button" data-teaching-context-force>
        Trotzdem Vorschlag machen
      </button>
    `}
  `;
  panel.querySelector("[data-teaching-context-force]")?.addEventListener("click", () => {
    sendChatMessage("Mach trotzdem einen ersten Vorschlag mit Annahmen.", {
      uiEvent: "teaching_context_force"
    });
  });
}

function parsePayload(value) {
  try {
    return value ? JSON.parse(value) : {};
  } catch {
    return {};
  }
}

function renderChatIntro(workspace) {
  const text = workspace.project.isLegacy
    ? "Dieses Projekt ist als Legacy-Stand geöffnet. Du kannst es prüfen und Inhalt kopieren."
    : workspace.chat?.mode === "openai"
      ? "Beschreibe kurz, welches Arbeitsblatt du brauchst, oder hänge Material an. Ich kläre mit dir den Unterrichtsrahmen und schlage danach den nächsten sinnvollen Schritt vor."
      : "Beschreibe kurz, welches Arbeitsblatt du brauchst, oder hänge Material an. Ich kläre mit dir den Unterrichtsrahmen und schlage danach den nächsten sinnvollen Schritt vor.";
  return `
    <div class="chat-message assistant">
      <div class="assistant-avatar">AI</div>
      <div class="message-bubble">
        <strong>SheetifyIMG AI</strong>
        <div class="message-copy">${markdownToHtml(text)}</div>
      </div>
    </div>
  `;
}

function renderActionButtons(actions = []) {
  return actions.length ? `<div class="message-actions">${actions.map((action) => `
    <button class="secondary-button mini-button" type="button" data-command="${escapeHtml(action.id || action.command)}" data-payload="${escapeHtml(JSON.stringify(action.payload || {}))}">
      ${escapeHtml(action.label || decisionButtonLabel({ id: action.id || action.command }))}
    </button>
  `).join("")}</div>` : "";
}

function actionLabel(action = {}) {
  return action.label || decisionButtonLabel({ id: action.id || action.command }) || action.command || action.id || "Aktion";
}

function actionHistoryLabel(action = {}) {
  const commandId = action.id || action.command || "";
  const label = actionLabel(action);
  const normalized = label.toLowerCase();
  if (commandId === "generate_lessonbrief_proposal" || normalized.includes("konzept vorschlagen")) {
    return "Konzeptvorschlag";
  }
  if (commandId === "generate_content_mirror_proposal" || normalized.includes("konzept überarbeiten")) {
    return "Konzeptüberarbeitung";
  }
  if (normalized.includes("konzept aktualisieren")) {
    return "Konzeptaktualisierung";
  }
  if (commandId === "adopt_content_mirror_proposal" || commandId === "adopt_lessonbrief_proposal" || normalized.includes("konzept übernehmen")) {
    return "Konzeptübernahme";
  }
  if (commandId === "generate_image_candidate" || normalized.includes("kandidat erzeugen") || normalized.includes("variante erzeugen")) {
    return hasCandidateHistoryLabel(label) ? "Variantenerzeugung" : "Kandidatenerzeugung";
  }
  if (commandId === "select_candidate" || normalized.includes("auswahl übernehmen") || normalized.includes("kandidat auswählen")) {
    return "Auswahlübernahme";
  }
  if (commandId === "prepare_export" || normalized.includes("pdf ohne lösungsblatt") || normalized.includes("pdf mit lösungsblatt")) {
    return "PDF-Erstellung";
  }
  if (commandId === "prepare_image_spec" || normalized.includes("kandidaten vorbereiten")) {
    return "Kandidatenvorbereitung";
  }
  if (commandId === "prepare_reference_asset" || normalized.includes("referenz vorbereiten")) {
    return "Referenzvorbereitung";
  }
  if (commandId === "prepare_web_reference_asset" || normalized.includes("webreferenz suchen")) {
    return "Webreferenzsuche";
  }
  return label;
}

function hasCandidateHistoryLabel(label = "") {
  return /weitere\s+variante/i.test(String(label || ""));
}

function comparablePayloadValue(value) {
  return value === undefined || value === null ? "" : String(value);
}

function actionPayloadMatchesCommand(action = {}, command = {}) {
  const expected = commandPayload(command);
  const actual = action.payload || {};
  const sensitiveKeys = ["proposalId", "runId", "candidateId", "imageSpecProposalId"];
  if (command.id === "select_candidate" && expected.runId && !actual.runId) {
    return false;
  }
  for (const key of sensitiveKeys) {
    const actualValue = comparablePayloadValue(actual[key]);
    const expectedValue = comparablePayloadValue(expected[key]);
    if (actualValue && expectedValue && actualValue !== expectedValue) {
      return false;
    }
    if (actualValue && !expectedValue && (key === "proposalId" || key === "imageSpecProposalId")) {
      return false;
    }
  }
  return true;
}

function actionState(action = {}, workspace = {}, isActionHost = false, visibleCommandIds = new Set()) {
  const commandId = action.id || action.command;
  const command = (workspace.commands || []).find((entry) => entry.id === commandId) || null;
  if (!isActionHost) {
    return { current: false, reason: "replaced" };
  }
  if (!command || !command.enabled || !visibleCommandIds.has(commandId)) {
    return { current: false, reason: "unavailable" };
  }
  if (!actionPayloadMatchesCommand(action, command)) {
    return { current: false, reason: "outdated" };
  }
  return { current: true, reason: null };
}

function renderActionHistory(actions = []) {
  if (!actions.length) {
    return "";
  }
  const labels = [...new Set(actions.map(({ action }) => actionHistoryLabel(action)))].join(", ");
  const text = `Aktion ausgeführt: ${labels}.`;
  return `<div class="message-action-history">${escapeHtml(text)}</div>`;
}

function renderChatAttachments(attachments = []) {
  const visualAttachments = attachments.filter((attachment) => attachment.kind === "visual_feedback");
  if (!visualAttachments.length) {
    return "";
  }
  return `<div class="message-attachments">${visualAttachments.map((attachment) => `
    <figure class="message-attachment">
      <img src="${escapeHtml(attachment.url || attachment.previewUrl || attachment.dataUrl || "")}" alt="${escapeHtml(attachment.label || "Screenshot-Ausschnitt")}">
      <figcaption>
        <span>${escapeHtml(attachment.label || "Ausschnitt")}</span>
        <small>${escapeHtml(attachment.source?.runId || "Visuelle Rückmeldung")}</small>
      </figcaption>
    </figure>
  `).join("")}</div>`;
}

function findCandidateForCard(card = {}, workspace = state.workspace) {
  const candidates = workspace?.preview?.candidates || [];
  return candidates.find((candidate) => {
    return candidate.id === card.candidateId && (!card.runId || candidate.runId === card.runId);
  }) || null;
}

function renderMiniSpinner() {
  return '<span class="mini-spinner" aria-hidden="true"></span>';
}

function renderPendingProductionCard(card = {}) {
  const isCandidateGeneration = card.commandId === "generate_image_candidate";
  const pageCount = Number(card.pageCount || 0);
  const isSeries = isCandidateGeneration && pageCount > 1;
  const title = isSeries ? "Kandidatenreihe wird gerendert" : isCandidateGeneration ? "Kandidat wird gerendert" : card.label || "Aktion läuft";
  const text = isCandidateGeneration
    ? isSeries
      ? `Das Bildmodell erzeugt gerade ${pageCount} zusammengehörige Seiten. Sie erscheinen danach als eine Kandidatenreihe.`
      : "Das Bildmodell erzeugt gerade einen neuen Kandidaten. Das kann einen Moment dauern."
    : card.message || "Der Produktionsschritt wird ausgeführt.";
  return `
    <article class="chat-result-card pending${isCandidateGeneration ? " candidate-render-pending" : ""}">
      <div class="chat-result-spinner">${isCandidateGeneration ? icon("scan-line", "icon icon-small") : renderMiniSpinner()}</div>
      <div>
        <strong>${escapeHtml(title)}</strong>
        <p>${escapeHtml(text)}</p>
        ${isSeries ? `
          <div class="render-page-placeholders" aria-label="${escapeHtml(`${pageCount} Seiten werden gerendert`)}">
            ${Array.from({ length: Math.min(pageCount, 4) }, (_, index) => `
              <span>
                <b>Seite ${index + 1}</b>
                <small>wird erstellt</small>
              </span>
            `).join("")}
          </div>
        ` : ""}
        ${isCandidateGeneration ? `
          <div class="render-progress-steps" aria-label="Rendering läuft">
            <span>Bildmodell gestartet</span>
            <span>${escapeHtml(isSeries ? "Layout, Text und Seitenstil werden gerendert" : "Layout und Text werden gerendert")}</span>
            <span>${escapeHtml(isSeries ? "Die Kandidatenreihe erscheint automatisch im Chat" : "Der Kandidat erscheint automatisch im Chat")}</span>
          </div>
        ` : ""}
      </div>
    </article>
  `;
}

function renderCandidateChatCard(card = {}, workspace) {
  const candidate = findCandidateForCard(card, workspace);
  const pages = (candidate?.pages || []).filter((entry) => entry.url);
  const page = pages[0];
  if (!candidate || !page) {
    return `
      <article class="chat-result-card pending">
        <div class="chat-result-spinner">${renderMiniSpinner()}</div>
        <div>
          <strong>${escapeHtml(card.candidateId || "Kandidat")}</strong>
          <p>Der Kandidat wird vorbereitet.</p>
        </div>
      </article>
    `;
  }
  const pageCount = pages.length || Number(candidate.generation?.generatedPageCount || candidate.generation?.pageCount || 0) || 1;
  const isSeries = pageCount > 1;
  const pdf = candidate.pdf?.url ? candidate.pdf : null;
  const meta = [
    candidate.runId,
    isSeries ? `${pageCount} Seiten` : page.page ? `Seite ${page.page}` : null,
    candidate.generation?.model || null,
    conceptLabel(candidate.concept || candidate)
  ].filter(Boolean).join(" · ");
  return `
    <figure
      class="chat-result-card candidate-chat-card"
      data-open-url="${escapeHtml(page.url)}"
      data-capture-kind="candidate"
      data-run-id="${escapeHtml(candidate.runId || "")}"
      data-candidate-id="${escapeHtml(candidate.id)}"
      data-page="${escapeHtml(page.page || 1)}"
      data-page-role="${escapeHtml(page.role || "worksheet")}"
      data-source-path="${escapeHtml(page.path || "")}"
      data-source-url="${escapeHtml(page.url)}"
    >
      <img data-capture-image src="${escapeHtml(page.url)}" alt="${escapeHtml(candidate.id)}">
      <figcaption>
        <span>
          <strong>${escapeHtml(isSeries ? `${candidate.id} · Kandidatenreihe fertig` : `${candidate.id} ist fertig`)}</strong>
          <button class="candidate-info-button" type="button" data-card-action="candidate-info" data-candidate-id="${escapeHtml(candidate.id)}" data-run-id="${escapeHtml(candidate.runId || "")}" aria-label="Generierungsinfo anzeigen" title="Generierungsinfo anzeigen">
            ${icon("info", "icon icon-small")}
          </button>
        </span>
        <small>${escapeHtml(meta || "Kandidat ansehen")}</small>
        ${pdf ? `
          <div class="candidate-chat-actions">
            <button class="mini-button primary-button" type="button" data-card-action="download-candidate-pdf" data-download-url="${escapeHtml(pdf.url)}" data-download-name="${escapeHtml(fileName(pdf.path || pdf.url))}">
              ${icon("download", "icon icon-small")}
              <span>PDF herunterladen</span>
            </button>
          </div>
        ` : ""}
      </figcaption>
    </figure>
  `;
}

function conceptPreviewFromMessage(message = {}, workspace = {}) {
  const proposal = message.proposal || null;
  if (proposal?.kind === "lessonbrief") {
    const sections = conceptSectionsFromContent({}, {
      brief: proposal.data || {},
      project: workspace.project || {},
      teachingContext: workspace.teachingContext || {}
    });
    return {
      title: proposal.data?.topic || proposal.title || "Konzept-Vorschlag",
      eyebrow: "Konzept-Vorschlag",
      canvasMode: "lessonbrief_proposal",
      summary: "Rahmen steht. Prüfe, ob Ziel, Zielgruppe und Format passen.",
      rows: [
        ["Fach", proposal.data?.subject],
        ["Zielgruppe", proposal.data?.targetGroup],
        ["Layout", proposal.data?.outputPreference?.layout]
      ],
      sections
    };
  }
  if (proposal?.kind === "content_mirror") {
    const readingTexts = proposal.data?.readingTexts || [];
    const tasks = proposal.data?.tasks || [];
    const imageMaterials = proposal.data?.imageMaterials || [];
    const brief = workspace.documents?.brief?.data || workspace.proposals?.latestLessonBrief?.data || {};
    const revisionOptions = conceptRevisionOptions(proposal.data || {}, workspace);
    return {
      title: proposal.data?.title || proposal.title || "Arbeitsblatt-Konzept",
      eyebrow: "Arbeitsblatt-Konzept",
      canvasMode: "content_proposal",
      summary: "Prüfe Rahmen, Blattaufbau, Aufgabenlogik, sichtbaren Inhalt und Bild/Layout.",
      rows: [
        ["Texte", readingTexts.length],
        ["Aufgaben", tasks.length],
        ["Bildmaterial", imageMaterials.length],
        ["Seiten", proposal.data?.pageCount || proposal.data?.outputPreference?.pages]
      ],
      sections: conceptSectionsFromContent(proposal.data || {}, {
        brief,
        project: workspace.project || {},
        teachingContext: workspace.teachingContext || {}
      }),
      revisionOptions
    };
  }
  if (proposal?.kind === "image_spec") {
    const spec = proposal.data || {};
    const policy = spec.referencePolicy || {};
    const references = spec.referenceImages || [];
    return {
      title: spec.purpose || proposal.title || "Kandidatenvorbereitung",
      eyebrow: "Kandidatenvorbereitung",
      canvasMode: "image_spec_proposal",
      summary: referencePolicySummary(policy),
      rows: [
        ["Visualisierung", spec.topic],
        ["Referenz", referencePolicyLabel(policy)],
        ["Vorhanden", references.length ? `${references.length} Referenz${references.length === 1 ? "" : "en"}` : "keine"]
      ],
      sections: [
        {
          title: "Warum",
          items: [policy.reason || "Keine besondere Referenzentscheidung nötig."]
        },
        {
          title: "Nächster Schritt",
          items: [policy.suggestedAction || "Direkt Kandidat erzeugen oder bei Bedarf eine Referenz im Chat anhängen."]
        }
      ]
    };
  }
  const content = workspace.documents?.content?.data || null;
  if (content) {
    const brief = workspace.documents?.brief?.data || {};
    return {
      title: content.title || workspace.project?.title || "Arbeitsblatt-Konzept",
      eyebrow: "Arbeitsblatt-Konzept",
      canvasMode: "content",
      summary: workspace.approval?.canGenerate ? "Freigegeben für Kandidaten." : "Als Entwurf angelegt.",
      rows: [
        ["Texte", content.readingTexts?.length],
        ["Aufgaben", content.tasks?.length],
        ["Bildmaterial", content.imageMaterials?.length],
        ["Status", statusWord(workspace.documents?.content?.status)]
      ],
      sections: conceptSectionsFromContent(content, {
        brief,
        project: workspace.project || {},
        teachingContext: workspace.teachingContext || {}
      })
    };
  }
  const brief = workspace.documents?.brief?.data || null;
  if (brief) {
    const sections = conceptSectionsFromContent({}, {
      brief,
      project: workspace.project || {},
      teachingContext: workspace.teachingContext || {}
    });
    return {
      title: brief.topic || workspace.project?.title || "Planungsstand",
      eyebrow: "Planungsstand",
      canvasMode: "brief",
      summary: "Rahmen steht. Der konkrete Blattaufbau fehlt noch.",
      rows: [
        ["Fach", brief.subject],
        ["Zielgruppe", brief.targetGroup],
        ["Status", statusWord(workspace.documents?.brief?.status)]
      ],
      sections
    };
  }
  return null;
}

function wordCount(value) {
  return String(value || "").split(/\s+/).map((word) => word.trim()).filter(Boolean).length;
}

function conceptRevisionOptions(content = {}, workspace = {}) {
  const brief = workspace.documents?.brief?.data || {};
  const targetText = normalizeGermanDisplayText([
    brief.targetGroup,
    workspace.teachingContext?.fields?.targetGroup?.value,
    workspace.project?.title,
    content.title
  ].filter(Boolean).join(" ")).toLowerCase();
  const readingTexts = Array.isArray(content.readingTexts) ? content.readingTexts : [];
  const tasks = Array.isArray(content.tasks) ? content.tasks : [];
  const imageMaterials = Array.isArray(content.imageMaterials) ? content.imageMaterials : [];
  const totalWords = readingTexts.reduce((sum, text) => sum + wordCount(text.body), 0);
  const isEarlyReader = /klasse\s*1|erstklass|leseanf|anfänger|grundschule/.test(targetText);
  const isOlderGroup = /klasse\s*(7|8|9|10|11|12|13)|sek/.test(targetText);
  const options = [];

  if (isEarlyReader || totalWords > 90) {
    options.push({
      label: "Noch einfacher",
      message: "Bitte überarbeite das Konzept: Text kürzer, Sprache noch einfacher, größere Abstände und Aufgaben noch leichter zugänglich. Thema und Unterrichtsziel bleiben gleich."
    });
  } else if (isOlderGroup) {
    options.push({
      label: "Anspruch schärfen",
      message: "Bitte überarbeite das Konzept: fachlich etwas anspruchsvoller, Aufgaben klarer auf Verstehen und Begründen ausrichten, ohne das Blatt zu überladen."
    });
  } else {
    options.push({
      label: "Text fokussieren",
      message: "Bitte überarbeite das Konzept: Text noch stärker auf das Unterrichtsziel fokussieren und alles streichen, was für die Aufgabe nicht nötig ist."
    });
  }

  if (tasks.length >= 4) {
    options.push({
      label: "Weniger Aufgaben",
      message: "Bitte überarbeite das Konzept: weniger Aufgaben, dafür klarere Bearbeitungsschritte und mehr Platz zum Arbeiten."
    });
  } else {
    options.push({
      label: "Mehr Übung",
      message: "Bitte überarbeite das Konzept: eine zusätzliche kleine Übung einbauen, die zum Unterrichtsziel passt und nicht zu viel Platz braucht."
    });
  }

  if (imageMaterials.length > 1) {
    options.push({
      label: "Bild ruhiger",
      message: "Bitte überarbeite das Konzept: Bildidee ruhiger und klarer machen, weniger visuelle Ablenkung, aber die wichtigste Information weiterhin gut sichtbar."
    });
  } else {
    options.push({
      label: "Bild stärker nutzen",
      message: "Bitte überarbeite das Konzept: Bildidee didaktisch stärker einbinden, sodass das Bild beim Bearbeiten der Aufgaben wirklich hilft."
    });
  }

  return options.slice(0, 3);
}

function renderConceptChatCard(message = {}, workspace = {}) {
  const preview = conceptPreviewFromMessage(message, workspace);
  if (!preview) {
    return "";
  }
  return `
    <article class="chat-result-card concept-chat-card">
      <div class="chat-result-card-header">
        <span>${escapeHtml(preview.eyebrow)}</span>
        <button class="secondary-button mini-button" type="button" data-canvas-mode="${escapeHtml(preview.canvasMode || "content")}">Im Canvas öffnen</button>
      </div>
      <h3>${escapeHtml(preview.title)}</h3>
      ${preview.summary ? `<p>${escapeHtml(preview.summary)}</p>` : ""}
      <div class="chat-result-meta-grid">
        ${(preview.rows || []).filter(([, value]) => value !== undefined && value !== null && value !== "").map(([label, value]) => `
          <div><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>
        `).join("")}
      </div>
      ${(preview.sections || []).length ? `
        ${renderConceptSections(preview.sections, { compact: true })}
      ` : (preview.bullets || []).length ? `<ul>${preview.bullets.slice(0, 3).map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>` : ""}
      ${(preview.revisionOptions || []).length ? `
        <div class="concept-revision-options" aria-label="Überarbeitungsideen">
          <p>Wenn du noch unsicher bist:</p>
          <div>
            ${preview.revisionOptions.map((option) => `
              <button class="secondary-button mini-button" type="button" data-chat-message="${escapeHtml(option.message)}">${escapeHtml(option.label)}</button>
            `).join("")}
          </div>
        </div>
      ` : ""}
    </article>
  `;
}

function renderProductionCard(message = {}, workspace = {}) {
  const card = message.productionCard || null;
  if (card?.kind === "command_pending") {
    return renderPendingProductionCard(card);
  }
  if (card?.kind === "candidate") {
    return renderCandidateChatCard(card, workspace);
  }
  if (card?.kind === "concept" || message.proposal?.kind === "lessonbrief" || message.proposal?.kind === "content_mirror" || message.proposal?.kind === "image_spec") {
    return renderConceptChatCard(message, workspace);
  }
  return "";
}

const hiddenLegacyCommandIds = new Set(["select_candidate", "prepare_export"]);

function isVisibleSuggestedAction(action = {}) {
  return !hiddenLegacyCommandIds.has(action.command || action.id);
}

function renderMessageCopy(message) {
  const content = message.content || "";
  if (!message.streaming) {
    return markdownToHtml(content);
  }
  return streamingMarkdownToHtml(content, message.streamRevealStart || 0, true);
}

function currentSuggestedActionButtons(actionEntries = [], workspace = {}) {
  return actionEntries
    .filter(({ action }) => isVisibleSuggestedAction(action))
    .filter((entry) => entry.current)
    .flatMap(({ action }) => {
      const commandId = action.command || action.id;
      const command = (workspace.commands || []).find((entry) => entry.id === commandId) || null;
      if (commandId === "generate_image_candidate" && command?.enabled) {
        return decisionButtons({
          ...command,
          defaultPayload: {
            ...(command.defaultPayload || {}),
            ...(action.payload || {})
          }
        });
      }
      return [{
        id: commandId,
        label: action.label || decisionButtonLabel({ id: commandId }),
        payload: action.payload || {}
      }];
    });
}

function renderChatMessage(message, visibleCommandIds = new Set(), extraCommands = [], workspace = {}, isActionHost = false) {
  if (message.pending && message.role !== "user" && !message.productionCard) {
    return renderThinkingMessage();
  }
  const role = message.role === "user" ? "user" : "assistant";
  const actionEntries = (message.suggestedActions || []).map((action) => ({
    action,
    ...actionState(action, workspace, isActionHost, visibleCommandIds)
  })).filter(({ action }) => isVisibleSuggestedAction(action));
  const suggestedActions = currentSuggestedActionButtons(actionEntries, workspace);
  const staleActions = actionEntries.filter((entry) => !entry.current);
  const extraActions = extraCommands.flatMap((command) => decisionButtons(command));
  const actions = suggestedActions.length ? suggestedActions : (actionEntries.length ? [] : extraActions);
  const stateClass = message.pending ? " pending" : message.failed ? " failed" : message.streaming ? " streaming" : "";
  const commandClass = message.productionCard?.kind === "command_pending" ? " command-pending" : "";
  const metaSuffix = message.pending
    ? message.productionCard?.kind === "command_pending" ? " · läuft" : " · wird gesendet"
    : message.streaming
      ? " · schreibt"
      : message.failed
        ? " · nicht gesendet"
        : message.createdAt ? ` · ${escapeHtml(timeOnly(message.createdAt))}` : "";
  const copyHtml = message.content || message.streaming || message.failed
    ? `<div class="message-copy">${renderMessageCopy(message)}</div>`
    : "";
  return `
    <div class="chat-message ${role}${stateClass}${commandClass}">
      ${role === "assistant" ? '<div class="assistant-avatar">AI</div>' : ""}
      <div class="message-bubble">
        <div class="message-meta">${role === "user" ? "Ich" : "SheetifyIMG AI"}${metaSuffix}</div>
        ${copyHtml}
        ${renderChatAttachments(message.attachments || [])}
        ${renderProductionCard(message, workspace)}
        ${message.streaming ? "" : renderActionButtons(actions)}
        ${message.streaming ? "" : renderActionHistory(staleActions)}
      </div>
    </div>
  `;
}

function renderThinkingMessage() {
  return `
    <div class="chat-message assistant thinking">
      <div class="assistant-avatar">AI</div>
      <div class="message-bubble">
        <div class="message-meta">SheetifyIMG AI</div>
        <p class="thinking-line"><span></span><span></span><span></span><em>Antwort wird vorbereitet</em></p>
      </div>
    </div>
  `;
}

function clearChatStreamTimer() {
  if (state.chatStreamTimer) {
    window.clearTimeout(state.chatStreamTimer);
    state.chatStreamTimer = null;
  }
}

function nextStreamSlice(text, index) {
  const remaining = text.length - index;
  if (remaining <= 0) {
    return text.length;
  }
  const base = remaining > 520 ? 22 : remaining > 240 ? 16 : 10;
  const nextWhitespace = text.slice(index + base).search(/\s/);
  if (nextWhitespace >= 0 && nextWhitespace <= 18) {
    return Math.min(text.length, index + base + nextWhitespace + 1);
  }
  return Math.min(text.length, index + base);
}

function streamAssistantResponse({ pendingChat, response, responseWorkspace }) {
  const fullText = response?.content || "";
  if (!fullText) {
    state.pendingChat = null;
    state.workspace = responseWorkspace;
    renderWorkspace();
    return;
  }

  clearChatStreamTimer();
  let index = 0;
  state.pendingChat = {
    ...pendingChat,
    status: "streaming",
    assistantText: "",
    streamRevealStart: 0
  };
  renderWorkspace();

  const tick = () => {
    const previousIndex = index;
    index = nextStreamSlice(fullText, index);
    state.pendingChat = {
      ...pendingChat,
      status: "streaming",
      assistantText: fullText.slice(0, index),
      streamRevealStart: previousIndex
    };
    renderWorkspace();

    if (index >= fullText.length) {
      clearChatStreamTimer();
      window.setTimeout(() => {
        state.pendingChat = null;
        state.workspace = responseWorkspace;
        renderWorkspace();
      }, 140);
      return;
    }

    const lastCharacter = fullText[index - 1] || "";
    const delay = lastCharacter === "\n" ? 90 : /[.!?]/.test(lastCharacter) ? 78 : 34;
    state.chatStreamTimer = window.setTimeout(tick, delay);
  };

  state.chatStreamTimer = window.setTimeout(tick, 160);
}

function latestAssistantAlreadyOffers(workspace, commands) {
  const latestAssistant = [...(workspace.chat?.messages || [])].reverse()
    .find((message) => message.role !== "user");
  const offered = new Set((latestAssistant?.suggestedActions || [])
    .filter(isVisibleSuggestedAction)
    .map((action) => action.command));
  return commands.some((command) => offered.has(command.id));
}

function latestAssistantIsWaiting(workspace) {
  const latestAssistant = [...(workspace.chat?.messages || [])].reverse()
    .find((message) => message.role !== "user");
  const content = normalizeGermanDisplayText(latestAssistant?.content || "").toLowerCase();
  const waitsForCorrection = /\b(ich warte|warte|schick.*änderung|schick.*aenderung|wenn du fertig|korrigier)/i.test(content);
  const requestsConceptWork = /\b(konzept|arbeitsblatt-konzept)\b[\s\S]{0,120}\b(überarbeiten|ueberarbeiten|aktualisieren|korrigieren|anpassen)\b/i.test(content)
    || /\b(überarbeiten|ueberarbeiten|aktualisieren|korrigieren|anpassen)\b[\s\S]{0,120}\b(konzept|arbeitsblatt-konzept)\b/i.test(content);
  return waitsForCorrection || requestsConceptWork;
}

function decisionButtons(command) {
  if (command.id === "prepare_export") {
    return [
      {
        id: command.id,
        label: "PDF ohne Lösungsblatt",
        payload: commandPayload(command)
      },
      {
        id: command.id,
        label: "PDF mit Lösungsblatt",
        payload: { ...commandPayload(command), includeSolutionSheet: true }
      }
    ];
  }
  if (command.id === "generate_image_candidate") {
    return [{
      id: command.id,
      label: decisionButtonLabel(command),
      payload: withConfiguredImageProvider(command, commandPayload(command))
    }];
  }
  return [{
    id: command.id,
    label: decisionButtonLabel(command),
    payload: commandPayload(command)
  }];
}

function decisionPrompt(command) {
  if (command.id === "generate_image_candidate" && /kandidatenreihe/i.test(command.label || "")) {
    return "Soll ich eine weitere Kandidatenreihe mit allen geplanten Seiten erzeugen?";
  }
  if (command.id === "generate_image_candidate" && /variante/i.test(command.label || "")) {
    return "Soll ich eine weitere Bildvariante mit demselben freigegebenen Konzept erzeugen?";
  }
  if (command.id === "generate_content_mirror_proposal" && /überarbeiten|ueberarbeiten|aktualisieren/i.test(command.label || "")) {
    return "Soll ich das Arbeitsblatt-Konzept mit deiner Änderung überarbeiten?";
  }
  if (command.id === "adopt_content_mirror_proposal" && /aktualisieren/i.test(command.label || "")) {
    return "Die Konzept-Aktualisierung liegt vor. Soll ich sie übernehmen? Danach erzeugst du den nächsten Kandidaten auf dieser neuen Grundlage.";
  }
  const prompts = {
    generate_lessonbrief_proposal: "Ich kann daraus ein vollständiges Arbeitsblatt-Konzept mit Text, Aufgaben und Bildidee schreiben. Soll ich das machen?",
    create_brief_draft: "Ich kann daraus direkt ein erstes Arbeitsblatt-Konzept anlegen. Soll ich das machen?",
    adopt_lessonbrief_proposal: "Der Konzept-Vorschlag liegt vor. Soll ich ihn übernehmen?",
    generate_content_mirror_proposal: "Soll ich daraus das vollständige Arbeitsblatt-Konzept ausformulieren?",
    create_content_draft: "Soll ich daraus direkt die Aufgabenstruktur und Materialseite anlegen?",
    adopt_content_mirror_proposal: "Das Arbeitsblatt-Konzept liegt vor. Wenn es passt, übernehme ich es als Grundlage für Kandidaten.",
    generate_candidate_from_content_proposal: "Wenn das Konzept passt, kann ich direkt einen Kandidaten erzeugen. Dafür kommt vorher die Kostenbestätigung.",
    adopt_content_warnings_proposal: "Die Prüfhinweise sind vorbereitet. Soll ich sie übernehmen?",
    approve_current_content: "Das Arbeitsblatt-Konzept wirkt bereit. Soll ich es als Grundlage für Kandidaten freigeben?",
    prepare_image_spec: "Ich kann kurz prüfen, ob die geplante Visualisierung eine Referenz oder Vorlage braucht. Soll ich das vorbereiten?",
    prepare_reference_asset: "Für diese Visualisierung kann ich jetzt die passende Referenz oder Vorlage vorbereiten. Soll ich das machen?",
    prepare_web_reference_asset: "Hier ist eine Webreferenz sinnvoll. Soll ich eine passende offene Bildreferenz suchen und für die Generierung anhängen?",
    adopt_image_spec: "Die Kandidatenvorbereitung liegt vor. Soll ich sie für die Bildgenerierung übernehmen?",
    generate_image_candidate: "Soll ich jetzt einen Kandidaten erzeugen?",
    select_candidate: "Ein Kandidat liegt vor. Soll ich ihn als Auswahl übernehmen?",
    prepare_export: "Soll ich daraus jetzt das PDF erstellen?",
    prepare_series_export: "Soll ich daraus jetzt das Reihen-PDF erstellen?"
  };
  return prompts[command.id] || "Soll ich mit dem nächsten Schritt weitermachen?";
}

function decisionButtonLabel(command) {
  if (command.id === "generate_image_candidate" && /kandidatenreihe/i.test(command.label || "")) {
    return /weitere/i.test(command.label || "") ? "Weitere Kandidatenreihe" : "Kandidatenreihe erzeugen";
  }
  if (command.id === "generate_image_candidate" && /variante/i.test(command.label || "")) {
    return "Weitere Variante erzeugen";
  }
  if (command.id === "generate_content_mirror_proposal" && /überarbeiten|ueberarbeiten|aktualisieren/i.test(command.label || "")) {
    return "Konzept überarbeiten";
  }
  if (command.id === "adopt_content_mirror_proposal" && /aktualisieren/i.test(command.label || "")) {
    return "Konzept aktualisieren";
  }
  const labels = {
    generate_lessonbrief_proposal: "Ja, Konzept schreiben",
    create_brief_draft: "Ja, direkt anlegen",
    adopt_lessonbrief_proposal: "Ja, übernehmen",
    generate_content_mirror_proposal: "Ja, Konzept ausformulieren",
    create_content_draft: "Ja, direkt anlegen",
    adopt_content_mirror_proposal: "Ja, Konzept passt",
    generate_candidate_from_content_proposal: "Kandidat erzeugen",
    adopt_content_warnings_proposal: "Ja, übernehmen",
    approve_current_content: "Ja, freigeben",
    prepare_image_spec: "Visualisierung prüfen",
    prepare_reference_asset: "Referenz/Vorlage vorbereiten",
    prepare_web_reference_asset: "Webreferenz suchen",
    adopt_image_spec: "Vorbereitung passt",
    generate_image_candidate: "Ja, Kandidat erzeugen",
    select_candidate: "Ja, als Auswahl übernehmen",
    prepare_export: "Ja, PDF erstellen",
    prepare_series_export: "Ja, Reihen-PDF erstellen"
  };
  return labels[command.id] || command.label;
}

function timeOnly(value) {
  const match = String(value).match(/T(\d{2}:\d{2})/);
  return match?.[1] || "";
}

function workspaceCards(workspace) {
  const proposalCards = proposalWorkspaceCards(workspace);
  if (workspace.project.projectType === "series") {
    return [...proposalCards, {
      title: "Reihe",
      subtitle: `${workspace.series?.worksheets?.length || 0} Arbeitsblaetter`,
      tag: "SERIE",
      mode: "series",
      actions: visibleCommands(workspace)
    }];
  }
  const docs = workspace.documents || {};
  const cards = [...proposalCards];
  if (cards.length) {
    return [cards[0]];
  }
  if (docs.content?.data) {
    const taskCount = docs.content.data.tasks?.length || 0;
    const materialCount = docs.content.data.imageMaterials?.length || 0;
    cards.push({
      title: `Arbeitsblatt-Konzept - ${statusWord(docs.content.status)}`,
      subtitle: `${taskCount} Aufgaben · ${materialCount} Bildmaterialien`,
      tag: "AB",
      mode: "content",
      actions: commandActions(workspace, ["approve_current_content"])
    });
  } else if (docs.brief?.data) {
    cards.push({
      title: `Arbeitsblatt-Konzept - ${statusWord(docs.brief.status)}`,
      subtitle: docs.brief.data.goal || docs.brief.data.topic || "Konzept vorhanden",
      tag: "AB",
      mode: "brief",
      actions: commandActions(workspace, ["approve_current_brief"])
    });
  }
  if (workspace.latestRun?.candidateCount || workspace.latestRun?.selectedPageCount || workspace.preview?.pages?.length) {
    const foundation = workspaceConceptLabel(workspace);
    const pdfCount = countPreviewCandidatePdfs(workspace.preview);
    return [{
      title: "Kandidaten",
      subtitle: [
        `${workspace.latestRun.candidateCount || 0} Kandidaten`,
        pdfCount ? `${pdfCount} PDF${pdfCount === 1 ? "" : "s"}` : null,
        foundation
      ].filter(Boolean).join(" · "),
      tag: "KAN",
      mode: "candidates",
      actions: []
    }];
  }
  return cards;
}

function proposalWorkspaceCards(workspace) {
  const proposals = workspace.proposals || {};
  const cards = [];
  const hasBrief = Boolean(workspace.documents?.brief?.data);
  const hasContent = Boolean(workspace.documents?.content?.data);
  const hasSelectionOrExport = Boolean(
    workspace.latestRun?.selectedPageCount
      || workspace.preview?.pages?.length
      || workspace.workspaceEntry?.availability?.hasExport
      || workspace.preview?.pdfs?.length
  );
  if (proposals.latestLessonBrief && !hasBrief && !hasContent && !hasSelectionOrExport) {
    cards.push({
      title: "Konzept-Vorschlag",
      subtitle: proposals.latestLessonBrief.summary || proposals.latestLessonBrief.title,
      tag: "AI",
      mode: "lessonbrief_proposal",
      actions: commandActions(workspace, ["adopt_lessonbrief_proposal"])
    });
  }
  if (proposals.latestContentMirror && !hasContent && !hasSelectionOrExport) {
    cards.push({
      title: "Konzept-Vorschlag",
      subtitle: proposals.latestContentMirror.summary || proposals.latestContentMirror.title,
      tag: "AI",
      mode: "content_proposal",
      actions: commandActions(workspace, ["adopt_content_mirror_proposal"])
    });
  }
  if (proposals.latestContentWarnings) {
    cards.push({
      title: "Prüfvorschlag",
      subtitle: proposals.latestContentWarnings.summary || proposals.latestContentWarnings.title,
      tag: "AI",
      mode: "warnings_proposal",
      actions: commandActions(workspace, ["adopt_content_warnings_proposal"])
    });
  }
  return cards;
}

function commandActions(workspace, ids) {
  return ids.map((id) => (workspace.commands || []).find((command) => command.id === id)).filter(Boolean);
}

function renderTimelineCard(card) {
  return `
    <article class="timeline-card">
      <div class="timeline-card-header">
        <div>
          <h3>${escapeHtml(card.title)}</h3>
          <p>${escapeHtml(card.subtitle)}</p>
        </div>
        <span>${escapeHtml(card.tag)}</span>
      </div>
      <div class="timeline-card-actions">
        <button class="secondary-button mini-button" type="button" data-canvas-mode="${escapeHtml(card.mode)}">Öffnen</button>
      </div>
    </article>
  `;
}

function mobileSheetCommand(workspace = {}, ids = []) {
  return ids.map((id) => (workspace.commands || []).find((command) => command.id === id && command.enabled)).find(Boolean) || null;
}

function mobileCommandButton(command, label = null, primary = false) {
  if (!command) {
    return "";
  }
  return `
    <button class="${primary ? "primary-button" : "secondary-button"} mobile-footer-button" type="button" data-command="${escapeHtml(command.id)}" data-payload="${escapeHtml(JSON.stringify(commandPayload(command)))}">
      ${escapeHtml(label || decisionButtonLabel(command) || command.label)}
    </button>
  `;
}

function mobileFocusChatButton(label = "Konzept ändern") {
  return `<button class="secondary-button mobile-footer-button" type="button" data-mobile-focus-chat>${escapeHtml(label)}</button>`;
}

function mobileMinimizeButton(label = "Kleinmachen") {
  return `<button class="secondary-button mobile-footer-button" type="button" data-mobile-minimize>${escapeHtml(label)}</button>`;
}

function mobileCloseButton(label = "Schließen") {
  return `<button class="secondary-button mobile-footer-button" type="button" data-mobile-close>${escapeHtml(label)}</button>`;
}

function mobileFullscreenButton(mode, label = "Vollbild") {
  return `
    <button class="secondary-button mobile-footer-button" type="button" data-mobile-open-preview="${escapeHtml(mode)}" data-mobile-presentation="fullscreen">
      ${escapeHtml(label)}
    </button>
  `;
}

function libraryWorkspaceFromItem(item = {}) {
  const derived = item.project?.derivedStatus || {};
  const latestRun = Array.isArray(derived.runs) ? derived.runs[derived.runs.length - 1] : null;
  const preview = item.preview || {};
  return {
    project: item.project || {},
    documents: item.documents || {},
    proposals: item.proposals || {},
    preview,
    teachingContext: item.teachingContext || {},
    approval: {
      canGenerate: Boolean(derived.hasEffectiveApprovedContent || item.documents?.content?.status === "approved")
    },
    latestRun: {
      candidateCount: latestRun?.candidateCount || countPreviewCandidates(preview),
      renderedCandidateCount: latestRun?.renderedCandidateCount || preview.previewMeta?.renderedCandidateCount || countPreviewCandidates(preview),
      selectedPageCount: latestRun?.selectedPageCount || preview.pages?.length || 0
    },
    workspaceEntry: {
      availability: {
        hasExport: Boolean(derived.hasExport || preview.pdfs?.length)
      }
    },
    commands: []
  };
}

function currentMobilePreviewContext() {
  if (state.mobilePreview.source === "library") {
    return state.selectedItem ? libraryWorkspaceFromItem(state.selectedItem) : null;
  }
  return state.workspace || null;
}

function isMobilePreviewFullscreen() {
  return state.mobilePreview.presentation === "fullscreen";
}

function openMobilePreviewMode(mode, presentation = "sheet") {
  openMobilePreview(mode, {
    source: state.mobilePreview.source || (state.workspace ? "workspace" : "library"),
    presentation
  });
}

function mobilePreviewStatusLabel(workspace = {}, mode = "") {
  if (mode === "candidates") {
    const count = workspace.preview?.candidates?.length || workspace.latestRun?.candidateCount || 0;
    return count ? `${count} Kandidaten` : "Noch keine Kandidaten";
  }
  if (mode === "selection") {
    return mobilePreviewStatusLabel(workspace, "candidates");
  }
  if (mode === "export") {
    return mobilePreviewStatusLabel(workspace, "candidates");
  }
  return workspace.approval?.canGenerate ? "Bereit für Kandidaten" : "In Arbeit";
}

function mobileConceptData(workspace = {}, mode = "") {
  if (mode === "lessonbrief_proposal") {
    return {
      brief: workspace.proposals?.latestLessonBrief?.data || {},
      content: {},
      status: "Rahmen prüfen"
    };
  }
  if (mode === "content_proposal") {
    return {
      brief: workspace.documents?.brief?.data || workspace.proposals?.latestLessonBrief?.data || {},
      content: workspace.proposals?.latestContentMirror?.data || {},
      status: "Konzept prüfen"
    };
  }
  if (mode === "brief") {
    return {
      brief: workspace.documents?.brief?.data || {},
      content: {},
      status: "Rahmen steht"
    };
  }
  return {
    brief: workspace.documents?.brief?.data || {},
    content: workspace.documents?.content?.data || {},
    status: mobilePreviewStatusLabel(workspace, mode)
  };
}

function renderMobileConceptBody(workspace = {}, mode = "") {
  const concept = mobileConceptData(workspace, mode);
  const sections = conceptSectionsFromContent(concept.content, {
    brief: concept.brief,
    project: workspace.project || {},
    teachingContext: workspace.teachingContext || {}
  });
  return `
    <div class="mobile-ready-strip ${workspace.approval?.canGenerate ? "done" : ""}">
      <span>${renderIcon(workspace.approval?.canGenerate ? "check" : "circle", "mobile-ready-icon")}</span>
      <strong>${escapeHtml(concept.status)}</strong>
    </div>
    ${renderConceptSections(sections, { compact: false })}
  `;
}

function renderMobileConceptFooter(workspace = {}, mode = "") {
  const primary = mobileSheetCommand(workspace, [
    "adopt_content_mirror_proposal",
    "adopt_lessonbrief_proposal",
    "approve_current_content",
    "generate_image_candidate",
    "generate_content_mirror_proposal"
  ]);
  const primaryLabel = primary?.id === "generate_image_candidate"
    ? "Kandidaten erstellen"
    : primary?.id === "approve_current_content"
      ? "Freigeben"
      : primary ? null : "";
  return `
    ${mobileCommandButton(primary, primaryLabel, true)}
    ${mobileFocusChatButton(mode === "brief" || mode === "lessonbrief_proposal" ? "Rahmen ändern" : "Konzept ändern")}
    ${mobileMinimizeButton()}
  `;
}

function firstCandidatePage(candidate = {}) {
  return (candidate.pages || []).find((page) => page.url) || null;
}

function renderMobileCandidateRow(candidate = {}, index = 0, options = {}) {
  const page = firstCandidatePage(candidate);
  const pages = (candidate.pages || []).filter((entry) => entry.url);
  const pageCount = pages.length || Number(candidate.generation?.pageCount || 0) || 1;
  const foundation = conceptLabel(candidate.concept || candidate);
  const pdf = candidate.pdf?.url ? candidate.pdf : null;
  if (!page) {
    return `
      <article class="mobile-preview-row">
        <div class="mobile-preview-thumb missing-preview">?</div>
        <div class="mobile-preview-row-copy">
          <strong>${escapeHtml(candidate.id || `Kandidat ${index + 1}`)}</strong>
          <small>Keine Vorschau vorhanden</small>
        </div>
      </article>
    `;
  }
  return `
    <article
      class="mobile-preview-row mobile-candidate-row"
      data-open-url="${escapeHtml(page.url)}"
      data-capture-kind="candidate"
      data-run-id="${escapeHtml(candidate.runId || "")}"
      data-candidate-id="${escapeHtml(candidate.id || "")}"
      data-page="${escapeHtml(page.page || 1)}"
      data-page-role="${escapeHtml(page.role || "worksheet")}"
      data-source-path="${escapeHtml(page.path || "")}"
      data-source-url="${escapeHtml(page.url)}"
    >
      <img class="mobile-preview-thumb" data-capture-image src="${escapeHtml(page.url)}" alt="${escapeHtml(candidate.id || `Kandidat ${index + 1}`)}" loading="lazy">
      <div class="mobile-preview-row-copy">
        <strong>${escapeHtml(candidate.id || `Kandidat ${index + 1}`)}</strong>
        <small>${escapeHtml([`${pageCount} Seite${pageCount === 1 ? "" : "n"}`, foundation].filter(Boolean).join(" · "))}</small>
        <div class="mobile-preview-row-actions">
          ${pdf ? `<button class="primary-button mini-button" type="button" data-card-action="download-candidate-pdf" data-download-url="${escapeHtml(pdf.url)}" data-download-name="${escapeHtml(fileName(pdf.path || pdf.url))}">PDF</button>` : ""}
          <button class="secondary-button mini-button" type="button" data-mobile-open-candidate>Vorschau</button>
          <button class="secondary-button mini-button icon-mini-button" type="button" data-card-action="candidate-info" data-candidate-id="${escapeHtml(candidate.id || "")}" data-run-id="${escapeHtml(candidate.runId || "")}" aria-label="Info">i</button>
        </div>
      </div>
    </article>
  `;
}

function renderMobileCandidatesBody(workspace = {}, options = {}) {
  const candidates = workspace.preview?.candidates || [];
  if (!candidates.length) {
    return '<div class="mobile-empty-state">Noch keine Kandidaten vorhanden.</div>';
  }
  return `<div class="mobile-preview-list">${candidates.map((candidate, index) => renderMobileCandidateRow(candidate, index, options)).join("")}</div>`;
}

function renderMobileImageRow(page = {}, index = 0, label = "Seite") {
  if (!page.url) {
    return "";
  }
  const meta = [page.role || "Arbeitsblatt", page.sourceCandidateId ? `aus ${page.sourceCandidateId}` : null].filter(Boolean).join(" · ");
  return `
    <article class="mobile-preview-row" data-open-url="${escapeHtml(page.url)}">
      <img class="mobile-preview-thumb" src="${escapeHtml(page.url)}" alt="${escapeHtml(`${label} ${page.page || index + 1}`)}" loading="lazy">
      <div class="mobile-preview-row-copy">
        <strong>${escapeHtml(`${label} ${page.page || index + 1}`)}</strong>
        <small>${escapeHtml(meta || "Vorschau")}</small>
        <div class="mobile-preview-row-actions">
          <button class="secondary-button mini-button" type="button" data-mobile-open-url="${escapeHtml(page.url)}">Öffnen</button>
        </div>
      </div>
    </article>
  `;
}

function renderMobileSelectionBody(workspace = {}) {
  const pages = workspace.preview?.pages || [];
  if (!pages.length) {
    return renderMobileCandidatesBody(workspace);
  }
  return `<div class="mobile-preview-list">${pages.map((page, index) => renderMobileImageRow(page, index, "Kandidat")).join("")}</div>`;
}

function renderMobileExportBody(workspace = {}) {
  const pdfs = workspace.preview?.pdfs || [];
  if (!pdfs.length) {
    return renderMobileSelectionBody(workspace);
  }
  return `<div class="mobile-preview-list">${pdfs.map((pdf) => `
    <article class="mobile-preview-row mobile-pdf-row" data-open-url="${escapeHtml(pdf.url)}">
      <div class="mobile-preview-thumb mobile-pdf-thumb">PDF</div>
      <div class="mobile-preview-row-copy">
        <strong>${escapeHtml(pdf.solutionSheet?.included ? "PDF mit Lösungsblatt" : "PDF")}</strong>
        <small>${escapeHtml([pdf.pageCount ? `${pdf.pageCount} Seite${pdf.pageCount === 1 ? "" : "n"}` : null, conceptLabel(pdf.concept)].filter(Boolean).join(" · ") || fileName(pdf.path))}</small>
        <div class="mobile-preview-row-actions">
          <button class="primary-button mini-button" type="button" data-mobile-open-url="${escapeHtml(pdf.url)}">Öffnen</button>
          <button class="secondary-button mini-button" type="button" data-mobile-download-url="${escapeHtml(pdf.url)}" data-mobile-download-name="${escapeHtml(fileName(pdf.path || pdf.url))}">Download</button>
        </div>
      </div>
    </article>
  `).join("")}</div>`;
}

function renderMobileInputBody(workspace = {}) {
  const source = workspace.documents?.source || {};
  const userMessages = (workspace.chat?.messages || []).filter((message) => message.role === "user" && String(message.content || "").trim());
  const files = sourceFilesFrom(source);
  const projectId = workspace.project?.projectId || projectIdFromItemId(state.selectedId);
  const fileRows = files.map((file, index) => {
    const displayName = fileName(file.path || file.url || `Datei ${index + 1}`);
    const openUrl = file.url || sourceFileUrl(projectId, file);
    return `
      <article class="mobile-preview-row">
        <div class="mobile-preview-thumb mobile-file-thumb">${escapeHtml(displayName.split(".").pop()?.toUpperCase() || "FILE")}</div>
        <div class="mobile-preview-row-copy">
          <strong>${escapeHtml(displayName)}</strong>
          <small>${escapeHtml(file.kind || "Input")}</small>
          ${openUrl ? `<div class="mobile-preview-row-actions"><button class="secondary-button mini-button" type="button" data-mobile-open-url="${escapeHtml(openUrl)}">Öffnen</button></div>` : ""}
        </div>
      </article>
    `;
  }).join("");
  const transferCard = String(source.transferCard || "").trim();
  const transferCardRow = transferCard
    ? `
      <article class="mobile-input-message">
        <span>Importierter Input</span>
        <p>${escapeHtml(transferCard)}</p>
      </article>
    `
    : "";
  const messageRows = userMessages.slice(-6).map((message, index) => `
    <article class="mobile-input-message">
      <span>Nachricht ${index + 1}</span>
      <p>${escapeHtml(message.content)}</p>
    </article>
  `).join("");
  return fileRows || transferCardRow || messageRows
    ? `<div class="mobile-preview-list">${fileRows}${transferCardRow}${messageRows}</div>`
    : '<div class="mobile-empty-state">Noch kein Input vorhanden.</div>';
}

function renderMobileContextBody(workspace = {}) {
  const context = workspace.teachingContext || {};
  return `
    <div class="mobile-ready-strip ${context.readiness?.conceptAllowed ? "done" : ""}">
      <span>${renderIcon(context.readiness?.conceptAllowed ? "check" : "circle", "mobile-ready-icon")}</span>
      <strong>${escapeHtml(teachingContextNote(context))}</strong>
    </div>
    <ul class="mobile-context-list">${teachingContextFieldRows(context)}</ul>
  `;
}

function mobileProjectStatusLabel(item = {}) {
  const rows = buildStatusRows(item);
  const active = rows.find((row) => row.tone === "active") || rows.find((row) => row.tone !== "done") || rows[rows.length - 1];
  if (!active) {
    return "Arbeitsblatt";
  }
  if (active.id === "candidates" && active.tone === "done") {
    return "Kandidaten bereit";
  }
  if (active.id === "export" && active.tone === "done") {
    return "Kandidaten bereit";
  }
  return `${active.title} · ${active.state}`;
}

function renderMobileProjectStepPills(item = {}) {
  return buildStatusRows(item).map((row) => {
    const mode = mobileProjectStepMode(row.id);
    return `
      <button class="mobile-project-step ${escapeHtml(row.tone)}" type="button" data-mobile-open-preview="${escapeHtml(mode)}" data-mobile-presentation="fullscreen">
        <span class="mobile-project-step-marker">${row.tone === "done" ? renderIcon("check", "mobile-step-icon") : row.number}</span>
        <span class="mobile-project-step-copy">
          <strong>${escapeHtml(row.title)}</strong>
          <small>${escapeHtml(mobileProjectStepMeta(item, row))}</small>
        </span>
        ${renderIcon("chevron-right", "mobile-project-step-arrow")}
      </button>
    `;
  }).join("");
}

function mobileProjectStepMode(stepId) {
  const modes = {
    input: "input",
    concept: "concept",
    candidates: "candidates"
  };
  return modes[stepId] || "project";
}

function mobileProjectStepMeta(item = {}, row = {}) {
  if (row.id === "concept") {
    return item.documents?.brief?.data || item.documents?.content?.data || item.proposals?.latestLessonBrief || item.proposals?.latestContentMirror
      ? "Rahmen · Aufbau · Logik"
      : row.state;
  }
  if (row.id === "candidates") {
    const count = countPreviewCandidates(item.preview) || item.project?.derivedStatus?.runs?.at?.(-1)?.candidateCount || 0;
    return count ? `${count} Kandidat${count === 1 ? "" : "en"}` : row.state;
  }
  return row.state;
}

function renderMobileProjectBody(workspace = {}) {
  const item = state.selectedItem;
  if (!item) {
    return '<div class="mobile-empty-state">Kein Arbeitsblatt ausgewählt.</div>';
  }
  return `
    <div class="mobile-project-summary">
      <div class="mobile-project-status-chip">${escapeHtml(mobileProjectStatusLabel(item))}</div>
      <div class="mobile-project-steps">${renderMobileProjectStepPills(item)}</div>
    </div>
  `;
}

function renderMobileProjectFooter(workspace = {}) {
  const projectId = workspace.project?.projectId || projectIdFromItemId(state.selectedId);
  return `
    <button class="primary-button mobile-footer-button" type="button" data-mobile-open-workspace="${escapeHtml(projectId || "")}">Bearbeiten</button>
  `;
}

function mobileSheetTitleForMode(workspace = {}, mode = "") {
  if (mode === "project") {
    return {
      eyebrow: "Arbeitsblatt",
      title: workspace.project?.title || state.selectedItem?.project?.title || "Arbeitsblatt",
      subtitle: state.selectedItem ? mobileProjectStatusLabel(state.selectedItem) : ""
    };
  }
  if (mode === "candidates") {
    return { eyebrow: "Vorschau", title: "Kandidaten", subtitle: mobilePreviewStatusLabel(workspace, mode) };
  }
  if (mode === "selection") {
    return { eyebrow: "Vorschau", title: "Kandidaten", subtitle: mobilePreviewStatusLabel(workspace, "candidates") };
  }
  if (mode === "export") {
    return { eyebrow: "Vorschau", title: "Kandidaten", subtitle: mobilePreviewStatusLabel(workspace, "candidates") };
  }
  if (mode === "input") {
    return { eyebrow: "Input", title: "Input", subtitle: inputArtifactMeta(workspace) };
  }
  if (mode === "context") {
    return { eyebrow: "Rahmen", title: "Unterrichtsrahmen", subtitle: workspace.teachingContext?.readiness?.conceptAllowed ? "bereit" : "wird geklärt" };
  }
  const concept = mobileConceptData(workspace, mode);
  return {
    eyebrow: mode.includes("proposal") ? "Konzept-Vorschlag" : "Arbeitsblatt-Konzept",
    title: "Arbeitsblatt-Konzept",
    subtitle: compactConceptText(worksheetConceptSubtitle(concept.brief, concept.content, workspace.teachingContext || {}), 72)
      || mobilePreviewStatusLabel(workspace, mode)
  };
}

function renderMobilePreviewFooter(workspace = {}, mode = "") {
  if (isMobilePreviewFullscreen()) {
    return state.mobilePreview.source === "library" && mode !== "project"
      ? `<button class="primary-button mobile-footer-button" type="button" data-mobile-open-workspace="${escapeHtml(workspace.project?.projectId || projectIdFromItemId(state.selectedId) || "")}">Bearbeiten</button>`
      : "";
  }
  if (mode === "project") {
    return renderMobileProjectFooter(workspace);
  }
  if (mode === "candidates") {
    const next = mobileSheetCommand(workspace, ["generate_image_candidate"]);
    const hasCandidates = Boolean(workspace.preview?.candidates?.length || workspace.latestRun?.candidateCount);
    return `${mobileCommandButton(next, hasCandidates ? "Weitere Variante" : "Kandidaten erstellen", true)}${mobileFullscreenButton("candidates", "Vollbild")}${mobileMinimizeButton()}${mobileCloseButton()}`;
  }
  if (mode === "selection") {
    return `${mobileFullscreenButton("candidates", "Vollbild")}${mobileMinimizeButton()}${mobileCloseButton()}`;
  }
  if (mode === "export") {
    const pdf = workspace.preview?.pdfs?.[0] || null;
    return `${pdf?.url ? `<button class="primary-button mobile-footer-button" type="button" data-mobile-open-url="${escapeHtml(pdf.url)}">PDF öffnen</button>` : ""}${mobileMinimizeButton()}${mobileCloseButton()}`;
  }
  if (mode === "input" || mode === "context") {
    return `${mobileMinimizeButton()}${mobileCloseButton()}`;
  }
  return `${renderMobileConceptFooter(workspace, mode)}${mobileFullscreenButton(mode, "Vollbild")}`;
}

function renderMobilePreviewBodyForMode(workspace = {}, mode = "") {
  if (mode === "project") {
    return renderMobileProjectBody(workspace);
  }
  if (mode === "candidates") {
    return renderMobileCandidatesBody(workspace);
  }
  if (mode === "selection") {
    return renderMobileSelectionBody(workspace);
  }
  if (mode === "export") {
    return renderMobileExportBody(workspace);
  }
  if (mode === "input") {
    return renderMobileInputBody(workspace);
  }
  if (mode === "context") {
    return renderMobileContextBody(workspace);
  }
  return renderMobileConceptBody(workspace, mode);
}

function openMobilePreview(mode, options = {}) {
  if (!elements.mobilePreviewLayer) {
    return;
  }
  const source = options.source || (state.workspace ? "workspace" : "library");
  const context = source === "library"
    ? state.selectedItem ? libraryWorkspaceFromItem(state.selectedItem) : null
    : state.workspace;
  if (!context) {
    return;
  }
  const nextMode = mode === "project" ? "project" : concreteMobileMode(mode, context);
  state.mobilePreview = {
    mode: nextMode,
    source,
    presentation: options.presentation || "sheet",
    minimized: false,
    lastFocusedElement: options.lastFocusedElement || document.activeElement
  };
  elements.mobilePreviewLayer.classList.remove("hidden", "is-minimized", "is-fullscreen");
  elements.mobilePreviewLayer.setAttribute("aria-hidden", "false");
  renderMobilePreview();
  window.setTimeout(() => elements.mobilePreviewCloseButton?.focus(), 0);
}

function renderMobilePreview() {
  const context = currentMobilePreviewContext();
  if (!elements.mobilePreviewLayer || !context || !state.mobilePreview.mode) {
    return;
  }
  const mode = state.mobilePreview.mode === "project"
    ? "project"
    : concreteMobileMode(state.mobilePreview.mode, context);
  state.mobilePreview.mode = mode;
  const copy = mobileSheetTitleForMode(context, mode);
  elements.mobilePreviewEyebrow.textContent = copy.eyebrow;
  elements.mobilePreviewTitle.textContent = copy.title;
  elements.mobilePreviewSubtitle.textContent = copy.subtitle || "";
  elements.mobilePreviewMiniLabel.textContent = copy.title;
  elements.mobilePreviewBody.innerHTML = renderMobilePreviewBodyForMode(context, mode);
  elements.mobilePreviewFooter.innerHTML = renderMobilePreviewFooter(context, mode);
  elements.mobilePreviewLayer.classList.toggle("is-minimized", Boolean(state.mobilePreview.minimized));
  elements.mobilePreviewLayer.classList.toggle("is-fullscreen", isMobilePreviewFullscreen());
  elements.mobilePreviewMini.classList.toggle("hidden", !state.mobilePreview.minimized);
  elements.mobilePreviewMinimizeButton?.classList.toggle("hidden", isMobilePreviewFullscreen());
  elements.mobilePreviewFooter?.classList.toggle("hidden", isMobilePreviewFullscreen() && !elements.mobilePreviewFooter.innerHTML.trim());
  bindMobilePreviewActions();
}

function minimizeMobilePreview() {
  if (!state.mobilePreview.mode || !elements.mobilePreviewLayer || isMobilePreviewFullscreen()) {
    return;
  }
  state.mobilePreview.minimized = true;
  elements.mobilePreviewLayer.classList.add("is-minimized");
  elements.mobilePreviewMini.classList.remove("hidden");
}

function restoreMobilePreview() {
  if (!state.mobilePreview.mode || !elements.mobilePreviewLayer) {
    return;
  }
  state.mobilePreview.minimized = false;
  elements.mobilePreviewLayer.classList.remove("is-minimized");
  elements.mobilePreviewMini.classList.add("hidden");
  renderMobilePreview();
}

function closeMobilePreview() {
  if (!elements.mobilePreviewLayer || elements.mobilePreviewLayer.classList.contains("hidden")) {
    return;
  }
  elements.mobilePreviewLayer.classList.add("hidden");
  elements.mobilePreviewLayer.classList.remove("is-minimized");
  elements.mobilePreviewLayer.setAttribute("aria-hidden", "true");
  elements.mobilePreviewBody.innerHTML = "";
  elements.mobilePreviewFooter.innerHTML = "";
  elements.mobilePreviewMini.classList.add("hidden");
  const lastFocusedElement = state.mobilePreview.lastFocusedElement;
  state.mobilePreview = {
    mode: null,
    source: "workspace",
    presentation: "sheet",
    minimized: false,
    lastFocusedElement: null
  };
  lastFocusedElement?.focus?.();
}

function bindMobilePreviewActions() {
  if (!elements.mobilePreviewLayer) {
    return;
  }
  elements.mobilePreviewLayer.querySelectorAll("[data-command]").forEach((button) => {
    button.addEventListener("click", () => executeCommand(button.dataset.command, parsePayload(button.dataset.payload)));
  });
  elements.mobilePreviewLayer.querySelectorAll("[data-mobile-focus-chat]").forEach((button) => {
    button.addEventListener("click", () => {
      minimizeMobilePreview();
      elements.chatInput?.focus();
    });
  });
  elements.mobilePreviewLayer.querySelectorAll("[data-mobile-minimize]").forEach((button) => {
    button.addEventListener("click", minimizeMobilePreview);
  });
  elements.mobilePreviewLayer.querySelectorAll("[data-mobile-close]").forEach((button) => {
    button.addEventListener("click", closeMobilePreview);
  });
  elements.mobilePreviewLayer.querySelectorAll("[data-mobile-open-preview]").forEach((button) => {
    button.addEventListener("click", () => {
      openMobilePreviewMode(button.dataset.mobileOpenPreview, button.dataset.mobilePresentation || "sheet");
    });
  });
  elements.mobilePreviewLayer.querySelectorAll("[data-mobile-open-workspace]").forEach((button) => {
    button.addEventListener("click", () => {
      const projectId = button.dataset.mobileOpenWorkspace || state.selectedItem?.project?.projectId || projectIdFromItemId(state.selectedId);
      if (!projectId) {
        return;
      }
      closeMobilePreview();
      openWorkspace(projectId);
    });
  });
  elements.mobilePreviewLayer.querySelectorAll("[data-mobile-open-url]").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.preventDefault();
      openUrl(button.dataset.mobileOpenUrl);
    });
  });
  elements.mobilePreviewLayer.querySelectorAll("[data-mobile-download-url]").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.preventDefault();
      downloadUrl(button.dataset.mobileDownloadUrl, button.dataset.mobileDownloadName);
    });
  });
  elements.mobilePreviewLayer.querySelectorAll("[data-mobile-open-candidate]").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      const row = button.closest("[data-capture-kind='candidate']");
      if (row) {
        openCandidateViewerFromCard(row, elements.mobilePreviewBody);
      }
    });
  });
  bindPreviewCardActions(elements.mobilePreviewBody);
}

function setCanvasMode(mode) {
  state.activeCanvasMode = mode || "content";
  renderWorkspace();
}

function canvasModeAfterCommand(commandId) {
  const modes = {
    generate_lessonbrief_proposal: "lessonbrief_proposal",
    adopt_lessonbrief_proposal: "brief",
    create_brief_draft: "brief",
    approve_current_brief: "brief",
    generate_content_mirror_proposal: "content_proposal",
    adopt_content_mirror_proposal: "content",
    create_content_draft: "content",
    approve_current_content: "content",
    generate_content_warnings_proposal: "warnings_proposal",
    adopt_content_warnings_proposal: "warnings",
    prepare_image_spec: "image_spec_proposal",
    prepare_reference_asset: "image_spec_proposal",
    prepare_web_reference_asset: "image_spec_proposal",
    adopt_image_spec: "image_spec_proposal",
    create_run: "candidates",
    generate_image_candidate: "candidates",
    select_candidate: "selection",
    prepare_export: "export",
    prepare_series_export: "export"
  };
  return modes[commandId] || null;
}

function shouldRevealCanvasAfterCommand(commandId) {
  return new Set([
    "generate_image_candidate",
    "select_candidate",
    "prepare_export",
    "prepare_series_export"
  ]).has(commandId);
}

function applyCommandNavigation(commandId, response = {}) {
  const mode = canvasModeAfterCommand(commandId);
  if (mode) {
    state.activeCanvasMode = mode;
  }
  if (commandId === "generate_image_candidate") {
    state.focusCandidateId = response.result?.candidate?.id || null;
  }
  if (shouldRevealCanvasAfterCommand(commandId) && state.canvasLayout.collapsed) {
    expandCanvas();
  }
}

function renderCanvas(workspace, mode) {
  const title = canvasLabels[mode] || "Canvas";
  elements.canvasTitle.textContent = title;
  const asset = firstCanvasAsset(workspace, mode);
  const canCapture = mode === "candidates" && Boolean((workspace.preview?.candidates || []).some((candidate) => {
    return (candidate.pages || []).some((page) => page.url);
  }));
  if (!canCapture && state.canvasCapture.active) {
    setCanvasCaptureActive(false);
  }
  if (elements.canvasCaptureButton) {
    elements.canvasCaptureButton.disabled = !canCapture;
    elements.canvasCaptureButton.title = canCapture ? "Ausschnitt markieren" : "Ausschnitt ist nur bei Kandidaten verfügbar";
  }
  elements.canvasDownloadButton.disabled = !asset?.url;
  elements.canvasDownloadButton.onclick = () => asset?.url && downloadUrl(asset.url, fileName(asset.path || asset.url));
  elements.canvasOpenButton.disabled = !asset?.url && !previewUrlForCanvas(workspace, mode);
  elements.canvasOpenButton.onclick = () => openUrl(asset?.url || previewUrlForCanvas(workspace, mode));

  if (mode === "assignment") {
    renderCanvasAssignment(workspace);
  } else if (mode === "brief") {
    renderCanvasBrief(workspace);
  } else if (mode === "content") {
    renderCanvasContent(workspace);
  } else if (mode === "warnings") {
    renderCanvasWarnings(workspace);
  } else if (mode === "candidates") {
    renderCanvasCandidates(workspace);
  } else if (mode === "selection") {
    renderCanvasCandidates(workspace);
  } else if (mode === "export") {
    renderCanvasExport(workspace);
  } else if (mode === "series") {
    renderCanvasSeries(workspace);
  } else if (mode === "lessonbrief_proposal" || mode === "content_proposal" || mode === "warnings_proposal" || mode === "image_spec_proposal") {
    renderCanvasProposal(workspace, mode);
  } else {
    elements.canvasBody.innerHTML = '<div class="no-preview">Keine Canvas-Ansicht verfuegbar.</div>';
  }
}

function firstCanvasAsset(workspace, mode) {
  if (mode === "export") {
    return workspace.preview?.pdfs?.[0] || null;
  }
  if (mode === "selection") {
    return workspace.preview?.pages?.[0] || null;
  }
  if (mode === "candidates") {
    for (const candidate of workspace.preview?.candidates || []) {
      const page = (candidate.pages || []).find((entry) => entry.url);
      if (page) {
        return page;
      }
    }
  }
  return null;
}

function previewUrlForCanvas(workspace, mode) {
  if (!["candidates", "selection", "export"].includes(mode)) {
    return null;
  }
  const step = mode === "selection" ? "selection" : mode === "export" ? "export" : "candidates";
  return `/preview.html?${new URLSearchParams({ project: workspace.project.projectId, step })}`;
}

function renderCanvasAssignment(workspace) {
  const source = workspace.documents?.source || {};
  const userMessages = (workspace.chat?.messages || []).filter((message) => message.role === "user" && String(message.content || "").trim());
  const hasSourceInput = Boolean(sourceFilesFrom(source).length || source.transferCard);
  if (!hasSourceInput && !userMessages.length) {
    elements.canvasBody.innerHTML = `
      <article class="canvas-document">
        <p class="detail-label">Start</p>
        <h3>${escapeHtml(workspace.project.title)}</h3>
        <p class="detail-muted">Noch kein Input vorhanden. Schreibe im Chat, was entstehen soll, oder lade Material dazu.</p>
      </article>
    `;
    return;
  }
  elements.canvasBody.innerHTML = `
    <article class="canvas-document">
      <p class="detail-label">Input</p>
      <h3>${escapeHtml(workspace.project.title)}</h3>
      ${renderSourceInputs({ source, projectId: workspace.project.projectId })}
      ${renderRawInputMessages(userMessages)}
    </article>
  `;
  bindPreviewCardActions(elements.canvasBody);
}

function renderCanvasBrief(workspace) {
  const brief = workspace.documents?.brief?.data || {};
  const sections = conceptSectionsFromContent({}, {
    brief,
    project: workspace.project || {},
    teachingContext: workspace.teachingContext || {}
  });
  elements.canvasBody.innerHTML = `
    <article class="canvas-document">
      <p class="detail-label">Arbeitsblatt-Konzept</p>
      <h3>${escapeHtml(worksheetConceptTitle(workspace.project || {}, brief, {}, workspace.teachingContext || {}))}</h3>
      <div class="detail-grid">
        <div><span>Fach</span><strong>${escapeHtml(brief.subject || "offen")}</strong></div>
        <div><span>Zielgruppe</span><strong>${escapeHtml(brief.targetGroup || "offen")}</strong></div>
        <div><span>Status</span><strong>${escapeHtml(statusWord(workspace.documents?.brief?.status))}</strong></div>
        <div><span>Layout</span><strong>${escapeHtml(brief.outputPreference?.layout || "auto")}</strong></div>
      </div>
      ${renderConceptSections(sections, { compact: false })}
    </article>
  `;
}

function renderCanvasContent(workspace) {
  const content = workspace.documents?.content?.data || {};
  const brief = workspace.documents?.brief?.data || {};
  const sections = conceptSectionsFromContent(content, {
    brief,
    project: workspace.project || {},
    teachingContext: workspace.teachingContext || {}
  });
  elements.canvasBody.innerHTML = `
    <article class="canvas-document">
      <p class="detail-label">Arbeitsblatt-Konzept</p>
      <h3>${escapeHtml(worksheetConceptTitle(workspace.project || {}, brief, content, workspace.teachingContext || {}))}</h3>
      <div class="detail-grid">
        <div><span>Status</span><strong>${escapeHtml(statusWord(workspace.documents?.content?.status))}</strong></div>
        <div><span>Generation</span><strong>${workspace.approval?.canGenerate ? "freigegeben" : "gesperrt"}</strong></div>
        <div><span>Texte</span><strong>${escapeHtml(content.readingTexts?.length || 0)}</strong></div>
        <div><span>Aufgaben</span><strong>${escapeHtml(content.tasks?.length || 0)}</strong></div>
        <div><span>Bildmaterial</span><strong>${escapeHtml(content.imageMaterials?.length || 0)}</strong></div>
      </div>
      ${renderConceptSections(sections, { compact: false })}
    </article>
  `;
}

function renderCanvasWarnings(workspace) {
  const warnings = workspace.documents?.warnings?.warnings || [];
  elements.canvasBody.innerHTML = `
    <article class="canvas-document">
      <p class="detail-label">Arbeitsblatt-Konzept</p>
      <h3>${warnings.length ? `${warnings.length} Hinweise` : "Keine aktiven Warnungen"}</h3>
      ${warnings.length ? `<ul>${warnings.map((warning) => `<li>${escapeHtml(warning.message || warning.category || "Warnung")}</li>`).join("")}</ul>` : '<p class="detail-muted">Die technischen und inhaltlichen Hinweise sind leer.</p>'}
    </article>
  `;
}

function renderCanvasCandidates(workspace) {
  const candidates = workspace.preview?.candidates || [];
  if (!candidates.length) {
    elements.canvasBody.innerHTML = '<div class="no-preview">Noch keine Kandidaten vorhanden.</div>';
    return;
  }
  elements.canvasBody.innerHTML = `
    <div class="canvas-candidate-grid">${candidates.map(renderCandidateCard).join("")}</div>
  `;
  bindPreviewCardActions(elements.canvasBody);
  focusNewCandidateCard();
}

function focusNewCandidateCard() {
  if (!state.focusCandidateId) {
    return;
  }
  const target = Array.from(elements.canvasBody.querySelectorAll("[data-candidate-id]"))
    .find((node) => node.dataset.candidateId === state.focusCandidateId);
  state.focusCandidateId = null;
  if (!target) {
    return;
  }
  target.classList.add("just-created");
  window.requestAnimationFrame(() => {
    target.scrollIntoView({ block: "center", inline: "nearest", behavior: "smooth" });
  });
  window.setTimeout(() => {
    target.classList.remove("just-created");
  }, 2200);
}

function renderCanvasPages(pages, emptyText) {
  elements.canvasBody.innerHTML = pages.length
    ? `<div class="canvas-page-stack">${pages.map(renderPageCard).join("")}</div>`
    : `<div class="no-preview">${escapeHtml(emptyText)}</div>`;
  bindPreviewCardActions(elements.canvasBody);
}

function renderCanvasExport(workspace) {
  const pdfs = workspace.preview?.pdfs || [];
  if (pdfs.length) {
    elements.canvasBody.innerHTML = `<div class="canvas-page-stack">${pdfs.map(renderPdfCard).join("")}</div>`;
    bindPreviewCardActions(elements.canvasBody);
    return;
  }
  if (workspace.project.projectType === "series") {
    renderCanvasSeries(workspace);
    return;
  }
  renderCanvasPages(workspace.preview?.pages || [], "Noch kein PDF erstellt.");
}

function renderInternalImageSpecDetails(workspace) {
  const imageSpec = workspace.proposals?.activeImageSpec || workspace.proposals?.latestImageSpec || null;
  if (!imageSpec?.data) {
    return "";
  }
  const spec = imageSpec.data;
  return `
    <details class="internal-spec-details">
      <summary>Interne ImageSpec ansehen</summary>
      <article class="canvas-document compact">
        <div class="detail-grid">
          <div><span>ID</span><strong>${escapeHtml(imageSpec.proposalId)}</strong></div>
          <div><span>Status</span><strong>${escapeHtml(statusWord(imageSpec.status))}</strong></div>
          <div><span>Format</span><strong>${escapeHtml(spec.aspectRatio || "portrait_a4_asset")}</strong></div>
          <div><span>Textregel</span><strong>${escapeHtml(spec.textPolicy || "no_text")}</strong></div>
        </div>
        <section class="detail-section">
          <p class="detail-label">Finaler Bildprompt</p>
          <p>${escapeHtml(spec.finalPrompt || "")}</p>
        </section>
      </article>
    </details>
  `;
}

function renderCanvasSeries(workspace) {
  const worksheets = workspace.series?.worksheets || [];
  elements.canvasBody.innerHTML = `
    <article class="canvas-document">
      <p class="detail-label">Reihe</p>
      <h3>${escapeHtml(workspace.series?.title || workspace.project.title)}</h3>
      <div class="series-list">
        ${worksheets.length ? worksheets.map((worksheet) => `
          <div class="series-row">
            <span>${escapeHtml(worksheet.position || "")}</span>
            <strong>${escapeHtml(worksheet.title || worksheet.projectId)}</strong>
            <em>${worksheet.includedInSeriesExport === false ? "nicht im Export" : "im Export"}</em>
          </div>
        `).join("") : '<p class="detail-muted">Noch keine Arbeitsblaetter in der Reihe.</p>'}
      </div>
    </article>
  `;
}

function proposalForMode(workspace, mode) {
  if (mode === "lessonbrief_proposal") {
    return workspace.proposals?.latestLessonBrief || null;
  }
  if (mode === "content_proposal") {
    return workspace.proposals?.latestContentMirror || null;
  }
  if (mode === "warnings_proposal") {
    return workspace.proposals?.latestContentWarnings || null;
  }
  if (mode === "image_spec_proposal") {
    return workspace.proposals?.latestImageSpec || workspace.proposals?.activeImageSpec || null;
  }
  return null;
}

function renderCanvasProposal(workspace, mode) {
  const proposal = proposalForMode(workspace, mode);
  if (!proposal?.data) {
    elements.canvasBody.innerHTML = '<div class="no-preview">Kein offener Vorschlag vorhanden.</div>';
    return;
  }
  if (mode === "lessonbrief_proposal") {
    renderLessonBriefProposal(proposal, workspace);
    return;
  }
  if (mode === "content_proposal") {
    renderContentProposal(proposal, workspace);
    return;
  }
  if (mode === "warnings_proposal") {
    renderWarningsProposal(proposal);
    return;
  }
  renderImageSpecProposal(proposal);
}

function proposalMeta(proposal) {
  return `
    <details class="internal-spec-details compact">
      <summary>Entwicklungsdetails</summary>
      <div class="detail-grid">
        <div><span>Vorschlag</span><strong>${escapeHtml(proposal.proposalId)}</strong></div>
        <div><span>Modell</span><strong>${escapeHtml(proposal.model || "lokal")}</strong></div>
      </div>
    </details>
  `;
}

function renderLessonBriefProposal(proposal, workspace = {}) {
  const brief = proposal.data || {};
  const sections = conceptSectionsFromContent({}, {
    brief,
    project: workspace.project || {},
    teachingContext: workspace.teachingContext || {}
  });
  elements.canvasBody.innerHTML = `
    <article class="canvas-document">
      <p class="detail-label">AI-Vorschlag</p>
      <h3>${escapeHtml(worksheetConceptTitle(workspace.project || {}, brief, {}, workspace.teachingContext || {}))}</h3>
      ${proposalMeta(proposal)}
      ${renderConceptSections(sections, { compact: false })}
    </article>
  `;
}

function renderContentProposal(proposal, workspace = {}) {
  const content = proposal.data || {};
  const brief = workspace.documents?.brief?.data || workspace.proposals?.latestLessonBrief?.data || {};
  const sections = conceptSectionsFromContent(content, {
    brief,
    project: workspace.project || {},
    teachingContext: workspace.teachingContext || {}
  });
  elements.canvasBody.innerHTML = `
    <article class="canvas-document">
      <p class="detail-label">AI-Vorschlag</p>
      <h3>${escapeHtml(worksheetConceptTitle(workspace.project || {}, brief, content, workspace.teachingContext || {}))}</h3>
      ${proposalMeta(proposal)}
      ${renderConceptSections(sections, { compact: false })}
    </article>
  `;
}

function renderWarningsProposal(proposal) {
  const warningState = proposal.data || {};
  const warnings = warningState.warnings || [];
  elements.canvasBody.innerHTML = `
    <article class="canvas-document">
      <p class="detail-label">AI-Prüfvorschlag</p>
      <h3>${escapeHtml(warningState.summary || proposal.title || "Prüfhinweise")}</h3>
      ${proposalMeta(proposal)}
      <section class="detail-section">
        <p class="detail-label">Hinweise</p>
        ${warnings.length ? `<ul>${warnings.map((warning) => `
          <li><strong>${escapeHtml(warning.severity || "medium")}</strong> · ${escapeHtml(warning.message || "")}${warning.recommendation ? `<br><span class="detail-muted">${escapeHtml(warning.recommendation)}</span>` : ""}</li>
        `).join("")}</ul>` : '<p class="detail-muted">Keine Hinweise vorgeschlagen.</p>'}
      </section>
    </article>
  `;
}

function renderImageSpecProposal(proposal) {
  const spec = proposal.data || {};
  const referencePolicy = spec.referencePolicy || null;
  const referenceImages = spec.referenceImages || [];
  const pagePlan = Array.isArray(spec.pagePlan) ? spec.pagePlan : [];
  elements.canvasBody.innerHTML = `
    <article class="canvas-document">
      <p class="detail-label">${proposal.status === "adopted" ? "Interne ImageSpec" : "Interne ImageSpec"}</p>
      <h3>${escapeHtml(spec.purpose || proposal.title || "Interne ImageSpec")}</h3>
      ${proposalMeta(proposal)}
      ${pagePlan.length ? `
        <section class="detail-section">
          <p class="detail-label">Geplante Seiten</p>
          <p>${escapeHtml(`${spec.pageCount || pagePlan.length} Seite${(spec.pageCount || pagePlan.length) === 1 ? "" : "n"} pro Kandidat`)}</p>
          <ul>
            ${pagePlan.map((page) => `
              <li>
                <strong>Seite ${escapeHtml(page.pageNumber || "")}</strong>${page.title ? ` · ${escapeHtml(page.title)}` : ""}
                ${page.sourceTaskIds?.length ? `<br><span class="detail-muted">${escapeHtml(page.sourceTaskIds.length)} Aufgabe${page.sourceTaskIds.length === 1 ? "" : "n"}</span>` : ""}
              </li>
            `).join("")}
          </ul>
        </section>
      ` : ""}
      <section class="detail-section">
        <p class="detail-label">Funktion</p>
        <p>${escapeHtml(spec.learningFunction || "Keine Lernfunktion formuliert.")}</p>
      </section>
      <section class="detail-section">
        <p class="detail-label">Stil und Platzierung</p>
        <p>${escapeHtml(spec.style || "clean_scientific")} · ${escapeHtml(spec.placement || "auto")}</p>
      </section>
      ${referencePolicy ? `
        <section class="detail-section">
          <p class="detail-label">Referenzentscheidung</p>
          <p><strong>${escapeHtml(referencePolicyLabel(referencePolicy))}</strong></p>
          <p>${escapeHtml(referencePolicySummary(referencePolicy))}</p>
          ${referenceImages.length ? `<p class="detail-muted">${escapeHtml(referenceImages.length)} Referenz${referenceImages.length === 1 ? "" : "en"} vorhanden.</p>` : ""}
        </section>
      ` : ""}
      <section class="detail-section">
        <p class="detail-label">Muss zeigen</p>
        ${listItems(spec.mustShow)}
      </section>
      <section class="detail-section">
        <p class="detail-label">Vermeiden</p>
        ${listItems(spec.avoid)}
      </section>
      <section class="detail-section">
        <p class="detail-label">Finaler Bildprompt</p>
        <p>${escapeHtml(spec.finalPrompt || "")}</p>
      </section>
    </article>
  `;
}

async function executeCommand(commandId, payload = {}) {
  if (!commandId) {
    return;
  }
  if (commandId === "copy_context") {
    await copyWorkspaceContext();
    return;
  }
  const projectId = currentProjectId();
  const command = workspaceCommandById(commandId);
  if (!command || !command.enabled) {
    showToast("Dieser Schritt ist nicht mehr aktuell. Ich habe den aktuellen Arbeitsstand geladen.", "warning");
    if (projectId) {
      const payload = await fetchJson(`/api/workspace/${encodeURIComponent(projectId)}`);
      state.workspace = payload.workspace;
      renderWorkspace();
    }
    return;
  }
  let nextPayload = withConfiguredImageProvider(command, { ...payload });
  if (commandUsesImageProvider(command)) {
    const unavailableReason = imageProviderUnavailableReason(command, nextPayload.imageProvider);
    if (unavailableReason) {
      showToast(unavailableReason, "error");
      openSettings();
      return;
    }
  }
  const confirmationFlag = command.confirmationKind === "paid_image_generation"
    || (command.confirmationKind === "image_generation_provider" && nextPayload.imageProvider !== "codex_cli")
    ? "confirmPaidRun"
    : "confirmedCommand";
  if (command?.requiresConfirmation && !nextPayload[confirmationFlag]) {
    const confirmed = await requestCommandConfirmation(command, nextPayload);
    if (!confirmed) {
      return;
    }
    nextPayload = { ...nextPayload, [confirmationFlag]: true };
  }
  state.pendingCommand = {
    projectId,
    commandId,
    label: command?.label || decisionButtonLabel({ id: commandId }),
    message: pendingCommandMessage(commandId, command, nextPayload),
    pageCount: commandPageCount(command, nextPayload),
    createdAt: new Date().toISOString()
  };
  state.commandError = null;
  renderWorkspace();
  try {
    const response = await fetchJson(`/api/workspace/${encodeURIComponent(projectId)}/commands`, {
      method: "POST",
      body: JSON.stringify({ command: commandId, payload: nextPayload })
    });
    state.pendingCommand = null;
    state.workspace = response.workspace;
    applyCommandNavigation(commandId, response);
    showToast("Aktion ausgeführt", "success");
    renderWorkspace();
    await loadTree({ keepSelection: true, selectAfterLoad: false });
  } catch (error) {
    const failedCommand = state.pendingCommand;
    state.pendingCommand = null;
    state.commandError = {
      projectId,
      commandId,
      label: failedCommand?.label || command?.label || decisionButtonLabel({ id: commandId }),
      message: `${failedCommand?.label || command?.label || "Aktion"} konnte nicht abgeschlossen werden: ${error.message}`,
      createdAt: new Date().toISOString()
    };
    showToast(error.message, "error");
    if (projectId) {
      try {
        const payload = await fetchJson(`/api/workspace/${encodeURIComponent(projectId)}`);
        state.workspace = payload.workspace;
        renderWorkspace();
      } catch {
        // Keep the original command error visible in the toast.
      }
    }
  }
}

async function sendChatMessage(message, context = {}) {
  const projectId = currentProjectId();
  if (!projectId || isChatBusy()) {
    return;
  }
  state.commandError = null;
  const attachments = context.attachments || [];
  const pendingChat = {
    projectId,
    message,
    attachments,
    createdAt: new Date().toISOString(),
    status: "sending"
  };
  state.pendingChat = { ...pendingChat };
  renderWorkspace();
  try {
    const response = await fetchJson(`/api/workspace/${encodeURIComponent(projectId)}/chat`, {
      method: "POST",
      body: JSON.stringify({
        message,
        uiEvent: context.uiEvent || (attachments.length ? "visual_feedback" : "chat_message"),
        canvasFocus: {
          mode: state.activeCanvasMode,
          ...(context.canvasFocus || {})
        },
        attachments: attachmentsForRequest(attachments)
      })
    });
    streamAssistantResponse({
      pendingChat,
      response: response.response,
      responseWorkspace: response.workspace
    });
  } catch (error) {
    state.pendingChat = {
      ...pendingChat,
      status: "error",
      errorMessage: error.message
    };
    renderWorkspace();
    showToast(error.message, "error");
  }
}

function removeComposerAttachment(attachmentId) {
  state.composerAttachments = state.composerAttachments.filter((attachment) => attachment.id !== attachmentId);
  if (!state.composerAttachments.length) {
    elements.chatInput.placeholder = "Nachricht an SheetifyIMG AI...";
  }
  renderComposerAttachments();
}

function renderComposerAttachmentThumb(attachment) {
  const imageUrl = attachment.previewUrl || attachment.dataUrl || attachment.url || "";
  if (imageUrl) {
    return `<img src="${escapeHtml(imageUrl)}" alt="${escapeHtml(attachment.label || "Anhang")}">`;
  }
  return `<span class="composer-attachment-file-icon">${icon("file", "icon icon-small")}</span>`;
}

function renderInputUploadReceipt(receipt) {
  const statusText = receipt.status === "uploading"
    ? "wird gespeichert"
    : receipt.status === "error"
      ? "Fehler"
      : `gespeichert · ${fileSizeLabel(receipt.size)}`;
  return `
    <figure class="composer-attachment input-upload ${escapeHtml(receipt.status)}">
      ${renderComposerAttachmentThumb(receipt)}
      <figcaption>
        <span>${escapeHtml(receipt.label || "Datei")}</span>
        <small>${escapeHtml(statusText)}</small>
      </figcaption>
      <button class="icon-button icon-button-plain" type="button" data-remove-upload-receipt="${escapeHtml(receipt.id)}" aria-label="Hinweis ausblenden" title="Hinweis ausblenden">
        ${icon("plus", "icon icon-small")}
      </button>
    </figure>
  `;
}

function renderVisualComposerAttachment(attachment) {
  return `
    <figure class="composer-attachment visual-feedback">
      ${renderComposerAttachmentThumb(attachment)}
      <figcaption>
        <span>${escapeHtml(attachment.label || "Ausschnitt")}</span>
        <small>mit Nachricht senden</small>
      </figcaption>
      <button class="icon-button icon-button-plain" type="button" data-remove-attachment="${escapeHtml(attachment.id)}" aria-label="Anhang entfernen" title="Anhang entfernen">
        ${icon("plus", "icon icon-small")}
      </button>
    </figure>
  `;
}

function renderComposerAttachments() {
  let host = elements.chatInputShell.querySelector(".composer-attachments");
  const count = composerAttachmentCount();
  elements.chatAttachmentButton.toggleAttribute("data-has-attachments", count > 0);
  if (count > 0) {
    elements.chatAttachmentButton.dataset.badge = String(count);
  } else {
    delete elements.chatAttachmentButton.dataset.badge;
  }
  if (!count) {
    host?.remove();
    elements.chatInputShell.classList.remove("has-visual-attachment");
    elements.chatInputShell.classList.remove("has-attachments");
    return;
  }
  if (!host) {
    host = document.createElement("div");
    host.className = "composer-attachments";
    elements.chatInputShell.prepend(host);
  }
  elements.chatInputShell.classList.toggle("has-visual-attachment", Boolean(state.composerAttachments.length));
  elements.chatInputShell.classList.add("has-attachments");
  host.innerHTML = [
    ...state.composerAttachments.map(renderVisualComposerAttachment),
    ...state.inputUploadReceipts.map(renderInputUploadReceipt)
  ].join("");
  host.querySelectorAll("[data-remove-attachment]").forEach((button) => {
    button.addEventListener("click", () => removeComposerAttachment(button.dataset.removeAttachment));
  });
  host.querySelectorAll("[data-remove-upload-receipt]").forEach((button) => {
    button.addEventListener("click", () => removeInputUploadReceipt(button.dataset.removeUploadReceipt));
  });
}

function updateComposerState() {
  const busy = isChatBusy();
  elements.chatInput.disabled = busy;
  elements.chatAttachmentButton.disabled = busy;
  elements.chatSendButton.disabled = busy;
  updateVoiceButton();
  renderComposerAttachments();
}

function submitComposerMessage() {
  if (isChatBusy()) {
    return;
  }
  const message = elements.chatInput.value.trim();
  if (state.composerAttachments.length && !message) {
    showToast("Bitte kurz beschreiben, was am Ausschnitt geändert werden soll.", "error");
    elements.chatInput.focus();
    return;
  }
  if (!message) {
    return;
  }
  stopVoiceInput();
  const attachments = [...state.composerAttachments];
  elements.chatInput.value = "";
  state.composerAttachments = [];
  elements.chatInput.placeholder = "Nachricht an SheetifyIMG AI...";
  renderComposerAttachments();
  sendChatMessage(message, attachments.length
    ? {
      uiEvent: "visual_feedback",
      attachments,
      canvasFocus: visualFeedbackCanvasFocus(attachments)
    }
    : {});
}

async function uploadInputFiles(fileList) {
  const projectId = currentProjectId();
  const files = Array.from(fileList || []).filter(Boolean);
  if (!projectId || !files.length) {
    return;
  }
  const receipts = createInputUploadReceipts(files);
  state.inputUploadReceipts = [...state.inputUploadReceipts, ...receipts];
  renderComposerAttachments();
  elements.chatAttachmentButton.disabled = true;
  setComposerDragActive(false);
  try {
    let latestWorkspace = state.workspace;
    for (const [index, file] of files.entries()) {
      const formData = new FormData();
      formData.append("file", file);
      try {
        const response = await fetchJson(`/api/workspace/${encodeURIComponent(projectId)}/input-upload`, {
          method: "POST",
          body: formData
        });
        latestWorkspace = response.workspace;
        state.inputUploadReceipts = state.inputUploadReceipts.map((receipt) => receipt.id === receipts[index].id
          ? {
            ...receipt,
            status: "saved",
            uploadedFile: response.upload?.file || null,
            label: response.upload?.file?.originalName || receipt.label,
            mimeType: response.upload?.file?.mimeType || receipt.mimeType,
            size: response.upload?.file?.size || receipt.size
          }
          : receipt);
        renderComposerAttachments();
      } catch (error) {
        state.inputUploadReceipts = state.inputUploadReceipts.map((receipt) => receipt.id === receipts[index].id
          ? { ...receipt, status: "error", errorMessage: error.message }
          : receipt);
        renderComposerAttachments();
        throw error;
      }
    }
    state.workspace = latestWorkspace;
    renderWorkspace();
    await loadTree({ keepSelection: true, selectAfterLoad: false });
    showToast(files.length === 1 ? "Input hinzugefügt" : `${files.length} Dateien hinzugefügt`, "success");
  } catch (error) {
    showToast(error.message, "error");
  } finally {
    elements.chatAttachmentButton.disabled = false;
    elements.chatAttachmentInput.value = "";
  }
}

async function copyWorkspaceContext() {
  const projectId = currentProjectId();
  try {
    const response = await fetchJson(`/api/workspace/${encodeURIComponent(projectId)}/copy-context`);
    await writeClipboardText(response.text || JSON.stringify(response.payload, null, 2));
    showToast(response.payload?.kind === "series_content_export" ? "Reiheninhalt kopiert" : "Inhalt kopiert", "success");
  } catch (error) {
    showToast(error.message, "error");
  }
}

async function copyProjectContext(item) {
  const projectId = item?.project?.projectId;
  if (!projectId) {
    showToast("Kein Arbeitsblatt ausgewählt.", "error");
    return;
  }
  try {
    const response = await fetchJson(`/api/workspace/${encodeURIComponent(projectId)}/copy-context`);
    await writeClipboardText(response.text || JSON.stringify(response.payload, null, 2));
    showToast(response.payload?.kind === "series_content_export" ? "Reiheninhalt kopiert" : "Inhalt kopiert", "success");
  } catch (error) {
    showToast(error.message || "Kopieren nicht moeglich.", "error");
  }
}

function setNewWorksheetFormVisible(visible) {
  elements.newWorksheetForm.classList.toggle("hidden", !visible);
  elements.newWorksheetButton.setAttribute("aria-expanded", visible ? "true" : "false");
  if (visible) {
    window.setTimeout(() => elements.newWorksheetTitle.focus(), 0);
  }
}

function resetNewWorksheetForm() {
  elements.newWorksheetForm.reset();
  elements.createNewWorksheetButton.disabled = false;
  elements.createNewWorksheetButton.textContent = "Anlegen";
}

async function createNewWorksheetFromLibrary() {
  const title = elements.newWorksheetTitle.value.trim();
  if (!title) {
    elements.newWorksheetTitle.focus();
    return;
  }

  elements.createNewWorksheetButton.disabled = true;
  elements.createNewWorksheetButton.textContent = "Lege an...";

  try {
    const payload = await fetchJson("/api/projects/single", {
      method: "POST",
      body: JSON.stringify({
        title,
        subject: elements.newWorksheetSubject.value.trim() || null,
        topic: elements.newWorksheetTopic.value.trim() || null,
        targetGroup: elements.newWorksheetTargetGroup.value.trim() || null
      })
    });
    const projectId = payload.project?.projectId;
    state.query = "";
    elements.searchInput.value = "";
    state.selectedId = projectId ? `project:${projectId}` : state.selectedId;
    state.collapsedFolders.delete("folder:work-in-progress");
    resetNewWorksheetForm();
    setNewWorksheetFormVisible(false);
    await loadTree({ keepSelection: true, selectAfterLoad: true });
    showToast("Arbeitsblatt angelegt", "success");
  } catch (error) {
    elements.createNewWorksheetButton.disabled = false;
    elements.createNewWorksheetButton.textContent = "Anlegen";
    showToast(error.message, "error");
  }
}

function scheduleSearch(value) {
  state.query = value;
  window.clearTimeout(scheduleSearch.timer);
  scheduleSearch.timer = window.setTimeout(() => {
    loadTree({ keepSelection: true, selectAfterLoad: state.mode === "library" });
  }, 140);
}

elements.searchInput.addEventListener("input", (event) => scheduleSearch(event.target.value || ""));
elements.refreshButton.addEventListener("click", () => loadTree({ keepSelection: true, selectAfterLoad: state.mode === "library" }));
elements.settingsButton?.addEventListener("click", openSettings);
elements.settingsCloseButton?.addEventListener("click", closeSettings);
elements.settingsModal?.addEventListener("click", (event) => {
  if (event.target === elements.settingsModal) {
    closeSettings();
  }
});
elements.newWorksheetButton.addEventListener("click", () => {
  setNewWorksheetFormVisible(elements.newWorksheetForm.classList.contains("hidden"));
});
elements.cancelNewWorksheetButton.addEventListener("click", () => {
  resetNewWorksheetForm();
  setNewWorksheetFormVisible(false);
});
elements.newWorksheetForm.addEventListener("submit", (event) => {
  event.preventDefault();
  createNewWorksheetFromLibrary();
});
elements.loadProjectButton.addEventListener("click", () => openWorkspace(currentProjectId()));
elements.copyContentButton.addEventListener("click", () => state.selectedItem && copyProjectContext(state.selectedItem));
elements.downloadButton.addEventListener("click", () => {
  const firstPdf = state.selectedItem?.preview?.pdfs?.[0] || null;
  if (firstPdf?.url) {
    downloadUrl(firstPdf.url, fileName(firstPdf.path));
  }
});
elements.backToLibraryButton.addEventListener("click", closeWorkspace);
elements.workspaceLibraryButton.addEventListener("click", closeWorkspace);
elements.workspaceCopyButton.addEventListener("click", copyWorkspaceContext);
elements.refreshChatButton.addEventListener("click", () => openWorkspace(currentProjectId()));
elements.chatComposer.addEventListener("submit", (event) => {
  event.preventDefault();
  submitComposerMessage();
});
elements.chatInput.addEventListener("keydown", (event) => {
  if (event.key !== "Enter" || event.altKey || event.isComposing) {
    return;
  }
  event.preventDefault();
  submitComposerMessage();
});
elements.chatVoiceButton?.addEventListener("click", toggleVoiceInput);
elements.chatAttachmentButton.addEventListener("click", () => {
  elements.chatAttachmentInput.click();
});
elements.chatAttachmentInput.addEventListener("change", () => {
  uploadInputFiles(elements.chatAttachmentInput.files);
});
elements.chatInputShell.addEventListener("dragenter", (event) => {
  if (!hasFileDrag(event)) {
    return;
  }
  event.preventDefault();
  setComposerDragActive(true);
});
elements.chatInputShell.addEventListener("dragover", (event) => {
  if (!hasFileDrag(event)) {
    return;
  }
  event.preventDefault();
  event.dataTransfer.dropEffect = "copy";
  setComposerDragActive(true);
});
elements.chatInputShell.addEventListener("dragleave", (event) => {
  if (elements.chatInputShell.contains(event.relatedTarget)) {
    return;
  }
  setComposerDragActive(false);
});
elements.chatInputShell.addEventListener("drop", (event) => {
  if (!hasFileDrag(event)) {
    return;
  }
  event.preventDefault();
  setComposerDragActive(false);
  uploadInputFiles(event.dataTransfer.files);
});
elements.canvasCaptureButton?.addEventListener("click", () => {
  setCanvasCaptureActive(!state.canvasCapture.active);
});
elements.candidateViewerModal?.addEventListener("click", (event) => {
  if (event.target === elements.candidateViewerModal) {
    closeCandidateViewer();
  }
});
elements.candidateViewerCloseButton?.addEventListener("click", closeCandidateViewer);
elements.candidateViewerPreviousButton?.addEventListener("click", () => {
  showCandidateViewerAt(state.candidateViewer.index - 1);
});
elements.candidateViewerNextButton?.addEventListener("click", () => {
  showCandidateViewerAt(state.candidateViewer.index + 1);
});
elements.candidateViewerCopyButton?.addEventListener("click", copyCurrentCandidateViewerImage);
elements.candidateInfoModal?.addEventListener("click", (event) => {
  if (event.target === elements.candidateInfoModal) {
    closeCandidateInfo();
  }
});
elements.candidateInfoCloseButton?.addEventListener("click", closeCandidateInfo);
elements.mobilePreviewBackdrop?.addEventListener("click", closeMobilePreview);
elements.mobilePreviewCloseButton?.addEventListener("click", closeMobilePreview);
elements.mobilePreviewMinimizeButton?.addEventListener("click", minimizeMobilePreview);
elements.mobilePreviewMini?.addEventListener("click", restoreMobilePreview);
elements.canvasBody.addEventListener("pointerdown", startCanvasCapture);
elements.canvasBody.addEventListener("pointermove", moveCanvasCapture);
elements.canvasBody.addEventListener("pointerup", endCanvasCapture);
elements.canvasBody.addEventListener("pointercancel", (event) => {
  if (event.pointerId === state.canvasCapture.pointerId) {
    resetCanvasCaptureDrag();
  }
});
elements.canvasResizeHandle.addEventListener("pointerdown", startCanvasResize);
elements.canvasResizeHandle.addEventListener("click", () => {
  if (state.canvasLayout.suppressClick) {
    state.canvasLayout.suppressClick = false;
    return;
  }
  if (state.canvasLayout.collapsed) {
    expandCanvas();
    return;
  }
  collapseCanvas();
});
window.addEventListener("pointermove", moveCanvasResize);
window.addEventListener("pointerup", endCanvasResize);
window.addEventListener("pointercancel", endCanvasResize);
window.addEventListener("resize", () => {
  if (state.mode === "workspace") {
    applyCanvasLayout();
    renderMobileStatusStrip(state.workspace || {});
  }
  if (!isMobileViewport() && state.mobilePreview.mode) {
    closeMobilePreview();
  }
});
document.addEventListener("click", (event) => {
  if (!event.target.closest(".tree-context-menu")) {
    closeTreeContextMenu();
  }
});
document.addEventListener("keydown", (event) => {
  if (isSettingsOpen()) {
    if (event.key === "Escape") {
      event.preventDefault();
      closeSettings();
      return;
    }
  }
  if (state.mobilePreview.mode && !elements.mobilePreviewLayer?.classList.contains("hidden")) {
    if (event.key === "Escape") {
      event.preventDefault();
      closeMobilePreview();
      return;
    }
  }
  if (isCandidateInfoOpen()) {
    if (event.key === "Escape") {
      event.preventDefault();
      closeCandidateInfo();
      return;
    }
  }
  if (isCandidateViewerOpen()) {
    if (event.key === "Escape") {
      event.preventDefault();
      closeCandidateViewer();
      return;
    }
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      showCandidateViewerAt(state.candidateViewer.index - 1);
      return;
    }
    if (event.key === "ArrowRight") {
      event.preventDefault();
      showCandidateViewerAt(state.candidateViewer.index + 1);
      return;
    }
  }
  if (event.key === "Escape") {
    closeTreeContextMenu();
    if (state.canvasCapture.active) {
      setCanvasCaptureActive(false);
    }
  }
});

updateVoiceButton();
loadTree();
