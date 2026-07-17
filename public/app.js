"use strict";

const appLocale = window.sheetifyLocale;

function t(key, variables = {}) {
  return appLocale?.t(key, variables) || key;
}

const SETTINGS_STORAGE_KEY = "sheetifyimg.settings.v1";
const VOICE_TRANSCRIPT_REVIEW_MIN_CHARS = 120;
const VOICE_MICROPHONE_START_TIMEOUT_MS = 15000;
const VOICE_TRANSCRIPTION_REQUEST_TIMEOUT_MS = 75000;
const imageProviderSettingIds = new Set(["codex_cli", "openai"]);
const imageQualitySettingIds = new Set(["sparsam", "standard", "druckqualitaet"]);

function normalizeImageProviderSetting(value) {
  return imageProviderSettingIds.has(value) ? value : null;
}

function normalizeImageQualitySetting(value, fallback = "standard") {
  const normalized = String(value || "").trim().toLowerCase();
  if (!normalized) {
    return fallback;
  }
  const aliases = {
    low: "sparsam",
    schnell: "sparsam",
    sparsam: "sparsam",
    medium: "standard",
    mittel: "standard",
    standard: "standard",
    high: "druckqualitaet",
    hoch: "druckqualitaet",
    druck: "druckqualitaet",
    druckqualitaet: "druckqualitaet"
  };
  const preset = aliases[normalized] || normalized;
  return imageQualitySettingIds.has(preset) ? preset : fallback;
}

function loadSettings() {
  try {
    const raw = window.localStorage.getItem(SETTINGS_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    const imageProviderConfigured = parsed.imageProviderConfigured === true;
    return {
      imageProvider: imageProviderConfigured ? normalizeImageProviderSetting(parsed.imageProvider) : null,
      imageQualityPreset: normalizeImageQualitySetting(parsed.imageQualityPreset, null),
      openAiImageStreaming: parsed.openAiImageStreaming === true
    };
  } catch {
    return { imageProvider: null, imageQualityPreset: null, openAiImageStreaming: false };
  }
}

function saveSettings(settings = {}) {
  try {
    const imageProvider = normalizeImageProviderSetting(settings.imageProvider);
    const imageQualityPreset = normalizeImageQualitySetting(settings.imageQualityPreset, null);
    window.localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify({
      imageProvider,
      imageProviderConfigured: Boolean(imageProvider),
      ...(imageQualityPreset ? { imageQualityPreset } : {}),
      openAiImageStreaming: settings.openAiImageStreaming === true
    }));
  } catch {
    // Browser storage can be unavailable in restricted contexts. The current session still works.
  }
}

const initialUrlParams = new URLSearchParams(window.location.search);

function normalizeRouteView(value) {
  const normalized = String(value || "").trim().toLowerCase();
  return normalized === "workspace" || normalized === "projects" || normalized === "worksheets"
    ? normalized
    : "";
}

function parseInitialRoute(params) {
  const projectId = String(params.get("project") || "").trim();
  const worksheetId = String(params.get("worksheet") || "").trim();
  const view = normalizeRouteView(params.get("view"));

  if (worksheetId) {
    return {
      view: "worksheets",
      projectId,
      worksheetId,
      itemId: `worksheet:${worksheetId}`
    };
  }

  if (projectId) {
    return {
      view: view === "workspace" ? "workspace" : "projects",
      projectId,
      worksheetId: "",
      itemId: `project:${projectId}`
    };
  }

  if (view === "worksheets" || view === "projects") {
    return {
      view,
      projectId: "",
      worksheetId: "",
      itemId: ""
    };
  }

  return null;
}

const initialRoute = parseInitialRoute(initialUrlParams);

const state = {
  mode: "library",
  libraryView: initialRoute?.view === "worksheets" ? "worksheets" : "projects",
  librarySelections: {
    projects: initialRoute?.itemId?.startsWith("project:") ? initialRoute.itemId : null,
    worksheets: initialRoute?.itemId?.startsWith("worksheet:") ? initialRoute.itemId : null
  },
  query: "",
  selectedId: null,
  selectedTreeItemIds: new Set(),
  treeSelectionAnchorId: null,
  selectedItem: null,
  workspace: null,
  settings: loadSettings(),
  settingsModal: {
    lastFocusedElement: null,
    billingStatus: null,
    billingProjectId: null,
    billingLoading: false,
    billingError: null
  },
  sharePanel: {
    open: false,
    pinned: false,
    loading: false,
    error: null,
    data: null,
    requestKey: "",
    selectedTargetId: null,
    lastFocusedElement: null,
    closeTimer: null,
    suppressFocusOpen: false
  },
  activeStatusStep: null,
  activeLibraryConceptId: null,
  activeCanvasMode: "content",
  activeArtifactSelection: null,
  artifactRelationPulseKey: "",
  artifactRelationPulseTimer: null,
  tree: null,
  collapsedFolders: new Set(),
  collapsedArtifactGroups: new Set(),
  draggingTreeNodeId: null,
  pendingChat: null,
  pendingCommand: null,
  commandError: null,
  chatStreamTimer: null,
  voiceInput: {
    recorder: null,
    stream: null,
    transcriptionController: null,
    transcriptionTimeoutId: null,
    transcriptionProjectId: null,
    transcriptionTimedOut: false,
    chunks: [],
    recording: false,
    transcribing: false,
    starting: false,
    stopRequested: false,
    startedAt: 0,
    lastError: null
  },
  voiceDraft: null,
  voiceTranscriptReview: {
    lastFocusedElement: null
  },
  teachingContextPanel: {
    collapsedByProjectId: {}
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
  revisionTarget: null,
  blueprintSelection: null,
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
  projectSplitLayout: {
    collapsed: false,
    height: 196,
    lastExpandedHeight: 196,
    resizing: false,
    pointerId: null,
    startY: 0,
    suppressClick: false
  },
  canvasLayout: {
    collapsed: true,
    docked: false,
    width: 520,
    lastExpandedWidth: 520,
    resizing: false,
    pointerId: null,
    startX: 0,
    suppressClick: false,
    dragBounds: null,
    pendingClientX: null,
    resizeFrame: null
  },
  canvasSheetWidthFrame: null,
  mobilePreview: {
    mode: null,
    source: "workspace",
    minimized: false,
    lastFocusedElement: null
  },
  mobilePreviewSwipe: {
    active: false,
    dragging: false,
    pointerId: null,
    startX: 0,
    startY: 0,
    lastY: 0,
    startTime: 0,
    lastTime: 0,
    source: ""
  }
};

const spriteHref = "/icons/lucide-sprite.svg?v=16";
const worksheetShareFileCache = new Map();
let pendingInitialRoute = initialRoute;
let backgroundRefreshTimer = null;
let backgroundRefreshInFlight = false;
let selectedItemRefreshId = 0;
let workspaceRefreshId = 0;
let shareRefreshId = 0;
let voiceStartRequestId = 0;
let voiceTranscriptionRequestId = 0;
let nextConceptCopyId = 1;
const conceptCopyTexts = new Map();
const candidateGenerationToastKeys = new Set();

const elements = {
  topbarProject: document.querySelector("#topbarProject"),
  workspaceProjectTitle: document.querySelector("#workspaceProjectTitle"),
  workspaceMobileProjectTitle: document.querySelector("#workspaceMobileProjectTitle"),
  workspaceLibraryButton: document.querySelector("#workspaceLibraryButton"),
  workspaceMobileLibraryButton: document.querySelector("#workspaceMobileLibraryButton"),
  shareButton: document.querySelector("#shareButton"),
  workspaceMobileShareButton: document.querySelector("#workspaceMobileShareButton"),
  workspaceMobileSettingsButton: document.querySelector("#workspaceMobileSettingsButton"),
  sharePopover: document.querySelector("#sharePopover"),
  shareCloseButton: document.querySelector("#shareCloseButton"),
  shareQrCode: document.querySelector("#shareQrCode"),
  shareStatus: document.querySelector("#shareStatus"),
  shareUrlText: document.querySelector("#shareUrlText"),
  shareTargetList: document.querySelector("#shareTargetList"),
  shareHint: document.querySelector("#shareHint"),
  shareCopyLinkButton: document.querySelector("#shareCopyLinkButton"),
  backToLibraryButton: document.querySelector("#backToLibraryButton"),
  librarySidebar: document.querySelector("#librarySidebar"),
  sidebarEyebrow: document.querySelector("#sidebarEyebrow"),
  sidebarTitle: document.querySelector("#sidebarTitle"),
  projectsViewButton: document.querySelector("#projectsViewButton"),
  worksheetsViewButton: document.querySelector("#worksheetsViewButton"),
  productionSidebar: document.querySelector("#productionSidebar"),
  productionSidebarTitle: document.querySelector("#productionSidebarTitle"),
  productionStepList: document.querySelector("#productionStepList"),
  productionArtifactList: document.querySelector("#productionArtifactList"),
  tree: document.querySelector("#libraryTree"),
  searchInput: document.querySelector("#librarySearchInput"),
  emptyState: document.querySelector("#emptyState"),
  emptyStateTitle: document.querySelector("#emptyStateTitle"),
  emptyStateCopy: document.querySelector("#emptyStateCopy"),
  projectView: document.querySelector("#projectView"),
  workspaceView: document.querySelector("#workspaceView"),
  chatPanel: document.querySelector(".chat-panel"),
  mobilePreviewLayer: document.querySelector("#mobilePreviewLayer"),
  mobilePreviewBackdrop: document.querySelector("#mobilePreviewBackdrop"),
  mobilePreviewSheet: document.querySelector("#mobilePreviewSheet"),
  mobilePreviewEyebrow: document.querySelector("#mobilePreviewEyebrow"),
  mobilePreviewTitle: document.querySelector("#mobilePreviewTitle"),
  mobilePreviewSubtitle: document.querySelector("#mobilePreviewSubtitle"),
  mobilePreviewBody: document.querySelector("#mobilePreviewBody"),
  mobilePreviewFooter: document.querySelector("#mobilePreviewFooter"),
  mobilePreviewCloseIconButton: document.querySelector("#mobilePreviewCloseIconButton"),
  mobilePreviewMini: document.querySelector("#mobilePreviewMini"),
  mobilePreviewMiniLabel: document.querySelector("#mobilePreviewMiniLabel"),
  projectTitle: document.querySelector("#projectTitle"),
  statusList: document.querySelector("#statusList"),
  statusArtifactSummary: document.querySelector("#statusArtifactSummary"),
  projectSplitView: document.querySelector("#projectSplitView"),
  statusPanel: document.querySelector("#statusPanel"),
  projectSplitHandle: document.querySelector("#projectSplitHandle"),
  previewGrid: document.querySelector("#previewGrid"),
  previewTitle: document.querySelector("#previewTitle"),
  previewEyebrow: document.querySelector("#previewEyebrow"),
  downloadButton: document.querySelector("#downloadButton"),
  refreshButton: document.querySelector("#refreshButton"),
  settingsButton: document.querySelector("#settingsButton"),
  settingsModal: document.querySelector("#settingsModal"),
  settingsCloseButton: document.querySelector("#settingsCloseButton"),
  settingsDisconnectButton: document.querySelector("#settingsDisconnectButton"),
  imageProviderSettings: document.querySelector("#imageProviderSettings"),
  billingStatusPanel: document.querySelector("#billingStatusPanel"),
  newWorksheetButton: document.querySelector("#newWorksheetButton"),
  newWorksheetForm: document.querySelector("#newWorksheetForm"),
  newWorksheetTitle: document.querySelector("#newWorksheetTitle"),
  cancelNewWorksheetButton: document.querySelector("#cancelNewWorksheetButton"),
  createNewWorksheetButton: document.querySelector("#createNewWorksheetButton"),
  loadProjectButton: document.querySelector("#loadProjectButton"),
  loadProjectButtonLabel: document.querySelector("#loadProjectButtonLabel"),
  chatTimeline: document.querySelector("#chatTimeline"),
  teachingContextPanel: document.querySelector("#teachingContextPanel"),
  chatComposer: document.querySelector("#chatComposer"),
  chatInput: document.querySelector("#chatInput"),
  chatInputShell: document.querySelector("#chatInputShell"),
  revisionTargetPill: document.querySelector("#revisionTargetPill"),
  revisionTargetLabel: document.querySelector("#revisionTargetLabel"),
  revisionTargetClearButton: document.querySelector("#revisionTargetClearButton"),
  chatSendButton: document.querySelector(".chat-send-button"),
  chatVoiceButton: document.querySelector("#chatVoiceButton"),
  voiceTranscriptReviewButton: document.querySelector("#voiceTranscriptReviewButton"),
  voiceTranscriptLayer: document.querySelector("#voiceTranscriptLayer"),
  voiceTranscriptBackdrop: document.querySelector("#voiceTranscriptBackdrop"),
  voiceTranscriptText: document.querySelector("#voiceTranscriptText"),
  voiceTranscriptCloseButton: document.querySelector("#voiceTranscriptCloseButton"),
  voiceTranscriptSaveButton: document.querySelector("#voiceTranscriptSaveButton"),
  chatAttachmentButton: document.querySelector("#chatAttachmentButton"),
  chatAttachmentInput: document.querySelector("#chatAttachmentInput"),
  refreshChatButton: document.querySelector("#refreshChatButton"),
  canvasTitle: document.querySelector("#canvasTitle"),
  canvasResizeHandle: document.querySelector("#canvasResizeHandle"),
  canvasBody: document.querySelector("#canvasBody"),
  canvasCaptureButton: document.querySelector("#canvasCaptureButton"),
  confirmationModal: document.querySelector("#confirmationModal"),
  confirmationEyebrow: document.querySelector("#confirmationEyebrow"),
  confirmationTitle: document.querySelector("#confirmationTitle"),
  confirmationMessage: document.querySelector("#confirmationMessage"),
  confirmationExtra: document.querySelector("#confirmationExtra"),
  confirmationCancelButton: document.querySelector("#confirmationCancelButton"),
  confirmationAcceptButton: document.querySelector("#confirmationAcceptButton"),
  manualCopyModal: document.querySelector("#manualCopyModal"),
  manualCopyText: document.querySelector("#manualCopyText"),
  manualCopyCloseButton: document.querySelector("#manualCopyCloseButton"),
  candidateViewerModal: document.querySelector("#candidateViewerModal"),
  candidateViewerCounter: document.querySelector("#candidateViewerCounter"),
  candidateViewerTitle: document.querySelector("#candidateViewerTitle"),
  candidateViewerMeta: document.querySelector("#candidateViewerMeta"),
  candidateViewerImage: document.querySelector("#candidateViewerImage"),
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

const customScrollbars = new WeakMap();

function customScrollbarTargets() {
  return [
    elements.tree,
    elements.previewGrid,
    elements.chatTimeline,
    elements.canvasBody,
    elements.candidateInfoBody,
    elements.mobilePreviewBody
  ].filter(Boolean);
}

function initializeCustomScrollbars() {
  if (typeof window.SimpleBar !== "function") {
    document.documentElement.classList.add("native-scrollbars");
    return;
  }
  customScrollbarTargets().forEach((element) => {
    if (customScrollbars.has(element)) {
      return;
    }
    element.classList.add("sheetify-scrollbar");
    customScrollbars.set(element, new window.SimpleBar(element, {
      autoHide: true,
      clickOnTrack: false,
      scrollbarMinSize: 38
    }));
  });
}

function customScrollContent(element) {
  return customScrollbars.get(element)?.getContentElement() || element;
}

function customScrollElement(element) {
  return customScrollbars.get(element)?.getScrollElement() || element;
}

function recalculateCustomScrollbar(element) {
  const instance = customScrollbars.get(element);
  if (!instance) {
    return;
  }
  instance.recalculate();
}

function setCustomScrollContent(element, html) {
  customScrollContent(element).innerHTML = html;
  recalculateCustomScrollbar(element);
}

const statusLabels = {
  concept: "Arbeitsblatt-Konzept",
  candidates: "Entwürfe",
  drafts: "Entwürfe",
  has_candidates: "Entwürfe",
  selected: "Entwürfe",
  exported: "Entwürfe",
  ready_for_generation: "Arbeitsblatt-Konzept",
  needs_approval: "Arbeitsblatt-Konzept",
  draft: "Input",
  error: "Prüfen",
  export: "Entwürfe",
  input: "Input"
};

const canvasLabels = {
  assignment: "Input",
  brief: "Arbeitsblatt-Konzept",
  content: "Arbeitsblatt-Bauplan",
  warnings: "Arbeitsblatt-Konzept",
  candidates: "Entwürfe",
  lessonbrief_proposal: "Arbeitsblatt-Konzept",
  content_proposal: "Arbeitsblatt-Bauplan",
  warnings_proposal: "Konzept-Feedback",
  image_spec_proposal: "Referenz/Vorlage"
};

const CANVAS_DEFAULT_WIDTH = 520;
const CANVAS_MIN_WIDTH = 360;
const CANVAS_MIN_CHAT_WIDTH = 340;
const CANVAS_SNAP_THRESHOLD = 120;
const CANVAS_COLLAPSE_THRESHOLD = 160;
const CANVAS_HANDLE_WIDTH = 18;
const PROJECT_SPLIT_DEFAULT_HEIGHT = 196;
const PROJECT_SPLIT_MIN_HEIGHT = 120;
const PROJECT_SPLIT_MIN_PREVIEW_HEIGHT = 220;
const PROJECT_SPLIT_HANDLE_HEIGHT = 16;
const PROJECT_SPLIT_COLLAPSE_THRESHOLD = 70;
const FOLDER_COLOR_PALETTE = [
  { label: "Standard", value: "" },
  { label: "Blau", value: "#bfdbfe" },
  { label: "Himmel", value: "#bae6fd" },
  { label: "Cyan", value: "#a5f3fc" },
  { label: "Türkis", value: "#99f6e4" },
  { label: "Mint", value: "#a7f3d0" },
  { label: "Grün", value: "#bbf7d0" },
  { label: "Gelb", value: "#fef3c7" },
  { label: "Honig", value: "#fde68a" },
  { label: "Orange", value: "#fed7aa" },
  { label: "Koralle", value: "#fecdd3" },
  { label: "Rot", value: "#fecaca" },
  { label: "Rosa", value: "#fce7f3" },
  { label: "Pink", value: "#fbcfe8" },
  { label: "Lila", value: "#ddd6fe" },
  { label: "Indigo", value: "#c7d2fe" },
  { label: "Grau", value: "#e2e8f0" }
];

const LEGACY_FOLDER_COLOR_MAP = {
  "#1f63d6": "#bfdbfe",
  "#168b4f": "#bbf7d0",
  "#d99a00": "#fef3c7",
  "#e46f2b": "#fed7aa",
  "#c24135": "#fecaca",
  "#7c3aed": "#ddd6fe",
  "#64748b": "#e2e8f0"
};

function displayFolderColor(value) {
  const color = String(value || "").trim().toLowerCase();
  return LEGACY_FOLDER_COLOR_MAP[color] || color;
}

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
  if (step.icon) {
    return renderIcon(step.icon, "step-marker-icon");
  }
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

function normalizeVisibleProductTerminology(value) {
  return String(value ?? "")
    .replace(/\bcandidate_0*(\d+)\b/gi, (_, number) => `Entwurf ${String(Number(number)).padStart(2, "0")}`)
    .replace(/\bKandidatenvorbereitung\b/g, "Bildplanung")
    .replace(/\bKandidatenvorlage\b/g, "Entwurfsvorlage")
    .replace(/\bKandidatenfeedback\b/g, "Entwurfsfeedback")
    .replace(/\bKandidatenkontext\b/g, "Entwurfskontext")
    .replace(/\bKandidatenlauf\b/g, "Entwurfslauf")
    .replace(/\bKandidatenerzeugung\b/g, "Entwurfserstellung")
    .replace(/\bKandidaten-Schritt\b/g, "Entwurfs-Schritt")
    .replace(/\bKandidatenschritt\b/g, "Entwurfsschritt")
    .replace(/\bKandidatenansicht\b/g, "Entwurfsansicht")
    .replace(/\bKandidatenvorschau\b/g, "Entwurfsvorschau")
    .replace(/\bBildentwürfe\b/g, "Bildentwürfe")
    .replace(/\bBildentwurf\b/g, "Bildentwurf")
    .replace(/\beine Kandidatenreihe\b/g, "einen mehrseitigen Entwurf")
    .replace(/\bEine Kandidatenreihe\b/g, "Ein mehrseitiger Entwurf")
    .replace(/\bdie Kandidatenreihe\b/g, "der mehrseitige Entwurf")
    .replace(/\bDie Kandidatenreihe\b/g, "Der mehrseitige Entwurf")
    .replace(/\bKandidatenreihe\b/g, "mehrseitiger Entwurf")
    .replace(/\bWenn er passt, kannst du ihn als Auswahl (?:übernehmen|uebernehmen)\b/g, "Wenn er passt, kannst du ihn als Arbeitsblatt ablegen")
    .replace(/\bWenn er passt, (?:übernimm|uebernimm) ihn als Auswahl\b/g, "Wenn er passt, lege ihn als Arbeitsblatt ab")
    .replace(/\b(ihn|sie|es|diesen|den|die|das)\s+als\s+Auswahl\s+(?:übernehmen|uebernehmen)\b/gi, "$1 als Arbeitsblatt ablegen")
    .replace(/\bals Auswahl (?:übernehmen|uebernehmen)\b/gi, "als Arbeitsblatt ablegen")
    .replace(/\bals Auswahl vorhanden\b/gi, "vorhanden")
    .replace(/\bAuswahl (?:übernehmen|uebernehmen)\b/g, "Arbeitsblatt ablegen")
    .replace(/\b(?:das\s+)?Arbeitsblatt-Konzept ist (?:übernommen|uebernommen)\b/gi, "Mit diesem Arbeitsblatt-Konzept wird weitergearbeitet")
    .replace(/\bKonzept(?:version)? ist (?:jetzt\s+)?(?:die\s+)?aktuelle Basis\b/gi, "Konzeptversion wird für die nächsten Schritte genutzt")
    .replace(/\bArbeitsblatt-Konzept (?:übernehmen|uebernehmen)\b/gi, "Mit diesem Konzept weiterarbeiten")
    .replace(/\beine weitere Auswahl\b/g, "einen weiteren Entwurf")
    .replace(/\bEine weitere Auswahl\b/g, "Einen weiteren Entwurf")
    .replace(/\bweitere Auswahl\b/g, "weiteren Entwurf")
    .replace(/\bWeitere Auswahl\b/g, "Weiteren Entwurf")
    .replace(/\bruhigere Auswahl\b/g, "ruhigeren Entwurf")
    .replace(/\bRuhigere Auswahl\b/g, "Ruhigeren Entwurf")
    .replace(/\bAuswahl mit\b/g, "Entwurf mit")
    .replace(/\bdiesen Kandidaten\b/g, "diesen Entwurf")
    .replace(/\bDiesen Kandidaten\b/g, "Diesen Entwurf")
    .replace(/\bden Kandidaten\b/g, "den Entwurf")
    .replace(/\bDen Kandidaten\b/g, "Den Entwurf")
    .replace(/\beinen Kandidaten\b/g, "einen Entwurf")
    .replace(/\bEinen Kandidaten\b/g, "Einen Entwurf")
    .replace(/\beinem Kandidaten\b/g, "einem Entwurf")
    .replace(/\bdiesem Kandidaten\b/g, "diesem Entwurf")
    .replace(/\baktuellen Kandidaten\b/g, "aktuellen Entwurf")
    .replace(/\bnächsten Kandidaten\b/g, "nächsten Entwurf")
    .replace(/\bneuen Kandidaten\b/g, "neuen Entwurf")
    .replace(/\bfertigen Kandidaten\b/g, "fertigen Entwurf")
    .replace(/\bpassenden Kandidaten\b/g, "passenden Entwurf")
    .replace(/\bletzten Kandidaten\b/g, "letzten Entwurf")
    .replace(/\bvorhandenen Kandidaten\b/g, "vorhandenen Entwürfe")
    .replace(/\bKandidat erzeugen\b/g, "Entwurf erstellen")
    .replace(/\bKandidaten erzeugen\b/g, "Entwürfe erstellen")
    .replace(/\bEntwurf erzeugen\b/g, "Entwurf erstellen")
    .replace(/\bKandidaten\b/g, "Entwürfe")
    .replace(/\bKandidat\b/g, "Entwurf");
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

function markdownHeading(line) {
  const match = String(line || "").match(/^(#{1,6})(\s+)(.+)$/);
  if (!match) {
    return null;
  }
  return {
    level: match[1].length,
    contentStart: match[1].length + match[2].length,
    text: match[3].trim()
  };
}

function renderMarkdownHeading(heading, contentHtml) {
  const level = Math.max(1, Math.min(6, Number(heading?.level) || 4));
  return `<h4 class="message-heading message-heading-level-${level}">${contentHtml}</h4>`;
}

function hasFileDrag(event) {
  return Array.from(event.dataTransfer?.types || []).includes("Files");
}

function imageFileExtension(mimeType = "") {
  const normalized = String(mimeType || "").toLowerCase();
  if (normalized.includes("jpeg") || normalized.includes("jpg")) {
    return "jpg";
  }
  if (normalized.includes("webp")) {
    return "webp";
  }
  if (normalized.includes("gif")) {
    return "gif";
  }
  return "png";
}

function pastedImageFileName(file = {}, index = 0) {
  const name = String(file.name || "").trim();
  if (name && !/^image\.(png|jpe?g|webp|gif)$/i.test(name)) {
    return name;
  }
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
  return `zwischenablage-${stamp}-${index + 1}.${imageFileExtension(file.type)}`;
}

function normalizePastedImageFile(file, index) {
  if (!file) {
    return null;
  }
  const mimeType = file.type || "image/png";
  const name = pastedImageFileName(file, index);
  try {
    return new File([file], name, {
      type: mimeType,
      lastModified: Date.now()
    });
  } catch {
    return file;
  }
}

function imageFilesFromPasteEvent(event) {
  const data = event.clipboardData;
  if (!data) {
    return [];
  }
  const itemFiles = Array.from(data.items || [])
    .filter((item) => item.kind === "file" && String(item.type || "").startsWith("image/"))
    .map((item) => item.getAsFile?.())
    .filter(Boolean);
  const files = itemFiles.length
    ? itemFiles
    : Array.from(data.files || []).filter((file) => String(file.type || "").startsWith("image/"));
  return files
    .map((file, index) => normalizePastedImageFile(file, index))
    .filter(Boolean);
}

function setComposerDragActive(active) {
  elements.chatComposer.classList.toggle("drag-active", active);
}

function voiceInputUnavailableReason() {
  if (!window.isSecureContext) {
    return "Mikrofon braucht HTTPS oder localhost.";
  }
  if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
    return "Audioaufnahme wird von diesem Browser nicht unterstützt.";
  }
  if (state.workspace?.transcription?.status === "missing_key") {
    return "Spracheingabe braucht den OpenAI API-Key.";
  }
  return "";
}

function preferredAudioMimeType() {
  const candidates = [
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/mp4"
  ];
  return candidates.find((type) => window.MediaRecorder?.isTypeSupported?.(type)) || "";
}

function extensionForAudioMimeType(mimeType = "") {
  const normalized = String(mimeType || "").toLowerCase();
  if (normalized.includes("mp4")) {
    return "m4a";
  }
  if (normalized.includes("ogg")) {
    return "ogg";
  }
  return "webm";
}

function resizeChatInput() {
  const input = elements.chatInput;
  if (!input) {
    return;
  }
  input.style.height = "auto";
  const computed = window.getComputedStyle(input);
  const minHeight = Number.parseFloat(computed.minHeight) || 40;
  const maxHeight = Number.parseFloat(computed.maxHeight) || (isMobileViewport() ? 78 : 110);
  const nextHeight = Math.min(Math.max(input.scrollHeight, minHeight), maxHeight);
  input.style.height = `${Math.ceil(nextHeight)}px`;
  input.style.overflowY = input.scrollHeight > maxHeight + 1 ? "auto" : "hidden";
}

function isVoiceTranscriptReviewOpen() {
  return Boolean(elements.voiceTranscriptLayer && !elements.voiceTranscriptLayer.classList.contains("hidden"));
}

function shouldShowVoiceTranscriptReviewButton() {
  const input = elements.chatInput;
  if (!isMobileViewport() || !state.voiceDraft || !input || !elements.voiceTranscriptReviewButton) {
    return false;
  }
  const value = input.value || "";
  if (!value.trim()) {
    return false;
  }
  return value.length >= VOICE_TRANSCRIPT_REVIEW_MIN_CHARS || input.scrollHeight > input.clientHeight + 4;
}

function syncVoiceTranscriptReviewButton() {
  resizeChatInput();
  const show = shouldShowVoiceTranscriptReviewButton();
  elements.chatInputShell?.classList.toggle("has-voice-transcript-review", show);
  elements.voiceTranscriptReviewButton?.classList.toggle("hidden", !show);
  elements.voiceTranscriptReviewButton?.setAttribute("aria-expanded", isVoiceTranscriptReviewOpen() ? "true" : "false");
  if (elements.voiceTranscriptReviewButton) {
    elements.voiceTranscriptReviewButton.disabled = !show || elements.chatInput?.disabled === true;
  }
  resizeChatInput();
  if (!show && isVoiceTranscriptReviewOpen()) {
    closeVoiceTranscriptReview({ restoreFocus: false });
  }
}

function setChatInputValue(value) {
  elements.chatInput.value = value;
  const caretPosition = elements.chatInput.value.length;
  elements.chatInput.setSelectionRange?.(caretPosition, caretPosition);
  syncVoiceTranscriptReviewButton();
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

async function requestMicrophoneAccess() {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error("Audioaufnahme wird von diesem Browser nicht unterstützt.");
  }
  let timedOut = false;
  let timeoutId = null;
  const mediaPromise = navigator.mediaDevices.getUserMedia({ audio: true });
  mediaPromise.then((stream) => {
    if (timedOut) {
      stream?.getTracks?.().forEach((track) => track.stop());
    }
  }, () => {});
  const timeoutPromise = new Promise((_, reject) => {
    timeoutId = window.setTimeout(() => {
      timedOut = true;
      reject(new Error("Mikrofon hat nicht geantwortet. Bitte erneut tippen."));
    }, VOICE_MICROPHONE_START_TIMEOUT_MS);
  });
  try {
    return await Promise.race([mediaPromise, timeoutPromise]);
  } finally {
    if (timeoutId) {
      window.clearTimeout(timeoutId);
    }
  }
}

function clearVoiceTranscriptionTimeout() {
  if (state.voiceInput.transcriptionTimeoutId) {
    window.clearTimeout(state.voiceInput.transcriptionTimeoutId);
    state.voiceInput.transcriptionTimeoutId = null;
  }
}

function isCurrentVoiceTranscription(requestId, projectId) {
  return state.voiceInput.transcribing
    && requestId === voiceTranscriptionRequestId
    && state.voiceInput.transcriptionProjectId === projectId;
}

function abortVoiceTranscription(options = {}) {
  const wasTranscribing = state.voiceInput.transcribing;
  const controller = state.voiceInput.transcriptionController;
  if (!wasTranscribing && !controller) {
    return;
  }
  voiceTranscriptionRequestId += 1;
  clearVoiceTranscriptionTimeout();
  state.voiceInput.transcriptionController = null;
  state.voiceInput.transcriptionProjectId = null;
  state.voiceInput.transcriptionTimedOut = false;
  state.voiceInput.transcribing = false;
  if (controller && !controller.signal.aborted) {
    controller.abort();
  }
  updateComposerState();
  if (wasTranscribing && !options.silent) {
    showToast("Transkription abgebrochen. Du kannst neu aufnehmen.", "info");
  }
}

function updateVoiceButton() {
  const button = elements.chatVoiceButton;
  if (!button) {
    return;
  }
  const unavailableReason = voiceInputUnavailableReason();
  const listening = state.voiceInput.recording;
  const starting = state.voiceInput.starting;
  const transcribing = state.voiceInput.transcribing;
  const label = transcribing
    ? "Transkription abbrechen"
    : starting ? "Mikrofonstart abbrechen"
    : listening ? "Aufnahme stoppen" : "Spracheingabe aufnehmen";

  button.classList.toggle("listening", listening);
  button.classList.toggle("starting", starting);
  button.classList.toggle("transcribing", transcribing);
  button.setAttribute("aria-pressed", listening ? "true" : "false");
  button.setAttribute("aria-busy", transcribing || starting ? "true" : "false");
  button.setAttribute("aria-label", transcribing || starting ? label : unavailableReason || label);
  button.title = transcribing || starting ? label : unavailableReason || label;
  button.disabled = (Boolean(unavailableReason) && !transcribing && !starting)
    || (isChatBusy() && !listening && !transcribing && !starting);
}

function resetVoiceRecordingState() {
  state.voiceInput.stream?.getTracks?.().forEach((track) => track.stop());
  state.voiceInput.recorder = null;
  state.voiceInput.stream = null;
  state.voiceInput.chunks = [];
  state.voiceInput.recording = false;
  state.voiceInput.starting = false;
  state.voiceInput.stopRequested = false;
  state.voiceInput.startedAt = 0;
}

async function uploadVoiceRecording(blob, durationMs) {
  const projectId = currentProjectId();
  if (!projectId) {
    return;
  }
  const requestId = ++voiceTranscriptionRequestId;
  const controller = new AbortController();
  state.voiceInput.transcribing = true;
  state.voiceInput.transcriptionController = controller;
  state.voiceInput.transcriptionProjectId = projectId;
  state.voiceInput.transcriptionTimedOut = false;
  state.voiceInput.transcriptionTimeoutId = window.setTimeout(() => {
    if (state.voiceInput.transcriptionController !== controller) {
      return;
    }
    state.voiceInput.transcriptionTimedOut = true;
    controller.abort();
  }, VOICE_TRANSCRIPTION_REQUEST_TIMEOUT_MS);
  updateComposerState();
  try {
    const formData = new FormData();
    const fileExtension = extensionForAudioMimeType(blob.type);
    formData.append("audio", blob, `aufnahme.${fileExtension}`);
    formData.append("durationMs", String(durationMs || 0));
    const response = await fetchJson(`/api/workspace/${encodeURIComponent(projectId)}/voice-transcription`, {
      method: "POST",
      body: formData,
      signal: controller.signal
    });
    if (!isCurrentVoiceTranscription(requestId, projectId)) {
      return;
    }
    if (state.mode === "workspace" && state.selectedId === `project:${projectId}`) {
      state.workspace = response.workspace;
    }
    state.voiceDraft = response.voice || null;
    setChatInputValue(response.voice?.transcript || "");
    elements.chatInput.focus();
    renderWorkspace();
  } catch (error) {
    if (!isCurrentVoiceTranscription(requestId, projectId)) {
      return;
    }
    if (error.name === "AbortError" && state.voiceInput.transcriptionTimedOut) {
      showToast("Transkription dauert zu lange. Bitte erneut aufnehmen.", "error");
    } else if (error.name !== "AbortError") {
      showToast(error.message || "Spracheingabe konnte nicht transkribiert werden.", "error");
    }
  } finally {
    if (requestId === voiceTranscriptionRequestId) {
      clearVoiceTranscriptionTimeout();
      state.voiceInput.transcriptionController = null;
      state.voiceInput.transcriptionProjectId = null;
      state.voiceInput.transcriptionTimedOut = false;
      state.voiceInput.transcribing = false;
      updateComposerState();
    }
  }
}

async function startVoiceInput() {
  const unavailableReason = voiceInputUnavailableReason();
  if (unavailableReason) {
    showToast(unavailableReason, "error");
    updateVoiceButton();
    return;
  }
  if (state.voiceInput.recording || state.voiceInput.starting || state.voiceInput.transcribing) {
    return;
  }

  state.voiceInput.starting = true;
  state.voiceInput.stopRequested = false;
  state.voiceInput.chunks = [];
  state.voiceInput.lastError = null;
  const startRequestId = ++voiceStartRequestId;
  updateVoiceButton();

  try {
    const stream = await requestMicrophoneAccess();
    if (startRequestId !== voiceStartRequestId || !state.voiceInput.starting) {
      stream?.getTracks?.().forEach((track) => track.stop());
      return;
    }
    const mimeType = preferredAudioMimeType();
    state.voiceInput.stream = stream;
    const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    state.voiceInput.recorder = recorder;
    recorder.addEventListener("dataavailable", (event) => {
      if (event.data?.size > 0) {
        state.voiceInput.chunks.push(event.data);
      }
    });
    recorder.addEventListener("stop", () => {
      const chunks = [...state.voiceInput.chunks];
      const durationMs = state.voiceInput.startedAt ? Date.now() - state.voiceInput.startedAt : 0;
      const recordedMimeType = recorder.mimeType || mimeType || "audio/webm";
      const discardRecording = state.voiceInput.stopRequested;
      resetVoiceRecordingState();
      updateComposerState();
      if (!chunks.length || discardRecording) {
        return;
      }
      uploadVoiceRecording(new Blob(chunks, { type: recordedMimeType }), durationMs);
    });
    recorder.start();
    state.voiceInput.startedAt = Date.now();
    state.voiceInput.recording = true;
    state.voiceInput.starting = false;
    updateComposerState();
  } catch (error) {
    if (startRequestId !== voiceStartRequestId) {
      return;
    }
    resetVoiceRecordingState();
    state.voiceInput.starting = false;
    state.voiceInput.stopRequested = false;
    updateVoiceButton();
    showToast(mapMicrophonePermissionError(error), "error");
  }
}

function stopVoiceInput(options = {}) {
  const recorder = state.voiceInput.recorder;
  state.voiceInput.stopRequested = options.discard === true;
  if (state.voiceInput.starting) {
    voiceStartRequestId += 1;
  }
  state.voiceInput.starting = false;
  if (!recorder) {
    state.voiceInput.recording = false;
    updateComposerState();
    return;
  }
  try {
    recorder.stop();
  } catch {
    resetVoiceRecordingState();
  }
  updateComposerState();
}

function toggleVoiceInput() {
  if (state.voiceInput.transcribing) {
    abortVoiceTranscription();
    elements.chatInput.focus();
    return;
  }
  if (state.voiceInput.recording || state.voiceInput.starting) {
    stopVoiceInput();
    elements.chatInput.focus();
    return;
  }
  startVoiceInput();
}

function projectSplitHeightAvailable() {
  return elements.projectSplitView?.getBoundingClientRect().height || 0;
}

function clampProjectSplitHeight(height) {
  const totalHeight = projectSplitHeightAvailable();
  if (!totalHeight) {
    return Math.max(PROJECT_SPLIT_MIN_HEIGHT, Number(height) || PROJECT_SPLIT_DEFAULT_HEIGHT);
  }
  const maxHeight = Math.max(
    PROJECT_SPLIT_MIN_HEIGHT,
    totalHeight - PROJECT_SPLIT_MIN_PREVIEW_HEIGHT - PROJECT_SPLIT_HANDLE_HEIGHT
  );
  return Math.max(PROJECT_SPLIT_MIN_HEIGHT, Math.min(Number(height) || PROJECT_SPLIT_DEFAULT_HEIGHT, maxHeight));
}

function applyProjectSplitLayout() {
  if (!elements.projectSplitView || !elements.statusPanel || !elements.projectSplitHandle) {
    return;
  }
  const layout = state.projectSplitLayout;
  const expandedHeight = clampProjectSplitHeight(layout.lastExpandedHeight || layout.height || PROJECT_SPLIT_DEFAULT_HEIGHT);
  elements.projectSplitView.classList.toggle("status-collapsed", layout.collapsed);
  elements.statusPanel.classList.toggle("collapsed", layout.collapsed);
  elements.projectSplitHandle.classList.toggle("dragging", layout.resizing);
  elements.projectSplitHandle.setAttribute(
    "aria-label",
    layout.collapsed ? "Statusbereich aufklappen" : "Höhe zwischen Status und Vorschau anpassen"
  );
  elements.projectSplitHandle.setAttribute(
    "title",
    layout.collapsed ? "Statusbereich aufklappen" : "Höhe zwischen Status und Vorschau anpassen"
  );

  if (layout.collapsed) {
    elements.statusPanel.style.height = "0px";
    return;
  }

  layout.height = clampProjectSplitHeight(layout.height || expandedHeight);
  layout.lastExpandedHeight = layout.height;
  elements.statusPanel.style.height = `${layout.height}px`;
}

function expandProjectSplit(height = state.projectSplitLayout.lastExpandedHeight || PROJECT_SPLIT_DEFAULT_HEIGHT) {
  state.projectSplitLayout.collapsed = false;
  state.projectSplitLayout.height = clampProjectSplitHeight(height);
  state.projectSplitLayout.lastExpandedHeight = state.projectSplitLayout.height;
  applyProjectSplitLayout();
}

function collapseProjectSplit() {
  if (!state.projectSplitLayout.collapsed) {
    state.projectSplitLayout.lastExpandedHeight = clampProjectSplitHeight(
      state.projectSplitLayout.height || state.projectSplitLayout.lastExpandedHeight
    );
  }
  state.projectSplitLayout.collapsed = true;
  applyProjectSplitLayout();
}

function updateProjectSplitFromPointer(clientY) {
  const rect = elements.projectSplitView?.getBoundingClientRect();
  if (!rect) {
    return;
  }
  const nextHeight = clientY - rect.top;
  if (nextHeight <= PROJECT_SPLIT_COLLAPSE_THRESHOLD) {
    state.projectSplitLayout.collapsed = true;
    applyProjectSplitLayout();
    return;
  }
  state.projectSplitLayout.collapsed = false;
  state.projectSplitLayout.height = clampProjectSplitHeight(nextHeight);
  state.projectSplitLayout.lastExpandedHeight = state.projectSplitLayout.height;
  applyProjectSplitLayout();
}

function startProjectSplitResize(event) {
  if (event.button !== 0) {
    return;
  }
  event.preventDefault();
  state.projectSplitLayout.resizing = true;
  state.projectSplitLayout.pointerId = event.pointerId;
  state.projectSplitLayout.startY = event.clientY;
  state.projectSplitLayout.suppressClick = false;
  elements.projectSplitHandle.setPointerCapture?.(event.pointerId);
  applyProjectSplitLayout();
}

function moveProjectSplitResize(event) {
  if (!state.projectSplitLayout.resizing) {
    return;
  }
  if (Math.abs(event.clientY - state.projectSplitLayout.startY) > 3) {
    state.projectSplitLayout.suppressClick = true;
  }
  updateProjectSplitFromPointer(event.clientY);
}

function endProjectSplitResize() {
  if (!state.projectSplitLayout.resizing) {
    return;
  }
  state.projectSplitLayout.resizing = false;
  state.projectSplitLayout.pointerId = null;
  applyProjectSplitLayout();
}

function resetCanvasLayout() {
  if (state.canvasLayout?.resizeFrame) {
    window.cancelAnimationFrame(state.canvasLayout.resizeFrame);
  }
  const defaultWidth = Math.max(CANVAS_DEFAULT_WIDTH, Math.round((window.innerWidth || CANVAS_DEFAULT_WIDTH * 3) / 3));
  state.canvasLayout = {
    collapsed: true,
    docked: false,
    width: defaultWidth,
    lastExpandedWidth: defaultWidth,
    resizing: false,
    pointerId: null,
    startX: 0,
    suppressClick: false,
    dragBounds: null,
    pendingClientX: null,
    resizeFrame: null
  };
}

function canvasWorkspaceWidth() {
  return elements.workspaceView.getBoundingClientRect().width || 0;
}

function clampCanvasWidth(width, workspaceWidth = canvasWorkspaceWidth()) {
  const maxWidth = Math.max(CANVAS_MIN_WIDTH, workspaceWidth - CANVAS_MIN_CHAT_WIDTH - CANVAS_HANDLE_WIDTH);
  return Math.max(CANVAS_MIN_WIDTH, Math.min(width, maxWidth));
}

function applyCanvasLayout({ syncCandidateSheetWidths = !state.canvasLayout.resizing } = {}) {
  const layout = state.canvasLayout;
  const workspaceWidth = layout.resizing && layout.dragBounds ? layout.dragBounds.width : canvasWorkspaceWidth();
  const width = clampCanvasWidth(layout.docked ? layout.lastExpandedWidth : layout.width, workspaceWidth);
  elements.workspaceView.style.setProperty("--canvas-panel-width", `${width}px`);
  elements.workspaceView.classList.toggle("canvas-collapsed", layout.collapsed);
  elements.workspaceView.classList.toggle("canvas-docked", layout.docked && !layout.collapsed);
  elements.workspaceView.classList.toggle("canvas-resizing", layout.resizing);
  elements.canvasResizeHandle.setAttribute(
    "aria-label",
    layout.collapsed ? "Canvas aufziehen" : layout.docked ? "Canvas zurückziehen" : "Canvasgröße verändern"
  );
  if (syncCandidateSheetWidths) {
    requestCanvasCandidateSheetWidthSync();
  }
}

function syncCanvasCandidateSheetWidths() {
  const cards = elements.canvasBody?.querySelectorAll(".canvas-candidate-grid .candidate-preview-card") || [];
  cards.forEach((card) => {
    const stack = card.querySelector(".candidate-page-stack");
    const image = card.querySelector(".candidate-page-tile img");
    if (!image) {
      return;
    }
    if (stack?.classList.contains("multi")) {
      card.style.removeProperty("--canvas-sheet-width");
      return;
    }
    const updateCardWidth = () => {
      card.style.removeProperty("--canvas-sheet-width");
      const width = Math.round(image.getBoundingClientRect().width || 0);
      if (width > 0) {
        card.style.setProperty("--canvas-sheet-width", `${width}px`);
      }
    };
    updateCardWidth();
    if (!image.complete && !image.dataset.sheetWidthLoadBound) {
      image.dataset.sheetWidthLoadBound = "true";
      image.addEventListener("load", () => requestCanvasCandidateSheetWidthSync(), { once: true });
    }
  });
}

function requestCanvasCandidateSheetWidthSync() {
  if (state.activeCanvasMode !== "candidates" || state.canvasLayout.collapsed || !elements.canvasBody) {
    return;
  }
  if (state.canvasSheetWidthFrame) {
    window.cancelAnimationFrame(state.canvasSheetWidthFrame);
  }
  state.canvasSheetWidthFrame = window.requestAnimationFrame(() => {
    state.canvasSheetWidthFrame = null;
    syncCanvasCandidateSheetWidths();
  });
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

function revealCanvasPanel() {
  if (isMobileViewport() || !state.canvasLayout.collapsed) {
    return;
  }
  window.requestAnimationFrame(() => {
    expandCanvas();
    elements.canvasPanel?.scrollIntoView?.({
      behavior: "smooth",
      block: "nearest",
      inline: "nearest"
    });
  });
}

function shouldAutoRevealDesktopCanvasMode(mode) {
  return mode === "candidates";
}

function ensureDesktopCanvasVisibleForMode(mode) {
  if (isMobileViewport() || !shouldAutoRevealDesktopCanvasMode(mode) || !state.canvasLayout.collapsed) {
    return;
  }
  expandCanvas();
}

function dockCanvas() {
  state.canvasLayout.collapsed = false;
  state.canvasLayout.docked = true;
  applyCanvasLayout();
}

function updateCanvasFromPointer(clientX) {
  const rect = state.canvasLayout.dragBounds || elements.workspaceView.getBoundingClientRect();
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
  state.canvasLayout.width = clampCanvasWidth(nextWidth, rect.width);
  state.canvasLayout.lastExpandedWidth = state.canvasLayout.width;
  applyCanvasLayout();
}

function requestCanvasResizeFrame(clientX) {
  state.canvasLayout.pendingClientX = clientX;
  if (state.canvasLayout.resizeFrame) {
    return;
  }
  state.canvasLayout.resizeFrame = window.requestAnimationFrame(() => {
    state.canvasLayout.resizeFrame = null;
    if (!state.canvasLayout.resizing || typeof state.canvasLayout.pendingClientX !== "number") {
      return;
    }
    updateCanvasFromPointer(state.canvasLayout.pendingClientX);
  });
}

function flushCanvasResizeFrame() {
  if (state.canvasLayout.resizeFrame) {
    window.cancelAnimationFrame(state.canvasLayout.resizeFrame);
    state.canvasLayout.resizeFrame = null;
  }
  if (!state.canvasLayout.resizing || typeof state.canvasLayout.pendingClientX !== "number") {
    state.canvasLayout.pendingClientX = null;
    return;
  }
  updateCanvasFromPointer(state.canvasLayout.pendingClientX);
  state.canvasLayout.pendingClientX = null;
}

function startCanvasResize(event) {
  if (event.button !== 0) {
    return;
  }
  event.preventDefault();
  state.canvasLayout.dragBounds = elements.workspaceView.getBoundingClientRect();
  state.canvasLayout.pendingClientX = event.clientX;
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
  requestCanvasResizeFrame(event.clientX);
}

function endCanvasResize(event) {
  if (!state.canvasLayout.resizing) {
    return;
  }
  if (Number.isFinite(event?.clientX)) {
    state.canvasLayout.pendingClientX = event.clientX;
  }
  flushCanvasResizeFrame();
  elements.canvasResizeHandle.releasePointerCapture?.(state.canvasLayout.pointerId);
  state.canvasLayout.resizing = false;
  state.canvasLayout.pointerId = null;
  state.canvasLayout.dragBounds = null;
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
    const errorKey = `app.error.${payload?.error || "default"}`;
    const localized = t(errorKey);
    const passKey = `pass.error.${payload?.error || "default"}`;
    const passMessage = t(passKey);
    throw new Error(localized !== errorKey
      ? localized
      : passMessage !== passKey
        ? passMessage
        : appLocale?.current() === "de" && payload?.message
          ? payload.message
          : t("app.error.default"));
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
  return t("app.error.network");
}

function showToast(message, kind = "default") {
  elements.toast.textContent = message;
  elements.toast.classList.remove("success", "error", "warning", "info");
  if (kind !== "default") {
    elements.toast.classList.add(kind);
  }
  elements.toast.classList.add("visible");
  window.clearTimeout(showToast.timer);
  showToast.timer = window.setTimeout(() => {
    elements.toast.classList.remove("visible");
  }, 2600);
}

function worksheetDepositToastMessage(result = {}) {
  const item = result.item || result.existing || result.items?.[0] || null;
  if (result.duplicate) {
    return item?.kind === "worksheet_bundle"
      ? "Arbeitsblätter waren schon abgelegt"
      : "Arbeitsblatt war schon abgelegt";
  }
  return `${worksheetDepositStoredLabel(item)} abgelegt`;
}

function isImageUrl(url) {
  return /\.(png|jpe?g|webp|gif|svg)(?:\?|$)/i.test(String(url || ""));
}

function openAssetViewer(url, options = {}) {
  if (!url) {
    return;
  }
  openCandidateViewer([{
    viewerKind: "asset",
    url,
    title: options.title || fileName(url),
    role: options.role || "Bild"
  }], 0);
}

function openUrl(url) {
  if (!url) {
    return;
  }
  if (isImageUrl(url)) {
    openAssetViewer(url);
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

function downloadBlob(blob, fileNameHint) {
  const objectUrl = URL.createObjectURL(blob);
  try {
    downloadUrl(objectUrl, fileNameHint);
  } finally {
    window.setTimeout(() => URL.revokeObjectURL(objectUrl), 5000);
  }
}

function absoluteAppUrl(url) {
  return new URL(url, window.location.href).href;
}

function isShareAbort(error) {
  return error?.name === "AbortError";
}

function canUseNativeShare() {
  return window.isSecureContext && typeof navigator.share === "function";
}

function canUseNativeFileShare(file) {
  return canUseNativeShare()
    && typeof navigator.canShare === "function"
    && file
    && navigator.canShare({ files: [file] });
}

function worksheetShareFileCacheKey(url, fileNameHint) {
  return `${absoluteAppUrl(url)}::${fileNameHint || fileName(url) || "arbeitsblatt.pdf"}`;
}

function cachedWorksheetShareFile(url, fileNameHint) {
  return worksheetShareFileCache.get(worksheetShareFileCacheKey(url, fileNameHint))?.file || null;
}

function prepareWorksheetShareFile({ url, fileNameHint } = {}) {
  if (!url || !window.File) {
    return null;
  }
  const key = worksheetShareFileCacheKey(url, fileNameHint);
  const cached = worksheetShareFileCache.get(key);
  if (cached?.promise) {
    return cached.promise;
  }
  const promise = fetch(url)
    .then((response) => {
      if (!response.ok) {
        throw new Error("PDF konnte nicht geladen werden.");
      }
      return response.blob();
    })
    .then((blob) => {
      const pdfFile = new File([blob], fileNameHint || fileName(url) || "arbeitsblatt.pdf", {
        type: blob.type || "application/pdf"
      });
      worksheetShareFileCache.set(key, { file: pdfFile, promise: Promise.resolve(pdfFile) });
      return pdfFile;
    })
    .catch((error) => {
      worksheetShareFileCache.delete(key);
      throw error;
    });
  worksheetShareFileCache.set(key, { file: null, promise });
  return promise;
}

async function writeClipboardText(text) {
  if (navigator.clipboard?.writeText && window.isSecureContext) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Fall through to the legacy copy path when the page is not focused.
    }
  }

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.left = "-9999px";
  textarea.style.top = "0";
  document.body.append(textarea);
  textarea.select();
  let copied = false;
  try {
    copied = document.execCommand("copy");
  } catch {
    copied = false;
  }
  textarea.remove();
  if (!copied) {
    openManualCopy(text);
    return false;
  }
  return true;
}

async function shareWorksheetPdf({ url, title, fileNameHint } = {}) {
  if (!url) {
    return;
  }
  const shareTitle = String(title || fileNameHint || "Arbeitsblatt").trim() || "Arbeitsblatt";
  const shareText = `${shareTitle} als PDF`;

  try {
    const pdfFile = cachedWorksheetShareFile(url, fileNameHint)
      || await prepareWorksheetShareFile({ url, fileNameHint });
    if (canUseNativeFileShare(pdfFile)) {
      await navigator.share({
        title: shareTitle,
        text: shareText,
        files: [pdfFile]
      });
      return;
    }
    const reason = window.isSecureContext
      ? "Dieser Browser kann PDF-Dateien nicht direkt teilen."
      : "Direktes Android-Teilen braucht HTTPS. Über diese LAN-Adresse blockiert der Browser die PDF-Übergabe.";
    showToast(reason, "error");
  } catch (error) {
    if (isShareAbort(error)) {
      return;
    }
    showToast(error.message || "PDF konnte nicht geteilt werden.", "error");
  }
}

async function downloadPreparedWorksheetPdf({ url, fileNameHint } = {}) {
  if (!url) {
    return;
  }
  try {
    const pdfFile = cachedWorksheetShareFile(url, fileNameHint)
      || await prepareWorksheetShareFile({ url, fileNameHint });
    if (pdfFile) {
      downloadBlob(pdfFile, fileNameHint || pdfFile.name || fileName(url));
      return;
    }
  } catch (error) {
    showToast(error.message || "PDF konnte nicht vorbereitet werden.", "error");
    return;
  }
  downloadUrl(url, fileNameHint);
}

function isManualCopyOpen() {
  return elements.manualCopyModal && !elements.manualCopyModal.classList.contains("hidden");
}

function openManualCopy(text) {
  if (!elements.manualCopyModal || !elements.manualCopyText) {
    return;
  }
  elements.manualCopyText.value = text;
  elements.manualCopyModal.classList.remove("hidden");
  elements.manualCopyModal.setAttribute("aria-hidden", "false");
  window.setTimeout(() => {
    elements.manualCopyText.focus();
    elements.manualCopyText.select();
    elements.manualCopyText.setSelectionRange(0, elements.manualCopyText.value.length);
  }, 0);
}

function closeManualCopy() {
  if (!elements.manualCopyModal) {
    return;
  }
  elements.manualCopyModal.classList.add("hidden");
  elements.manualCopyModal.setAttribute("aria-hidden", "true");
}

function openVoiceTranscriptReview() {
  if (!shouldShowVoiceTranscriptReviewButton() || !elements.voiceTranscriptLayer || !elements.voiceTranscriptText) {
    return;
  }
  state.voiceTranscriptReview.lastFocusedElement = document.activeElement;
  elements.voiceTranscriptText.value = elements.chatInput?.value || "";
  elements.voiceTranscriptLayer.classList.remove("hidden");
  elements.voiceTranscriptLayer.setAttribute("aria-hidden", "false");
  elements.voiceTranscriptReviewButton?.setAttribute("aria-expanded", "true");
  window.setTimeout(() => {
    elements.voiceTranscriptText?.focus();
    elements.voiceTranscriptText?.setSelectionRange?.(
      elements.voiceTranscriptText.value.length,
      elements.voiceTranscriptText.value.length
    );
  }, 0);
}

function closeVoiceTranscriptReview(options = {}) {
  if (!elements.voiceTranscriptLayer) {
    return;
  }
  elements.voiceTranscriptLayer.classList.add("hidden");
  elements.voiceTranscriptLayer.setAttribute("aria-hidden", "true");
  elements.voiceTranscriptReviewButton?.setAttribute("aria-expanded", "false");
  const lastFocusedElement = state.voiceTranscriptReview.lastFocusedElement;
  state.voiceTranscriptReview.lastFocusedElement = null;
  if (options.restoreFocus !== false) {
    (lastFocusedElement || elements.voiceTranscriptReviewButton)?.focus?.();
  }
}

function saveVoiceTranscriptReview() {
  if (!elements.voiceTranscriptText) {
    return;
  }
  setChatInputValue(elements.voiceTranscriptText.value);
  closeVoiceTranscriptReview({ restoreFocus: false });
  elements.chatInput?.focus();
  updateComposerState();
}

function shareButtons() {
  return [elements.shareButton, elements.workspaceMobileShareButton].filter(Boolean);
}

function currentWorksheetId() {
  return state.selectedItem?.worksheet?.worksheetId
    || (isTreeWorksheetItemId(state.selectedId) ? worksheetIdFromItemId(state.selectedId) : "");
}

function currentShareRoute() {
  if (state.mode === "workspace") {
    return {
      view: "projects",
      projectId: "",
      worksheetId: ""
    };
  }

  if (!isProjectsLibraryView()) {
    return {
      view: "worksheets",
      projectId: currentProjectId(),
      worksheetId: currentWorksheetId()
    };
  }

  return {
    view: "projects",
    projectId: "",
    worksheetId: ""
  };
}

function shareUrlFromLocation() {
  const url = new URL(window.location.href);
  url.hash = "";
  url.search = "";
  const route = currentShareRoute();
  if (route.view) {
    url.searchParams.set("view", route.view);
  }
  if (route.projectId) {
    url.searchParams.set("project", route.projectId);
  }
  if (route.worksheetId) {
    url.searchParams.set("worksheet", route.worksheetId);
  }
  return url.toString();
}

function shareRequestKey() {
  const route = currentShareRoute();
  return [shareUrlFromLocation(), route.projectId || "", route.worksheetId || ""].join("|");
}

function selectedShareTarget() {
  const share = state.sharePanel.data || {};
  const targets = share.targets || [];
  return targets.find((target) => target.id === state.sharePanel.selectedTargetId)
    || targets.find((target) => target.id === share.primaryTargetId)
    || targets[0]
    || null;
}

function syncShareButtons() {
  for (const button of shareButtons()) {
    button.classList.toggle("active", state.sharePanel.open);
    button.setAttribute("aria-expanded", state.sharePanel.open ? "true" : "false");
  }
}

function allowShareFocusOpenSoon() {
  window.setTimeout(() => {
    state.sharePanel.suppressFocusOpen = false;
  }, 0);
}

function clearShareCloseTimer() {
  if (state.sharePanel.closeTimer) {
    window.clearTimeout(state.sharePanel.closeTimer);
    state.sharePanel.closeTimer = null;
  }
}

function isSharePanelOpen() {
  return Boolean(elements.sharePopover && state.sharePanel.open && !elements.sharePopover.classList.contains("hidden"));
}

function renderSharePanel() {
  if (!elements.sharePopover) {
    return;
  }

  const panel = state.sharePanel;
  const target = selectedShareTarget();
  const loading = panel.loading && !target;
  elements.sharePopover.classList.toggle("loading", loading);

  if (elements.shareStatus) {
    elements.shareStatus.textContent = panel.error
      ? "Nicht verbunden"
      : target ? `${target.label}${target.detail ? ` · ${target.detail}` : ""}` : "Adresse wird geladen...";
  }

  if (elements.shareQrCode) {
    if (target?.qrSvg) {
      elements.shareQrCode.innerHTML = target.qrSvg;
    } else if (panel.error) {
      elements.shareQrCode.innerHTML = `<span>${escapeHtml(panel.error)}</span>`;
    } else {
      elements.shareQrCode.innerHTML = '<span class="mini-spinner" aria-hidden="true"></span>';
    }
  }

  if (elements.shareUrlText) {
    elements.shareUrlText.textContent = target?.url || shareUrlFromLocation();
  }

  if (elements.shareHint) {
    elements.shareHint.textContent = panel.error
      ? "Die aktuelle Adresse kann trotzdem kopiert werden."
      : panel.data?.message || "";
  }

  const targets = panel.data?.targets || [];
  if (elements.shareTargetList) {
    elements.shareTargetList.innerHTML = targets.length > 1
      ? targets.map((entry) => `
        <button class="share-target-button${entry.id === target?.id ? " active" : ""}" type="button" data-share-target-id="${escapeHtml(entry.id)}">
          <span>${escapeHtml(entry.label)}</span>
          <small>${escapeHtml(entry.detail || "")}</small>
        </button>
      `).join("")
      : "";
    elements.shareTargetList.classList.toggle("hidden", targets.length <= 1);
    elements.shareTargetList.querySelectorAll("[data-share-target-id]").forEach((button) => {
      button.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        clearShareCloseTimer();
        state.sharePanel.selectedTargetId = button.dataset.shareTargetId || null;
        state.sharePanel.pinned = true;
        renderSharePanel();
        syncShareButtons();
      });
    });
  }
}

async function refreshShareTargets() {
  const key = shareRequestKey();
  if (state.sharePanel.loading) {
    renderSharePanel();
    return;
  }

  const refreshId = ++shareRefreshId;
  state.sharePanel.loading = true;
  state.sharePanel.error = null;
  state.sharePanel.requestKey = key;
  renderSharePanel();

  try {
    const route = currentShareRoute();
    const params = new URLSearchParams({
      currentUrl: shareUrlFromLocation()
    });
    if (route.projectId) {
      params.set("projectId", route.projectId);
    }
    const payload = await fetchJson(`/api/share/targets?${params}`);
    if (refreshId !== shareRefreshId) {
      return;
    }
    state.sharePanel.data = payload.share;
    const targetStillExists = payload.share?.targets?.some((target) => target.id === state.sharePanel.selectedTargetId);
    if (!targetStillExists) {
      state.sharePanel.selectedTargetId = payload.share?.primaryTargetId || payload.share?.targets?.[0]?.id || null;
    }
  } catch (error) {
    if (refreshId !== shareRefreshId) {
      return;
    }
    state.sharePanel.error = "QR nicht verfügbar";
    state.sharePanel.data = null;
  } finally {
    if (refreshId === shareRefreshId) {
      state.sharePanel.loading = false;
      renderSharePanel();
    }
  }
}

function openSharePanel(options = {}) {
  if (!elements.sharePopover) {
    return;
  }
  clearShareCloseTimer();
  state.sharePanel.open = true;
  state.sharePanel.pinned = Boolean(options.pinned || state.sharePanel.pinned);
  if (state.sharePanel.pinned && !state.sharePanel.lastFocusedElement) {
    state.sharePanel.lastFocusedElement = document.activeElement;
  }
  elements.sharePopover.classList.remove("hidden");
  elements.sharePopover.setAttribute("aria-hidden", "false");
  syncShareButtons();
  renderSharePanel();
  refreshShareTargets();
}

function closeSharePanel(options = {}) {
  if (!elements.sharePopover) {
    return;
  }
  clearShareCloseTimer();
  state.sharePanel.open = false;
  state.sharePanel.pinned = false;
  state.sharePanel.suppressFocusOpen = true;
  elements.sharePopover.classList.add("hidden");
  elements.sharePopover.setAttribute("aria-hidden", "true");
  syncShareButtons();
  if (options.restoreFocus) {
    const lastFocusedElement = state.sharePanel.lastFocusedElement;
    state.sharePanel.lastFocusedElement = null;
    lastFocusedElement?.focus?.();
  } else {
    state.sharePanel.lastFocusedElement = null;
  }
  allowShareFocusOpenSoon();
}

function scheduleSharePanelClose() {
  clearShareCloseTimer();
  if (state.sharePanel.pinned) {
    return;
  }
  state.sharePanel.closeTimer = window.setTimeout(() => {
    closeSharePanel();
  }, 280);
}

function togglePinnedSharePanel() {
  if (isSharePanelOpen() && state.sharePanel.pinned) {
    closeSharePanel({ restoreFocus: true });
    return;
  }
  state.sharePanel.pinned = false;
  openSharePanel({ pinned: true });
}

async function copySelectedShareUrl() {
  const target = selectedShareTarget();
  const url = target?.url || shareUrlFromLocation();
  try {
    await writeClipboardText(url);
    showToast("Link kopiert", "success");
  } catch (error) {
    showToast(error.message || "Link konnte nicht kopiert werden.", "error");
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
    draftDisplayLabel({ id: source.candidateId }),
    source.page ? `Seite ${source.page}` : null
  ].filter(Boolean).join(" · ");
}

async function attachVisualFeedbackFromSelection(card, displayRect) {
  const image = card.querySelector("[data-capture-image]");
  if (!image) {
    throw new Error("Kein Entwurfsbild gefunden.");
  }
  if (!image.naturalWidth || !image.naturalHeight) {
    throw new Error("Das Entwurfsbild ist noch nicht bereit.");
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
}

function startCanvasCapture(event) {
  if (!state.canvasCapture.active || event.button !== 0) {
    return;
  }
  const card = event.target.closest("[data-capture-kind='candidate']");
  if (!card || !elements.canvasBody.contains(card)) {
    showToast("Bitte direkt auf einem Entwurfsbild markieren.", "error");
    return;
  }
  const image = card.querySelector("[data-capture-image]");
  if (!image) {
    showToast("Dieser Entwurf kann nicht markiert werden.", "error");
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
    size: attachment.size || null,
    path: attachment.path || null,
    originalName: attachment.originalName || null,
    artifactId: attachment.artifactId || null,
    dataUrl: attachment.dataUrl,
    source: attachment.source,
    userInstructionRequired: attachment.userInstructionRequired === true
  }));
}

function inputUploadAttachmentFromReceipt(receipt = {}) {
  if (receipt.status !== "saved" || !receipt.uploadedFile?.path) {
    return null;
  }
  const file = receipt.uploadedFile;
  const originalName = file.originalName || receipt.label || fileName(file.path);
  const mimeType = file.mimeType || receipt.mimeType || "application/octet-stream";
  const size = Number(file.size || receipt.size || 0) || 0;
  return {
    id: file.artifactId || receipt.id,
    kind: "input_upload",
    label: originalName,
    originalName,
    mimeType,
    size,
    path: file.path,
    artifactId: file.artifactId || null,
    source: {
      kind: "input_upload",
      artifactId: file.artifactId || null,
      path: file.path,
      originalName,
      mimeType,
      size
    }
  };
}

function inputUploadAttachmentsForRequest(receipts = state.inputUploadReceipts) {
  return receipts
    .map(inputUploadAttachmentFromReceipt)
    .filter(Boolean);
}

function chatUiEventForAttachments(attachments = []) {
  if (attachments.some((attachment) => attachment.kind === "visual_feedback")) {
    return "visual_feedback";
  }
  if (attachments.some((attachment) => attachment.kind === "input_upload")) {
    return "input_upload";
  }
  return "chat_message";
}

function textTargetValue(value, max = 160) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  return text ? text.slice(0, max) : null;
}

function numberTargetValue(value) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : null;
}

function normalizeRevisionTarget(target = null) {
  if (!target || typeof target !== "object") {
    return null;
  }
  const kind = target.kind === "concept" || target.kind === "draft" ? target.kind : null;
  if (!kind) {
    return null;
  }
  const base = {
    source: target.source === "inferred" ? "inferred" : "explicit",
    kind,
    label: textTargetValue(target.label, 80),
    projectId: textTargetValue(target.projectId, 120) || currentProjectId()
  };
  if (kind === "concept") {
    return {
      ...base,
      contentMirrorId: textTargetValue(target.contentMirrorId || target.conceptId, 160),
      proposalId: textTargetValue(target.proposalId, 160),
      conceptVersion: numberTargetValue(target.conceptVersion),
      elementId: textTargetValue(target.elementId, 160),
      elementType: textTargetValue(target.elementType, 40),
      elementLabel: textTargetValue(target.elementLabel, 120),
      elementPage: numberTargetValue(target.elementPage)
    };
  }
  return {
    ...base,
    runId: textTargetValue(target.runId, 160),
    candidateId: textTargetValue(target.candidateId, 160),
    page: numberTargetValue(target.page)
  };
}

function revisionTargetForRequest(target = null) {
  const normalized = normalizeRevisionTarget(target);
  if (!normalized) {
    return null;
  }
  return Object.fromEntries(Object.entries(normalized).filter(([, value]) => value !== null && value !== ""));
}

function revisionTargetDisplayLabel(target = null) {
  if (!target) {
    return "";
  }
  if (target.kind === "concept") {
    const label = String(target.label || "").trim();
    if (/offener\s+konzeptvorschlag/i.test(label)) {
      return "Offener Konzeptvorschlag";
    }
    const labelVersion = label.match(/\b(?:AB-Konzept|Arbeitsblatt-Konzept|Konzept|Version|v)\s*v?(\d+)\b/i);
    const version = numberTargetValue(target.conceptVersion || labelVersion?.[1]);
    const elementLabel = textTargetValue(target.elementLabel, 120);
    if (elementLabel) {
      return version ? `Konzept v${version} · ${elementLabel}` : `Konzept · ${elementLabel}`;
    }
    if (version) {
      return `Konzept v${version}`;
    }
    return label
      ? label.replace(/^AB-Konzept\b/i, "Konzept").replace(/^Arbeitsblatt-Konzept\b/i, "Konzept")
      : "Konzept";
  }
  if (target.label) {
    return target.label;
  }
  return target.candidateId ? draftDisplayLabel({ id: target.candidateId }) : "Entwurf";
}

function renderRevisionTargetPill() {
  const pill = elements.revisionTargetPill;
  if (!pill || !elements.revisionTargetLabel) {
    return;
  }
  const target = normalizeRevisionTarget(state.revisionTarget);
  if (!target) {
    pill.classList.add("hidden");
    pill.removeAttribute("data-kind");
    elements.chatInputShell?.classList.remove("has-revision-target");
    elements.revisionTargetLabel.textContent = "";
    return;
  }
  const label = revisionTargetDisplayLabel(target);
  pill.classList.remove("hidden");
  pill.dataset.kind = target.kind;
  elements.chatInputShell?.classList.add("has-revision-target");
  pill.title = target.kind === "concept"
    ? "Nächste Nachricht bezieht sich auf dieses Arbeitsblatt-Konzept"
    : "Nächste Nachricht bezieht sich auf diesen Entwurf";
  elements.revisionTargetLabel.textContent = label;
}

function setRevisionTarget(target = null, options = {}) {
  const normalized = normalizeRevisionTarget(target);
  if (!normalized) {
    showToast("Bearbeitungsbezug konnte nicht gesetzt werden.", "error");
    return false;
  }
  state.revisionTarget = normalized;
  renderRevisionTargetPill();
  if (options.focus !== false) {
    elements.chatInput?.focus();
  }
  return true;
}

function clearRevisionTarget(options = {}) {
  state.revisionTarget = null;
  renderRevisionTargetPill();
  if (options.focus) {
    elements.chatInput?.focus();
  }
}

function currentConceptRevisionTarget(extra = {}) {
  const concepts = workspaceConceptArtifacts(state.workspace || {});
  const requestedConcept = extra.contentMirrorId
    ? concepts.find((concept) => concept.id === extra.contentMirrorId)
    : null;
  const requestedVersion = extra.conceptVersion
    ? concepts.find((concept) => Number(concept.version || 0) === Number(extra.conceptVersion))
    : null;
  const current = requestedConcept || requestedVersion || currentConceptArtifact(state.workspace || {}, concepts);
  const currentContent = state.workspace?.artifacts?.currentContent || {};
  const version = numberTargetValue(extra.conceptVersion || current?.version || currentContent.version);
  return {
    source: "explicit",
    kind: "concept",
    label: version ? `AB-Konzept ${conceptVersionDisplayName(version).replace(/^Version /, "")}` : "AB-Konzept",
    projectId: currentProjectId(),
    contentMirrorId: extra.contentMirrorId || current?.id || currentContent.id || null,
    conceptVersion: version,
    ...extra
  };
}

function candidateRevisionTargetFromElement(node = null) {
  if (!node) {
    return null;
  }
  const candidateId = textTargetValue(node.dataset.candidateId, 160);
  if (!candidateId) {
    return null;
  }
  const runId = textTargetValue(node.dataset.runId, 160);
  const candidate = findCandidatePreview(candidateId, runId) || { id: candidateId, runId };
  const displayCandidate = candidateForDisplay(candidate, state.workspace || {});
  return {
    source: "explicit",
    kind: "draft",
    label: textTargetValue(node.dataset.displayLabel, 80) || draftDisplayLabel(displayCandidate),
    projectId: currentProjectId(),
    runId,
    candidateId,
    page: numberTargetValue(node.dataset.page)
  };
}

function startConceptRevisionFromButton(button = null) {
  const selectedElement = state.blueprintSelection;
  const elementTarget = selectedElement
    ? {
        elementId: selectedElement.id,
        elementType: selectedElement.type,
        elementLabel: selectedElement.label,
        elementPage: selectedElement.page
      }
    : {};
  const proposalId = textTargetValue(button?.dataset.proposalId, 160);
  if (proposalId) {
    return setRevisionTarget({
      source: "explicit",
      kind: "concept",
      label: "Offener Konzeptvorschlag",
      projectId: currentProjectId(),
      proposalId,
      ...elementTarget
    });
  }
  const extra = {};
  const contentMirrorId = textTargetValue(button?.dataset.contentMirrorId, 160);
  const conceptVersion = numberTargetValue(button?.dataset.conceptVersion);
  if (contentMirrorId) {
    extra.contentMirrorId = contentMirrorId;
  }
  if (conceptVersion) {
    extra.conceptVersion = conceptVersion;
  }
  if (!extra.contentMirrorId && state.activeArtifactSelection?.kind === "concept") {
    extra.contentMirrorId = state.activeArtifactSelection.id || state.activeArtifactSelection.conceptId || null;
  }
  if (!extra.conceptVersion && state.activeArtifactSelection?.kind === "concept") {
    extra.conceptVersion = numberTargetValue(state.activeArtifactSelection.conceptVersion);
  }
  const target = currentConceptRevisionTarget(extra);
  return setRevisionTarget({ ...target, ...elementTarget });
}

function startDraftRevisionFromElement(node = null) {
  const target = candidateRevisionTargetFromElement(node);
  return setRevisionTarget(target);
}

function bindRevisionTargetActions(container) {
  if (!container) {
    return;
  }
  container.querySelectorAll("[data-revise-concept]").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      startConceptRevisionFromButton(button);
    });
  });
  container.querySelectorAll("[data-card-action='revise-candidate']").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      startDraftRevisionFromElement(button.closest("[data-capture-kind='candidate']") || button);
    });
  });
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
  return String(filePath || "").split("/").pop() || t("app.chat.file");
}

function conceptLabel(reference = {}) {
  if (!reference || (!reference.conceptId && !reference.conceptVersion)) {
    return "";
  }
  if (reference.label) {
    return reference.label;
  }
  return reference.conceptVersion ? t("app.concept.version", { number: reference.conceptVersion }) : t("app.concept.title");
}

function conceptVersionDisplayName(version) {
  const normalized = Number(version || 0) || null;
  return normalized ? t("app.concept.version", { number: normalized }) : t("app.concept.current");
}

function worksheetConceptCollectionLabel(count = 1) {
  return (Number(count || 0) || 0) > 1
    ? (appLocale?.current() === "en" ? "Worksheet concepts" : "Arbeitsblatt-Konzepte")
    : t("app.concept.title");
}

function worksheetDepositActionLabel(pageCount = 1) {
  if (appLocale?.current() === "en") {
    return (Number(pageCount || 0) || 1) > 1 ? "Save worksheets" : "Save worksheet";
  }
  return (Number(pageCount || 0) || 1) > 1 ? "Arbeitsblätter ablegen" : "Arbeitsblatt ablegen";
}

const candidateCardRenderer = window.SheetifyIMGCandidateCards.createCandidateCardRenderer({
  escapeHtml,
  icon,
  fileName,
  conceptLabel,
  worksheetDepositActionLabel,
  draftDisplayLabel,
  draftFilePrefix,
  draftMetaLabel
});

const actionBindings = window.SheetifyIMGActionBindings.createActionBindings({
  executeCommand,
  parsePayload,
  handleCanvasModeRequest,
  artifactSelectionFromButton,
  openCandidateInfo,
  downloadUrl,
  fileName,
  showToast,
  depositCandidateWorksheet,
  openWorksheetInLibrary,
  isCanvasCaptureActive: () => state.canvasCapture.active,
  isMobileViewport,
  openMobilePreview,
  openCandidateViewerFromCard,
  openWorksheetViewerFromCard,
  openUrl
});

const worksheetBlueprint = window.SheetifyIMGWorksheetBlueprint.createWorksheetBlueprint({
  escapeHtml,
  t,
  onSelectionChange(selection) {
    state.blueprintSelection = selection;
  },
  onRevise(selection) {
    state.blueprintSelection = selection;
    const updated = startConceptRevisionFromButton();
    if (!updated) {
      return;
    }
    if (elements.mobilePreviewLayer && !elements.mobilePreviewLayer.classList.contains("hidden")) {
      closeMobilePreview();
    }
    elements.chatInput?.focus();
  }
});

const mobilePreviewRenderer = window.SheetifyIMGMobilePreviewRenderer.createMobilePreviewRenderer({
  escapeHtml,
  icon,
  renderIcon,
  fileName,
  conceptLabel,
  sourceFilesFrom,
  sourceFileUrl,
  projectIdFromItemId,
  conceptSectionsFromContent,
  renderConceptDocumentHeader,
  renderConceptSections,
  renderWorksheetBlueprint: worksheetBlueprint.render,
  proposalForMode,
  buttonActionForCommand,
  isBusyGenerateCandidateAction,
  shouldDisableGenerateCandidateAction,
  renderCandidateImageDownloadButton,
  candidateImageDownloads,
  draftDisplayLabel,
  draftFilePrefix,
  annotateCandidateDisplayList,
  teachingContextNote,
  teachingContextFieldRows,
  buildStatusRows,
  countPreviewCandidates,
  candidateCountLabel,
  inputArtifactMeta,
  worksheetConceptSubtitle,
  workspaceConceptArtifacts,
  currentConceptArtifact,
  conceptVersionDisplayName,
  conceptArtifactMeta,
  statusWord
});

const canvasRenderer = window.SheetifyIMGCanvasRenderer.createCanvasRenderer({
  escapeHtml,
  sourceFilesFrom,
  renderSourceInputs,
  renderRawInputMessages,
  conceptSectionsFromContent,
  renderConceptDocumentHeader,
  renderConceptSections,
  renderWorksheetBlueprint: worksheetBlueprint.render,
  statusWord,
  workspaceConceptArtifacts,
  currentConceptArtifact,
  annotateCandidateDisplayList,
  workspaceCandidateHistory,
  renderCandidateCard,
  renderPageCard
});

function worksheetDepositStoredLabel(item = {}) {
  return item?.kind === "worksheet_bundle" ? "Arbeitsblätter" : "Arbeitsblatt";
}

function sourceFilesFrom(source = {}) {
  return Array.isArray(source.manifest?.files) ? source.manifest.files : [];
}

function opaqueFileUrl(relativePath) {
  const bytes = new TextEncoder().encode(String(relativePath || ""));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return `/api/files/${btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")}`;
}

function sourceFileUrl(projectId, file = {}) {
  if (!projectId || !file.path) {
    return null;
  }
  return opaqueFileUrl(`projects/${projectId}/${file.path}`);
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
    return ["export", "selected", "exported"].includes(project.productStage) ? "drafts" : project.productStage;
  }
  if (project.status === "exported" || project.status === "selected" || project.status === "has_candidates") {
    return "drafts";
  }
  if (project.status === "needs_approval" || project.status === "ready_for_generation" || project.status === "draft") {
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
  if (stage === "concept" || stage === "drafts" || stage === "has_candidates" || stage === "needs_approval" || stage === "ready_for_generation" || stage === "export" || stage === "selected" || stage === "exported") {
    return `In Arbeit: ${productStageLabel(stage)}`;
  }
  return `Offen: ${productStageLabel(stage)}`;
}

function projectIdFromItemId(itemId) {
  return String(itemId || "").replace(/^project:/, "");
}

function worksheetIdFromItemId(itemId) {
  return String(itemId || "").replace(/^worksheet:/, "");
}

function isTreeProjectItemId(itemId) {
  return /^project:/.test(String(itemId || ""));
}

function isTreeWorksheetItemId(itemId) {
  return /^worksheet:/.test(String(itemId || ""));
}

function isSelectableTreeItemId(itemId) {
  return isTreeProjectItemId(itemId) || isTreeWorksheetItemId(itemId);
}

function selectedTreeProjectItemIds() {
  return [...state.selectedTreeItemIds].filter((itemId) => isTreeProjectItemId(itemId));
}

function treeSelectionCount() {
  return selectedTreeProjectItemIds().length;
}

function isProjectsLibraryView() {
  return state.libraryView === "projects";
}

function libraryViewForItemId(itemId) {
  if (isTreeWorksheetItemId(itemId)) {
    return "worksheets";
  }
  if (isTreeProjectItemId(itemId)) {
    return "projects";
  }
  return "";
}

function rememberLibrarySelection(itemId = state.selectedId) {
  if (!isSelectableTreeItemId(itemId)) {
    return;
  }
  const view = libraryViewForItemId(itemId);
  if (!view) {
    return;
  }
  state.librarySelections[view] = itemId;
}

function rememberedLibrarySelection(view = state.libraryView) {
  return state.librarySelections?.[view] || null;
}

function restoreRememberedLibrarySelection(view = state.libraryView) {
  const itemId = rememberedLibrarySelection(view);
  if (!itemId) {
    setTreeSelection([]);
    return;
  }
  setTreeSelection([itemId], {
    primaryId: itemId,
    anchorId: itemId
  });
}

function forgetLibrarySelection(itemId) {
  for (const view of ["projects", "worksheets"]) {
    if (state.librarySelections[view] === itemId) {
      state.librarySelections[view] = null;
    }
  }
}

function renderLibraryViewChrome() {
  const projectsActive = isProjectsLibraryView();
  elements.projectsViewButton?.classList.toggle("active", projectsActive);
  elements.worksheetsViewButton?.classList.toggle("active", !projectsActive);
  elements.projectsViewButton?.setAttribute("aria-selected", projectsActive ? "true" : "false");
  elements.worksheetsViewButton?.setAttribute("aria-selected", projectsActive ? "false" : "true");

  if (elements.sidebarEyebrow) {
    elements.sidebarEyebrow.textContent = t("app.sidebar.label");
  }
  if (elements.sidebarTitle) {
    elements.sidebarTitle.textContent = t(projectsActive ? "app.sidebar.projects" : "app.sidebar.worksheets");
  }
  if (elements.newWorksheetButton) {
    elements.newWorksheetButton.classList.toggle("hidden", !projectsActive);
    elements.newWorksheetButton.disabled = !projectsActive;
    elements.newWorksheetButton.title = t("app.sidebar.newProject");
    elements.newWorksheetButton.setAttribute("aria-label", t("app.sidebar.newProject"));
  }
  if (elements.searchInput) {
    elements.searchInput.disabled = false;
    elements.searchInput.placeholder = t(projectsActive ? "app.sidebar.searchProjects" : "app.sidebar.searchWorksheets");
    elements.searchInput.setAttribute("aria-label", t(projectsActive ? "app.sidebar.searchAriaProjects" : "app.sidebar.searchAriaWorksheets"));
  }
  if (elements.tree) {
    elements.tree.setAttribute("aria-label", projectsActive ? t("app.sidebar.tree") : t("app.sidebar.worksheets"));
  }
}

function renderWorksheetsEmptyState() {
  elements.projectView.classList.add("hidden");
  elements.workspaceView.classList.add("hidden");
  elements.emptyState.classList.remove("hidden");
  if (elements.emptyStateTitle) {
    elements.emptyStateTitle.textContent = t("app.empty.worksheetTitle");
  }
  if (elements.emptyStateCopy) {
    elements.emptyStateCopy.textContent = t("app.empty.worksheetCopy");
  }
}

function renderMissingRouteState(route = {}) {
  const target = t(route.worksheetId ? "app.target.worksheet" : "app.target.project");
  elements.projectView.classList.add("hidden");
  elements.workspaceView.classList.add("hidden");
  elements.emptyState.classList.remove("hidden");
  if (elements.emptyStateTitle) {
    elements.emptyStateTitle.textContent = t("app.empty.notFound", { target });
  }
  if (elements.emptyStateCopy) {
    elements.emptyStateCopy.textContent = t("app.empty.notFoundCopy", { target: target.toLowerCase() });
  }
  showToast(t("app.empty.notFound", { target }), "warning");
}

function setLibraryView(view) {
  const nextView = view === "worksheets" ? "worksheets" : "projects";
  if (state.libraryView === nextView) {
    rememberLibrarySelection();
    renderLibraryViewChrome();
    loadTree({ keepSelection: true, selectAfterLoad: state.mode === "library" });
    return;
  }

  rememberLibrarySelection();
  state.libraryView = nextView;
  restoreRememberedLibrarySelection(nextView);
  state.query = "";
  if (elements.searchInput) {
    elements.searchInput.value = "";
  }
  renderLibraryViewChrome();
  if (elements.emptyStateTitle) {
    elements.emptyStateTitle.textContent = t(nextView === "projects" ? "app.empty.title" : "app.empty.chooseWorksheet");
  }
  if (elements.emptyStateCopy) {
    elements.emptyStateCopy.textContent = nextView === "projects"
      ? t("app.empty.copy")
      : t("app.empty.worksheetPreview");
  }
  loadTree({ keepSelection: true, selectAfterLoad: true });
}

function isTreeItemSelected(itemId) {
  return state.selectedTreeItemIds.has(itemId);
}

function setTreeSelection(itemIds = [], options = {}) {
  const nextIds = [...new Set((itemIds || []).filter((itemId) => isSelectableTreeItemId(itemId)))];
  state.selectedTreeItemIds = new Set(nextIds);
  if (!nextIds.length) {
    state.selectedId = null;
    state.treeSelectionAnchorId = null;
    return;
  }

  const primaryId = nextIds.includes(options.primaryId) ? options.primaryId : nextIds[0];
  state.selectedId = primaryId;
  rememberLibrarySelection(primaryId);
  const anchorId = isSelectableTreeItemId(options.anchorId) ? options.anchorId : state.treeSelectionAnchorId;
  state.treeSelectionAnchorId = nextIds.includes(anchorId) ? anchorId : primaryId;
}

function ensureTreePrimarySelection(itemId) {
  if (!isTreeProjectItemId(itemId)) {
    return;
  }
  if (!state.selectedTreeItemIds.size || !state.selectedTreeItemIds.has(itemId)) {
    setTreeSelection([itemId], { primaryId: itemId, anchorId: itemId });
    return;
  }
  state.selectedId = itemId;
  rememberLibrarySelection(itemId);
  if (!state.treeSelectionAnchorId || !state.selectedTreeItemIds.has(state.treeSelectionAnchorId)) {
    state.treeSelectionAnchorId = itemId;
  }
}

function collapseTreeSelectionToPrimary() {
  const primaryId = isTreeProjectItemId(state.selectedId)
    ? state.selectedId
    : selectedTreeProjectItemIds()[0] || null;
  if (!primaryId) {
    setTreeSelection([]);
    return;
  }
  setTreeSelection([primaryId], { primaryId, anchorId: primaryId });
}

function visibleTreeProjectItemIds() {
  return [...elements.tree?.querySelectorAll("[data-item-id]") || []]
    .filter((button) => button.offsetParent !== null && isTreeProjectItemId(button.dataset.itemId))
    .map((button) => button.dataset.itemId);
}

function treeSelectionRangeTo(itemId) {
  const visibleIds = visibleTreeProjectItemIds();
  if (!visibleIds.includes(itemId)) {
    return [itemId];
  }
  const anchorId = visibleIds.includes(state.treeSelectionAnchorId)
    ? state.treeSelectionAnchorId
    : visibleIds.includes(state.selectedId)
      ? state.selectedId
      : itemId;
  const start = visibleIds.indexOf(anchorId);
  const end = visibleIds.indexOf(itemId);
  if (start < 0 || end < 0) {
    return [itemId];
  }
  const range = start <= end
    ? visibleIds.slice(start, end + 1)
    : visibleIds.slice(end, start + 1);
  return range.length ? range : [itemId];
}

function currentProjectId() {
  return state.workspace?.project?.projectId
    || state.selectedItem?.project?.projectId
    || state.selectedItem?.worksheet?.source?.projectId
    || (isTreeProjectItemId(state.selectedId) ? projectIdFromItemId(state.selectedId) : "");
}

function candidateGenerationStateForWorkspace(workspace = null) {
  return workspace?.candidateGeneration || null;
}

function isBackgroundCandidateGenerationRunning(candidateGeneration = null) {
  return Boolean(candidateGeneration?.isRunning);
}

function candidateGenerationRenderSignature(candidateGeneration = null) {
  const activeJob = candidateGeneration?.activeJob || {};
  const latestCompletion = candidateGeneration?.latestCompletion || {};
  const latestFailure = candidateGeneration?.latestFailure || {};
  return [
    candidateGeneration?.isRunning ? "running" : "idle",
    activeJob.jobId || "",
    activeJob.startedAt || "",
    latestCompletion.completedAt || "",
    latestCompletion.candidateId || "",
    latestFailure.completedAt || "",
    latestFailure.message || "",
    candidateGeneration?.hasUnreadCompletion ? "unread" : "seen"
  ].join("|");
}

function treeRenderSignature(node = null) {
  if (!node) {
    return "";
  }
  if (node.type === "worksheet") {
    return [
      "worksheet",
      node.id || "",
      node.label || "",
      node.previewType || "",
      node.hasUnreadCandidateCompletion ? "candidate-update" : "",
      candidateGenerationRenderSignature(node.candidateGeneration)
    ].join("|");
  }
  const children = (node.children || []).map(treeRenderSignature).join(",");
  return [
    node.type || "folder",
    node.id || "",
    node.label || "",
    node.color || "",
    node.locked ? "locked" : "",
    children
  ].join("|");
}

function selectedTreeSignature() {
  return selectedTreeProjectItemIds().join("|");
}

function workspaceBackgroundRenderSignature(workspace = null) {
  const latestRun = workspace?.latestRun || {};
  const preview = workspace?.preview || {};
  return [
    workspace?.project?.projectId || "",
    candidateGenerationRenderSignature(workspace?.candidateGeneration),
    latestRun.runId || "",
    latestRun.candidateCount || 0,
    latestRun.renderedCandidateCount || 0,
    latestRun.selectedPageCount || 0,
    preview.previewType || "",
    preview.previewMeta?.renderedCandidateCount || 0,
    countPreviewCandidates(preview),
    countPreviewCandidatePages(preview),
    preview.pdfs?.length || 0,
    preview.pages?.length || 0
  ].join("|");
}

function selectedItemBackgroundRenderSignature(item = null) {
  const project = item?.project || {};
  const derived = project.derivedStatus || {};
  const preview = item?.preview || {};
  const artifactSummary = item?.artifacts?.summary || {};
  const candidateGroups = Array.isArray(artifactSummary.candidateGroups)
    ? artifactSummary.candidateGroups.map((group) => [
      group.conceptId || "",
      group.conceptVersion || "",
      group.candidateCount || 0
    ].join(":")).join(",")
    : "";
  return [
    project.projectId || "",
    project.title || "",
    project.status || "",
    derived.previewState || "",
    derived.runs?.at?.(-1)?.runId || "",
    derived.runs?.at?.(-1)?.candidateCount || 0,
    derived.runs?.at?.(-1)?.renderedCandidateCount || 0,
    candidateGenerationRenderSignature(project.candidateGeneration),
    preview.previewType || "",
    preview.previewMeta?.renderedCandidateCount || 0,
    countPreviewCandidates(preview),
    countPreviewCandidatePages(preview),
    preview.pdfs?.length || 0,
    preview.pages?.length || 0,
    artifactSummary.conceptCount || 0,
    artifactSummary.candidateCount || 0,
    candidateGroups
  ].join("|");
}

function treeHasRunningCandidateGeneration(node = null) {
  if (!node) {
    return false;
  }
  if (isBackgroundCandidateGenerationRunning(node.candidateGeneration)) {
    return true;
  }
  return (node.children || []).some((child) => treeHasRunningCandidateGeneration(child));
}

function candidateGenerationStatesFromTree(tree = null) {
  const states = new Map();
  function walk(node) {
    if (!node) {
      return;
    }
    if (isTreeProjectItemId(node.id) && node.candidateGeneration) {
      const projectId = projectIdFromItemId(node.id);
      states.set(projectId, {
        projectId,
        label: node.label || projectId,
        candidateGeneration: node.candidateGeneration
      });
    }
    for (const child of node.children || []) {
      walk(child);
    }
  }
  for (const child of tree?.children || []) {
    walk(child);
  }
  return states;
}

function candidateGenerationToastKey(kind, projectId, event = {}) {
  return [
    kind,
    projectId || "",
    event.jobId || "",
    event.completedAt || "",
    event.candidateId || "",
    event.message || ""
  ].join("|");
}

function showCandidateGenerationToast(kind, {
  projectId = "",
  projectLabel = "",
  candidateGeneration = null
} = {}) {
  const event = kind === "failure"
    ? candidateGeneration?.latestFailure
    : candidateGeneration?.latestCompletion;
  if (!event?.completedAt) {
    return;
  }
  const key = candidateGenerationToastKey(kind, projectId, event);
  if (candidateGenerationToastKeys.has(key)) {
    return;
  }
  candidateGenerationToastKeys.add(key);
  const label = String(projectLabel || "").trim();
  const target = label ? ` für "${label}"` : "";
  if (kind === "failure") {
    const message = event.message || `Entwurf${target} konnte nicht fertiggestellt werden.`;
    showToast(label && event.message ? `${label}: ${message}` : message, "error");
    return;
  }
  const pageCount = Number(event.pageCount || 0);
  showToast(pageCount > 1 ? `Mehrseitiger Entwurf${target} ist fertig.` : `Entwurf${target} ist fertig.`, "success");
}

function notifyCandidateGenerationTransition(previousGeneration, nextGeneration, project = {}) {
  if (!previousGeneration?.isRunning || nextGeneration?.isRunning) {
    return;
  }
  if (
    nextGeneration?.latestFailure?.completedAt
    && nextGeneration.latestFailure.completedAt !== previousGeneration?.latestFailure?.completedAt
  ) {
    showCandidateGenerationToast("failure", {
      projectId: project.projectId,
      projectLabel: project.label,
      candidateGeneration: nextGeneration
    });
    return;
  }
  if (
    nextGeneration?.latestCompletion?.candidateId
    && nextGeneration.latestCompletion.completedAt !== previousGeneration?.latestCompletion?.completedAt
  ) {
    showCandidateGenerationToast("completion", {
      projectId: project.projectId,
      projectLabel: project.label,
      candidateGeneration: nextGeneration
    });
  }
}

function notifyCandidateGenerationTreeTransitions(previousStates, nextStates) {
  if (!previousStates?.size) {
    return;
  }
  for (const [projectId, previous] of previousStates) {
    const next = nextStates.get(projectId);
    notifyCandidateGenerationTransition(previous.candidateGeneration, next?.candidateGeneration, {
      projectId,
      label: next?.label || previous.label
    });
  }
}

function clearBackgroundRefreshTimer() {
  if (backgroundRefreshTimer) {
    window.clearTimeout(backgroundRefreshTimer);
    backgroundRefreshTimer = null;
  }
}

function shouldPollBackgroundRefresh() {
  if (state.mode === "workspace") {
    return isBackgroundCandidateGenerationRunning(candidateGenerationStateForWorkspace(state.workspace))
      || treeHasRunningCandidateGeneration(state.tree);
  }
  return treeHasRunningCandidateGeneration(state.tree);
}

async function runBackgroundRefresh() {
  if (backgroundRefreshInFlight) {
    return;
  }
  backgroundRefreshInFlight = true;
  try {
    if (state.mode === "workspace" && state.workspace?.project?.projectId) {
      const projectId = state.workspace.project.projectId;
      const refreshId = ++workspaceRefreshId;
      const previousGeneration = candidateGenerationStateForWorkspace(state.workspace);
      const previousWorkspaceSignature = workspaceBackgroundRenderSignature(state.workspace);
      const payload = await fetchJson(`/api/workspace/${encodeURIComponent(projectId)}`);
      if (refreshId !== workspaceRefreshId || state.mode !== "workspace" || state.workspace?.project?.projectId !== projectId) {
        return;
      }
      state.workspace = payload.workspace;
      const nextGeneration = candidateGenerationStateForWorkspace(state.workspace);
      if (previousWorkspaceSignature !== workspaceBackgroundRenderSignature(state.workspace)) {
        renderWorkspace();
      }
      notifyCandidateGenerationTransition(previousGeneration, nextGeneration, {
        projectId,
        label: state.workspace?.project?.title || projectId
      });
    }
    await loadTree({
      keepSelection: true,
      selectAfterLoad: false,
      quiet: true,
      preserveScroll: true,
      renderIfChangedOnly: true
    });
    if (state.mode === "library") {
      await refreshSelectedLibraryItem({
        preferCandidatesOnChange: true,
        renderIfChangedOnly: true
      });
    }
  } catch {
    // Keep the current UI and try again on the next cycle.
  } finally {
    backgroundRefreshInFlight = false;
    syncBackgroundRefresh();
  }
}

function syncBackgroundRefresh() {
  clearBackgroundRefreshTimer();
  if (!shouldPollBackgroundRefresh()) {
    return;
  }
  backgroundRefreshTimer = window.setTimeout(() => {
    runBackgroundRefresh();
  }, 2500);
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
  return !state.query.trim() && !/search$/.test(String(state.tree?.id || ""));
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
  const folderColor = displayFolderColor(folder.color);
  const colorStyle = [
    `--folder-fill: ${escapeHtml(folderColor || "none")}`,
    `--folder-shadow: ${folderColor ? "drop-shadow(0 1px 1px rgba(16, 24, 39, 0.12))" : "none"}`
  ].join("; ");
  return `
    <section class="tree-group${rootClass}" style="--tree-depth: ${escapeHtml(depth)}; ${colorStyle}" data-drop-folder-id="${escapeHtml(folder.id)}">
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
  const selected = isTreeItemSelected(item.id) ? " selected" : "";
  const isWorksheetItem = item.itemType === "worksheet" || isTreeWorksheetItemId(item.id);
  const candidateGenerationRunning = isBackgroundCandidateGenerationRunning(item.candidateGeneration);
  const hasUnreadCandidateCompletion = Boolean(item.hasUnreadCandidateCompletion);
  const unreadMarker = hasUnreadCandidateCompletion && !candidateGenerationRunning
    ? '<span class="tree-unread-dot" title="Neuer Entwurf fertig" aria-label="Neuer Entwurf fertig"></span>'
    : "";
  const worksheetIcon = isWorksheetItem
    ? renderIcon("file-text", `tree-item-icon${item.unseen ? " unseen" : ""}`)
    : "";
  const candidateStatus = candidateGenerationRunning
    ? `<span class="tree-status candidate-rendering" title="Entwurf wird erstellt" aria-label="Entwurf wird erstellt"><span class="tree-status-spinner" aria-hidden="true"></span><span class="tree-status-label">Wird erstellt</span></span>`
    : "";
  const interactive = treeInteractionsEnabled();
  const dragAttrs = interactive && item.draggable ? ' draggable="true"' : "";
  const contextAttrs = interactive ? ` data-tree-node-id="${escapeHtml(item.id)}"` : "";
  return `
    <button class="tree-item${active}${selected}${candidateGenerationRunning ? " is-rendering-candidate" : ""}${hasUnreadCandidateCompletion && !candidateGenerationRunning ? " has-candidate-update" : ""}" type="button" style="--tree-depth: ${escapeHtml(depth)}" data-item-id="${escapeHtml(item.id)}" data-parent-folder-id="${escapeHtml(parentId)}" aria-selected="${isTreeItemSelected(item.id) ? "true" : "false"}"${contextAttrs}${dragAttrs}>
      ${unreadMarker}
      ${worksheetIcon}
      <span class="tree-item-label">${escapeHtml(item.label)}</span>
      ${candidateStatus}
    </button>
  `;
}

function captureTreeScroll() {
  if (!elements.tree) {
    return null;
  }
  const treeScrollElement = customScrollElement(elements.tree);
  return {
    left: treeScrollElement.scrollLeft,
    top: treeScrollElement.scrollTop
  };
}

function restoreTreeScroll(scrollState) {
  if (!elements.tree || !scrollState) {
    return;
  }
  const treeScrollElement = customScrollElement(elements.tree);
  const maxTop = Math.max(0, treeScrollElement.scrollHeight - treeScrollElement.clientHeight);
  const maxLeft = Math.max(0, treeScrollElement.scrollWidth - treeScrollElement.clientWidth);
  treeScrollElement.scrollTop = Math.min(scrollState.top, maxTop);
  treeScrollElement.scrollLeft = Math.min(scrollState.left, maxLeft);
}

function revealTreeItem(itemId, options = {}) {
  if (!elements.tree || !itemId) {
    return;
  }
  const target = [...elements.tree.querySelectorAll("[data-item-id]")]
    .find((button) => button.dataset.itemId === itemId);
  if (!target) {
    return;
  }
  target.scrollIntoView({
    block: options.block || "nearest",
    inline: "nearest",
    behavior: "auto"
  });
}

function renderTree(tree, options = {}) {
  if (!tree) {
    return;
  }
  const scrollState = options.scrollState || (options.preserveScroll ? captureTreeScroll() : null);
  closeTreeContextMenu();
  setCustomScrollContent(elements.tree, (tree.children || []).map((folder) => renderTreeFolder(folder, 0)).join(""));
  elements.tree.querySelectorAll("[data-toggle-folder-id]").forEach((button) => {
    button.addEventListener("click", () => toggleFolder(button.dataset.toggleFolderId));
  });
  elements.tree.querySelectorAll("[data-item-id]").forEach((button) => {
    button.addEventListener("click", (event) => handleTreeItemClick(button.dataset.itemId, event));
  });
  bindTreeOrganizationEvents();
  restoreTreeScroll(scrollState);
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

function selectableIdsFromTree(tree) {
  const ids = [];
  function walk(node) {
    if (isSelectableTreeItemId(node.id)) {
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
  return items.find((item) => item.previewType === "candidates")?.id
    || projectIdsFromTree(tree)[0]
    || null;
}

function findDefaultWorksheet(tree) {
  const ids = selectableIdsFromTree(tree).filter((itemId) => isTreeWorksheetItemId(itemId));
  return ids[0] || null;
}

function findDefaultLibraryItem(tree) {
  return isProjectsLibraryView() ? findDefaultProject(tree) : findDefaultWorksheet(tree);
}

async function handleTreeItemClick(itemId, event) {
  const shiftRangeSelection = Boolean(event?.shiftKey)
    && !isMobileViewport()
    && state.mode === "library"
    && isProjectsLibraryView()
    && isTreeProjectItemId(itemId);

  if (shiftRangeSelection) {
    const rangeIds = treeSelectionRangeTo(itemId);
    setTreeSelection(rangeIds, {
      primaryId: itemId,
      anchorId: state.treeSelectionAnchorId || state.selectedId || itemId
    });
    await selectItem(itemId, {
      openMobileSheet: false,
      preserveTreeScroll: true,
      skipSelectionUpdate: true
    });
    return;
  }

  setTreeSelection([itemId], { primaryId: itemId, anchorId: itemId });
  if (isMobileViewport() && isTreeProjectItemId(itemId)) {
    await openWorkspace(projectIdFromItemId(itemId));
    return;
  }
  await selectItem(itemId, {
    openMobileSheet: isMobileViewport(),
    preserveTreeScroll: true,
    skipSelectionUpdate: true
  });
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
  menu.innerHTML = treeContextMenuActions(node).map((action) => renderTreeContextAction(action, node)).join("");
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
  menu.querySelectorAll("[data-folder-color]").forEach((button) => {
    button.addEventListener("click", () => {
      const color = button.dataset.folderColor || "";
      closeTreeContextMenu();
      updateFolderColor(nodeId, color);
    });
  });
}

function renderTreeContextAction(action, node = {}) {
  if (action.palette) {
    const currentColor = displayFolderColor(node.color);
    return `
      <div class="tree-context-palette" role="group" aria-label="Ordnerfarbe">
        <span>Farbe</span>
        <div class="tree-context-swatches">
          ${FOLDER_COLOR_PALETTE.map((entry) => {
            const selected = displayFolderColor(entry.value) === currentColor;
            return `
              <button
                class="folder-color-swatch ${selected ? "selected" : ""} ${entry.value ? "" : "is-reset"}"
                type="button"
                data-folder-color="${escapeHtml(entry.value)}"
                aria-label="${escapeHtml(entry.label)}"
                title="${escapeHtml(entry.label)}"
                style="${entry.value ? `--swatch-color: ${escapeHtml(entry.value)};` : ""}"
              ></button>
            `;
          }).join("")}
        </div>
      </div>
    `;
  }
  return `
    <button type="button" role="menuitem" data-tree-action="${escapeHtml(action.id)}" class="${action.danger ? "danger" : ""}">
      ${escapeHtml(action.label)}
    </button>
  `;
}

function treeContextMenuActions(node) {
  if (node.type === "folder") {
    const actions = [
      { id: "new_folder", label: "Neuer Ordner" },
      { id: "folder_color", label: "Farbe", palette: true }
    ];
    if (node.canRename) {
      actions.push({ id: "rename_folder", label: "Umbenennen" });
    }
    if (node.canDelete) {
      actions.push({ id: "delete_folder", label: "Ordner löschen", danger: true });
    }
    return actions;
  }
  if (isTreeWorksheetItemId(node.id)) {
    return [
      { id: "rename_worksheet", label: "Umbenennen" },
      { id: "open_source_project", label: "Zum Projekt" },
      { id: "delete_worksheet", label: "Arbeitsblatt löschen", danger: true }
    ];
  }
  if (treeSelectionCount() > 1 && isTreeItemSelected(node.id)) {
    return [
      {
        id: "delete_selected_projects",
        label: `${treeSelectionCount()} Projekte löschen`,
        danger: true
      }
    ];
  }
  return [
    { id: "rename_project", label: "Umbenennen" },
    { id: "delete_project", label: "Projekt löschen", danger: true }
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
  } else if (action === "rename_worksheet") {
    renameWorksheetFromTree(nodeId);
  } else if (action === "open_source_project") {
    const found = findTreeNodeById(state.tree, nodeId);
    const projectId = found?.node?.sourceProjectId || state.selectedItem?.worksheet?.source?.projectId || "";
    if (projectId) {
      openWorkspace(projectId);
    }
  } else if (action === "delete_worksheet") {
    deleteWorksheetFromTree(nodeId);
  } else if (action === "delete_selected_projects") {
    deleteSelectedProjectsFromTree();
  } else if (action === "delete_project") {
    deleteProjectFromTree(projectIdFromItemId(nodeId));
  }
}

async function updateFolderColor(folderId, color) {
  try {
    const endpoint = isProjectsLibraryView()
      ? `/api/library/folders/${encodeURIComponent(folderId)}`
      : `/api/worksheets/folders/${encodeURIComponent(folderId)}`;
    await fetchJson(endpoint, {
      method: "PATCH",
      body: JSON.stringify({ color: color || null })
    });
    await loadTree({ keepSelection: true, selectAfterLoad: false, preserveScroll: true });
  } catch (error) {
    showToast(error.message, "error");
  }
}

async function moveTreeItem(itemId, targetFolderId, beforeId) {
  if (!itemId || !targetFolderId || itemId === targetFolderId) {
    return;
  }
  try {
    await fetchJson(isProjectsLibraryView() ? "/api/library/move" : "/api/worksheets/move", {
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
    await fetchJson(isProjectsLibraryView() ? "/api/library/folders" : "/api/worksheets/folders", {
      method: "POST",
      body: JSON.stringify({ parentId, label: label.trim() })
    });
    state.collapsedFolders.delete(parentId);
    await loadTree({ keepSelection: true, selectAfterLoad: false });
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
    const endpoint = isProjectsLibraryView()
      ? `/api/library/folders/${encodeURIComponent(folderId)}`
      : `/api/worksheets/folders/${encodeURIComponent(folderId)}`;
    await fetchJson(endpoint, {
      method: "PATCH",
      body: JSON.stringify({ label: label.trim() })
    });
    await loadTree({ keepSelection: true, selectAfterLoad: false });
  } catch (error) {
    showToast(error.message, "error");
  }
}

async function deleteLibraryFolder(folderId) {
  const found = findTreeNodeById(state.tree, folderId);
  const itemName = isProjectsLibraryView() ? "Projekte" : "Arbeitsblätter";
  const confirmed = await requestConfirmation({
    title: "Ordner löschen?",
    message: `Der Ordner "${found?.node?.label || "Ordner"}" wird entfernt. Enthaltene ${itemName} bleiben erhalten und wandern eine Ebene nach oben.`,
    acceptLabel: "Ordner löschen",
    danger: true
  });
  if (!confirmed) {
    return;
  }
  try {
    const endpoint = isProjectsLibraryView()
      ? `/api/library/folders/${encodeURIComponent(folderId)}`
      : `/api/worksheets/folders/${encodeURIComponent(folderId)}`;
    await fetchJson(endpoint, { method: "DELETE" });
    await loadTree({ keepSelection: true, selectAfterLoad: false });
  } catch (error) {
    showToast(error.message, "error");
  }
}

async function renameProjectFromTree(projectId) {
  const found = findTreeNodeById(state.tree, `project:${projectId}`);
  const title = window.prompt("Projekt umbenennen", found?.node?.label || "");
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
  } catch (error) {
    showToast(error.message, "error");
  }
}

async function renameWorksheetFromTree(itemId) {
  const found = findTreeNodeById(state.tree, itemId);
  const title = window.prompt("Arbeitsblatt umbenennen", found?.node?.label || "");
  if (!title?.trim()) {
    return;
  }
  try {
    await fetchJson(`/api/worksheets/items/${encodeURIComponent(itemId)}`, {
      method: "PATCH",
      body: JSON.stringify({ title: title.trim() })
    });
    await loadTree({ keepSelection: true, selectAfterLoad: state.mode === "library" });
  } catch (error) {
    showToast(error.message, "error");
  }
}

async function deleteWorksheetFromTree(itemId) {
  const found = findTreeNodeById(state.tree, itemId);
  const confirmed = await requestConfirmation({
    title: "Arbeitsblatt löschen?",
    message: `"${found?.node?.label || "Arbeitsblatt"}" wird aus der Ablage entfernt. Die PDF-Datei wird gelöscht; das Quellprojekt bleibt erhalten.`,
    acceptLabel: "Arbeitsblatt löschen",
    danger: true
  });
  if (!confirmed) {
    return;
  }
  try {
    await fetchJson(`/api/worksheets/items/${encodeURIComponent(itemId)}`, { method: "DELETE" });
    forgetLibrarySelection(itemId);
    if (state.selectedId === itemId) {
      state.selectedId = null;
      state.selectedItem = null;
      state.selectedTreeItemIds = new Set();
    }
    await loadTree({ keepSelection: true, selectAfterLoad: state.mode === "library" });
    if (!state.selectedId && !isProjectsLibraryView()) {
      renderWorksheetsEmptyState();
    }
    showToast("Arbeitsblatt gelöscht", "success");
  } catch (error) {
    showToast(error.message, "error");
  }
}

function clearProjectViewsAfterDeletion() {
  state.selectedId = null;
  state.selectedItem = null;
  state.workspace = null;
  elements.projectView.classList.add("hidden");
  elements.workspaceView.classList.add("hidden");
  elements.emptyState.classList.remove("hidden");
}

async function projectWorksheetDeleteSummary(projectIds = []) {
  const entries = await Promise.all(projectIds.map(async (projectId) => {
    const payload = await fetchJson(`/api/projects/${encodeURIComponent(projectId)}/worksheets`);
    const worksheets = Array.isArray(payload.worksheets) ? payload.worksheets : [];
    return {
      projectId,
      count: worksheets.length
    };
  }));
  return {
    total: entries.reduce((sum, entry) => sum + entry.count, 0),
    entries
  };
}

function projectWorksheetDeleteSentence(count) {
  if (!count) {
    return "Zugehörige Arbeitsblätter: keine.";
  }
  return count === 1
    ? "1 zugehöriges Arbeitsblatt wird ebenfalls gelöscht."
    : `${count} zugehörige Arbeitsblätter werden ebenfalls gelöscht.`;
}

async function deleteSelectedProjectsFromTree(projectIds = null) {
  const itemIds = (projectIds || selectedTreeProjectItemIds().map((itemId) => projectIdFromItemId(itemId)))
    .map((projectId) => String(projectId || "").trim())
    .filter(Boolean);
  const uniqueProjectIds = [...new Set(itemIds)];
  if (!uniqueProjectIds.length) {
    return;
  }

  const labels = uniqueProjectIds.map((projectId) => {
    const found = findTreeNodeById(state.tree, `project:${projectId}`);
    return found?.node?.label || projectId;
  });
  const count = uniqueProjectIds.length;
  let worksheetSummary;
  try {
    worksheetSummary = await projectWorksheetDeleteSummary(uniqueProjectIds);
  } catch (error) {
    showToast(error.message, "error");
    return;
  }
  const baseMessage = count === 1
    ? `Das Projekt "${labels[0]}" wird dauerhaft gelöscht.`
    : `${count} ausgewählte Projekte werden dauerhaft gelöscht: ${labels.slice(0, 4).join(", ")}${count > 4 ? " ..." : ""}`;
  const message = `${baseMessage} ${projectWorksheetDeleteSentence(worksheetSummary.total)}`;
  const confirmed = await requestConfirmation({
    title: count === 1 ? "Projekt löschen?" : `${count} Projekte löschen?`,
    message,
    acceptLabel: count === 1 ? "Projekt löschen" : `${count} Projekte löschen`,
    danger: true
  });
  if (!confirmed) {
    return;
  }
  try {
    let deletedWorksheetCount = 0;
    for (const projectId of uniqueProjectIds) {
      const payload = await fetchJson(`/api/projects/${encodeURIComponent(projectId)}`, { method: "DELETE" });
      deletedWorksheetCount += Number(payload.deletedWorksheets?.deletedCount || 0);
    }
    const deletedItemIds = new Set(uniqueProjectIds.map((projectId) => `project:${projectId}`));
    for (const itemId of deletedItemIds) {
      forgetLibrarySelection(itemId);
    }
    state.selectedTreeItemIds = new Set(selectedTreeProjectItemIds().filter((itemId) => !deletedItemIds.has(itemId)));
    if (state.selectedId && deletedItemIds.has(state.selectedId)) {
      clearProjectViewsAfterDeletion();
    }
    if (!state.selectedTreeItemIds.size) {
      state.treeSelectionAnchorId = null;
    } else if (!state.treeSelectionAnchorId || deletedItemIds.has(state.treeSelectionAnchorId)) {
      state.treeSelectionAnchorId = selectedTreeProjectItemIds()[0] || null;
    }
    await loadTree({ keepSelection: true, selectAfterLoad: state.mode === "library" });
    const worksheetToast = deletedWorksheetCount
      ? `, ${pluralLabel(deletedWorksheetCount, "Arbeitsblatt", "Arbeitsblätter")} mitgelöscht`
      : "";
    showToast(count === 1 ? `Projekt gelöscht${worksheetToast}` : `${count} Projekte gelöscht${worksheetToast}`, "success");
  } catch (error) {
    showToast(error.message, "error");
  }
}

async function deleteProjectFromTree(projectId) {
  const itemId = `project:${projectId}`;
  if (treeSelectionCount() > 1 && isTreeItemSelected(itemId)) {
    await deleteSelectedProjectsFromTree();
    return;
  }
  await deleteSelectedProjectsFromTree([projectId]);
}

async function loadTree({ keepSelection = false, selectAfterLoad = true, quiet = false, preserveScroll = false, renderIfChangedOnly = false, revealSelected = false, openSelectedMobileSheet = false } = {}) {
  renderLibraryViewChrome();
  const treeScrollState = preserveScroll ? captureTreeScroll() : null;
  const previousTreeSignature = renderIfChangedOnly ? treeRenderSignature(state.tree) : "";
  const previousCandidateGenerationStates = candidateGenerationStatesFromTree(state.tree);
  const previousSelectedId = state.selectedId;
  const previousSelectionSignature = renderIfChangedOnly ? selectedTreeSignature() : "";
  if (!quiet) {
    setCustomScrollContent(elements.tree, '<div class="tree-loading">Lade Projekte...</div>');
  }
  try {
    const query = state.query.trim();
    const baseUrl = isProjectsLibraryView() ? "/api/library/tree" : "/api/worksheets/tree";
    const url = query ? `${baseUrl}?q=${encodeURIComponent(query)}` : baseUrl;
    const payload = await fetchJson(url);
    state.tree = payload.tree;
    notifyCandidateGenerationTreeTransitions(previousCandidateGenerationStates, candidateGenerationStatesFromTree(state.tree));
    const availableIds = new Set(selectableIdsFromTree(state.tree));
    const routeToApply = pendingInitialRoute;
    const routeRequestsOverviewOnly = Boolean(routeToApply)
      && routeToApply.view === state.libraryView
      && !routeToApply.itemId;
    let openInitialWorkspace = false;
    let missingInitialRoute = null;
    if (keepSelection) {
      state.selectedTreeItemIds = new Set(selectedTreeProjectItemIds().filter((itemId) => availableIds.has(itemId)));
      if (state.selectedId && !availableIds.has(state.selectedId)) {
        state.selectedId = null;
      }
    } else {
      state.selectedTreeItemIds = new Set();
      state.treeSelectionAnchorId = null;
      state.selectedId = null;
    }
    if (routeToApply) {
      pendingInitialRoute = null;
      if (routeToApply.itemId && availableIds.has(routeToApply.itemId)) {
        setTreeSelection([routeToApply.itemId], {
          primaryId: routeToApply.itemId,
          anchorId: routeToApply.itemId
        });
        openInitialWorkspace = routeToApply.view === "workspace" && Boolean(routeToApply.projectId);
      } else if (routeToApply.itemId) {
        missingInitialRoute = routeToApply;
        setTreeSelection([]);
      }
    }
    if (routeRequestsOverviewOnly) {
      setTreeSelection([]);
    } else if (!missingInitialRoute && (!state.selectedId || !availableIds.has(state.selectedId))) {
      const nextSelectedId = findDefaultLibraryItem(state.tree);
      if (nextSelectedId) {
        setTreeSelection([nextSelectedId], {
          primaryId: nextSelectedId,
          anchorId: nextSelectedId
        });
      } else {
        setTreeSelection([]);
      }
    } else {
      ensureTreePrimarySelection(state.selectedId);
    }
    const selectionChanged = previousSelectedId !== state.selectedId || previousSelectionSignature !== selectedTreeSignature();
    const treeChanged = previousTreeSignature !== treeRenderSignature(state.tree);
    if (!renderIfChangedOnly || treeChanged || selectionChanged) {
      renderTree(state.tree, { scrollState: treeScrollState });
    }
    if (missingInitialRoute) {
      renderMissingRouteState(missingInitialRoute);
    } else if (openInitialWorkspace && routeToApply?.projectId) {
      await openWorkspace(routeToApply.projectId);
    } else if (selectAfterLoad && state.mode === "library" && state.selectedId) {
      await selectItem(state.selectedId, {
        openMobileSheet: Boolean(routeToApply?.itemId) || Boolean(openSelectedMobileSheet),
        preserveTreeScroll: preserveScroll,
        skipSelectionUpdate: true
      });
      if (revealSelected) {
        revealTreeItem(state.selectedId, { block: "center" });
      }
    } else if (selectAfterLoad && state.mode === "library" && !state.selectedId && !isProjectsLibraryView()) {
      renderWorksheetsEmptyState();
    } else if (revealSelected && state.selectedId) {
      revealTreeItem(state.selectedId, { block: "center" });
    }
    syncBackgroundRefresh();
  } catch (error) {
    if (!quiet) {
      setCustomScrollContent(elements.tree, `<div class="tree-error">${escapeHtml(error.message)}</div>`);
    }
    syncBackgroundRefresh();
  }
}

function selectedItemCandidateState(item = null) {
  const preview = item?.preview || {};
  return {
    running: Boolean(item?.project?.candidateGeneration?.isRunning),
    renderedCount: Number(preview.previewMeta?.renderedCandidateCount || countPreviewCandidates(preview) || 0)
  };
}

function shouldPreferCandidatesAfterRefresh(previousItem, nextItem) {
  const previous = selectedItemCandidateState(previousItem);
  const next = selectedItemCandidateState(nextItem);
  return Boolean(next.running || next.renderedCount > previous.renderedCount || (previous.running && next.renderedCount));
}

async function refreshSelectedLibraryItem(options = {}) {
  const itemId = state.selectedId;
  if (state.mode !== "library" || !isProjectsLibraryView() || !isTreeProjectItemId(itemId)) {
    return;
  }
  const refreshId = ++selectedItemRefreshId;
  const previousItem = state.selectedItem;
  const previousSignature = options.renderIfChangedOnly ? selectedItemBackgroundRenderSignature(previousItem) : "";
  const previousStep = state.activeStatusStep;
  try {
    const payload = await fetchJson(`/api/library/items/${encodeURIComponent(itemId)}`);
    if (refreshId !== selectedItemRefreshId || state.mode !== "library" || state.selectedId !== itemId) {
      return;
    }
    state.selectedItem = payload.item;
    if (options.renderIfChangedOnly && previousSignature === selectedItemBackgroundRenderSignature(payload.item)) {
      return;
    }
    const nextStep = options.preferCandidatesOnChange && shouldPreferCandidatesAfterRefresh(previousItem, payload.item)
      ? "candidates"
      : previousStep;
    renderProject(payload.item, nextStep);
  } catch {
    // Background refresh should not replace a usable preview with a transient error.
  }
}

async function refreshSelectedWorksheetItem() {
  const itemId = state.selectedId;
  if (state.mode !== "library" || isProjectsLibraryView() || !isTreeWorksheetItemId(itemId)) {
    return;
  }
  const refreshId = ++selectedItemRefreshId;
  try {
    const payload = await fetchJson(`/api/worksheets/items/${encodeURIComponent(itemId)}`);
    if (refreshId !== selectedItemRefreshId || state.mode !== "library" || state.selectedId !== itemId) {
      return;
    }
    state.selectedItem = payload.item;
    renderWorksheetItem(payload.item);
  } catch {
    // Background refresh should not replace a usable preview with a transient error.
  }
}

async function markWorksheetItemSeen(itemId) {
  try {
    await fetchJson(`/api/worksheets/items/${encodeURIComponent(itemId)}/seen`, { method: "POST" });
  } catch {
    // Öffnen darf nicht an der Lesestatus-Aktualisierung scheitern.
  }
}

async function selectItem(itemId, options = {}) {
  const requestId = ++selectedItemRefreshId;
  if (!options.skipSelectionUpdate) {
    setTreeSelection([itemId], { primaryId: itemId, anchorId: itemId });
  } else {
    state.selectedId = itemId;
    rememberLibrarySelection(itemId);
  }
  state.activeStatusStep = null;
  state.activeLibraryConceptId = null;
  renderTree(state.tree, { preserveScroll: Boolean(options.preserveTreeScroll) });

  if (state.mode === "workspace") {
    await openWorkspace(projectIdFromItemId(itemId));
    return;
  }

  elements.emptyState.classList.add("hidden");
  elements.projectView.classList.remove("hidden");
  elements.workspaceView.classList.add("hidden");
  setCustomScrollContent(elements.previewGrid, '<div class="no-preview">Lade Vorschau...</div>');

  try {
    if (isTreeWorksheetItemId(itemId)) {
      await markWorksheetItemSeen(itemId);
    }
    const endpoint = isTreeWorksheetItemId(itemId)
      ? `/api/worksheets/items/${encodeURIComponent(itemId)}`
      : `/api/library/items/${encodeURIComponent(itemId)}`;
    const payload = await fetchJson(endpoint);
    if (requestId !== selectedItemRefreshId || state.mode !== "library" || state.selectedId !== itemId) {
      return;
    }
    state.selectedItem = payload.item;
    if (isTreeWorksheetItemId(itemId)) {
      renderWorksheetItem(payload.item);
      await loadTree({ keepSelection: true, selectAfterLoad: false, quiet: true, preserveScroll: true });
    } else {
      renderProject(payload.item);
    }
    syncBackgroundRefresh();
    if (options.openMobileSheet && isMobileViewport()) {
      openMobilePreview(isTreeWorksheetItemId(itemId) ? "worksheet" : "project", { source: "library" });
    }
  } catch (error) {
    setCustomScrollContent(elements.previewGrid, `<div class="no-preview">${escapeHtml(error.message)}</div>`);
    syncBackgroundRefresh();
  }
}

function renderProject(item, requestedStep = null) {
  elements.projectView.classList.remove("worksheet-detail-view");
  elements.statusPanel?.querySelector("h3")?.replaceChildren(document.createTextNode(t("app.project.status")));
  const project = item.project;
  elements.projectTitle.textContent = project.title;
  elements.loadProjectButtonLabel.textContent = editButtonLabel(item);
  const activeStep = requestedStep || state.activeStatusStep || defaultStatusStep(item);
  state.activeStatusStep = activeStep;
  elements.statusList.innerHTML = buildStatusRows(item).map(renderStatusRow).join("");
  renderStatusArtifactSummary(item);
  elements.statusList.querySelectorAll("[data-status-step]").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.preventDefault();
      renderProject(item, button.dataset.statusStep);
    });
  });
  renderActions(item);
  renderPreviewForStep(item, activeStep);
  applyProjectSplitLayout();
}

function worksheetMetaRows(worksheet = {}) {
  const pageCount = Number(worksheet.pageCount || worksheet.pages?.length || 0);
  const sourceProject = worksheet.source?.projectTitle || worksheet.source?.projectId || "";
  return [
    { id: "kind", title: worksheet.kindLabel || (pageCount > 1 ? "Arbeitsblatt-Bundle" : "Arbeitsblatt"), state: pageCount ? `${pageCount} Seite${pageCount === 1 ? "" : "n"}` : "PDF" },
    { id: "source", title: "Quellprojekt", state: sourceProject || "Projekt" },
    { id: "created", title: "Abgelegt", state: worksheet.createdAt ? formatResetTime(worksheet.createdAt) : "Gespeichert" }
  ];
}

function renderWorksheetMetaRow(row) {
  return `
    <div class="status-row worksheet-meta-row">
      <span class="step-marker done">${icon(row.id === "kind" ? "file-text" : row.id === "source" ? "folder-open" : "check", "step-marker-icon")}</span>
      <span class="step-title">${escapeHtml(row.title)}</span>
      <span class="step-state">${escapeHtml(row.state)}</span>
    </div>
  `;
}

function renderWorksheetItem(item) {
  const worksheet = item.worksheet || {};
  const pdf = worksheet.pdf || null;
  const pages = (worksheet.pages || []).filter((page) => page.url);
  elements.projectView.classList.add("worksheet-detail-view");
  elements.statusPanel?.querySelector("h3")?.replaceChildren(document.createTextNode("Details"));
  elements.projectTitle.textContent = worksheet.title || "Arbeitsblatt";
  elements.loadProjectButtonLabel.textContent = "Zum Projekt";
  elements.statusList.innerHTML = worksheetMetaRows(worksheet).map(renderWorksheetMetaRow).join("");
  elements.statusArtifactSummary.classList.add("hidden");
  elements.statusArtifactSummary.innerHTML = "";
  renderActions(item);
  elements.previewEyebrow.textContent = worksheet.kindLabel || "Arbeitsblatt";
  elements.previewTitle.textContent = worksheet.title || "PDF";
  elements.previewGrid.dataset.previewType = pages.length ? "worksheet_pages" : "pdf";
  applyPreviewLayout({ previewType: pages.length ? "selected_pages" : "pdf" });
  setCustomScrollContent(elements.previewGrid, pages.length
    ? pages.map((page, index) => renderWorksheetPageCard(page, index, pages.length, worksheet.title || "Arbeitsblatt")).join("")
    : pdf?.url
    ? renderPdfCard({
      ...pdf,
      pageCount: worksheet.pageCount,
      concept: worksheet.source?.concept || null
    })
    : '<div class="no-preview">PDF nicht gefunden.</div>');
  bindPreviewCardActions(elements.previewGrid);
  applyProjectSplitLayout();
}

function editButtonLabel(item) {
  return t("app.project.open");
}

function defaultStatusStep(item) {
  if (item.project?.candidateGeneration?.isRunning || item.project?.derivedStatus?.previewState === "candidate_generation_pending") {
    return "candidates";
  }
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
  const workflowSteps = Array.isArray(item.steps) ? item.steps : [];
  const workflowStep = (id) => workflowSteps.find((step) => step.id === id) || null;
  const latestRun = Array.isArray(derived.runs) ? derived.runs[derived.runs.length - 1] : null;
  const artifactSummary = item.artifacts?.summary || {};
  const totalCandidateCount = Number(artifactSummary.candidateCount || 0);
  const candidateGenerationPending = Boolean(item.project?.candidateGeneration?.isRunning || isCandidateGenerationPendingForProject(item.project?.projectId));
  const plannedCandidateCount = Math.max(
    Number(latestRun?.candidateCount || 0),
    countPreviewCandidates(item.preview),
    totalCandidateCount
  );
  const renderedCandidateCount = latestRun?.renderedCandidateCount || item.preview?.previewMeta?.renderedCandidateCount || 0;
  const hasInput = item.inputReadiness
    ? Boolean(item.inputReadiness.ready)
    : Boolean(item.documents?.source?.manifest || item.documents?.source?.transferCard || item.documents?.brief?.data || item.documents?.content?.data);
  const hasBrief = Boolean(derived.hasEffectiveApprovedBrief || item.documents?.brief?.data);
  const hasContent = Boolean(derived.hasEffectiveApprovedContent || item.documents?.content?.data);
  const hasConceptProposal = Boolean(item.proposals?.latestContentMirror?.data);
  const conceptComplete = Boolean(workflowStep("concept")?.complete || hasContent || hasConceptProposal);
  const hasCandidates = Boolean(renderedCandidateCount || plannedCandidateCount);
  const present = appLocale?.current() === "en" ? "Available" : "Vorhanden";
  const open = appLocale?.current() === "en" ? "Open" : "Offen";
  const conceptState = conceptComplete ? present : hasBrief ? t("common.inProgress") : open;
  const candidateState = candidateGenerationPending
    ? (appLocale?.current() === "en" ? "Creating" : "Wird erstellt")
    : hasCandidates ? present : open;
  return [
    { id: "input", number: 1, icon: "inbox", title: "Input", state: hasInput ? present : open, tone: hasInput ? "done" : "active" },
    { id: "concept", number: 2, icon: "notebook-text", title: t("app.concept.title"), state: conceptState, tone: conceptComplete ? "done" : hasBrief ? "active" : "pending" },
    { id: "candidates", number: 3, icon: "images", title: t("app.preview.drafts"), state: candidateState, tone: candidateGenerationPending ? "working" : hasCandidates ? "done" : "pending" }
  ];
}

function pluralLabel(count, singular, plural) {
  return `${count} ${count === 1 ? singular : plural}`;
}

function conceptVersionCountLabel(count) {
  return appLocale?.current() === "en"
    ? pluralLabel(count, "concept version", "concept versions")
    : pluralLabel(count, "Konzeptversion", "Konzeptversionen");
}

function candidateCountLabel(count) {
  return appLocale?.current() === "en"
    ? pluralLabel(count, "draft", "drafts")
    : pluralLabel(count, "Entwurf", "Entwürfe");
}

function projectArtifactSummaryParts(item = {}) {
  const summary = item.artifacts?.summary || {};
  const conceptCount = Number(summary.conceptCount || 0);
  const candidateCount = Number(summary.candidateCount || 0);
  const shouldShow = conceptCount > 1 || candidateCount > 1;
  if (!shouldShow) {
    return null;
  }

  const headline = [
    conceptCount > 1 ? conceptVersionCountLabel(conceptCount) : null,
    candidateCount ? candidateCountLabel(candidateCount) : "keine Entwürfe"
  ].filter(Boolean).join(" · ");

  return { headline };
}

function renderStatusArtifactSummary(item = {}) {
  if (!elements.statusArtifactSummary) {
    return;
  }
  const parts = projectArtifactSummaryParts(item);
  elements.statusArtifactSummary.classList.toggle("hidden", !parts);
  elements.statusArtifactSummary.innerHTML = parts
    ? `
      <strong>${escapeHtml(parts.headline)}</strong>
    `
    : "";
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
  if (item.worksheet) {
    const pdf = item.worksheet.pdf || null;
    elements.downloadButton.classList.toggle("hidden", !pdf?.url);
    elements.downloadButton.disabled = !pdf?.url;
    elements.loadProjectButton.disabled = !item.worksheet.source?.projectId;
    return;
  }
  elements.downloadButton.classList.add("hidden");
  elements.downloadButton.disabled = true;
  elements.loadProjectButton.disabled = false;
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
  const preview = previewForStep(item.preview, step);
  const candidateGeneration = step === "candidates" ? item.project?.candidateGeneration || null : null;
  if (step === "candidates") {
    renderPreview({
      ...(preview || {}),
      previewType: "candidates",
      pdfs: [],
      pages: [],
      candidates: preview?.candidates || [],
      candidateGeneration
    });
    return;
  }
  renderPreview(preview);
}

function previewForStep(preview, step) {
  if (!preview) {
    return null;
  }
  if (step === "drafts") {
    return { ...preview, previewType: "candidates", pdfs: [], pages: [], candidates: preview.candidates || [] };
  }
  if (step === "candidates") {
    return { ...preview, previewType: "candidates", pdfs: [], pages: [], candidates: preview.candidates || [] };
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

function bindPreviewOpenActions(preview) {
  bindPreviewCardActions(elements.previewGrid);
}

function bindCommandButtons(container) {
  actionBindings.bindCommandButtons(container);
}

function bindCanvasModeButtons(container) {
  actionBindings.bindCanvasModeButtons(container);
}

function renderPreview(preview) {
  elements.previewEyebrow.textContent = t("app.preview.eyebrow");
  elements.previewTitle.textContent = titleForPreview(preview);
  elements.previewGrid.dataset.previewType = preview?.previewType || "";
  applyPreviewLayout(preview);
  if (!preview || preview.previewType === "project_status") {
    setCustomScrollContent(elements.previewGrid, `<div class="no-preview">${escapeHtml(t("app.preview.noMedia"))}</div>`);
    bindPreviewOpenActions(preview);
    return;
  }
  if (preview.previewType === "pdf") {
    setCustomScrollContent(elements.previewGrid, preview.pdfs?.length
      ? preview.pdfs.map(renderPdfCard).join("")
      : `<div class="no-preview">${escapeHtml(t("app.preview.noPdf"))}</div>`);
  } else if (preview.previewType === "selected_pages") {
    setCustomScrollContent(elements.previewGrid, preview.pages?.length
      ? preview.pages.map(renderPageCard).join("")
      : `<div class="no-preview">${escapeHtml(t("app.preview.noDraftPreview"))}</div>`);
  } else if (preview.previewType === "candidates") {
    const candidates = annotateCandidateDisplayList(preview.candidates || []);
    const cards = candidates.map((candidate) => renderCandidateCard(candidate, state.workspace, { showConceptTag: false }));
    setCustomScrollContent(elements.previewGrid, cards.length
      ? cards.join("")
      : `<div class="no-preview">${escapeHtml(t("app.preview.noDrafts"))}</div>`);
  }
  bindPreviewOpenActions(preview);
}

function titleForPreview(preview) {
  const titles = {
    candidates: t("app.preview.drafts"),
    pdf: "PDF",
    project_status: t("app.preview.input"),
    selected_pages: t("app.preview.drafts")
  };
  return titles[preview?.previewType] || t("app.preview.eyebrow");
}

function renderPageCard(page) {
  return `
    <figure class="preview-card is-openable" data-open-url="${escapeHtml(page.url)}">
      <img src="${escapeHtml(page.url)}" alt="${escapeHtml(t("common.page", { number: page.page }))}">
    </figure>
  `;
}

function renderWorksheetPageCard(page = {}, index = 0, pageTotal = 1, worksheetTitle = "") {
  const label = pageTotal > 1
    ? `${t("common.page", { number: page.page || index + 1 })}/${pageTotal}`
    : t("common.page", { number: page.page || index + 1 });
  return `
    <figure
      class="preview-card worksheet-page-card is-openable"
      data-open-url="${escapeHtml(page.url)}"
      data-capture-kind="worksheet-page"
      data-viewer-title="${escapeHtml(worksheetTitle || t("app.preview.worksheet"))}"
      data-page="${escapeHtml(page.page || index + 1)}"
      data-page-total="${escapeHtml(pageTotal)}"
      data-page-role="${escapeHtml(page.role || t("app.preview.worksheet"))}"
      data-source-candidate-id="${escapeHtml(page.sourceCandidateId || "")}"
    >
      <span class="worksheet-page-sheet">
        <img src="${escapeHtml(page.url)}" alt="${escapeHtml(label)}" loading="lazy">
      </span>
    </figure>
  `;
}

function renderPdfCard(pdf) {
  return `
    <figure class="preview-card is-openable" data-open-url="${escapeHtml(pdf.url)}">
      <iframe src="${escapeHtml(pdf.url)}" title="${escapeHtml(t("app.preview.pdf"))}"></iframe>
    </figure>
  `;
}

function candidateCreatedAtValue(candidate = {}) {
  return candidate.createdAt
    || candidate.generation?.createdAt
    || candidate.pages?.[0]?.metadata?.createdAt
    || "";
}

function candidateDisplaySortEntries(candidates = []) {
  return candidates
    .map((candidate, index) => ({ candidate, index, key: `${candidateKey(candidate)}:${index}` }))
    .sort((left, right) => {
      return String(candidateCreatedAtValue(left.candidate)).localeCompare(String(candidateCreatedAtValue(right.candidate)))
        || String(left.candidate.runId || "").localeCompare(String(right.candidate.runId || ""))
        || String(left.candidate.id || "").localeCompare(String(right.candidate.id || ""))
        || left.index - right.index;
    });
}

function candidateConceptDisplayLabel(candidate = {}) {
  const reference = candidate.concept || candidate;
  const version = Number(candidate.basedOnConceptVersion || reference.conceptVersion || 0) || null;
  return version ? conceptVersionDisplayName(version) : conceptLabel(reference);
}

function draftLabelFromNumber(value = 1) {
  const number = Number(value || 0) || 1;
  return t("app.draft.label", { number: String(number).padStart(2, "0") });
}

function draftNumberFromValue(value = "") {
  const match = String(value || "").match(/candidate(?:_bundle)?_0*(\d+)/i);
  return match ? Number(match[1]) : null;
}

function draftDisplayLabel(candidate = {}, fallbackNumber = 1) {
  const existing = String(candidate.displayLabel || "").trim();
  if (/^(?:Entwurf|Draft)\s+\d+/i.test(existing)) {
    const existingNumber = existing.match(/\d+/)?.[0];
    return t("app.draft.label", { number: String(existingNumber || fallbackNumber).padStart(2, "0") });
  }
  const number = Number(candidate.displayNumber || 0)
    || draftNumberFromValue(candidate.id)
    || draftNumberFromValue(candidate.rawCandidateId)
    || draftNumberFromValue(existing)
    || fallbackNumber;
  return draftLabelFromNumber(number);
}

function draftFilePrefix(candidate = {}, fallbackNumber = 1) {
  const number = Number(candidate.displayNumber || 0)
    || draftNumberFromValue(candidate.id)
    || draftNumberFromValue(candidate.rawCandidateId)
    || fallbackNumber;
  return `entwurf_${String(number).padStart(2, "0")}`;
}

function draftPageCount(candidate = {}) {
  const pages = (candidate.pages || []).filter((page) => page.url).length;
  return pages || Number(candidate.generation?.generatedPageCount || candidate.generation?.pageCount || candidate.generation?.plannedPageCount || 0) || 0;
}

function draftVersionLabel(candidate = {}) {
  const reference = candidate.concept || candidate;
  const version = Number(candidate.basedOnConceptVersion || reference.conceptVersion || 0) || null;
  return version ? conceptVersionDisplayName(version) : "";
}

function draftMetaLabel(candidate = {}) {
  const pageCount = draftPageCount(candidate);
  return [
    pageCount > 1 ? t("common.pages", { count: pageCount }) : null,
    draftVersionLabel(candidate) || null
  ].filter(Boolean).join(" · ");
}

function draftChatBasisLabel(candidate = {}) {
  const versionLabel = draftVersionLabel(candidate);
  return versionLabel
    ? `${appLocale?.current() === "en" ? "Worksheet concept" : "AB-Konzept"} ${versionLabel}`
    : "";
}

function candidateForDisplay(candidate = {}, workspace = state.workspace) {
  const candidates = annotateCandidateDisplayList(workspaceCandidateHistory(workspace || {}));
  const found = candidates.find((entry) => candidateKey(entry) === candidateKey(candidate));
  return found || {
    ...candidate,
    displayLabel: draftDisplayLabel(candidate),
    conceptDisplayLabel: candidateConceptDisplayLabel(candidate),
    rawCandidateId: candidate.id || null
  };
}

function candidateConceptGroupKey(candidate = {}) {
  const reference = candidate.concept || {};
  return candidate.basedOnConceptId
    || reference.contentMirrorId
    || reference.conceptId
    || (candidate.basedOnConceptVersion || reference.conceptVersion ? `version:${candidate.basedOnConceptVersion || reference.conceptVersion}` : "")
    || "unknown";
}

function candidateImageSpecKey(candidate = {}) {
  return candidate.generation?.imageSpecProposalId
    || candidate.generation?.imageSpecId
    || candidate.generation?.imageSpecSummary
    || "";
}

function annotateCandidateDisplayList(candidates = []) {
  if (!Array.isArray(candidates) || !candidates.length) {
    return [];
  }
  const sortedEntries = candidateDisplaySortEntries(candidates);
  const byDisplayKey = new Map();
  const conceptGroups = new Map();

  sortedEntries.forEach((entry, index) => {
    byDisplayKey.set(entry.key, index + 1);
    const conceptKey = candidateConceptGroupKey(entry.candidate);
    if (!conceptGroups.has(conceptKey)) {
      conceptGroups.set(conceptKey, []);
    }
    conceptGroups.get(conceptKey).push(entry);
  });

  return sortedEntries.map((entry) => {
    const { candidate, key } = entry;
    const displayNumber = byDisplayKey.get(key) || entry.index + 1;
    return {
      ...candidate,
      displayNumber,
      displayLabel: draftLabelFromNumber(displayNumber),
      conceptDisplayLabel: candidateConceptDisplayLabel(candidate),
      rawCandidateId: candidate.id || null
    };
  });
}

function candidateImageDownloads(pages = [], fallbackPrefix = "candidate") {
  return candidateCardRenderer.candidateImageDownloads(pages, fallbackPrefix);
}

function renderCandidateImageDownloadButton(downloads = []) {
  return candidateCardRenderer.renderCandidateImageDownloadButton(downloads);
}

function candidateWorksheetDepositKey(runId = "", candidateId = "") {
  return candidateCardRenderer.candidateWorksheetDepositKey(runId, candidateId);
}

function candidateWorksheetDeposits(candidate = {}, workspace = state.workspace) {
  return candidateCardRenderer.candidateWorksheetDeposits(candidate, workspace);
}

function candidateHasWorksheetDeposit(candidate = {}, workspace = state.workspace) {
  return candidateCardRenderer.candidateHasWorksheetDeposit(candidate, workspace);
}

function renderCandidateWorksheetStoreAction(candidate = {}, pageCount = 1, workspace = state.workspace) {
  return candidateCardRenderer.renderCandidateWorksheetStoreAction(candidate, pageCount, workspace);
}

function renderCandidateCard(candidate, workspace = state.workspace, options = {}) {
  return candidateCardRenderer.renderCandidateCard(candidate, workspace, options);
}

async function openWorksheetInLibrary(worksheetId) {
  if (!worksheetId) {
    return;
  }
  state.libraryView = "worksheets";
  state.query = "";
  if (elements.searchInput) {
    elements.searchInput.value = "";
  }
  setTreeSelection([`worksheet:${worksheetId}`], {
    primaryId: `worksheet:${worksheetId}`,
    anchorId: `worksheet:${worksheetId}`
  });
  closeWorkspace();
  await loadTree({ keepSelection: true, selectAfterLoad: true });
}

async function depositCandidateWorksheet(button) {
  const projectId = state.selectedItem?.project?.projectId || state.workspace?.project?.projectId || currentProjectId();
  const candidateId = button.dataset.candidateId || "";
  const runId = button.dataset.runId || "";
  if (!projectId || !candidateId) {
    showToast("Kein Entwurf ausgewählt.", "error");
    return;
  }
  button.disabled = true;
  try {
    const result = await fetchJson("/api/worksheets/deposit-candidate", {
      method: "POST",
      body: JSON.stringify({
        projectId,
        runId,
        candidateId
      })
    });
    if (result.duplicate && result.existing?.worksheetId) {
      const createCopy = await requestConfirmation({
        eyebrow: "Schon abgelegt",
        title: "Bereits in Arbeitsblätter",
        message: `"${result.existing.title || "Dieses Arbeitsblatt"}" wurde aus genau diesem Entwurf schon abgelegt.`,
        acceptLabel: "Kopie anlegen",
        cancelLabel: "Bestehendes öffnen"
      });
      if (!createCopy) {
        await openWorksheetInLibrary(result.existing.worksheetId);
        showToast(worksheetDepositToastMessage(result), "success");
        return;
      }
      const copy = await fetchJson("/api/worksheets/deposit-candidate", {
        method: "POST",
        body: JSON.stringify({
          projectId,
          runId,
          candidateId,
          forceDuplicate: true
        })
      });
      if (copy.item?.worksheetId) {
        await openWorksheetInLibrary(copy.item.worksheetId);
        showToast(worksheetDepositToastMessage(copy), "success");
      }
      return;
    }
    if (result.item?.worksheetId) {
      await openWorksheetInLibrary(result.item.worksheetId);
      showToast(worksheetDepositToastMessage(result), "success");
    }
  } catch (error) {
    showToast(error.message, "error");
  } finally {
    button.disabled = false;
  }
}

function downloadCandidateImages(button) {
  actionBindings.downloadCandidateImages(button);
}

function bindPreviewCardActions(container) {
  actionBindings.bindPreviewCardActions(container);
  bindRevisionTargetActions(container);
}

function currentPreviewCandidates() {
  return state.mode === "workspace"
    ? workspaceCandidateHistory(state.workspace || {})
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

function finiteNumber(value) {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function formatUsd(value) {
  const number = finiteNumber(value);
  if (number === null) {
    return "";
  }
  const digits = number === 0 ? 2 : Math.abs(number) < 0.01 ? 4 : 2;
  return `$${number.toFixed(digits)}`;
}

function formatTokenCount(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) {
    return "";
  }
  return new Intl.NumberFormat("de-DE").format(Math.round(number));
}

function candidatePageCostEstimates(candidate = {}) {
  return (candidate.pages || [])
    .map((page) => page.metadata?.costEstimate)
    .filter(Boolean);
}

function candidatePageUsage(candidate = {}) {
  return (candidate.pages || [])
    .map((page) => page.metadata?.usage)
    .filter(Boolean);
}

function usageTotalTokens(usage = {}) {
  return Number(usage.total_tokens || usage.totalTokens || 0)
    || (Number(usage.input_tokens || 0) + Number(usage.output_tokens || 0))
    || 0;
}

function candidateBillingSummary(candidate = {}) {
  const generation = candidate.generation || {};
  const provider = generation.provider || candidate.pages?.[0]?.metadata?.provider || null;
  if (provider === "codex_cli") {
    return {
      provider,
      shortLabel: "Codex Usage",
      providerLabel: "Codex/ChatGPT-Kontingent",
      title: "Dieser Entwurf wurde über Codex Usage erzeugt. Exakte Kosten pro Bildlauf werden von diesem Pfad nicht zurückgegeben.",
      costLabel: null,
      tokenLabel: null
    };
  }

  const estimates = candidatePageCostEstimates(candidate);
  const pricedEstimates = estimates.filter((estimate) => estimate.estimatedCostAvailable && finiteNumber(estimate.estimatedCostUsd) !== null);
  const usageEntries = candidatePageUsage(candidate);
  const totalTokens = pricedEstimates.reduce((sum, estimate) => sum + Number(estimate.tokens?.totalTokens || 0), 0)
    || usageEntries.reduce((sum, usage) => sum + usageTotalTokens(usage), 0);
  const totalCost = pricedEstimates.reduce((sum, estimate) => sum + Number(estimate.estimatedCostUsd || 0), 0);
  const imageCount = Number(generation.generatedPageCount || pricedEstimates.length || usageEntries.length || 0) || 0;
  const tokenLabel = totalTokens ? `${formatTokenCount(totalTokens)} Tokens` : null;

  if (pricedEstimates.length) {
    const costLabel = `ca. ${formatUsd(totalCost)}`;
    const titleParts = [
      `${costLabel} für ${imageCount || pricedEstimates.length} Bildlauf${(imageCount || pricedEstimates.length) === 1 ? "" : "e"}`,
      tokenLabel,
      pricedEstimates[0]?.pricingSourceDate ? `Preisstand ${pricedEstimates[0].pricingSourceDate}` : null
    ].filter(Boolean);
    return {
      provider: "openai",
      shortLabel: costLabel,
      providerLabel: "OpenAI API",
      title: titleParts.join(" · "),
      costLabel,
      tokenLabel,
      estimatedCostUsd: totalCost,
      totalTokens,
      imageCount
    };
  }

  if (tokenLabel) {
    return {
      provider: "openai",
      shortLabel: tokenLabel,
      providerLabel: "OpenAI API",
      title: "OpenAI API-Usage ist vorhanden, aber für dieses Modell gibt es keine lokale Kostenregel.",
      costLabel: null,
      tokenLabel,
      totalTokens,
      imageCount
    };
  }

  if (provider === "openai") {
    return {
      provider: "openai",
      shortLabel: "API-Kosten",
      providerLabel: "OpenAI API",
      title: "Für diesen Entwurf wurden keine Usage-Daten im Bildlauf gespeichert.",
      costLabel: null,
      tokenLabel: null
    };
  }

  return null;
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
    deterministic: "Exaktheit beachten",
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
    ? "Spezialvorlagen sind im normalen Ablauf deaktiviert; bei Bedarf ein eigenes Referenzbild anhängen."
    : policy.preferredSource === "user_upload_or_reference_search"
      ? "Am besten mit hochgeladener Referenz oder optionaler offener Bildreferenz."
      : policy.preferredSource === "app_template_or_user_upload"
        ? "Am besten mit hochgeladener Referenz."
        : "";
  const action = policy.suggestedAction || "";
  return [policy.reason, source, action].filter(Boolean).join(" ");
}

function renderCandidateInfo(candidate) {
  const firstPage = (candidate.pages || []).find((page) => page.url) || (candidate.pages || [])[0] || {};
  const generation = candidate.generation || {};
  const metadata = firstPage.metadata || {};
  const referencePolicy = generation.referencePolicy || metadata.referencePolicy || null;
  const referenceImages = (Array.isArray(generation.referenceImages) && generation.referenceImages.length
    ? generation.referenceImages
    : Array.isArray(metadata.referenceImages)
      ? metadata.referenceImages
      : [])
    .filter((reference) => reference?.path)
    .slice(0, 4);
  const duration = formatDuration(metadata.durationMs);
  const usage = candidateUsageLabel(candidate);
  const billing = candidateBillingSummary(candidate);
  const prompt = firstPage.prompt || metadata.revisedPrompt || "";
  return `
    <section class="candidate-info-grid">
      ${renderInfoRow("Modell", generation.model || metadata.model)}
      ${renderInfoRow("Qualität", generation.qualityLabel || generation.qualityPreset || metadata.qualityPreset || metadata.quality)}
      ${renderInfoRow("Größe", generation.size || metadata.size)}
      ${renderInfoRow("Format", generation.outputFormat || firstPage.format || metadata.format)}
      ${renderInfoRow("Dauer", duration)}
      ${renderInfoRow("Kosten", billing?.costLabel)}
      ${renderInfoRow("Tokens", billing?.tokenLabel)}
      ${renderInfoRow("Abrechnung", billing?.providerLabel)}
      ${renderInfoRow("Nutzung", usage)}
      ${renderInfoRow("Interne Bildplanung", generation.imageSpecSummary || generation.imageSpecProposalId)}
      ${renderInfoRow("Referenz", referencePolicy ? referencePolicyLabel(referencePolicy) : "")}
      ${renderInfoRow("Konzept", draftVersionLabel(candidate) || conceptLabel(candidate.concept || candidate))}
    </section>
    ${referencePolicy ? `
      <section class="candidate-info-section">
        <p class="detail-label">Referenz/Vorlage</p>
        <p>${escapeHtml(referencePolicySummary(referencePolicy))}</p>
      </section>
    ` : ""}
    ${referenceImages.length ? `
      <section class="candidate-info-section">
        <p class="detail-label">Beigelegte Referenzen</p>
        <div class="candidate-reference-list">
          ${referenceImages.map((reference) => `
            <span>${escapeHtml(reference.role || "Referenz")} · ${escapeHtml(fileName(reference.path) || reference.path)}</span>
          `).join("")}
        </div>
      </section>
    ` : ""}
    ${generation.imageSpecProposalId ? `
      <section class="candidate-info-section">
        <p class="detail-label">Bildplanungs-ID</p>
        <p>${escapeHtml(generation.imageSpecProposalId)}</p>
      </section>
    ` : ""}
      <section class="candidate-info-section">
        <p class="detail-label">Bildprompt</p>
      <pre>${escapeHtml(prompt || "Kein Prompt für diesen Entwurf gefunden.")}</pre>
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
    showToast("Keine Generierungsinfos für diesen Entwurf gefunden.", "error");
    return;
  }
  const displayCandidate = candidateForDisplay(candidate);
  state.candidateInfo.lastFocusedElement = document.activeElement;
  elements.candidateInfoTitle.textContent = draftDisplayLabel(displayCandidate);
  elements.candidateInfoMeta.textContent = [
    draftMetaLabel(displayCandidate),
    candidate.generation?.provider || "openai",
    candidate.status
  ].filter(Boolean).join(" · ");
  setCustomScrollContent(elements.candidateInfoBody, renderCandidateInfo(candidate));
  elements.candidateInfoModal.classList.remove("hidden");
  elements.candidateInfoCloseButton?.focus();
}

function closeCandidateInfo() {
  if (!elements.candidateInfoModal || elements.candidateInfoModal.classList.contains("hidden")) {
    return;
  }
  elements.candidateInfoModal.classList.add("hidden");
  setCustomScrollContent(elements.candidateInfoBody, "");
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
    candidateId: card.dataset.displayLabel || draftDisplayLabel({ id: source.candidateId }),
    runId: source.runId,
    page: source.page,
    role: source.role,
    path: source.sourcePath,
    meta: card.dataset.viewerMeta || "",
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
        candidateId: draftDisplayLabel(candidate),
        runId: candidate.runId,
        page: page.page || 1,
        role: page.role,
        path: page.path,
        meta: draftMetaLabel(candidate),
        source
      };
    });
}

function candidateViewerItemsFromCard(card) {
  const candidate = findCandidatePreview(card.dataset.candidateId, card.dataset.runId);
  const displayLabel = card.dataset.displayLabel || null;
  const items = candidate ? candidateViewerItemsFromCandidate({
    ...candidate,
    displayLabel: displayLabel || candidate.displayLabel
  }) : [];
  if (items.length) {
    return items;
  }
  const item = candidateViewerItemFromCard(card);
  return item?.url ? [item] : [];
}

function worksheetViewerItemFromCard(card) {
  const image = card.querySelector("img");
  const page = Number(card.dataset.page || 1) || 1;
  const pageTotal = Number(card.dataset.pageTotal || 1) || 1;
  const title = card.dataset.viewerTitle || state.selectedItem?.worksheet?.title || "Arbeitsblatt";
  return {
    viewerKind: "worksheet-page",
    url: card.dataset.openUrl || image?.currentSrc || image?.src || null,
    title,
    page,
    pageTotal,
    role: card.dataset.pageRole || "Arbeitsblatt",
    sourceCandidateId: card.dataset.sourceCandidateId || ""
  };
}

function worksheetViewerItemsFrom(container) {
  return Array.from(container.querySelectorAll("[data-capture-kind='worksheet-page']"))
    .map(worksheetViewerItemFromCard)
    .filter((item) => item.url);
}

function openWorksheetViewerFromCard(card, container) {
  const host = container || card.closest(".preview-grid, .mobile-preview-body") || document;
  const cards = Array.from(host.querySelectorAll("[data-capture-kind='worksheet-page']"));
  const items = worksheetViewerItemsFrom(host);
  const index = Math.max(0, cards.indexOf(card));
  openCandidateViewer(items, index);
}

function candidateViewerItemsFrom(container) {
  return Array.from(container.querySelectorAll("[data-capture-kind='candidate']"))
    .flatMap(candidateViewerItemsFromCard)
    .filter((item) => item.url);
}

function openCandidateViewerFromCard(card, container) {
  const host = container || card.closest(".canvas-body, .preview-grid, .mobile-preview-body") || document;
  if (host === elements.chatTimeline || card.closest(".chat-timeline")) {
    const items = annotateCandidateDisplayList(state.workspace?.preview?.candidates || [])
      .flatMap(candidateViewerItemsFromCandidate)
      .filter(Boolean);
    const targetCandidateId = card.dataset.candidateId || "";
    const targetRunId = card.dataset.runId || "";
    const targetPage = Number(card.dataset.page || 0) || 0;
    const index = Math.max(0, items.findIndex((item) => {
      const matchesCandidate = !targetCandidateId
        || item.candidateId === targetCandidateId
        || item.source?.candidateId === targetCandidateId;
      const matchesRun = !targetRunId || item.runId === targetRunId;
      const matchesPage = !targetPage || Number(item.page || 0) === targetPage;
      return matchesCandidate && matchesRun && matchesPage;
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

function candidateViewerGroupKey(item = {}) {
  return [
    item.runId || "",
    item.source?.candidateId || item.candidateId || ""
  ].join("::");
}

function candidateViewerPosition(items = [], index = 0) {
  const groups = [];
  const groupMap = new Map();

  items.forEach((entry, itemIndex) => {
    const key = candidateViewerGroupKey(entry);
    let group = groupMap.get(key);
    if (!group) {
      group = { key, itemIndexes: [] };
      groupMap.set(key, group);
      groups.push(group);
    }
    group.itemIndexes.push(itemIndex);
  });

  const currentItem = items[index] || null;
  const currentKey = candidateViewerGroupKey(currentItem);
  const candidateIndex = Math.max(0, groups.findIndex((group) => group.key === currentKey));
  const currentGroup = groups[candidateIndex] || { itemIndexes: [index] };
  const pageIndex = Math.max(0, currentGroup.itemIndexes.indexOf(index));

  return {
    candidateNumber: candidateIndex + 1,
    candidateTotal: groups.length || 1,
    pageNumber: pageIndex + 1,
    pageTotal: currentGroup.itemIndexes.length || 1
  };
}

function candidateViewerCounterLabel(position = {}) {
  const candidateLabel = draftLabelFromNumber(position.candidateNumber || 1);
  if ((position.pageTotal || 1) > 1) {
    return `${candidateLabel}, Seite ${position.pageNumber || 1}`;
  }
  return candidateLabel;
}

function worksheetViewerCounterLabel(item = {}, index = 0, total = 1) {
  const currentPage = Number(item.page || index + 1) || index + 1;
  if (total > 1) {
    return `Seite ${currentPage} / ${total}`;
  }
  return "Arbeitsblatt";
}

function renderCandidateViewer() {
  const item = currentCandidateViewerItem();
  if (!item) {
    closeCandidateViewer();
    return;
  }
  const total = state.candidateViewer.items.length;
  if (item.viewerKind === "asset") {
    elements.candidateViewerCounter.textContent = item.role || "Bild";
    elements.candidateViewerTitle.textContent = item.title || fileName(item.url);
    elements.candidateViewerMeta.textContent = item.meta || "";
    elements.candidateViewerImage.src = item.url;
    elements.candidateViewerImage.alt = item.title || fileName(item.url);
    elements.candidateViewerPreviousButton.disabled = true;
    elements.candidateViewerNextButton.disabled = true;
    return;
  }
  if (item.viewerKind === "worksheet-page") {
    elements.candidateViewerCounter.textContent = worksheetViewerCounterLabel(item, state.candidateViewer.index, total);
    elements.candidateViewerTitle.textContent = item.title || "Arbeitsblatt";
    elements.candidateViewerMeta.textContent = [
      item.role || null,
      item.sourceCandidateId ? `aus ${draftDisplayLabel({ id: item.sourceCandidateId })}` : null
    ].filter(Boolean).join(" · ");
    elements.candidateViewerImage.src = item.url;
    elements.candidateViewerImage.alt = worksheetViewerCounterLabel(item, state.candidateViewer.index, total);
    elements.candidateViewerPreviousButton.disabled = state.candidateViewer.index <= 0;
    elements.candidateViewerNextButton.disabled = state.candidateViewer.index >= total - 1;
    return;
  }
  const position = candidateViewerPosition(state.candidateViewer.items, state.candidateViewer.index);
  elements.candidateViewerCounter.textContent = candidateViewerCounterLabel(position);
  elements.candidateViewerTitle.textContent = item.candidateId;
  elements.candidateViewerMeta.textContent = item.meta || "";
  elements.candidateViewerImage.src = item.url;
  elements.candidateViewerImage.alt = candidateViewerCounterLabel(position);
  elements.candidateViewerPreviousButton.disabled = state.candidateViewer.index <= 0;
  elements.candidateViewerNextButton.disabled = state.candidateViewer.index >= total - 1;
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
    const heading = markdownHeading(trimmed);
    if (!trimmed) {
      closeList();
    } else if (heading) {
      closeList();
      html.push(renderMarkdownHeading(heading, renderInlineRichText(heading.text)));
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
  const heading = markdownHeading(trimmed);
  if (heading) {
    return {
      html: renderMarkdownHeading(
        heading,
        `${renderStreamingInlineText(heading.text, contentOffset + heading.contentStart, revealStart)}${cursor}`
      ),
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

function taskVisibleContent(task = {}) {
  const text = normalizeGermanDisplayText(
    stripLeadingTaskNumber(firstNonEmpty(task.text, task.prompt))
  );
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (!lines.length) {
    return { title: "", body: "" };
  }
  if (lines.length === 1) {
    return { title: lines[0], body: "" };
  }
  return {
    title: lines[0],
    body: lines.slice(1).join("\n")
  };
}

function taskGroupLabelText(task = {}) {
  return normalizeGermanDisplayText(firstNonEmpty(task.groupLabel));
}

function taskActionLabel(task = {}) {
  const prompt = normalizeGermanDisplayText(taskPromptText(task));
  const text = prompt.toLowerCase();
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
  return prompt || "Bearbeiten";
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
  const pages = worksheetPagesValue(brief, content);
  const taskPrefix = pages && pages > 1 && tasks.length <= pages ? "Blatt" : "Aufgabe";
  const groupCounts = tasks.reduce((counts, task) => {
    const groupLabel = taskGroupLabelText(task);
    if (groupLabel) {
      counts.set(groupLabel, (counts.get(groupLabel) || 0) + 1);
    }
    return counts;
  }, new Map());
  const groupIndexes = new Map();
  const visibleBlocks = [
    ...readingTexts.map((_, index) => ({
      title: readingTexts.length > 1 ? `Text ${index + 1}` : "Text",
      structureTone: "text"
    })),
    ...tasks.map((task, index) => {
      const groupLabel = taskGroupLabelText(task);
      if (!groupLabel) {
        return {
          title: `${taskPrefix} ${index + 1}`,
          structureTone: taskPrefix === "Blatt" ? "sheet" : "task"
        };
      }
      const groupIndex = (groupIndexes.get(groupLabel) || 0) + 1;
      groupIndexes.set(groupLabel, groupIndex);
      return {
        title: groupCounts.get(groupLabel) === 1 && /^Station\s+/i.test(groupLabel)
          ? groupLabel
          : `${groupLabel} · Aufgabe ${groupIndex}`,
        structureTone: "task"
      };
    })
  ];

  if (visibleBlocks.length) {
    return visibleBlocks;
  }

  const imageMaterials = Array.isArray(content.imageMaterials) ? content.imageMaterials : [];
  return imageMaterials.map((_, index) => ({
    title: imageMaterials.length > 1 ? `Bild ${index + 1}` : "Bild",
    structureTone: "image"
  }));
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
      title: firstNonEmpty(brief.goal)
    });
  }

  return items.filter((item) => item.title || item.body || item.meta);
}

function conceptVisibleContentItems(content = {}) {
  const readingTexts = Array.isArray(content.readingTexts) ? content.readingTexts : [];
  const tasks = Array.isArray(content.tasks) ? content.tasks : [];
  const solutionNotes = Array.isArray(content.solutionNotes) ? content.solutionNotes : [];
  const items = [];
  const groupCounts = tasks.reduce((counts, task) => {
    const groupLabel = taskGroupLabelText(task);
    if (groupLabel) {
      counts.set(groupLabel, (counts.get(groupLabel) || 0) + 1);
    }
    return counts;
  }, new Map());
  const groupIndexes = new Map();

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
    const visibleTask = taskVisibleContent(task);
    const expected = firstNonEmpty(task.expectedAnswer);
    const groupLabel = taskGroupLabelText(task);
    const groupIndex = groupLabel ? (groupIndexes.get(groupLabel) || 0) + 1 : 0;
    if (groupLabel) {
      groupIndexes.set(groupLabel, groupIndex);
    }
    if (visibleTask.title || visibleTask.body || expected) {
      items.push({
        kicker: groupLabel
          ? groupCounts.get(groupLabel) === 1 && /^Station\s+/i.test(groupLabel)
            ? groupLabel
            : `${groupLabel} · Aufgabe ${groupIndex}`
          : `Aufgabe ${index + 1}`,
        title: visibleTask.title,
        body: visibleTask.body,
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
    { title: t("app.concept.framework"), items: conceptFrameItems(project, teachingContext, brief, content) },
    { title: t("app.concept.sheetStructure"), items: conceptStructureItems(content, brief), display: "structure" },
    { title: t("app.concept.taskLogic"), items: conceptLogicItems(content, brief) },
    { title: t("app.concept.visibleContent"), items: conceptVisibleContentItems(content) },
    { title: t("app.concept.imageLayout"), items: conceptLayoutItems(content, brief) }
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
      ${item.expected ? `<div class="concept-item-expected"><span>${escapeHtml(appLocale?.current() === "en" ? "Expected answer" : "Erwartung")}</span>${richParagraphs(item.expected)}</div>` : ""}
      ${item.meta ? `<p class="concept-item-meta">${renderInlineRichText(item.meta)}</p>` : ""}
    </article>
  `;
}

function renderConceptStructureSection(section = {}) {
  return `
    <div class="concept-structure-flow" aria-label="${escapeHtml(section.title || "Blattaufbau")}">
      ${(section.items || []).map((item, index) => `
        <article class="concept-structure-node tone-${escapeHtml(item.structureTone || "task")}">
          <span class="concept-structure-step">${index + 1}</span>
          <strong>${escapeHtml(firstNonEmpty(item.title, item.kicker, `Schritt ${index + 1}`))}</strong>
        </article>
      `).join("")}
    </div>
  `;
}

function renderConceptSectionBody(section = {}, options = {}) {
  if (section.display === "structure") {
    return renderConceptStructureSection(section);
  }
  return `
    <div class="concept-items">
      ${section.items.map((item) => renderConceptItem(item, { compact: options.compact !== false })).join("")}
    </div>
  `;
}

function renderConceptSections(sections = [], options = {}) {
  if (!sections.length) {
    return `<p class="detail-muted">${escapeHtml(appLocale?.current() === "en" ? "No concept details available." : "Keine Konzeptdetails vorhanden.")}</p>`;
  }
  const compact = options.compact !== false;
  const accordion = options.accordion === true || !compact;
  return `
    <div class="${compact ? "concept-chat-sections" : "concept-detail-sections"}${accordion ? " concept-accordion" : ""}">
      ${sections.map((section) => `
        ${accordion ? `
          <details class="concept-section-panel">
            <summary>
              <span class="concept-section-title">${escapeHtml(section.title)}</span>
              <span class="concept-section-count">${escapeHtml(section.items.length)} ${appLocale?.current() === "en" ? (section.items.length === 1 ? "entry" : "entries") : (section.items.length === 1 ? "Eintrag" : "Einträge")}</span>
            </summary>
            ${renderConceptSectionBody(section, { compact })}
          </details>
        ` : `
          <section>
            <div class="concept-section-heading">
              <h4>${escapeHtml(section.title)}</h4>
              <span>${escapeHtml(section.items.length)} ${appLocale?.current() === "en" ? (section.items.length === 1 ? "entry" : "entries") : (section.items.length === 1 ? "Eintrag" : "Einträge")}</span>
            </div>
            ${renderConceptSectionBody(section, { compact })}
          </section>
        `}
      `).join("")}
    </div>
  `;
}

function conceptCopyLine(label, value) {
  const text = valueText(value);
  return text ? `${label}: ${text}` : "";
}

function conceptCopyItemText(item = {}) {
  const lines = [];
  const title = firstNonEmpty(item.title, item.kicker);
  const kicker = item.kicker && item.kicker !== title ? `${item.kicker}: ` : "";
  if (title) {
    lines.push(`- ${kicker}${valueText(title)}`);
  }
  if (item.body) {
    lines.push(`  ${valueText(item.body)}`);
  }
  if (item.expected) {
    lines.push(`  Erwartung: ${valueText(item.expected)}`);
  }
  if (item.meta) {
    lines.push(`  Hinweis: ${valueText(item.meta)}`);
  }
  return lines.join("\n");
}

function conceptCopyText({
  project = {},
  brief = {},
  content = {},
  teachingContext = {},
  versionLabel = "",
  statusLabel = "",
  eyebrow = "Arbeitsblatt-Konzept"
} = {}) {
  const title = worksheetConceptTitle(project, brief, content, teachingContext);
  const subtitle = worksheetConceptSubtitle(brief, content, teachingContext);
  const sections = conceptSectionsFromContent(content, { brief, project, teachingContext });
  const header = [
    `${eyebrow}: ${title}`,
    conceptCopyLine("Version", versionLabel),
    conceptCopyLine("Status", statusLabel),
    conceptCopyLine("Kurzinfo", subtitle)
  ].filter(Boolean);
  const body = sections.flatMap((section) => {
    const items = (section.items || [])
      .map(conceptCopyItemText)
      .filter(Boolean);
    return items.length ? [`\n${section.title}`, ...items] : [];
  });
  return [...header, ...body].join("\n");
}

function registerConceptCopyText(options = {}) {
  const id = `concept-copy-${nextConceptCopyId++}`;
  conceptCopyTexts.set(id, conceptCopyText(options));
  return id;
}

function renderConceptCopyButton(options = {}) {
  const copyId = registerConceptCopyText(options);
  return `
    <button class="icon-button icon-button-plain concept-chat-action-button" type="button" data-concept-copy-id="${escapeHtml(copyId)}" aria-label="${escapeHtml(appLocale?.current() === "en" ? "Copy worksheet concept" : "Arbeitsblatt-Konzept kopieren")}" title="${escapeHtml(appLocale?.current() === "en" ? "Copy worksheet concept" : "Arbeitsblatt-Konzept kopieren")}">
      ${icon("copy", "icon icon-small")}
    </button>
  `;
}

function renderConceptPreviewButton(preview = {}) {
  const proposalAttrs = preview.proposalRef?.proposalId
    ? `data-artifact-kind="proposal" data-artifact-id="${escapeHtml(preview.proposalRef.proposalId)}" data-proposal-kind="${escapeHtml(preview.proposalRef.kind || "")}"`
    : "";
  return `
    <button class="icon-button icon-button-plain concept-chat-action-button" type="button" data-canvas-mode="${escapeHtml(preview.canvasMode || "content")}" ${proposalAttrs} aria-label="${escapeHtml(appLocale?.current() === "en" ? "Open preview" : "Vorschau öffnen")}" title="${escapeHtml(appLocale?.current() === "en" ? "Open preview" : "Vorschau öffnen")}">
      ${icon("eye", "icon icon-small")}
    </button>
  `;
}

async function copyConceptFromButton(button) {
  const text = conceptCopyTexts.get(button.dataset.conceptCopyId || "");
  if (!text) {
    showToast("Kein Konzept zum Kopieren gefunden.", "error");
    return;
  }
  try {
    const copied = await writeClipboardText(text);
    showToast(copied ? "Arbeitsblatt-Konzept kopiert" : "Arbeitsblatt-Konzept zum Kopieren geöffnet", "success");
  } catch (error) {
    showToast(error.message || "Konzept konnte nicht kopiert werden.", "error");
  }
}

function bindConceptCopyActions(container) {
  container?.querySelectorAll("[data-concept-copy-id]").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      copyConceptFromButton(button);
    });
  });
}

function renderConceptDocumentHeader({
  project = {},
  brief = {},
  content = {},
  teachingContext = {},
  label = "Kurzüberblick",
  titleTag = "h4",
  versionLabel = "",
  statusLabel = "",
  eyebrow = "Arbeitsblatt-Konzept"
} = {}) {
  const title = escapeHtml(worksheetConceptTitle(project, brief, content, teachingContext));
  const copyButton = renderConceptCopyButton({
    project,
    brief,
    content,
    teachingContext,
    versionLabel,
    statusLabel,
    eyebrow
  });
  return `
    <div class="concept-document-heading concept-document-heading-with-action">
      <div>
        <p class="detail-label">${escapeHtml(label)}</p>
        <${titleTag}>${title}</${titleTag}>
      </div>
      ${copyButton}
    </div>
  `;
}

function statusWord(value) {
  if (value === "approved") {
    return appLocale?.current() === "en" ? "approved" : "bestätigt";
  }
  if (value === "draft") {
    return t("common.inProgress");
  }
  if (value === "proposed") {
    return t("common.ready").toLowerCase();
  }
  if (value === "adopted") {
    return t("common.saved").toLowerCase();
  }
  if (value === "superseded" || value === "outdated") {
    return appLocale?.current() === "en" ? "older version" : "älterer Stand";
  }
  return appLocale?.current() === "en" ? "not available" : "nicht vorhanden";
}

function renderAssignmentPreview(item) {
  const source = item.documents?.source || {};
  const userMessages = (item.chat?.messages || []).filter((message) => message.role === "user" && String(message.content || "").trim());
  const hasSourceInput = Boolean(sourceFilesFrom(source).length || source.transferCard || userMessages.length);
  elements.previewGrid.dataset.previewType = "input";
  elements.previewEyebrow.textContent = "Vorschau";
  elements.previewTitle.textContent = "Input";
  if (!hasSourceInput) {
    setCustomScrollContent(elements.previewGrid, `
      <article class="detail-panel">
        <section class="detail-section">
          <p class="detail-label">Start</p>
          <h4>${escapeHtml(item.project?.title || "Neues Arbeitsblatt")}</h4>
          <p class="detail-muted">Noch kein Input vorhanden. Schreibe im Chat, was entstehen soll, oder lade Material dazu.</p>
        </section>
      </article>
    `);
    applyPreviewLayout(null);
    bindPreviewOpenActions(null);
    return;
  }
  setCustomScrollContent(elements.previewGrid, `
    <article class="detail-panel">
      <section class="detail-section">
        <p class="detail-label">Input</p>
        <h4>${escapeHtml(item.project?.title || "Input")}</h4>
      </section>
      ${renderSourceInputs({ source, projectId: item.project?.projectId })}
      ${renderRawInputMessages(userMessages)}
    </article>
  `);
  applyPreviewLayout(null);
  bindPreviewCardActions(elements.previewGrid);
  bindPreviewOpenActions(null);
}

function selectedLibraryConceptArtifact(item = {}) {
  const concepts = workspaceConceptArtifacts(item);
  const selected = state.activeLibraryConceptId
    ? concepts.find((concept) => concept.id === state.activeLibraryConceptId)
    : null;
  const current = currentConceptArtifact(item, concepts);
  const fallback = current || concepts[0] || null;
  if (!selected && state.activeLibraryConceptId) {
    state.activeLibraryConceptId = null;
  }
  return selected || fallback;
}

function renderConceptVersionOverview(item = {}, selectedConcept = null) {
  const concepts = workspaceConceptArtifacts(item);
  if (concepts.length <= 1) {
    return "";
  }
  const selectedId = selectedConcept?.id || null;

  return `
    <section class="concept-version-overview" aria-label="Konzeptversionen">
      <div class="concept-version-heading">
        <span>Konzeptversionen</span>
        <strong>${escapeHtml(concepts.length)} Versionen</strong>
      </div>
      <div class="concept-version-list">
        ${concepts.map((concept) => {
          const label = concept.version ? `v${concept.version}` : "Konzept";
          const meta = [
            concept.current ? "aktuell" : artifactLifecycleLabel(concept.status),
            concept.taskCount ? `${concept.taskCount} Aufgaben` : null,
            concept.readingTextCount ? `${concept.readingTextCount} Texte` : null,
            concept.imageMaterialCount ? `${concept.imageMaterialCount} Bilder` : null
          ].filter(Boolean).join(" · ");
          return `
            <button class="concept-version-row ${concept.current ? "current" : ""} ${selectedId === concept.id ? "selected" : ""}" type="button" data-library-concept-id="${escapeHtml(concept.id || "")}">
              <span>${escapeHtml(label)}</span>
              <strong>${escapeHtml(concept.title || "Arbeitsblatt-Konzept")}</strong>
              <em>${escapeHtml(meta || "Konzept")}</em>
            </button>
          `;
        }).join("")}
      </div>
    </section>
  `;
}

function renderConceptPreview(item) {
  const brief = item.documents?.brief || {};
  const content = item.documents?.content || {};
  const selectedConcept = selectedLibraryConceptArtifact(item);
  const briefData = brief.data || {};
  const contentData = selectedConcept?.data || content.data || {};
  elements.previewGrid.dataset.previewType = "concept";
  elements.previewEyebrow.textContent = t("app.preview.eyebrow");
  elements.previewTitle.textContent = t("app.concept.title");
  setCustomScrollContent(elements.previewGrid, `
    <div class="worksheet-blueprint-library">
      ${renderConceptVersionOverview(item, selectedConcept)}
      ${worksheetBlueprint.render({
        content: contentData,
        brief: briefData,
        project: item.project || {},
        teachingContext: item.teachingContext || {},
        concept: selectedConcept || null
      })}
    </div>
  `);
  applyPreviewLayout(null);
  elements.previewGrid.querySelectorAll("[data-library-concept-id]").forEach((button) => {
    button.addEventListener("click", () => {
      state.activeLibraryConceptId = button.dataset.libraryConceptId || null;
      renderConceptPreview(item);
    });
  });
  worksheetBlueprint.bind(elements.previewGrid);
  bindConceptCopyActions(elements.previewGrid);
  bindPreviewOpenActions(null);
}

async function markProjectCandidateGenerationSeen(projectId) {
  try {
    await fetchJson(`/api/workspace/${encodeURIComponent(projectId)}/candidate-generation/seen`, { method: "POST" });
  } catch {
    // Öffnen darf nicht an der Lesestatus-Aktualisierung scheitern.
  }
}

async function openWorkspace(projectId) {
  if (!projectId) {
    return;
  }
  const requestId = ++workspaceRefreshId;
  stopVoiceInput({ discard: true });
  abortVoiceTranscription({ silent: true });
  resetCanvasLayout();
  setCanvasCaptureActive(false);
  closeCandidateViewer();
  closeCandidateInfo();
  closeMobilePreview();
  state.pendingCommand = null;
  state.composerAttachments = [];
  clearInputUploadReceipts();
  elements.chatInput.placeholder = t("app.chat.placeholder");
  renderComposerAttachments();
  state.mode = "workspace";
  document.body.classList.add("production-mode");
  elements.emptyState.classList.add("hidden");
  elements.projectView.classList.add("hidden");
  elements.workspaceView.classList.remove("hidden");
  elements.librarySidebar.classList.add("hidden");
  elements.productionSidebar.classList.remove("hidden");
  elements.topbarProject.classList.remove("hidden");
  ensureTreePrimarySelection(`project:${projectId}`);
  renderTree(state.tree);

  setCustomScrollContent(elements.chatTimeline, '<div class="chat-loading">Workspace wird geladen...</div>');
  setCustomScrollContent(elements.canvasBody, '<div class="no-preview">Canvas wird geladen...</div>');
  applyCanvasLayout();

  try {
    await markProjectCandidateGenerationSeen(projectId);
    const payload = await fetchJson(`/api/workspace/${encodeURIComponent(projectId)}`);
    if (requestId !== workspaceRefreshId || state.mode !== "workspace" || state.selectedId !== `project:${projectId}`) {
      return;
    }
    state.workspace = payload.workspace;
    state.activeCanvasMode = defaultCanvasMode(state.workspace);
    state.activeArtifactSelection = null;
    ensureDesktopCanvasVisibleForMode(state.activeCanvasMode);
    renderWorkspace();
    syncBackgroundRefresh();
  } catch (error) {
    setCustomScrollContent(elements.chatTimeline, `<div class="chat-error">${escapeHtml(error.message)}</div>`);
    syncBackgroundRefresh();
  }
}

function closeWorkspace() {
  stopVoiceInput({ discard: true });
  abortVoiceTranscription({ silent: true });
  state.mode = "library";
  state.workspace = null;
  state.activeArtifactSelection = null;
  setCanvasCaptureActive(false);
  closeCandidateViewer();
  closeCandidateInfo();
  closeMobilePreview();
  state.pendingCommand = null;
  state.composerAttachments = [];
  clearInputUploadReceipts();
  elements.chatInput.placeholder = t("app.chat.placeholder");
  renderComposerAttachments();
  resetCanvasLayout();
  document.body.classList.remove("production-mode");
  elements.topbarProject.classList.add("hidden");
  elements.productionSidebar.classList.add("hidden");
  elements.librarySidebar.classList.remove("hidden");
  elements.workspaceView.classList.add("hidden");
  if (state.selectedId) {
    selectItem(state.selectedId, { skipSelectionUpdate: true });
  } else {
    elements.emptyState.classList.remove("hidden");
  }
  syncBackgroundRefresh();
}

function defaultCanvasMode(workspace) {
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

function syncWorkspaceShellTitles(workspace) {
  elements.workspaceProjectTitle.textContent = workspace.project.title;
  if (elements.workspaceMobileProjectTitle) {
    elements.workspaceMobileProjectTitle.textContent = workspace.project.title;
  }
  elements.productionSidebarTitle.textContent = workspace.project.title;
}

function renderDesktopWorkspaceShell(workspace) {
  if (!state.canvasLayout.collapsed && !state.canvasLayout.docked) {
    state.canvasLayout.width = clampCanvasWidth(state.canvasLayout.width);
    state.canvasLayout.lastExpandedWidth = state.canvasLayout.width;
  }
  applyCanvasLayout();
  renderProductionSidebar(workspace);
  renderTeachingContextPanel(workspace);
  renderCanvas(workspace, state.activeCanvasMode);
}

function renderMobileWorkspaceShell(workspace) {
  if (state.mobilePreview.mode && !state.mobilePreview.minimized && isMobileViewport()) {
    renderMobilePreview();
  }
}

function renderWorkspace() {
  const workspace = state.workspace;
  if (!workspace) {
    syncBackgroundRefresh();
    return;
  }
  syncWorkspaceShellTitles(workspace);
  renderDesktopWorkspaceShell(workspace);
  renderMobileWorkspaceShell(workspace);
  updateWorkspaceDebugSnapshot(workspace);
  renderChat(workspace);
  if (isSettingsOpen()) {
    renderSettings();
  }
  syncBackgroundRefresh();
}

function productionSteps(workspace) {
  const docs = workspace.documents || {};
  const workflowSteps = Array.isArray(workspace.steps) ? workspace.steps : [];
  const workflowStep = (id) => workflowSteps.find((step) => step.id === id) || null;
  const candidateGenerationPending = isCandidateGenerationPendingForWorkspace(workspace);
  const hasInput = hasInputArtifact(workspace);
  const hasBrief = Boolean(docs.brief?.data);
  const hasContent = Boolean(docs.content?.data);
  const hasApprovedContent = Boolean(workspace.approval?.canGenerate);
  const hasConceptProposal = Boolean(workspace.proposals?.latestContentMirror?.data);
  const hasCandidates = Boolean(workspace.latestRun?.candidateCount || workspace.preview?.previewMeta?.renderedCandidateCount);
  const inputComplete = Boolean(workflowStep("input")?.complete || hasInput || hasBrief || hasContent || hasCandidates);
  const conceptComplete = Boolean(workflowStep("concept")?.complete || hasApprovedContent || hasConceptProposal);
  const conceptActive = !conceptComplete && Boolean(hasBrief || hasContent);
  const candidateComplete = Boolean(workflowStep("candidates")?.complete || hasCandidates);
  const conceptCanvasMode = hasConceptProposal && !hasContent ? "content_proposal" : "content";
  const checks = [
    { id: "input", number: 1, icon: "inbox", label: "Input", complete: inputComplete, active: !inputComplete, canvasMode: "assignment" },
    { id: "concept", number: 2, icon: "notebook-text", label: t("app.concept.title"), complete: conceptComplete, active: conceptActive, canvasMode: conceptCanvasMode },
    { id: "candidates", number: 3, icon: "images", label: t("app.preview.drafts"), complete: candidateComplete, active: candidateGenerationPending, state: candidateGenerationPending ? (appLocale?.current() === "en" ? "Creating" : "Wird erstellt") : "", canvasMode: "candidates" }
  ];
  const firstActive = checks.find((step) => step.active) || checks.find((step) => !step.complete);
  return checks.map((step) => ({
    ...step,
    tone: step.id === "candidates" && candidateGenerationPending ? "working" : step.complete ? "done" : firstActive?.id === step.id ? "active" : "pending"
  }));
}

function productionStepStateLabel(step) {
  if (step.tone === "done") {
    return appLocale?.current() === "en" ? "Done" : "Fertig";
  }
  if (step.tone === "working") {
    return step.state || (appLocale?.current() === "en" ? "Creating" : "Wird erstellt");
  }
  if (step.tone === "active") {
    return step.state || (appLocale?.current() === "en" ? "Active" : "Aktiv");
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
  elements.productionStepList.innerHTML = productionSteps(workspace).map(renderProductionStep).join("");
  bindCanvasModeButtons(elements.productionStepList);
  elements.productionArtifactList.innerHTML = artifactRows(workspace).map(renderArtifactRow).join("");
  elements.productionArtifactList.querySelectorAll("[data-artifact-group-toggle]").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      toggleArtifactGroup(button.dataset.artifactGroupToggle);
    });
  });
  bindCanvasModeButtons(elements.productionArtifactList);
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
  if (mode === "worksheet") {
    return "worksheet";
  }
  if (mode?.includes?.("_proposal") && state.activeArtifactSelection?.kind === "proposal") {
    return mode;
  }
  if (mode === "concept" || mode === "content" || mode === "brief" || mode === "lessonbrief_proposal" || mode === "content_proposal") {
    return mobileConceptMode(workspace || {});
  }
  if (mode === "assignment") {
    return "input";
  }
  return mode || "content";
}

function artifactSelectionFromButton(button) {
  const kind = button.dataset.artifactKind || "";
  if (!kind) {
    return null;
  }
  return {
    kind,
    id: button.dataset.artifactId || null,
    proposalKind: button.dataset.proposalKind || null,
    runId: button.dataset.runId || null,
    candidateId: button.dataset.candidateId || null,
    conceptId: button.dataset.conceptId || null,
    conceptVersion: button.dataset.conceptVersion || null
  };
}

function artifactConceptIdentity(source = {}) {
  const reference = source.concept || source;
  return {
    conceptId: source.basedOnConceptId || reference.conceptId || source.contentMirrorId || reference.contentMirrorId || "",
    conceptVersion: String(source.basedOnConceptVersion || reference.conceptVersion || source.version || "")
  };
}

function artifactConceptKey(identity = {}) {
  return [
    identity.conceptId ? `id:${identity.conceptId}` : "",
    identity.conceptVersion ? `v:${identity.conceptVersion}` : ""
  ].filter(Boolean).join("|");
}

function conceptSelectionKey(selection = {}) {
  if (!selection || selection.kind !== "concept") {
    return "";
  }
  return artifactConceptKey(selection);
}

function artifactMatchesConceptSelection(row = {}, selection = {}) {
  if (!selection || selection.kind !== "concept" || row.artifactKind !== "candidate") {
    return false;
  }
  const rowIdentity = artifactConceptIdentity(row);
  if (selection.conceptId && rowIdentity.conceptId) {
    return rowIdentity.conceptId === selection.conceptId;
  }
  return Boolean(selection.conceptVersion && rowIdentity.conceptVersion && rowIdentity.conceptVersion === selection.conceptVersion);
}

function hasCandidateForConcept(rows = [], selection = {}) {
  return rows.some((row) => {
    if (row.kind === "group") {
      return hasCandidateForConcept(row.children || [], selection);
    }
    return artifactMatchesConceptSelection(row, selection);
  });
}

function triggerArtifactRelationPulse(selection = null) {
  const key = conceptSelectionKey(selection);
  if (!key) {
    state.artifactRelationPulseKey = "";
    if (state.artifactRelationPulseTimer) {
      window.clearTimeout(state.artifactRelationPulseTimer);
      state.artifactRelationPulseTimer = null;
    }
    return;
  }
  state.artifactRelationPulseKey = key;
  if (state.artifactRelationPulseTimer) {
    window.clearTimeout(state.artifactRelationPulseTimer);
  }
  state.artifactRelationPulseTimer = window.setTimeout(() => {
    state.artifactRelationPulseKey = "";
    state.artifactRelationPulseTimer = null;
    if (state.workspace) {
      renderProductionSidebar(state.workspace);
    }
  }, 760);
}

function handleCanvasModeRequest(mode, artifactSelection = null) {
  if (isMobileViewport()) {
    triggerArtifactRelationPulse(artifactSelection);
    state.activeCanvasMode = mode || "content";
    state.activeArtifactSelection = artifactSelection;
    openMobilePreview(mode || "content");
    return;
  }
  setCanvasMode(mode, artifactSelection);
  revealCanvasPanel();
}

function artifactRows(workspace) {
  const rows = [];
  if (hasInputArtifact(workspace)) {
    rows.push({ label: "Input", meta: inputArtifactMeta(workspace), icon: "inbox", mode: "assignment" });
  }
  const concepts = workspaceConceptArtifacts(workspace);
  if (concepts.length) {
    const currentConcept = currentConceptArtifact(workspace, concepts) || concepts[0];
    rows.push({
      kind: "group",
      group: "concepts",
      label: worksheetConceptCollectionLabel(concepts.length),
      meta: conceptGroupMeta(concepts, currentConcept),
      icon: "notebook-text",
      mode: "content",
      artifactKind: "concept",
      artifactId: currentConcept?.id || null,
      conceptId: currentConcept?.id || null,
      conceptVersion: currentConcept?.version || null,
      children: concepts.map((concept) => ({
        kind: "concept",
        label: conceptVersionDisplayName(concept.version),
        meta: conceptArtifactMeta(concept),
        mode: "content",
        artifactKind: "concept",
        artifactId: concept.id,
        conceptId: concept.id,
        conceptVersion: concept.version || null,
        current: Boolean(concept.current)
      }))
    });
  } else {
    const conceptStep = Array.isArray(workspace.steps)
      ? workspace.steps.find((step) => step.id === "concept")
      : null;
    const hasConceptProposal = Boolean(workspace.proposals?.latestContentMirror?.data);
    const conceptStatus = conceptStep?.complete || workspace.approval?.canGenerate || hasConceptProposal
      ? "bereit"
      : workspace.documents?.content?.data
        ? "in Arbeit"
        : workspace.documents?.brief?.data || workspace.proposals?.latestLessonBrief || workspace.proposals?.latestContentMirror
          ? "in Arbeit"
          : null;
    if (conceptStatus) {
      rows.push({
        label: t("app.concept.title"),
        meta: conceptStatus,
        icon: "notebook-text",
        mode: hasConceptProposal && !workspace.documents?.content?.data ? "content_proposal" : "content"
      });
    }
  }
  const candidates = workspaceCandidateHistory(workspace);
  if (candidates.length) {
    const displayedCandidates = annotateCandidateDisplayList(candidates);
    rows.push({
      kind: "group",
      group: "candidates",
      label: t("app.preview.drafts"),
      meta: candidateGroupMeta(candidates, workspace),
      icon: "images",
      mode: "candidates",
      children: displayedCandidates.map((candidate) => {
        const identity = artifactConceptIdentity(candidate);
        return {
          kind: "candidate",
          label: draftDisplayLabel(candidate),
          meta: candidateArtifactMeta(candidate),
          mode: "candidates",
          artifactKind: "candidate",
          artifactId: candidate.artifactId || `${candidate.runId || ""}_${candidate.id || ""}`,
          runId: candidate.runId || null,
          candidateId: candidate.id || null,
          conceptId: identity.conceptId || null,
          conceptVersion: identity.conceptVersion || null,
          current: Boolean(candidate.current),
          blocked: candidateHasFormatError(candidate)
        };
      })
    });
  } else {
    const candidateCount = workspace.latestRun?.candidateCount || workspace.preview?.previewMeta?.renderedCandidateCount || 0;
    if (candidateCount) {
      const candidatePages = countPreviewCandidatePages(workspace.preview);
      const meta = candidatePages > candidateCount
        ? `${candidateCount} vorhanden · ${candidatePages} Seiten`
        : `${candidateCount} vorhanden`;
      rows.push({ label: t("app.preview.drafts"), meta: withConceptMeta(meta, workspace), icon: "images", mode: "candidates" });
    }
  }
  return rows;
}

function workspaceConceptArtifacts(workspace = {}) {
  const concepts = Array.isArray(workspace.artifacts?.concepts)
    ? workspace.artifacts.concepts.filter((concept) => concept?.data || concept?.id)
    : [];
  if (concepts.length) {
    return concepts;
  }
  const content = workspace.documents?.content;
  if (!content?.data) {
    return [];
  }
  return [{
    id: content.data.artifactId || workspace.artifacts?.currentContent?.id || "current_content",
    version: content.data.version || workspace.artifacts?.currentContent?.version || null,
    status: content.status,
    current: true,
    title: content.data.title || content.data.topic || null,
    taskCount: Array.isArray(content.data.tasks) ? content.data.tasks.length : 0,
    readingTextCount: Array.isArray(content.data.readingTexts) ? content.data.readingTexts.length : 0,
    imageMaterialCount: Array.isArray(content.data.imageMaterials) ? content.data.imageMaterials.length : 0,
    data: content.data
  }];
}

function currentConceptArtifact(workspace = {}, concepts = workspaceConceptArtifacts(workspace)) {
  return concepts.find((concept) => concept.current)
    || concepts.find((concept) => concept.id === workspace.artifacts?.currentContent?.id)
    || concepts[0]
    || null;
}

function conceptGroupMeta(concepts = [], currentConcept = null) {
  const count = concepts.length;
  const currentLabel = currentConcept?.version
    ? `${conceptVersionDisplayName(currentConcept.version)} · ${t("app.work.label")}`
    : t("app.work.label");
  return count === 1 ? currentLabel : `${count} ${appLocale?.current() === "en" ? "versions" : "Versionen"} · ${currentLabel}`;
}

function conceptArtifactMeta(concept = {}) {
  const parts = [
    !concept.current && concept.status ? artifactLifecycleLabel(concept.status) : null,
    concept.taskCount ? `${concept.taskCount} ${appLocale?.current() === "en" ? (concept.taskCount === 1 ? "task" : "tasks") : "Aufgaben"}` : null,
    concept.title || null
  ].filter(Boolean);
  return parts.join(" · ") || t("app.concept.title");
}

function artifactLifecycleLabel(status) {
  if (status === "outdated") {
    return "älterer Stand";
  }
  return statusWord(status);
}

function candidateKey(candidate = {}) {
  return `${candidate.runId || ""}:${candidate.id || ""}`;
}

function workspaceCandidateHistory(workspace = {}) {
  const history = Array.isArray(workspace.artifacts?.candidates) ? workspace.artifacts.candidates : [];
  const latestPreview = Array.isArray(workspace.preview?.candidates) ? workspace.preview.candidates : [];
  const byKey = new Map();
  for (const candidate of history) {
    byKey.set(candidateKey(candidate), candidate);
  }
  for (const candidate of latestPreview) {
    const key = candidateKey(candidate);
    byKey.set(key, {
      ...(byKey.get(key) || {}),
      ...candidate,
      current: byKey.get(key)?.current ?? true
    });
  }
  return Array.from(byKey.values()).filter((candidate) => candidate?.id);
}

function candidateGroupMeta(candidates = [], workspace = {}) {
  const pageCount = candidates.reduce((total, candidate) => {
    const renderedPages = (candidate.pages || []).filter((page) => page.url).length;
    return total + renderedPages;
  }, 0);
  const blockedCount = candidates.filter((candidate) => candidateHasFormatError(candidate)).length;
  const currentCount = candidates.filter((candidate) => candidate.current && !candidateHasFormatError(candidate)).length;
  const parts = [
    `${candidates.length} ${appLocale?.current() === "en" ? "available" : "vorhanden"}`,
    pageCount > candidates.length ? t("common.pages", { count: pageCount }) : null,
    blockedCount ? `${blockedCount} Formatfehler` : null,
    currentCount > 1
      ? `${currentCount} ${appLocale?.current() === "en" ? "from the current version" : "zum Arbeitsstand"}`
      : currentCount === 1
        ? (appLocale?.current() === "en" ? "from the current version" : "zum Arbeitsstand")
        : (workspaceConceptLabel(workspace) || null)
  ].filter(Boolean);
  return parts.join(" · ");
}

function candidateHasFormatError(candidate = {}) {
  return candidate.status === "technical_failed" || candidate.qc?.status === "error";
}

function candidateArtifactMeta(candidate = {}) {
  const pageCount = draftPageCount(candidate);
  const foundation = candidateSidebarConceptLabel(candidate);
  const parts = [
    pageCount > 1 ? `${pageCount} Seiten` : null,
    candidateHasFormatError(candidate) ? "Formatprüfung fehlgeschlagen" : null,
    foundation || null,
    !candidate.current && candidate.status ? artifactLifecycleLabel(candidate.status) : null
  ].filter(Boolean);
  return parts.join(" · ") || "Entwurf";
}

function candidateSidebarConceptLabel(candidate = {}) {
  const reference = candidate.concept || candidate;
  const version = Number(candidate.basedOnConceptVersion || reference.conceptVersion || 0) || null;
  if (version) {
    return appLocale?.current() === "en" ? `Based on concept version ${version}` : `Basierend auf Konzeptversion ${version}`;
  }
  const label = conceptLabel(reference);
  return label ? `${appLocale?.current() === "en" ? "Based on" : "Basierend auf"} ${label}` : "";
}

function hasInputArtifact(workspace) {
  return Boolean(workspace.inputReadiness?.ready);
}

function inputArtifactMeta(workspace) {
  const messageCount = (workspace.chat?.messages || []).filter((message) => message.role === "user").length;
  const meaningfulMessageCount = workspace.inputReadiness?.evidence?.meaningfulUserMessageCount || 0;
  const fileCount = sourceFilesFrom(workspace.documents?.source || {}).length;
  if (fileCount && meaningfulMessageCount) {
    if (appLocale?.current() === "en") {
      return `${fileCount} file${fileCount === 1 ? "" : "s"} · ${meaningfulMessageCount} usable message${meaningfulMessageCount === 1 ? "" : "s"}`;
    }
    return `${fileCount} Datei${fileCount === 1 ? "" : "en"} · ${meaningfulMessageCount} verwertbare Nachricht${meaningfulMessageCount === 1 ? "" : "en"}`;
  }
  if (fileCount) {
    return appLocale?.current() === "en"
      ? `${fileCount} file${fileCount === 1 ? "" : "s"}`
      : `${fileCount} Datei${fileCount === 1 ? "" : "en"}`;
  }
  if (workspace.documents?.source?.transferCard) {
    return "Import";
  }
  if (meaningfulMessageCount) {
    if (appLocale?.current() === "en") {
      return `${meaningfulMessageCount} usable message${meaningfulMessageCount === 1 ? "" : "s"}`;
    }
    return meaningfulMessageCount === 1 ? "1 verwertbare Nachricht" : `${meaningfulMessageCount} verwertbare Nachrichten`;
  }
  return messageCount
    ? (appLocale?.current() === "en" ? "not usable yet" : "noch nicht verwertbar")
    : t("app.context.openValue");
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

function artifactButtonData(row = {}) {
  return [
    row.mode ? `data-canvas-mode="${escapeHtml(row.mode)}"` : "",
    row.artifactKind ? `data-artifact-kind="${escapeHtml(row.artifactKind)}"` : "",
    row.artifactId ? `data-artifact-id="${escapeHtml(row.artifactId)}"` : "",
    row.runId ? `data-run-id="${escapeHtml(row.runId)}"` : "",
    row.candidateId ? `data-candidate-id="${escapeHtml(row.candidateId)}"` : "",
    row.conceptId ? `data-concept-id="${escapeHtml(row.conceptId)}"` : "",
    row.conceptVersion ? `data-concept-version="${escapeHtml(row.conceptVersion)}"` : ""
  ].filter(Boolean).join(" ");
}

function isArtifactSelectionActive(row = {}) {
  const selection = state.activeArtifactSelection;
  if (!selection) {
    if (row.group === "concepts") {
      return state.activeCanvasMode === "content";
    }
    if (row.group === "candidates") {
      return state.activeCanvasMode === "candidates";
    }
    return state.activeCanvasMode === row.mode && !row.artifactKind;
  }
  if (row.artifactKind === "concept") {
    return selection.kind === "concept" && selection.id === row.artifactId;
  }
  if (row.artifactKind === "candidate") {
    return selection.kind === "candidate"
      && selection.runId === row.runId
      && selection.candidateId === row.candidateId;
  }
  return false;
}

function isArtifactGroupCollapsed(group = "") {
  return Boolean(group && state.collapsedArtifactGroups.has(group));
}

function toggleArtifactGroup(group = "") {
  if (!group || !state.workspace) {
    return;
  }
  if (state.collapsedArtifactGroups.has(group)) {
    state.collapsedArtifactGroups.delete(group);
  } else {
    state.collapsedArtifactGroups.add(group);
  }
  const scrollTop = elements.productionSidebar?.scrollTop || 0;
  renderProductionSidebar(state.workspace);
  if (elements.productionSidebar) {
    elements.productionSidebar.scrollTop = scrollTop;
  }
}

function artifactChildPositionClass(index, total) {
  if (total <= 1) {
    return "only-child";
  }
  if (index === 0) {
    return "first-child";
  }
  if (index === total - 1) {
    return "last-child";
  }
  return "middle-child";
}

function artifactRelationClass(row = {}, relationContext = {}) {
  if (row.artifactKind !== "candidate" || !relationContext.active) {
    return "";
  }
  if (artifactMatchesConceptSelection(row, relationContext.selection)) {
    return [
      "related",
      state.artifactRelationPulseKey && state.artifactRelationPulseKey === relationContext.key ? "relation-pulse" : ""
    ].filter(Boolean).join(" ");
  }
  return relationContext.hasRelatedCandidate ? "dimmed" : "";
}

function renderArtifactChild(row, index, total, relationContext = {}) {
  const selected = isArtifactSelectionActive(row) ? "selected" : "";
  const currentClass = row.current ? "current" : "";
  const positionClass = artifactChildPositionClass(index, total);
  const relationClass = artifactRelationClass(row, relationContext);
  return `
    <li class="artifact-tree-child-item ${positionClass}">
      <button class="artifact-tree-child-row ${selected} ${currentClass} ${relationClass}" type="button" ${artifactButtonData(row)}>
        <span class="artifact-tree-copy">
          <span class="artifact-tree-title-line">
            <strong>${escapeHtml(row.label)}</strong>
            ${row.blocked ? `<span class="artifact-tree-inline-status problem">${appLocale?.current() === "en" ? "Format error" : "Formatfehler"}</span>` : row.current ? `<span class="artifact-tree-inline-status">${escapeHtml(t("app.work.label"))}</span>` : ""}
          </span>
          <small>${escapeHtml(row.meta)}</small>
        </span>
      </button>
    </li>
  `;
}

function renderArtifactGroup(row) {
  const selected = isArtifactSelectionActive(row) ? "selected" : "";
  const collapsed = isArtifactGroupCollapsed(row.group);
  const selection = state.activeArtifactSelection;
  const relationContext = {
    active: selection?.kind === "concept",
    selection,
    key: conceptSelectionKey(selection),
    hasRelatedCandidate: hasCandidateForConcept(row.children || [], selection)
  };
  const childHtml = collapsed
    ? ""
    : `
      <ul class="artifact-tree-children">
        ${(row.children || []).map((child, index) => renderArtifactChild(child, index, row.children.length, relationContext)).join("")}
      </ul>
    `;
  return `
    <section class="artifact-tree-group ${escapeHtml(row.group || "")} ${collapsed ? "collapsed" : "expanded"}">
      <div class="artifact-tree-group-header">
        <button class="artifact-tree-row artifact-tree-parent-row ${selected}" type="button" ${artifactButtonData(row)}>
          <span class="artifact-tree-copy">
            <span class="artifact-tree-title-line">
              <strong>${escapeHtml(row.label)}</strong>
            </span>
            <small>${escapeHtml(row.meta)}</small>
          </span>
          <span class="artifact-tree-toggle ${collapsed ? "collapsed" : "expanded"}" data-artifact-group-toggle="${escapeHtml(row.group || "")}" aria-label="${escapeHtml(collapsed ? `${row.label} ausklappen` : `${row.label} einklappen`)}" title="${escapeHtml(collapsed ? `${row.label} ausklappen` : `${row.label} einklappen`)}">
            ${renderIcon("chevron-down", "icon icon-small")}
          </span>
        </button>
      </div>
      ${childHtml}
    </section>
  `;
}

function renderArtifactRow(row) {
  if (row.kind === "group") {
    return renderArtifactGroup(row);
  }
  const selected = isArtifactSelectionActive(row) ? "selected" : "";
  return `
    <button class="artifact-tree-row artifact-tree-leaf-row ${row.warning ? "warning" : ""} ${selected}" type="button" ${artifactButtonData(row)}>
      <span class="artifact-tree-copy">
        <span class="artifact-tree-title-line">
          <strong>${escapeHtml(row.label)}</strong>
        </span>
        <small>${escapeHtml(row.meta)}</small>
      </span>
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
  return visibleCommands(workspace)[0] || null;
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

function materializedVisibleCommands(workspace) {
  if (!Array.isArray(workspace.visibleCommands)) {
    return null;
  }
  const rawCommands = new Map((workspace.commands || []).map((command) => [command.id, command]));
  return workspace.visibleCommands.map((command) => {
    const raw = rawCommands.get(command.id || command.command) || {};
    return {
      ...raw,
      ...command,
      id: command.id || command.command,
      command: command.command || command.id,
      enabled: command.enabled !== false,
      defaultPayload: command.defaultPayload || command.payload || raw.defaultPayload || {},
      payload: command.payload || command.defaultPayload || raw.payload || raw.defaultPayload || {}
    };
  });
}

function visibleCommands(workspace) {
  const materializedCommands = materializedVisibleCommands(workspace);
  if (materializedCommands) {
    return materializedCommands;
  }

  const commands = enabledCommands(workspace);
  const policyActions = Array.isArray(workspace.workflowActions) ? workspace.workflowActions : [];
  if (policyActions.length) {
    return policyActions
      .map((action) => commands.find((command) => command.id === (action.id || action.command)))
      .filter(Boolean);
  }

  return [];
}

function enabledCommands(workspace) {
  const priorities = [
    "adopt_lessonbrief_proposal",
    "adopt_content_mirror_proposal",
    "generate_lessonbrief_proposal",
    "generate_content_mirror_proposal",
    "prepare_reference_asset",
    "prepare_web_reference_asset",
    "approve_current_content",
    "deposit_worksheet",
    "generate_image_candidate",
    "approve_current_brief",
    "create_content_draft",
    "create_brief_draft"
  ];
  return (workspace.commands || [])
    .filter((command) => command.enabled)
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
      description: "Schneller Entwurfsweg über den lokalen Codex-Login; das Seitenformat wird technisch geprüft."
    },
    {
      id: "openai",
      label: "OpenAI API",
      enabled: true,
      description: "Stabilerer Produktionsweg mit fester Bildgröße über den hinterlegten API-Key."
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
  const commandDefault = normalizeImageProviderSetting(command?.defaultPayload?.imageProvider);
  if (commandDefault) {
    return commandDefault;
  }
  const runtimeDefault = normalizeImageProviderSetting(workspace?.image?.provider || workspace?.image?.mode);
  if (runtimeDefault) {
    return runtimeDefault;
  }
  const codexProvider = imageProviderOptions(workspace, command)
    .find((provider) => provider.id === "codex_cli" && provider.enabled !== false);
  if (codexProvider) {
    return "codex_cli";
  }
  const enabledProvider = imageProviderOptions(workspace, command).find((provider) => provider.enabled !== false);
  return normalizeImageProviderSetting(enabledProvider?.id) || "codex_cli";
}

function configuredImageProviderId(command = null, workspace = state.workspace) {
  return normalizeImageProviderSetting(state.settings.imageProvider)
    || defaultImageProviderForCommand(command, workspace);
}

function defaultImageQualityPresetForCommand(command = null, workspace = state.workspace) {
  return normalizeImageQualitySetting(command?.defaultPayload?.imageQualityPreset, null)
    || normalizeImageQualitySetting(workspace?.image?.imageQualityPreset, null)
    || "standard";
}

function configuredImageQualityPreset(command = null, workspace = state.workspace) {
  return normalizeImageQualitySetting(state.settings.imageQualityPreset, null)
    || defaultImageQualityPresetForCommand(command, workspace);
}

function commandUsesImageProvider(command = {}) {
  return command.id === "generate_image_candidate" || command.confirmationKind === "image_generation_provider";
}

function withConfiguredImageProvider(command = {}, payload = {}) {
  if (!commandUsesImageProvider(command)) {
    return payload;
  }
  const imageProvider = configuredImageProviderId(command, state.workspace);
  return {
    ...payload,
    imageProvider,
    imageQualityPreset: configuredImageQualityPreset(command, state.workspace),
    openAiImageStreaming: imageProvider === "openai" && state.settings.openAiImageStreaming === true
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
    return "Für schnelle Entwürfe. Kein API-Key nötig.";
  }
  if (provider.id === "openai") {
    return "Für stabile Druckläufe. Nutzt deinen API-Key.";
  }
  return provider.description || "Wird für neue Bildentwürfe verwendet.";
}

function formatPercent(value) {
  const number = finiteNumber(value);
  if (number === null) {
    return "";
  }
  return `${Math.round(number)} %`;
}

function formatResetTime(value) {
  if (!value) {
    return "";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  return date.toLocaleString("de-DE", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  });
}

function windowLabel(durationMins) {
  const duration = Number(durationMins);
  if (!Number.isFinite(duration) || duration <= 0) {
    return "Limit";
  }
  if (duration >= 43200) {
    return `${Math.round(duration / 43200)} Monat${Math.round(duration / 43200) === 1 ? "" : "e"}`;
  }
  if (duration >= 10080) {
    return `${Math.round(duration / 10080)} Woche${Math.round(duration / 10080) === 1 ? "" : "n"}`;
  }
  if (duration >= 60) {
    return `${Math.round(duration / 60)} h`;
  }
  return `${duration} min`;
}

function renderBillingMetric(label, value, tone = "") {
  const displayValue = value === null || value === undefined || value === "" ? "Nicht verfügbar" : value;
  return `
    <div class="billing-metric ${tone ? `tone-${escapeHtml(tone)}` : ""}">
      <span>${escapeHtml(label)}</span>
      <strong>${escapeHtml(displayValue)}</strong>
    </div>
  `;
}

function latestOpenAiCandidateBillingSummary(workspace = state.workspace) {
  const candidates = workspace?.preview?.candidates || [];
  for (let index = candidates.length - 1; index >= 0; index -= 1) {
    const summary = candidateBillingSummary(candidates[index]);
    if (summary?.provider === "openai" && (summary.costLabel || summary.tokenLabel)) {
      return {
        ...summary,
        candidateId: candidates[index].id || null
      };
    }
  }
  return null;
}

function openAiPresetEstimateLabel(openai = {}) {
  const estimate = openai.requestEstimate || {};
  if (!estimate.estimatedCostAvailable || finiteNumber(estimate.estimatedOutputCostUsd) === null) {
    return null;
  }
  const quality = openai.imageQualityLabel || estimate.quality || "Standard";
  const size = estimate.estimateIsExactSize
    ? estimate.estimateSizeLabel || openai.imageSize || estimate.requestedSize
    : estimate.estimateSizeLabel
      ? `nahe ${estimate.estimateSizeLabel}`
      : openai.imageSize || estimate.requestedSize;
  return `${formatUsd(estimate.estimatedOutputCostUsd)} ${quality}${size ? ` · ${size}` : ""}`;
}

function renderOpenAiBillingStatus(openai = {}) {
  const hasBudget = openai.budgetUsd !== null
    && openai.budgetUsd !== undefined
    && Number.isFinite(Number(openai.budgetUsd));
  const monthCost = finiteNumber(openai.monthCostUsd) !== null ? formatUsd(openai.monthCostUsd) : null;
  const imageCost = finiteNumber(openai.monthImageCostUsd) !== null ? formatUsd(openai.monthImageCostUsd) : null;
  const remainingBudget = finiteNumber(openai.remainingBudgetUsd) !== null ? formatUsd(openai.remainingBudgetUsd) : null;
  const budgetLabel = hasBudget ? formatUsd(openai.budgetUsd) : null;
  const remainingBudgetLabel = hasBudget
    ? remainingBudget || (openai.adminConfigured ? "Noch keine Kostendaten" : "Admin-Key fehlt")
    : "Budget fehlt";
  const imageCount = finiteNumber(openai.monthImageCount) !== null
    ? `${new Intl.NumberFormat("de-DE").format(Math.round(Number(openai.monthImageCount)))} Bilder`
    : null;
  const lastRun = latestOpenAiCandidateBillingSummary();
  const lastRunLabel = lastRun
    ? [lastRun.costLabel, lastRun.tokenLabel].filter(Boolean).join(" · ")
    : null;
  const presetEstimate = openAiPresetEstimateLabel(openai);
  const estimateSource = openai.requestEstimate?.pricingSourceDate
    ? `Preisstand ${openai.requestEstimate.pricingSourceDate}. `
    : "";
  const message = openai.costsError || openai.imageUsageError || openai.message || "";
  return `
    <article class="billing-status-card">
      <header>
        <strong>OpenAI API</strong>
        <span>${escapeHtml(openai.adminConfigured ? "Admin-Daten" : openai.apiKeyConfigured ? "API-Key aktiv" : "Nicht konfiguriert")}</span>
      </header>
      <div class="billing-metric-grid">
        ${renderBillingMetric("Noch übrig", remainingBudgetLabel, hasBudget && Number(openai.remainingBudgetUsd) < 0 ? "warning" : "")}
        ${renderBillingMetric("Monatsbudget", budgetLabel || "Nicht hinterlegt")}
        ${renderBillingMetric("Schätzung", presetEstimate || "Nicht verfügbar")}
        ${renderBillingMetric("Letzter Lauf", lastRunLabel || "Noch keine Usage")}
        ${renderBillingMetric("Verbraucht", monthCost || (openai.adminConfigured ? "Keine Daten" : "Admin-Key fehlt"))}
        ${renderBillingMetric("Bildnutzung", imageCount || imageCost || "Keine Daten")}
      </div>
      ${message ? `<p>${escapeHtml(message)}</p>` : ""}
      ${presetEstimate ? `<p>${escapeHtml(`${estimateSource}Schätzung ist nur der Bild-Output; Prompt- und Referenz-Input kommen dazu.`)}</p>` : ""}
    </article>
  `;
}

function codexWindowMetric(label, window = {}) {
  if (!window || finiteNumber(window.usedPercent) === null) {
    return renderBillingMetric(label, "Nicht verfügbar");
  }
  const remainingPercent = finiteNumber(window.remainingPercent) !== null
    ? window.remainingPercent
    : Math.max(0, 100 - Number(window.usedPercent));
  const reset = formatResetTime(window.resetsAt);
  return renderBillingMetric(
    label,
    `${formatPercent(remainingPercent)} übrig${reset ? ` · Reset ${reset}` : ""}`,
    Number(remainingPercent) <= 15 ? "warning" : ""
  );
}

function renderCodexBillingStatus(codex = {}) {
  const limit = codex.rateLimits || {};
  const credits = limit.credits || {};
  const creditLabel = credits.unlimited
    ? "Unbegrenzt"
    : credits.balance !== undefined && credits.balance !== null
      ? `${credits.balance} Credits`
      : "Nicht verfügbar";
  const resetCredits = codex.rateLimitResetCredits?.availableCount
    ? `${codex.rateLimitResetCredits.availableCount} Reset${codex.rateLimitResetCredits.availableCount === 1 ? "" : "s"}`
    : "Keine";
  const primaryLabel = limit.primary ? windowLabel(limit.primary.windowDurationMins) : "Aktuell";
  const secondaryLabel = limit.secondary ? windowLabel(limit.secondary.windowDurationMins) : "Länger";
  return `
    <article class="billing-status-card">
      <header>
        <strong>Codex Usage</strong>
        <span>${escapeHtml(codex.available ? (limit.planType || "Verbunden") : codex.enabled ? "Nicht abrufbar" : "Deaktiviert")}</span>
      </header>
      <div class="billing-metric-grid">
        ${codexWindowMetric(primaryLabel, limit.primary)}
        ${codexWindowMetric(secondaryLabel, limit.secondary)}
        ${renderBillingMetric("Credits", creditLabel)}
        ${renderBillingMetric("Reset-Credits", resetCredits)}
      </div>
      ${codex.message || codex.error ? `<p>${escapeHtml(codex.message || codex.error)}</p>` : ""}
    </article>
  `;
}

function activityKindLabel(activity = {}) {
  if (activity.kind === "image_generation") {
    return "Bild";
  }
  return "Chat/API";
}

function renderCostActivity(activity = {}) {
  const cost = finiteNumber(activity.estimatedCostUsd) !== null
    ? formatUsd(activity.estimatedCostUsd)
    : "Nicht verfügbar";
  const tokens = activity.totalTokens ? `${formatTokenCount(activity.totalTokens)} Tokens` : "";
  const when = activity.createdAt ? formatResetTime(activity.createdAt) : "";
  const meta = [
    activityKindLabel(activity),
    activity.model,
    tokens,
    when
  ].filter(Boolean).join(" · ");
  return `
    <li class="billing-activity-item">
      <span>
        <strong>${escapeHtml(activity.label || activity.purpose || "OpenAI-Aufruf")}</strong>
        <em>${escapeHtml(meta)}</em>
      </span>
      <b>${escapeHtml(cost)}</b>
    </li>
  `;
}

function renderProjectBillingStatus(project = null) {
  const projectId = currentProjectId();
  if (!projectId) {
    return `
      <article class="billing-status-card">
        <header>
          <strong>Projektkosten</strong>
          <span>Kein Projekt</span>
        </header>
        <p>Öffne ein Arbeitsblatt, um die letzten Chat- und Bildkosten dieses Projekts zu sehen.</p>
      </article>
    `;
  }
  const totals = project?.totals || {};
  const recentCosts = project?.recentThreeCosts || project?.recentCosts || [];
  const hasKnownCosts = Number(totals.imageRuns || 0) + Number(totals.llmRuns || 0) > 0;
  const knownCost = hasKnownCosts && finiteNumber(totals.knownCostUsd) !== null ? formatUsd(totals.knownCostUsd) : "Noch keine Werte";
  const imageCost = hasKnownCosts && finiteNumber(totals.imageCostUsd) !== null ? formatUsd(totals.imageCostUsd) : "Keine Werte";
  const llmCost = hasKnownCosts && finiteNumber(totals.llmCostUsd) !== null ? formatUsd(totals.llmCostUsd) : "Keine Werte";
  const unpricedCount = Number(project?.unpricedModelRunCount || 0);
  return `
    <article class="billing-status-card billing-project-card">
      <header>
        <strong>Projektkosten</strong>
        <span>${escapeHtml(project?.projectId || projectId)}</span>
      </header>
      <div class="billing-metric-grid">
        ${renderBillingMetric("Bekannte Summe", knownCost)}
        ${renderBillingMetric("Bilder", imageCost)}
        ${renderBillingMetric("Chat/API", llmCost)}
        ${renderBillingMetric("Letzte Einträge", recentCosts.length ? `${recentCosts.length}` : "Keine")}
      </div>
      ${recentCosts.length ? `
        <ol class="billing-activity-list">
          ${recentCosts.map(renderCostActivity).join("")}
        </ol>
      ` : `<p>Noch keine gespeicherten Usage-Kosten für dieses Projekt.</p>`}
      ${unpricedCount ? `<p>${escapeHtml(`${unpricedCount} ältere OpenAI-Aufrufe haben keine gespeicherten Usage-Daten und fehlen in der Summe.`)}</p>` : ""}
    </article>
  `;
}

function renderBillingStatusPanel() {
  const container = elements.billingStatusPanel;
  if (!container) {
    return;
  }
  const status = state.settingsModal.billingStatus;
  const loading = state.settingsModal.billingLoading;
  const error = state.settingsModal.billingError;
  const updatedAt = status?.generatedAt ? formatResetTime(status.generatedAt) : "";
  container.innerHTML = `
    <div class="billing-status-header">
      <div>
        <p class="eyebrow">Verbrauch</p>
        <h4>Kosten und Limits</h4>
      </div>
      <button class="secondary-button mini-button" type="button" data-refresh-billing-status ${loading ? "disabled" : ""}>
        ${loading ? "Prüfe..." : "Aktualisieren"}
      </button>
    </div>
    ${error ? `<p class="billing-status-error">${escapeHtml(error)}</p>` : ""}
    ${!status && !loading && !error ? `<p class="billing-status-muted">Noch nicht geprüft.</p>` : ""}
    ${loading && !status ? `<p class="billing-status-muted">Verbrauchsdaten werden geladen.</p>` : ""}
    ${status ? `
      <div class="billing-status-grid">
        ${renderOpenAiBillingStatus(status.openai || {})}
        ${renderProjectBillingStatus(status.project || null)}
        ${renderCodexBillingStatus(status.codex || {})}
      </div>
      ${updatedAt ? `<p class="billing-status-muted">Stand ${escapeHtml(updatedAt)}</p>` : ""}
    ` : ""}
  `;
  container.querySelector("[data-refresh-billing-status]")?.addEventListener("click", () => {
    fetchBillingStatus({ force: true });
  });
}

async function fetchBillingStatus(options = {}) {
  if (state.settingsModal.billingLoading) {
    return;
  }
  const projectId = currentProjectId();
  if (!options.force && state.settingsModal.billingStatus && state.settingsModal.billingProjectId === projectId) {
    renderBillingStatusPanel();
    return;
  }
  state.settingsModal.billingLoading = true;
  state.settingsModal.billingError = null;
  renderBillingStatusPanel();
  try {
    const params = new URLSearchParams();
    if (projectId) {
      params.set("projectId", projectId);
    }
    const response = await fetchJson(`/api/billing/status${params.toString() ? `?${params}` : ""}`);
    state.settingsModal.billingStatus = response.billing || null;
    state.settingsModal.billingProjectId = projectId;
  } catch (error) {
    state.settingsModal.billingError = error.message;
  } finally {
    state.settingsModal.billingLoading = false;
    renderBillingStatusPanel();
  }
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

function qualitySettingOptions() {
  return [
    {
      id: "sparsam",
      label: t("app.settings.fast"),
      description: t("app.settings.fastHelp")
    },
    {
      id: "standard",
      label: t("app.settings.standard"),
      description: t("app.settings.standardHelp")
    },
    {
      id: "druckqualitaet",
      label: t("app.settings.high"),
      description: t("app.settings.highHelp")
    }
  ];
}

function selectedProviderLabel(providerId, providers = []) {
  const provider = providers.find((entry) => normalizeImageProviderSetting(entry.id) === providerId);
  return provider?.label || (providerId === "openai" ? "OpenAI API" : "Codex Usage");
}

function renderSettings() {
  const container = elements.imageProviderSettings;
  if (!container) {
    return;
  }
  const command = imageProviderCommand(state.workspace);
  const selectedProviderId = configuredImageProviderId(command, state.workspace);
  const providers = imageProviderOptions(state.workspace, command);
  const selectedQuality = configuredImageQualityPreset(command, state.workspace);
  const streamingEnabled = state.settings.openAiImageStreaming === true;
  const providerOptionsHtml = providers.map((provider) => {
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
  const qualityOptionsHtml = qualitySettingOptions().map((option) => `
    <button class="segmented-setting-option ${option.id === selectedQuality ? "selected" : ""}" type="button" data-image-quality="${escapeHtml(option.id)}" aria-pressed="${option.id === selectedQuality ? "true" : "false"}">
      <strong>${escapeHtml(option.label)}</strong>
      <span>${escapeHtml(option.description)}</span>
    </button>
  `).join("");
  container.innerHTML = `
    <div class="settings-control-block">
      <h4>${escapeHtml(t("app.settings.imagePath"))}</h4>
      <p>${escapeHtml(t("app.settings.imagePathHelp"))}</p>
      <div class="provider-setting-list" role="radiogroup" aria-label="${escapeHtml(t("app.settings.imagePath"))}">
        ${providerOptionsHtml}
      </div>
    </div>
    <div class="settings-control-block">
      <h4>${escapeHtml(t("app.settings.quality"))}</h4>
      <p>${escapeHtml(t("app.settings.qualityHelp"))}</p>
      <div class="segmented-setting-list" role="group" aria-label="${escapeHtml(t("app.settings.quality"))}">
        ${qualityOptionsHtml}
      </div>
    </div>
    <div class="settings-control-block api-streaming-setting ${selectedProviderId === "openai" ? "" : "muted"}">
      <h4>API-Live-Vorschau</h4>
      <label class="toggle-setting-option">
        <input type="checkbox" data-openai-streaming ${streamingEnabled ? "checked" : ""} ${selectedProviderId === "openai" ? "" : "disabled"}>
        <span>
          <strong>${escapeHtml(streamingEnabled ? "An" : "Aus")}</strong>
          <em>${escapeHtml(selectedProviderId === "openai" ? "Für API-Streaming vorbereitet." : "Nur beim OpenAI-API-Weg relevant.")}</em>
        </span>
      </label>
    </div>
    <p class="settings-summary-note">${escapeHtml(`Neue Entwürfe: ${selectedProviderLabel(selectedProviderId, providers)} · ${qualitySettingOptions().find((option) => option.id === selectedQuality)?.label || "Standard"}`)}</p>
  `;
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
    });
  });
  container.querySelectorAll("[data-image-quality]").forEach((button) => {
    button.addEventListener("click", () => {
      const imageQualityPreset = normalizeImageQualitySetting(button.dataset.imageQuality);
      state.settings = {
        ...state.settings,
        imageQualityPreset
      };
      saveSettings(state.settings);
      renderSettings();
      if (state.workspace) {
        renderWorkspace();
      }
    });
  });
  container.querySelector("[data-openai-streaming]")?.addEventListener("change", (event) => {
    state.settings = {
      ...state.settings,
      openAiImageStreaming: event.currentTarget.checked === true
    };
    saveSettings(state.settings);
    renderSettings();
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

async function disconnectCurrentDevice() {
  closeSettings();
  const confirmed = await requestConfirmation({
    eyebrow: t("app.settings.disconnectEyebrow"),
    title: t("app.settings.disconnectTitle"),
    message: t("app.settings.disconnectMessage"),
    acceptLabel: t("app.settings.disconnectConfirm"),
    cancelLabel: t("common.cancel"),
    danger: true
  });
  if (!confirmed) {
    openSettings();
    return;
  }
  try {
    await fetchJson("/api/auth/logout", { method: "POST", body: "{}" });
    window.location.replace("/");
  } catch (error) {
    openSettings();
    showToast(error.message || t("app.settings.disconnectError"), "error");
  }
}

function runReferenceRoleOptions() {
  return [
    {
      value: "style_reference",
      label: "Stil",
      description: "Look, Farben, Schriftanmutung"
    },
    {
      value: "layout_reference",
      label: "Aufbau",
      description: "Blattkomposition, Bereiche, Anordnung"
    },
    {
      value: "style_layout_reference",
      label: "Vorlage",
      description: "Komposition und Stil für ein Folgeblatt"
    },
    {
      value: "material_image",
      label: "Bildmaterial",
      description: "sichtbar ins Arbeitsblatt einbauen"
    }
  ];
}

function roleLabel(role = "") {
  return runReferenceRoleOptions().find((option) => option.value === role)?.label || "Referenz";
}

function runReferencePurpose(role = "", label = "") {
  const cleanLabel = String(label || "Referenzbild").trim();
  if (role === "material_image") {
    return `${cleanLabel} als konkretes Bildmaterial im Arbeitsblatt nutzen`;
  }
  if (role === "layout_reference") {
    return `${cleanLabel} als Aufbau- und Layoutreferenz nutzen`;
  }
  if (role === "style_layout_reference") {
    return `${cleanLabel} als Vorlage fuer Stil und Aufbau nutzen`;
  }
  return `${cleanLabel} als Stilreferenz nutzen`;
}

function projectRelativeReferencePath(value = "") {
  const text = String(value || "").replaceAll("\\", "/").replace(/^\/+/, "");
  const projectId = currentProjectId();
  if (!text || !projectId) {
    return text;
  }
  const projectPrefix = `projects/${projectId}/`;
  const projectIndex = text.indexOf(projectPrefix);
  if (projectIndex >= 0) {
    return text.slice(projectIndex + projectPrefix.length);
  }
  return text;
}

function runReferenceSourceKey(source = {}) {
  return `${source.kind || "reference"}:${source.path || source.id || ""}:${source.page || ""}`;
}

function sourceFileRunReferenceSource(file = {}) {
  const pathValue = projectRelativeReferencePath(file.path);
  const label = file.originalName || fileName(pathValue) || "Bild";
  return pathValue && isImageInput(file) ? {
    key: `input:${pathValue}`,
    kind: "input_upload",
    label,
    detail: "Input-Bild",
    path: pathValue,
    url: sourceFileUrl(currentProjectId(), file),
    defaultRole: "material_image",
    source: {
      kind: "input_upload",
      artifactId: file.artifactId || null,
      path: pathValue,
      originalName: file.originalName || null,
      mimeType: file.mimeType || null,
      size: file.size || null
    }
  } : null;
}

function candidatePageRunReferenceSource(candidate = {}, page = {}) {
  const pathValue = projectRelativeReferencePath(page.path);
  if (!pathValue) {
    return null;
  }
  const display = draftDisplayLabel(candidate);
  const pageNumber = Number(page.page || 1) || 1;
  return {
    key: `candidate:${candidate.runId || ""}:${candidate.id || ""}:${pageNumber}:${pathValue}`,
    kind: "candidate_page",
    label: `${display}, Seite ${pageNumber}`,
    detail: "Entwurf",
    path: pathValue,
    url: page.url || null,
    page: pageNumber,
    defaultRole: "style_layout_reference",
    source: {
      kind: "candidate",
      projectId: currentProjectId(),
      runId: candidate.runId || null,
      candidateId: candidate.id || null,
      page: pageNumber,
      role: page.role || null
    }
  };
}

function availableRunReferenceSources(workspace = state.workspace) {
  const sourceFiles = sourceFilesFrom(workspace?.documents?.source || {})
    .map(sourceFileRunReferenceSource)
    .filter(Boolean);
  const candidatePages = (workspace?.artifacts?.candidates || [])
    .flatMap((candidate) => (candidate.pages || [])
      .filter((page) => page.url && page.path)
      .map((page) => candidatePageRunReferenceSource(candidate, page))
      .filter(Boolean));
  return [...sourceFiles, ...candidatePages];
}

function initialRunReferenceSelection(payload = {}, sources = []) {
  const byPath = new Map(sources.map((source) => [source.path, source]));
  return (Array.isArray(payload.referenceImages) ? payload.referenceImages : [])
    .filter((reference) => reference?.path)
    .slice(0, 4)
    .map((reference, index) => {
      const refPath = projectRelativeReferencePath(reference.path);
      const source = byPath.get(refPath);
      const label = reference.sourceLabel || source?.label || fileName(refPath) || `Referenz ${index + 1}`;
      return {
        localId: `existing_${index}_${Date.now()}`,
        key: source?.key || `existing:${refPath}`,
        label,
        path: refPath,
        url: source?.url || (refPath ? opaqueFileUrl(`projects/${currentProjectId()}/${refPath}`) : ""),
        role: reference.role || source?.defaultRole || "style_reference",
        targetPage: Number(reference.targetPage || reference.page || 0) || 0,
        userDetails: reference.userDetails || reference.details || "",
        source: reference.source || source?.source || null
      };
    });
}

function runReferenceSelectionToPayload(selection = []) {
  return selection
    .filter((reference) => reference.path)
    .slice(0, 4)
    .map((reference, index) => {
      const role = reference.role || "style_reference";
      const label = reference.label || fileName(reference.path) || `Referenz ${index + 1}`;
      return {
        id: `run_ref_${String(index + 1).padStart(2, "0")}`,
        role,
        path: reference.path,
        purpose: runReferencePurpose(role, label),
        userDetails: String(reference.userDetails || "").trim() || null,
        targetPage: Number(reference.targetPage || 0) || null,
        sourceLabel: label,
        source: reference.source || null,
        scope: "next_candidate"
      };
    });
}

async function uploadRunReferenceFiles(fileList = []) {
  const projectId = currentProjectId();
  const files = Array.from(fileList || []).filter(Boolean);
  const imageFiles = files.filter((file) => String(file.type || "").startsWith("image/"));
  if (!projectId || !imageFiles.length) {
    return [];
  }
  const uploadedSources = [];
  for (const file of imageFiles) {
    const formData = new FormData();
    formData.append("file", file);
    formData.append("deferChatReceipt", "true");
    const response = await fetchJson(`/api/workspace/${encodeURIComponent(projectId)}/input-upload`, {
      method: "POST",
      body: formData
    });
    state.workspace = response.workspace || state.workspace;
    const source = sourceFileRunReferenceSource(response.upload?.file || {});
    if (source) {
      uploadedSources.push(source);
    }
  }
  renderWorkspace();
  await loadTree({ keepSelection: true, selectAfterLoad: false });
  return uploadedSources;
}

function pageTargetOptions(pageCount = 1, selectedPage = 0) {
  const count = Math.max(1, Number(pageCount || 1) || 1);
  return [
    `<option value="" ${selectedPage ? "" : "selected"}>alle Seiten</option>`,
    ...Array.from({ length: count }, (_, index) => {
      const page = index + 1;
      return `<option value="${page}" ${Number(selectedPage) === page ? "selected" : ""}>Seite ${page}</option>`;
    })
  ].join("");
}

function renderRunReferenceSelector({ command = {}, payload = {}, selection = [], sources = [], uploading = false } = {}) {
  const pageCount = commandPageCount(command, payload) || 1;
  const roleOptions = runReferenceRoleOptions();
  const availableToAdd = sources.filter((source) => !selection.some((reference) => reference.path === source.path));
  const sourceOptions = availableToAdd.map((source) => `
    <option value="${escapeHtml(source.key)}">${escapeHtml(`${source.label} · ${source.detail}`)}</option>
  `).join("");
  return `
    <section class="run-reference-panel">
      <header>
        <div>
          <strong>Referenzen</strong>
          <span>Optional für diesen Lauf</span>
        </div>
      </header>
      <div class="run-reference-add-row">
        <label class="run-reference-source-field">
          <span class="sr-only">Bild auswählen</span>
          <select data-run-reference-source ${availableToAdd.length ? "" : "disabled"} aria-label="Referenzquelle">
            ${sourceOptions || "<option>Keine vorhandenen Bilder</option>"}
          </select>
        </label>
        <button class="secondary-button mini-button" type="button" data-run-reference-add ${availableToAdd.length && selection.length < 4 ? "" : "disabled"}>Hinzufügen</button>
        <button class="secondary-button mini-button" type="button" data-run-reference-upload ${uploading || selection.length >= 4 ? "disabled" : ""}>Aus Datei</button>
        <input class="sr-only" type="file" accept="image/*" multiple data-run-reference-file-input>
      </div>
      ${uploading ? `<p class="run-reference-note">Bild wird gespeichert...</p>` : ""}
      ${selection.length ? `
        <div class="run-reference-list">
          ${selection.map((reference, index) => `
            <article class="run-reference-item" data-run-reference-index="${index}">
              <div class="run-reference-thumb">
                ${reference.url ? `<img src="${escapeHtml(reference.url)}" alt="">` : ""}
              </div>
              <div class="run-reference-fields">
                <div class="run-reference-item-header">
                  <strong>${escapeHtml(reference.label || fileName(reference.path) || "Referenz")}</strong>
                  <button class="icon-button icon-button-plain" type="button" data-run-reference-remove="${index}" aria-label="Referenz entfernen" title="Referenz entfernen">${icon("x", "icon icon-small")}</button>
                </div>
                <div class="run-reference-controls">
                  <label>
                    <span>Funktion</span>
                    <select data-run-reference-role="${index}">
                      ${roleOptions.map((option) => `<option value="${escapeHtml(option.value)}" ${option.value === reference.role ? "selected" : ""}>${escapeHtml(option.label)}</option>`).join("")}
                    </select>
                    <em>${escapeHtml(roleOptions.find((option) => option.value === reference.role)?.description || "Referenzfunktion festlegen")}</em>
                  </label>
                  <label>
                    <span>Gilt für</span>
                    <select data-run-reference-page="${index}">
                      ${pageTargetOptions(pageCount, reference.targetPage)}
                    </select>
                  </label>
                </div>
                <label class="run-reference-detail">
                  <span>Details</span>
                  <textarea data-run-reference-details="${index}" rows="2" maxlength="220" placeholder="${escapeHtml(`${roleLabel(reference.role)} genauer beschreiben...`)}">${escapeHtml(reference.userDetails || "")}</textarea>
                </label>
              </div>
            </article>
          `).join("")}
        </div>
      ` : `<p class="run-reference-note">Keine Referenz ausgewählt.</p>`}
    </section>
  `;
}

async function requestImageGenerationConfirmation(command = {}, payload = {}) {
  let sources = availableRunReferenceSources(state.workspace);
  let selection = initialRunReferenceSelection(payload, sources);
  let uploading = false;
  let extraHost = null;

  const render = () => {
    if (!extraHost) {
      return;
    }
    extraHost.innerHTML = renderRunReferenceSelector({
      command,
      payload,
      selection,
      sources,
      uploading
    });
    const sourceByKey = new Map(sources.map((source) => [source.key, source]));
    extraHost.querySelector("[data-run-reference-add]")?.addEventListener("click", () => {
      const select = extraHost.querySelector("[data-run-reference-source]");
      const source = sourceByKey.get(select?.value);
      if (!source || selection.length >= 4) {
        return;
      }
      selection = [...selection, {
        localId: `ref_${Date.now()}_${selection.length}`,
        key: source.key,
        label: source.label,
        path: source.path,
        url: source.url,
        role: source.defaultRole || "style_reference",
        targetPage: 0,
        userDetails: "",
        source: source.source || null
      }];
      render();
    });
    extraHost.querySelector("[data-run-reference-upload]")?.addEventListener("click", () => {
      extraHost.querySelector("[data-run-reference-file-input]")?.click();
    });
    extraHost.querySelector("[data-run-reference-file-input]")?.addEventListener("change", async (event) => {
      uploading = true;
      render();
      try {
        const uploaded = await uploadRunReferenceFiles(event.currentTarget.files);
        sources = [...availableRunReferenceSources(state.workspace), ...uploaded]
          .filter((source, index, list) => list.findIndex((entry) => entry.path === source.path) === index);
        const additions = uploaded
          .filter((source) => !selection.some((reference) => reference.path === source.path))
          .slice(0, Math.max(0, 4 - selection.length))
          .map((source) => ({
            localId: `ref_upload_${Date.now()}_${source.key}`,
            key: source.key,
            label: source.label,
            path: source.path,
            url: source.url,
            role: source.defaultRole || "material_image",
            targetPage: 0,
            userDetails: "",
            source: source.source || null
          }));
        selection = [...selection, ...additions].slice(0, 4);
      } catch (error) {
        showToast(error.message, "error");
      } finally {
        uploading = false;
        render();
      }
    });
    extraHost.querySelectorAll("[data-run-reference-remove]").forEach((button) => {
      button.addEventListener("click", () => {
        const index = Number(button.dataset.runReferenceRemove);
        selection = selection.filter((_, itemIndex) => itemIndex !== index);
        render();
      });
    });
    extraHost.querySelectorAll("[data-run-reference-role]").forEach((select) => {
      select.addEventListener("change", () => {
        const index = Number(select.dataset.runReferenceRole);
        selection = selection.map((reference, itemIndex) => itemIndex === index
          ? { ...reference, role: select.value || "style_reference" }
          : reference);
        render();
      });
    });
    extraHost.querySelectorAll("[data-run-reference-page]").forEach((select) => {
      select.addEventListener("change", () => {
        const index = Number(select.dataset.runReferencePage);
        selection = selection.map((reference, itemIndex) => itemIndex === index
          ? { ...reference, targetPage: Number(select.value || 0) || 0 }
          : reference);
      });
    });
    extraHost.querySelectorAll("[data-run-reference-details]").forEach((textarea) => {
      textarea.addEventListener("input", () => {
        const index = Number(textarea.dataset.runReferenceDetails);
        selection = selection.map((reference, itemIndex) => itemIndex === index
          ? { ...reference, userDetails: textarea.value }
          : reference);
      });
    });
  };

  return requestConfirmation({
    eyebrow: "Entwurf",
    title: "Entwurf erstellen",
    message: "Optional Referenzen festlegen.",
    acceptLabel: "Entwurf erstellen",
    compact: true,
    variant: "reference",
    extraHtml: "<div></div>",
    onRender: (host) => {
      extraHost = host;
      render();
    },
    onAccept: () => {
      if (uploading) {
        showToast("Bitte warte, bis das Referenzbild gespeichert ist.", "info");
        return false;
      }
      return {
        payload: {
          referenceImages: runReferenceSelectionToPayload(selection)
        }
      };
    }
  });
}

function requestConfirmation(options = {}) {
  return new Promise((resolve) => {
    const modal = elements.confirmationModal;
    const card = modal?.querySelector(".confirmation-card");
    const eyebrow = elements.confirmationEyebrow;
    const title = elements.confirmationTitle;
    const message = elements.confirmationMessage;
    const extra = elements.confirmationExtra;
    const accept = elements.confirmationAcceptButton;
    const cancel = elements.confirmationCancelButton;
    if (!modal || !title || !message || !accept || !cancel) {
      resolve(false);
      return;
    }

    if (eyebrow) {
      eyebrow.textContent = options.eyebrow || "Bestätigung";
    }
    card?.classList.toggle("confirmation-card-compact", Boolean(options.compact));
    modal.classList.toggle("confirmation-modal-reference", options.variant === "reference");
    title.textContent = options.title || "Aktion bestätigen?";
    message.textContent = options.message || "Diese Aktion kann nicht automatisch rückgängig gemacht werden.";
    if (extra) {
      extra.innerHTML = options.extraHtml || "";
      extra.classList.toggle("hidden", !options.extraHtml);
      if (options.extraHtml && typeof options.onRender === "function") {
        options.onRender(extra);
      }
    }
    accept.textContent = options.acceptLabel || "Bestätigen";
    cancel.textContent = options.cancelLabel || "Abbrechen";
    accept.classList.toggle("danger-button", Boolean(options.danger));
    modal.classList.remove("hidden");
    accept.focus();

    const cleanup = (value) => {
      modal.classList.add("hidden");
      modal.classList.remove("confirmation-modal-reference");
      card?.classList.remove("confirmation-card-compact");
      accept.classList.remove("danger-button");
      if (extra) {
        extra.innerHTML = "";
        extra.classList.add("hidden");
      }
      cancel.textContent = "Abbrechen";
      accept.removeEventListener("click", onAccept);
      cancel.removeEventListener("click", onCancel);
      modal.removeEventListener("click", onBackdrop);
      document.removeEventListener("keydown", onKeydown);
      resolve(value);
    };
    const onAccept = () => {
      const value = typeof options.onAccept === "function" ? options.onAccept(extra) : true;
      if (value === false) {
        return;
      }
      cleanup(value || true);
    };
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
      message: `Dieser Schritt nutzt den hinterlegten OpenAI API-Key und kann API-Kosten verursachen. Er erzeugt nur Seite ${page} als neuen Entwurf.`,
      acceptLabel: `Seite ${page} mit OpenAI API erzeugen`
    });
  }
  if (commandUsesImageProvider(command)) {
    return requestImageGenerationConfirmation(command, payload);
  }
  return requestConfirmation({
    eyebrow: command.confirmationKind === "paid_image_generation" ? "API-Kosten" : "Bestätigung",
    title: command.confirmationTitle || "Entwurf erstellen?",
    message: command.confirmationMessage
      || "Dieser Schritt erzeugt ein Bild über die OpenAI Image API und kann Kosten verursachen.",
    acceptLabel: command.confirmationAcceptLabel || command.label || "Entwurf erstellen"
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
      return `Ein mehrseitiger Entwurf mit ${pageCount} Seiten wird${providerText} gerendert. Das kann einen Moment dauern.`;
    }
    return `Entwurf wird${providerText} gerendert. Das kann einen Moment dauern.`;
  }
  if (commandId === "generate_lessonbrief_proposal" || commandId === "generate_content_mirror_proposal") {
    return "Arbeitsblatt-Konzept wird vorbereitet.";
  }
  if (commandId === "deposit_worksheet") {
    return "Arbeitsblatt wird in der Ablage gespeichert.";
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
  return isBackgroundCandidateGenerationRunning(candidateGenerationStateForWorkspace(workspace))
    || isCandidateGenerationPendingForProject(workspace?.project?.projectId);
}

function candidateGenerationBusyPageCount(workspace = {}, command = {}) {
  return Number(
    candidateGenerationStateForWorkspace(workspace)?.activeJob?.pageCount
    || commandPayload(command).pageCount
    || 0
  );
}

function candidateGenerationBusyLabel(workspace = {}, command = {}) {
  return candidateGenerationBusyPageCount(workspace, command) > 1
    ? "Mehrseitiger Entwurf läuft bereits"
    : "Entwurf läuft bereits";
}

function candidateGenerationBusyReason(workspace = {}, command = {}) {
  return candidateGenerationBusyPageCount(workspace, command) > 1
    ? "Der mehrseitige Entwurf wird bereits im Hintergrund erstellt."
    : "Der Entwurf wird bereits im Hintergrund erstellt.";
}

function shouldDisableGenerateCandidateAction(workspace = {}, command = {}) {
  return command?.id === "generate_image_candidate" && isCandidateGenerationPendingForWorkspace(workspace);
}

function isBusyGenerateCandidateAction(action = {}) {
  return (action.id || action.command) === "generate_image_candidate" && action.busy === true;
}

function candidateGenerationDisplayCommand(workspace = {}) {
  const command = (workspace.commands || []).find((entry) => entry.id === "generate_image_candidate") || null;
  return command && shouldDisableGenerateCandidateAction(workspace, command) ? command : null;
}

function localizedActionLabel(label = "") {
  const value = String(label || "");
  if (appLocale?.current() !== "en") return value;
  if (/weitere.*entwurfsvariante|weiteren.*entwurf/i.test(value)) return "Create another draft";
  if (/entwurf.*erstellen|entwurf.*erzeugen/i.test(value)) return "Create draft";
  if (/konzept.*überarbeiten|konzept.*ueberarbeiten/i.test(value)) return "Revise concept";
  if (/mit diesem konzept weiterarbeiten|übernehmen|uebernehmen/i.test(value)) return "Adopt";
  if (/arbeitsblätter? ablegen/i.test(value)) return /arbeitsblätter/i.test(value) ? "Save worksheets" : "Save worksheet";
  return value;
}

function buttonActionForCommand(command = {}, workspace = state.workspace, overrides = {}) {
  if (!command?.id) {
    return null;
  }
  const disabledByBusy = shouldDisableGenerateCandidateAction(workspace, command);
  const nextPayload = overrides.payload ? { ...overrides.payload } : commandPayload(command);
  return {
    id: command.id,
    label: localizedActionLabel(disabledByBusy
      ? candidateGenerationBusyLabel(workspace, command)
      : overrides.label || decisionButtonLabel(command) || command.label),
    payload: command.id === "generate_image_candidate"
      ? withConfiguredImageProvider(command, nextPayload)
      : nextPayload,
    disabled: Boolean(overrides.disabled || !command.enabled || disabledByBusy),
    busy: Boolean(disabledByBusy),
    reason: disabledByBusy
      ? candidateGenerationBusyReason(workspace, command)
      : overrides.reason || command.reason || null
  };
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
  const candidateGeneration = candidateGenerationStateForWorkspace(workspace);
  if (!pendingCommand && candidateGeneration?.isRunning) {
    messages.push({
      role: "assistant",
      content: "",
      createdAt: candidateGeneration.activeJob?.startedAt || new Date().toISOString(),
      pending: true,
      productionCard: {
        kind: "command_pending",
        commandId: candidateGeneration.activeJob?.commandId || "generate_image_candidate",
        label: candidateGeneration.activeJob?.label || "Entwurf wird erstellt",
        message: candidateGeneration.activeJob?.message || "Der Entwurf wird im Hintergrund erstellt.",
        pageCount: candidateGeneration.activeJob?.pageCount || 0
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
  if (latestUserTargetsNonCurrentConcept(workspace)) {
    return [];
  }
  const commands = visibleCommands(workspace);
  const busyCandidateCommand = candidateGenerationDisplayCommand(workspace);
  const displayCommands = busyCandidateCommand && !commands.some((command) => command.id === busyCandidateCommand.id)
    ? [busyCandidateCommand, ...commands]
    : commands;
  const alreadyOffered = latestAssistantOfferedCommandIds(workspace);
  const remainingCommands = displayCommands.filter((command) => !alreadyOffered.has(command.id));
  if (!remainingCommands.length || latestAssistantIsWaiting(workspace)) {
    return [];
  }
  return remainingCommands;
}

function conceptVersionMention(content = "") {
  const normalized = normalizeGermanDisplayText(content).toLowerCase();
  const match = normalized.match(/\b(?:konzept|concept)?\s*v(?:ersion)?\s*0*(\d+)\b/)
    || normalized.match(/\b(?:konzept|concept)\s*0*(\d+)\b/);
  return match ? Number(match[1]) || null : null;
}

function conceptVersionActionText(content = "") {
  const normalized = normalizeGermanDisplayText(content).toLowerCase();
  return Boolean(conceptVersionMention(content))
    && /\b(nehm|nehmen|nimm|setze|setz|basis|aktuell|freigeb|frei|auswähl|auswaehl|verwende|nutze|kandidat|variante|erzeug|generier|render|basierend|grundlage)\w*\b/.test(normalized);
}

function latestUserTargetsNonCurrentConcept(workspace = {}) {
  const latestUser = [...(workspace.chat?.messages || [])].reverse()
    .find((message) => message.role === "user");
  if (!latestUser || !conceptVersionActionText(latestUser.content || "")) {
    return false;
  }
  const version = conceptVersionMention(latestUser.content || "");
  const concepts = workspaceConceptArtifacts(workspace);
  const target = concepts.find((concept) => Number(concept.version || 0) === Number(version)) || null;
  return Boolean(target && !target.current);
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
  const latestStableIndex = latestStableMessageIndex(messages);
  const latestMessage = messages[messages.length - 1] || null;
  const latestAssistantHostIndex = latestAssistantIndex(messages);
  const actionHostIndex = latestStableIndex >= 0
    ? messages[latestStableIndex].role === "user"
      ? latestStableIndex
      : latestAssistantHostIndex
    : -1;
  const actionHostMessage = actionHostIndex >= 0 ? messages[actionHostIndex] : null;
  const worksheetWasDeposited = /^Arbeitsbl(?:att|ätter)\s+abgelegt\.?$/i.test(String(actionHostMessage?.content || "").trim());
  const extraCommands = worksheetWasDeposited
    ? []
    : trailingDecisionCommands(workspace).filter((command) => {
      if (actionHostMessage?.productionCard?.kind !== "candidate") {
        return true;
      }
      return command.id !== "deposit_worksheet";
    });
  setCustomScrollContent(elements.chatTimeline, `
    ${renderChatRuntime(workspace.chat)}
    ${messages.length ? messages.map((message, index) => renderChatMessage(
      message,
      visibleCommandIds,
      index === actionHostIndex ? extraCommands : [],
      workspace,
      index === actionHostIndex,
      messages,
      index
    )).join("") : renderChatIntro(workspace)}
  `);
  bindCommandButtons(elements.chatTimeline);
  bindCanvasModeButtons(elements.chatTimeline);
  bindConceptCopyActions(elements.chatTimeline);
  bindPreviewCardActions(elements.chatTimeline);
  const chatScrollElement = customScrollElement(elements.chatTimeline);
  chatScrollElement.scrollTop = chatScrollElement.scrollHeight;
  updateComposerState();
}

function renderChatRuntime(chat = {}) {
  const status = chat.status || chat.mode || "missing_key";
  const modeClass = status === "ready" ? "openai" : "error";
  const label = chat.mode === "openai" && status === "ready"
    ? t("app.chat.ready")
    : status === "missing_key"
      ? t("app.chat.missingKey")
      : t("app.chat.notReady");
  return `<div class="chat-runtime ${modeClass}">${escapeHtml(label)}</div>`;
}

function teachingContextVisible(workspace = {}) {
  if (!workspace.teachingContext) {
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
    const value = field.value || t("app.context.openValue");
    return `
      <li class="teaching-context-field ${escapeHtml(statusClass)}">
        <span class="teaching-context-status" aria-hidden="true">${iconName ? renderIcon(iconName, "teaching-context-check") : ""}</span>
        <span class="teaching-context-label">${escapeHtml(field.label || id)}</span>
        <strong>${escapeHtml(value)}</strong>
        ${field.assumption || status === "assumed" ? `<em>${escapeHtml(t("app.context.assumption"))}</em>` : ""}
      </li>
    `;
  }).join("");
}

function teachingContextNote(context = {}) {
  const readiness = context.readiness || {};
  if (readiness.ready) {
    return appLocale?.current() === "en" ? "Enough information for a first worksheet concept." : "Genug Infos für ein erstes Arbeitsblatt-Konzept.";
  }
  if (readiness.forcedWithAssumptions) {
    return appLocale?.current() === "en" ? "A suggestion with visible assumptions is allowed." : "Vorschlag mit sichtbaren Annahmen ist erlaubt.";
  }
  return context.nextQuestion || (appLocale?.current() === "en"
    ? "I will briefly clarify how the worksheet should work in class."
    : "Ich kläre kurz, wofür das Arbeitsblatt im Unterricht funktionieren soll.");
}

function teachingContextStatusLabel(readiness = {}) {
  if (readiness.conceptAllowed) {
    return t("app.context.ready");
  }
  if (readiness.forcedWithAssumptions) {
    return t("app.context.assumed");
  }
  return t("app.context.clarifying");
}

function teachingContextStatusTone(readiness = {}) {
  if (readiness.conceptAllowed) {
    return "ready";
  }
  if (readiness.forcedWithAssumptions) {
    return "assumed";
  }
  return "pending";
}

function teachingContextPanelProjectId(workspace = {}) {
  return workspace.project?.projectId || currentProjectId() || "__current";
}

function teachingContextPanelCollapsed(workspace = {}, context = {}) {
  const projectId = teachingContextPanelProjectId(workspace);
  const saved = state.teachingContextPanel.collapsedByProjectId[projectId];
  if (typeof saved === "boolean") {
    return saved;
  }
  return Boolean(context.readiness?.conceptAllowed);
}

function setTeachingContextPanelCollapsed(workspace = {}, collapsed) {
  const projectId = teachingContextPanelProjectId(workspace);
  state.teachingContextPanel.collapsedByProjectId[projectId] = Boolean(collapsed);
}

function renderTeachingContextChip(readiness = {}) {
  const statusLabel = teachingContextStatusLabel(readiness);
  const statusTone = teachingContextStatusTone(readiness);
  return `
    <button class="teaching-context-chip" type="button" data-teaching-context-toggle data-status="${escapeHtml(statusTone)}" aria-expanded="false" aria-label="${escapeHtml(t("app.context.open"))}" title="${escapeHtml(t("app.context.open"))}">
      ${renderIcon("notebook-text", "teaching-context-chip-icon")}
      <span>${escapeHtml(t("app.context.title"))}</span>
      <strong>${escapeHtml(statusLabel)}</strong>
      ${renderIcon("chevron-down", "teaching-context-chip-chevron")}
    </button>
  `;
}

function renderTeachingContextPanel(workspace = {}) {
  const panel = elements.teachingContextPanel;
  if (!panel) {
    return;
  }
  if (!teachingContextVisible(workspace)) {
    panel.classList.add("hidden");
    panel.classList.remove("collapsed");
    panel.removeAttribute("aria-expanded");
    panel.innerHTML = "";
    return;
  }
  const context = workspace.teachingContext || {};
  const readiness = context.readiness || {};
  const collapsed = teachingContextPanelCollapsed(workspace, context);
  panel.classList.remove("hidden");
  panel.classList.toggle("collapsed", collapsed);
  panel.setAttribute("aria-expanded", collapsed ? "false" : "true");
  panel.innerHTML = collapsed
    ? renderTeachingContextChip(readiness)
    : `
      <div class="teaching-context-header">
        <div>
          <p>${escapeHtml(t("app.context.title"))}</p>
          <strong>${escapeHtml(teachingContextStatusLabel(readiness))}</strong>
        </div>
        <button class="teaching-context-minimize-button" type="button" data-teaching-context-toggle aria-expanded="true" aria-label="${escapeHtml(t("app.context.collapse"))}" title="${escapeHtml(t("app.context.collapse"))}">
          ${renderIcon("chevron-down", "teaching-context-minimize-icon")}
        </button>
      </div>
      <ul>${teachingContextFieldRows(context)}</ul>
      <div class="teaching-context-next">
        <span>${escapeHtml(t("app.context.next"))}</span>
        <p>${escapeHtml(teachingContextNote(context))}</p>
      </div>
      ${readiness.conceptAllowed ? "" : `
        <button class="secondary-button mini-button teaching-context-force" type="button" data-teaching-context-force>
          ${escapeHtml(t("app.context.force"))}
        </button>
      `}
    `;
  panel.querySelector("[data-teaching-context-toggle]")?.addEventListener("click", () => {
    const currentWorkspace = state.workspace?.project?.projectId === workspace.project?.projectId ? state.workspace : workspace;
    setTeachingContextPanelCollapsed(currentWorkspace, !collapsed);
    renderTeachingContextPanel(currentWorkspace);
  });
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
    ? t("app.chat.legacy")
    : t("app.chat.intro");
  return `
    <div class="chat-message assistant">
      <div class="assistant-avatar">AI</div>
      <div class="message-bubble">
        <strong>SheetifyAI</strong>
        <div class="message-copy">${markdownToHtml(text)}</div>
      </div>
    </div>
  `;
}

const conceptDecisionCommandIds = new Set([
  "adopt_content_mirror_proposal",
  "approve_current_content",
  "generate_candidate_from_content_proposal",
  "generate_image_candidate"
]);

function renderConceptDecisionPreviewButton(preview = {}) {
  const proposalAttrs = preview.proposalRef?.proposalId
    ? `data-artifact-kind="proposal" data-artifact-id="${escapeHtml(preview.proposalRef.proposalId)}" data-proposal-kind="${escapeHtml(preview.proposalRef.kind || "")}"`
    : "";
  const label = t("app.chat.viewConcept");
  return `
    <button class="secondary-button mini-button concept-decision-preview-button" type="button" data-canvas-mode="${escapeHtml(preview.canvasMode || "content")}" ${proposalAttrs} aria-label="${escapeHtml(label)}" title="${escapeHtml(label)}">
      ${icon("eye", "icon icon-small")}
      <span>${escapeHtml(label)}</span>
    </button>
  `;
}

function uniqueActionsByCommand(actions = []) {
  const seen = new Set();
  return actions.filter((action) => {
    const commandId = action.id || action.command || "";
    if (!commandId || seen.has(commandId)) {
      return false;
    }
    seen.add(commandId);
    return true;
  });
}

function renderedActionButtonLabel(action = {}, options = {}) {
  if (options.candidateDecision && (action.id || action.command) === "generate_image_candidate") {
    return t("app.chat.createAnotherVariant");
  }
  return normalizeVisibleProductTerminology(action.label || decisionButtonLabel({ id: action.id || action.command }));
}

function renderedActionButtonIcon(action = {}, options = {}) {
  if (options.candidateDecision && (action.id || action.command) === "deposit_worksheet") {
    return icon("file-text", "icon icon-small");
  }
  return "";
}

function renderActionButtons(actions = [], options = {}) {
  if (!actions.length) {
    return "";
  }
  const buttonActions = actions.filter((action) => !isBusyGenerateCandidateAction(action));
  const conceptForwardActionIndex = options.conceptPreview
    ? buttonActions.findIndex((action) => conceptDecisionCommandIds.has(action.id || action.command || ""))
    : -1;
  const showConceptDecision = conceptForwardActionIndex >= 0;
  const candidateDepositActionIndex = options.candidateDecision
    ? buttonActions.findIndex((action) => (action.id || action.command) === "deposit_worksheet")
    : -1;
  const candidateVariantActionIndex = options.candidateDecision
    ? buttonActions.findIndex((action) => (action.id || action.command) === "generate_image_candidate")
    : -1;
  const showCandidateDecision = candidateDepositActionIndex >= 0 && candidateVariantActionIndex >= 0;
  const decisionClass = showConceptDecision
    ? " concept-decision-actions"
    : showCandidateDecision ? " candidate-decision-actions" : "";
  const disabledStatus = [...new Set(actions
    .filter((action) => action.disabled)
    .map((action) => action.id === "generate_image_candidate"
      ? `${normalizeVisibleProductTerminology(action.label || candidateGenerationBusyLabel())}.`
      : normalizeVisibleProductTerminology(action.reason))
    .filter(Boolean))];
  if (!buttonActions.length) {
    return disabledStatus.length
      ? `<div class="message-action-status">${escapeHtml(disabledStatus.join(" "))}</div>`
      : "";
  }
  return `
    <div class="message-actions${decisionClass}">${buttonActions.map((action, index) => `
      <span class="message-action-wrap">
        <button class="${(showConceptDecision && index === conceptForwardActionIndex) || (showCandidateDecision && index === candidateDepositActionIndex) ? "primary-button" : "secondary-button"} mini-button${showConceptDecision && index === conceptForwardActionIndex ? " concept-decision-forward-button" : ""}${showCandidateDecision && index === candidateDepositActionIndex ? " candidate-decision-deposit-button" : ""}${showCandidateDecision && index === candidateVariantActionIndex ? " candidate-decision-variant-button" : ""}" type="button" data-command="${escapeHtml(action.id || action.command)}" data-payload="${escapeHtml(JSON.stringify(action.payload || {}))}"${action.reason ? ` title="${escapeHtml(normalizeVisibleProductTerminology(action.reason))}"` : ""}${action.disabled ? " disabled" : ""}>
          ${renderedActionButtonIcon(action, options)}
          <span>${escapeHtml(renderedActionButtonLabel(action, options))}</span>
        </button>
        ${renderActionReferenceHint(action)}
      </span>
    `).join("")}${showConceptDecision ? renderConceptDecisionPreviewButton(options.conceptPreview) : ""}</div>
    ${disabledStatus.length ? `<div class="message-action-status">${escapeHtml(disabledStatus.join(" "))}</div>` : ""}
  `;
}

function actionReferenceImages(action = {}) {
  return (Array.isArray(action.payload?.referenceImages) ? action.payload.referenceImages : [])
    .filter((reference) => reference?.path)
    .slice(0, 4);
}

function renderActionReferenceHint(action = {}) {
  const references = actionReferenceImages(action);
  if (!references.length) {
    return "";
  }
  const label = `${references.length} Referenz${references.length === 1 ? "" : "en"} beigelegt`;
  return `<span class="message-action-reference-pill" title="${escapeHtml(label)}">${escapeHtml(label)}</span>`;
}

function actionLabel(action = {}) {
  return normalizeVisibleProductTerminology(action.label || decisionButtonLabel({ id: action.id || action.command }) || action.command || action.id || "Aktion");
}

function sentenceCaseLabel(label = "") {
  const value = String(label || "").trim();
  return value ? value.charAt(0).toUpperCase() + value.slice(1) : "";
}

function completedActionLabel(action = {}) {
  const label = normalizeVisibleProductTerminology(actionLabel(action))
    .replace(/^ja,\s*/i, "")
    .trim();
  return sentenceCaseLabel(label || "Aktion ausführen");
}

function comparablePayloadValue(value) {
  return value === undefined || value === null ? "" : String(value);
}

function actionPayloadMatchesCommand(action = {}, command = {}) {
  const expected = commandPayload(command);
  const actual = action.payload || {};
  const sensitiveKeys = ["proposalId", "basisProposalId", "runId", "candidateId", "imageSpecProposalId", "contentMirrorId", "conceptVersion", "pageCount"];
  if (command.id === "select_candidate" && expected.runId && !actual.runId) {
    return false;
  }
  for (const key of sensitiveKeys) {
    const actualValue = comparablePayloadValue(actual[key]);
    const expectedValue = comparablePayloadValue(expected[key]);
    if (actualValue && expectedValue && actualValue !== expectedValue) {
      return false;
    }
    if (actualValue && !expectedValue && (key === "proposalId" || key === "basisProposalId" || key === "imageSpecProposalId")) {
      return false;
    }
  }
  return true;
}

const chatAuthoringActionCommandIds = new Set(["generate_content_mirror_proposal"]);

function isAllowedCurrentChatAction(commandId, command = null, visibleCommandIds = new Set()) {
  return visibleCommandIds.has(commandId)
    || (chatAuthoringActionCommandIds.has(commandId) && command?.enabled);
}

function actionState(action = {}, workspace = {}, isActionHost = false, visibleCommandIds = new Set()) {
  const commandId = action.id || action.command;
  const command = (workspace.commands || []).find((entry) => entry.id === commandId) || null;
  if (!isActionHost) {
    return { current: false, reason: "replaced" };
  }
  if (commandId === "generate_image_candidate" && command && shouldDisableGenerateCandidateAction(workspace, command)) {
    if (!actionPayloadMatchesCommand(action, command)) {
      return { current: false, reason: "outdated" };
    }
    return { current: true, reason: null };
  }
  if (commandId === "generate_image_candidate" && command?.enabled) {
    if (!actionPayloadMatchesCommand(action, command)) {
      return { current: false, reason: "outdated" };
    }
    return { current: true, reason: null };
  }
  if (!command || !command.enabled || !isAllowedCurrentChatAction(commandId, command, visibleCommandIds)) {
    return { current: false, reason: "unavailable" };
  }
  if (!actionPayloadMatchesCommand(action, command)) {
    return { current: false, reason: "outdated" };
  }
  return { current: true, reason: null };
}

function nextMessageResolvesAction(messages = [], index = -1, action = {}) {
  if (index < 0 || index >= messages.length - 1) {
    return false;
  }
  const nextMessage = messages[index + 1] || null;
  if (!nextMessage || nextMessage.role === "user" || nextMessage.pending || nextMessage.failed) {
    return false;
  }
  const commandId = action.id || action.command || "";
  const content = String(nextMessage.content || "");
  if (commandId === "deposit_worksheet") {
    return /arbeitsbl(?:att|ätter)\s+(wurde[n]?\s+)?abgelegt/i.test(content);
  }
  if (commandId === "generate_image_candidate") {
    return nextMessage.productionCard?.kind === "candidate" || /\b(?:kandidat|entwurf)\b.*\bfertig\b/i.test(content);
  }
  if (/adopt_.*proposal|approve_current_content|activate_content_mirror_version/.test(commandId)) {
    return /weitergearbeitet|gespeichert|arbeitsbasis|arbeitsstand|nächste[nr]?\s+schritte|naechste[nr]?\s+schritte/i.test(content);
  }
  if (/generate_.*proposal|create_.*draft|prepare_/.test(commandId)) {
    return /erstellt|angelegt|vorbereitet|ausformuliert|vorschlag/i.test(content);
  }
  return false;
}

function renderCompletedActionButtons(actions = [], context = {}) {
  const completed = actions
    .filter(({ action }) => nextMessageResolvesAction(context.messages || [], context.index ?? -1, action))
    .map(({ action }) => completedActionLabel(action))
    .filter(Boolean);
  const labels = [...new Set(completed)];
  if (!labels.length) {
    return "";
  }
  return `
    <div class="message-actions message-actions-completed">${labels.map((label) => `
      <button class="secondary-button mini-button message-action-completed-button" type="button" disabled>
        ${escapeHtml(t("app.chat.completed", { label }))}
      </button>
    `).join("")}</div>
  `;
}

function renderChatAttachments(attachments = []) {
  const visualAttachments = attachments.filter((attachment) => attachment.kind === "visual_feedback");
  const inputUploads = attachments.filter((attachment) => attachment.kind === "input_upload");
  if (!visualAttachments.length && !inputUploads.length) {
    return "";
  }
  const renderInputUpload = (attachment) => {
    const uploadPath = attachment.path || attachment.source?.path || "";
    const label = attachment.label || attachment.originalName || fileName(uploadPath) || t("app.chat.file");
    const mimeType = attachment.mimeType || attachment.source?.mimeType || "";
    const imageUrl = isPreviewableImageType(mimeType) ? sourceFileUrl(currentProjectId(), { path: uploadPath }) : null;
    const typeLabel = imageUrl ? t("app.chat.image") : t("app.chat.attachedFile");
    return `
    <figure class="message-attachment input-upload">
      ${imageUrl
    ? `<img src="${escapeHtml(imageUrl)}" alt="${escapeHtml(label)}" loading="lazy">`
    : `<div class="message-attachment-file-thumb">${icon("file", "icon icon-small")}</div>`}
      <figcaption>
        <span>${escapeHtml(label)}</span>
        <small>${escapeHtml([typeLabel, attachment.size ? fileSizeLabel(attachment.size) : ""].filter(Boolean).join(" · "))}</small>
      </figcaption>
    </figure>
  `;
  };
  return `<div class="message-attachments">${[
    ...visualAttachments.map((attachment) => `
    <figure class="message-attachment visual-feedback">
      <img src="${escapeHtml(attachment.url || attachment.previewUrl || attachment.dataUrl || "")}" alt="${escapeHtml(attachment.label || t("app.chat.screenshotExcerpt"))}">
      <figcaption>
        <span>${escapeHtml(attachment.label || t("app.chat.screenshotExcerpt"))}</span>
        <small>${escapeHtml(attachment.source?.candidateId ? t("app.chat.visualFeedbackFor", { draft: draftDisplayLabel({ id: attachment.source.candidateId }) }) : t("app.chat.visualFeedback"))}</small>
      </figcaption>
    </figure>
  `),
    ...inputUploads.map(renderInputUpload)
  ].join("")}</div>`;
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
  const title = isSeries ? t("app.chat.seriesRendering") : isCandidateGeneration ? t("app.chat.draftRendering") : card.label || t("app.chat.actionRunning");
  const text = isCandidateGeneration
    ? isSeries
      ? t("app.chat.seriesRenderingBody", { count: pageCount })
      : t("app.chat.draftRenderingBody")
    : card.message || t("app.chat.productionRunning");
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
                <b>${escapeHtml(t("common.page", { number: index + 1 }))}</b>
                <small>${escapeHtml(t("app.chat.pageRendering"))}</small>
              </span>
            `).join("")}
          </div>
        ` : ""}
        ${isCandidateGeneration ? `
          <div class="render-progress-steps" aria-label="${escapeHtml(t("app.chat.rendering"))}">
            <span>${escapeHtml(t("app.chat.modelStarted"))}</span>
            <span>${escapeHtml(isSeries ? "Layout, Text und Seitenstil werden gerendert" : "Layout und Text werden gerendert")}</span>
            <span>${escapeHtml(isSeries ? "Der mehrseitige Entwurf erscheint automatisch im Chat" : "Der Entwurf erscheint automatisch im Chat")}</span>
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
          <strong>${escapeHtml(draftDisplayLabel({ id: card.candidateId }))}</strong>
          <p>${escapeHtml(t("app.chat.draftPreparing"))}</p>
        </div>
      </article>
    `;
  }
  const displayCandidate = candidateForDisplay(candidate, workspace);
  const displayCandidateId = draftDisplayLabel(displayCandidate);
  const basisLabel = draftChatBasisLabel(displayCandidate);
  const imageDownloads = candidateImageDownloads(pages, draftFilePrefix(displayCandidate));
  const candidatePreviewActions = `
    <span class="candidate-chat-preview-actions">
      <button class="icon-button icon-button-plain concept-chat-action-button" type="button" data-card-action="revise-candidate" data-run-id="${escapeHtml(candidate.runId || "")}" data-candidate-id="${escapeHtml(candidate.id)}" data-display-label="${escapeHtml(displayCandidateId)}" data-page="${escapeHtml(page.page || 1)}" aria-label="${escapeHtml(t("app.draft.adjust"))}" title="${escapeHtml(t("app.draft.adjust"))}">
        ${icon("square-pen", "icon icon-small")}
      </button>
      <button class="icon-button icon-button-plain concept-chat-action-button" type="button" data-canvas-mode="candidates" data-artifact-kind="candidate" data-run-id="${escapeHtml(candidate.runId || "")}" data-candidate-id="${escapeHtml(candidate.id)}" aria-label="${escapeHtml(t("app.draft.openPreview"))}" title="${escapeHtml(t("app.draft.openPreview"))}">
        ${icon("eye", "icon icon-small")}
      </button>
      <button class="candidate-info-button" type="button" data-card-action="candidate-info" data-candidate-id="${escapeHtml(candidate.id)}" data-run-id="${escapeHtml(candidate.runId || "")}" aria-label="${escapeHtml(t("app.draft.info"))}" title="${escapeHtml(t("app.draft.info"))}">
        ${icon("info", "icon icon-small")}
      </button>
      ${renderCandidateImageDownloadButton(imageDownloads)}
    </span>
  `;
  return `
    <figure
      class="chat-result-card candidate-chat-card"
      data-capture-kind="candidate"
      data-run-id="${escapeHtml(candidate.runId || "")}"
      data-candidate-id="${escapeHtml(candidate.id)}"
      data-display-label="${escapeHtml(displayCandidateId)}"
      data-page="${escapeHtml(page.page || 1)}"
      data-page-role="${escapeHtml(page.role || "worksheet")}"
      data-source-path="${escapeHtml(page.path || "")}"
      data-source-url="${escapeHtml(page.url)}"
    >
      <div class="candidate-chat-preview">
        <img data-capture-image src="${escapeHtml(page.url)}" alt="${escapeHtml(displayCandidateId)}">
        ${candidatePreviewActions}
      </div>
      <figcaption>
        <div class="candidate-chat-header">
          <span class="candidate-chat-title">
            <strong>${escapeHtml(t("app.chat.draftFinished", { draft: displayCandidateId }))}</strong>
            ${basisLabel ? `<small>${escapeHtml(basisLabel)}</small>` : ""}
          </span>
        </div>
      </figcaption>
    </figure>
  `;
}

function conceptPreviewFromMessage(message = {}, workspace = {}) {
  const proposal = message.proposal || null;
  if (proposal?.kind === "lessonbrief") {
    return null;
  }
  if (proposal?.kind === "content_mirror") {
    const content = proposal.data || {};
    const brief = workspace.documents?.brief?.data || workspace.proposals?.latestLessonBrief?.data || {};
    const proposalState = conceptProposalDisplayState(proposal);
    return {
      title: content.title || proposal.title || "Arbeitsblatt-Konzept",
      eyebrow: proposalState.eyebrow,
      presentation: "pitch",
      canvasMode: "content_proposal",
      proposalRef: {
        proposalId: proposal.proposalId || null,
        kind: proposal.kind
      },
      summary: proposalState.summary,
      rows: [],
      sections: conceptSectionsFromContent(content, {
        brief,
        project: workspace.project || {},
        teachingContext: workspace.teachingContext || {}
      }),
      copyContext: {
        project: workspace.project || {},
        brief,
        content,
        teachingContext: workspace.teachingContext || {},
        statusLabel: statusWord(proposal.status),
        eyebrow: "Arbeitsblatt-Konzept"
      }
    };
  }
  if (proposal?.kind === "image_spec") {
    const spec = proposal.data || {};
    const policy = spec.referencePolicy || {};
    const references = spec.referenceImages || [];
    return {
      title: normalizeVisibleProductTerminology(spec.purpose || proposal.title || "Referenzbedarf"),
      eyebrow: "Referenz/Vorlage",
      canvasMode: "image_spec_proposal",
      proposalRef: {
        proposalId: proposal.proposalId || null,
        kind: proposal.kind
      },
      summary: normalizeVisibleProductTerminology(referencePolicySummary(policy)),
      rows: [
        ["Visualisierung", normalizeVisibleProductTerminology(spec.topic)],
        ["Referenz", normalizeVisibleProductTerminology(referencePolicyLabel(policy))],
        ["Vorhanden", references.length ? `${references.length} Referenz${references.length === 1 ? "" : "en"}` : "keine"]
      ],
      sections: [
        {
          title: "Warum",
          items: [normalizeVisibleProductTerminology(policy.reason || "Keine besondere Referenz oder Vorlage nötig.")]
        },
        {
          title: "Nächster Schritt",
          items: [normalizeVisibleProductTerminology(policy.suggestedAction || "Direkt Entwurf erstellen oder bei Bedarf eine Referenz im Chat anhängen.")]
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
      summary: workspace.approval?.canGenerate ? "Bereit für Entwürfe." : "Als Entwurf angelegt.",
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
      }),
      copyContext: {
        project: workspace.project || {},
        brief,
        content,
        teachingContext: workspace.teachingContext || {},
        statusLabel: statusWord(workspace.documents?.content?.status),
        eyebrow: "Arbeitsblatt-Konzept"
      }
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
      sections,
      copyContext: {
        project: workspace.project || {},
        brief,
        content: {},
        teachingContext: workspace.teachingContext || {},
        statusLabel: statusWord(workspace.documents?.brief?.status),
        eyebrow: "Arbeitsblatt-Konzept"
      }
    };
  }
  return null;
}

function conceptProposalDisplayState(proposal = {}) {
  if (proposal.status === "adopted") {
    return {
      eyebrow: t("app.chat.conceptReady"),
      summary: ""
    };
  }
  const revisionMode = proposal.source?.revisionMode || "";
  if (revisionMode === "followup_concept" || revisionMode === "new_concept_from_context") {
    return {
      eyebrow: t("app.chat.conceptUpdated"),
      summary: ""
    };
  }
  if (revisionMode || proposal.source?.currentContentMirrorId) {
    return {
      eyebrow: t("app.chat.conceptUpdated"),
      summary: ""
    };
  }
  return {
    eyebrow: t("app.chat.conceptReady"),
    summary: ""
  };
}

function renderConceptChatCard(message = {}, workspace = {}) {
  const preview = conceptPreviewFromMessage(message, workspace);
  if (!preview) {
    return "";
  }
  const currentConcept = currentConceptArtifact(workspace);
  const conceptVersion = currentConcept?.version || workspace.artifacts?.currentContent?.version || "";
  const contentMirrorId = currentConcept?.id || workspace.artifacts?.currentContent?.id || "";
  const proposalId = preview.proposalRef?.kind === "content_mirror"
    ? preview.proposalRef?.proposalId || ""
    : "";
  const pitchHtml = preview.presentation === "pitch" && message.content
    ? `<div class="concept-pitch-copy">${renderMessageCopy(message, workspace)}</div>`
    : "";
  const rows = (preview.rows || []).filter(([, value]) => value !== undefined && value !== null && value !== "");
  return `
    <article class="chat-result-card concept-chat-card">
      <div class="chat-result-card-header">
        <span>${escapeHtml(preview.eyebrow)}</span>
        <div class="chat-result-card-actions">
          <button class="icon-button icon-button-plain concept-chat-action-button" type="button" data-revise-concept data-proposal-id="${escapeHtml(proposalId)}" data-content-mirror-id="${escapeHtml(contentMirrorId)}" data-concept-version="${escapeHtml(conceptVersion)}" aria-label="Konzept überarbeiten" title="Konzept überarbeiten">
            ${icon("square-pen", "icon icon-small")}
          </button>
          ${preview.copyContext ? renderConceptCopyButton(preview.copyContext) : ""}
          ${renderConceptPreviewButton(preview)}
        </div>
      </div>
      <h3>${escapeHtml(preview.title)}</h3>
      ${preview.summary ? `<p>${escapeHtml(preview.summary)}</p>` : ""}
      ${pitchHtml}
      ${rows.length ? `<div class="chat-result-meta-grid">
        ${rows.map(([label, value]) => `
          <div><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>
        `).join("")}
      </div>` : ""}
      ${(preview.bullets || []).length ? `<ul>${preview.bullets.slice(0, 3).map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>` : ""}
    </article>
  `;
}

function isConceptViewerOnlyMessage(message = {}) {
  if (message.role === "user") {
    return false;
  }
  const proposalKind = message.proposal?.kind || "";
  if (proposalKind === "lessonbrief" || proposalKind === "content_mirror") {
    return false;
  }
  return message.productionCard?.kind === "concept"
    || proposalKind === "image_spec";
}

function isConceptNarrationMessage(message = {}) {
  const proposalKind = message.proposal?.kind || "";
  return Boolean(message.content && (proposalKind === "lessonbrief" || proposalKind === "content_mirror"));
}

function isConceptPitchMessage(message = {}) {
  return message.role !== "user"
    && message.proposal?.kind === "content_mirror"
    && Boolean(message.content);
}

function renderConceptNarrationCopy(message = {}) {
  const feedbackLabel = t("app.chat.feedbackOnConcept");
  return `
    <section class="concept-feedback-panel">
      <div class="concept-feedback-header">
        <span>${escapeHtml(feedbackLabel)}</span>
      </div>
      <div class="message-copy concept-feedback-copy">${renderMessageCopy(message)}</div>
    </section>
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

function candidateMessageDisplayContent(message = {}, workspace = {}) {
  const card = message.productionCard || null;
  if (card?.kind !== "candidate") {
    return null;
  }
  const candidate = findCandidateForCard(card, workspace);
  const displayCandidate = candidate
    ? candidateForDisplay(candidate, workspace)
    : {
      id: card.candidateId,
      displayLabel: card.displayLabel
    };
  const displayLabel = draftDisplayLabel(displayCandidate);
  const pageCount = candidate
    ? (candidate.pages || []).filter((page) => page.url).length
      || Number(candidate.generation?.generatedPageCount || candidate.generation?.pageCount || 0)
      || 0
    : Number(card.pageCount || 0) || 0;
  const pageLabel = pageCount
    ? `${t(pageCount === 1 ? "app.draft.pageCount" : "app.draft.pageCountPlural", { count: pageCount })}.`
    : "";
  return `${t("app.chat.draftFinished", { draft: displayLabel })}.${pageLabel ? ` ${pageLabel}` : ""}`;
}

function messageDisplayContent(message = {}, workspace = {}) {
  return candidateMessageDisplayContent(message, workspace) || message.content || "";
}

const hiddenLegacyCommandIds = new Set(["select_candidate", "prepare_export"]);

function isVisibleSuggestedAction(action = {}) {
  return !hiddenLegacyCommandIds.has(action.command || action.id);
}

function renderMessageCopy(message, workspace = {}) {
  const displayContent = messageDisplayContent(message, workspace);
  const content = message.role === "user"
    ? displayContent
    : normalizeVisibleProductTerminology(displayContent);
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
      if (commandId === "generate_image_candidate" && command) {
        return decisionButtons({
          ...command,
          defaultPayload: {
            ...(command.defaultPayload || {}),
            ...(action.payload || {})
          }
        }, workspace);
      }
      if (command) {
        return [buttonActionForCommand(command, workspace, {
          label: suggestedActionButtonLabel(action, command),
          payload: action.payload || commandPayload(command)
        })].filter(Boolean);
      }
      return [{
        id: commandId,
        label: action.label || decisionButtonLabel({ id: commandId }),
        payload: action.payload || {}
      }];
    });
}

function suggestedActionButtonLabel(action = {}, command = {}) {
  if (
    (action.command || action.id) === "generate_content_mirror_proposal"
    && action.payload?.revisionMode === "patch"
  ) {
    return "Konzept überarbeiten";
  }
  return action.label || decisionButtonLabel(command);
}

function renderChatRevisionTarget(target = null) {
  const normalized = normalizeRevisionTarget(target);
  if (!normalized) {
    return "";
  }
  const label = revisionTargetDisplayLabel(normalized);
  return `
    <div class="message-revision-target" data-kind="${escapeHtml(normalized.kind)}" title="${escapeHtml(`Bearbeitungsbezug: ${label}`)}">
      ${icon("square-pen", "icon icon-small")}
      <span>${escapeHtml(label)}</span>
    </div>
  `;
}

function renderChatMessage(message, visibleCommandIds = new Set(), extraCommands = [], workspace = {}, isActionHost = false, messages = [], messageIndex = -1) {
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
  const extraActions = extraCommands.flatMap((command) => decisionButtons(command, workspace));
  const candidateDecision = isActionHost && message.productionCard?.kind === "candidate";
  const actions = candidateDecision
    ? uniqueActionsByCommand([...suggestedActions, ...extraActions])
    : suggestedActions.length ? suggestedActions : (actionEntries.length ? [] : extraActions);
  const stateClass = message.pending ? " pending" : message.failed ? " failed" : message.streaming ? " streaming" : "";
  const commandClass = message.productionCard?.kind === "command_pending" ? " command-pending" : "";
  const metaSuffix = message.pending
    ? message.productionCard?.kind === "command_pending" ? ` · ${t("common.inProgress").toLowerCase()}` : ` · ${t("app.chat.sending")}`
    : message.streaming
      ? ` · ${t("app.chat.writing")}`
      : message.failed
        ? ` · ${t("app.chat.notSent")}`
        : message.createdAt ? ` · ${escapeHtml(timeOnly(message.createdAt))}` : "";
  const hideConceptCopy = isConceptViewerOnlyMessage(message) && !message.streaming && !message.failed;
  const hasCopy = !hideConceptCopy && (messageDisplayContent(message, workspace) || message.streaming || message.failed);
  const copyInsideConceptCard = isConceptPitchMessage(message) && hasCopy;
  const copyHtml = hasCopy && !copyInsideConceptCard ? `<div class="message-copy">${renderMessageCopy(message, workspace)}</div>` : "";
  const copyAfterCard = isConceptNarrationMessage(message) && hasCopy && !copyInsideConceptCard;
  const conceptFeedbackHtml = copyAfterCard ? renderConceptNarrationCopy(message) : "";
  const conceptDecisionPreview = isActionHost && isConceptPitchMessage(message)
    ? conceptPreviewFromMessage(message, workspace)
    : null;
  return `
    <div class="chat-message ${role}${stateClass}${commandClass}">
      ${role === "assistant" ? '<div class="assistant-avatar">AI</div>' : ""}
      <div class="message-bubble">
        <div class="message-meta">${role === "user" ? t("app.chat.me") : "SheetifyAI"}${metaSuffix}</div>
        ${renderChatRevisionTarget(message.revisionTarget)}
        ${copyAfterCard ? "" : copyHtml}
        ${renderChatAttachments(message.attachments || [])}
        ${renderProductionCard(message, workspace)}
        ${copyAfterCard ? conceptFeedbackHtml : ""}
        ${message.streaming ? "" : renderActionButtons(actions, {
          conceptPreview: conceptDecisionPreview,
          candidateDecision
        })}
        ${message.streaming ? "" : renderCompletedActionButtons(staleActions, { messages, index: messageIndex, workspace })}
      </div>
    </div>
  `;
}

function renderThinkingMessage() {
  return `
    <div class="chat-message assistant thinking">
      <div class="assistant-avatar">AI</div>
      <div class="message-bubble">
        <div class="message-meta">SheetifyAI</div>
        <p class="thinking-line"><span></span><span></span><span></span><em>${escapeHtml(t("app.chat.thinking"))}</em></p>
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

function autoOpenConfirmedSuggestedAction(response = {}) {
  const action = (response.suggestedActions || []).find((entry) => entry.autoOpenConfirmation);
  if (!action) {
    return;
  }
  const commandId = action.command || action.id;
  if (!commandId) {
    return;
  }
  window.setTimeout(() => {
    executeCommand(commandId, action.payload || {});
  }, 80);
}

function canvasModeForProposalKind(kind = "") {
  const modes = {
    lessonbrief: "lessonbrief_proposal",
    content_mirror: "content_proposal",
    content_warnings: "warnings_proposal",
    image_spec: "image_spec_proposal"
  };
  return modes[kind] || null;
}

function applyChatResponseNavigation(response = {}) {
  const proposal = response.proposal || null;
  const mode = canvasModeForProposalKind(proposal?.kind);
  if (!mode) {
    return;
  }
  state.activeCanvasMode = mode;
  state.activeArtifactSelection = proposal.proposalId
    ? {
        kind: "proposal",
        id: proposal.proposalId,
        proposalKind: proposal.kind || null
      }
    : null;
  ensureDesktopCanvasVisibleForMode(mode);
}

function streamAssistantResponse({ pendingChat, response, responseWorkspace }) {
  const fullText = response?.content || "";
  if (!fullText) {
    state.pendingChat = null;
    state.workspace = responseWorkspace;
    applyChatResponseNavigation(response);
    renderWorkspace();
    autoOpenConfirmedSuggestedAction(response);
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
        applyChatResponseNavigation(response);
        renderWorkspace();
        autoOpenConfirmedSuggestedAction(response);
      }, 140);
      return;
    }

    const lastCharacter = fullText[index - 1] || "";
    const delay = lastCharacter === "\n" ? 90 : /[.!?]/.test(lastCharacter) ? 78 : 34;
    state.chatStreamTimer = window.setTimeout(tick, delay);
  };

  state.chatStreamTimer = window.setTimeout(tick, 160);
}

function latestAssistantOfferedCommandIds(workspace) {
  const latestAssistant = [...(workspace.chat?.messages || [])].reverse()
    .find((message) => message.role !== "user");
  return new Set((latestAssistant?.suggestedActions || [])
    .filter(isVisibleSuggestedAction)
    .map((action) => action.command));
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

function decisionButtons(command, workspace = state.workspace) {
  if (command.id === "generate_image_candidate") {
    return [buttonActionForCommand(command, workspace)].filter(Boolean);
  }
  return [buttonActionForCommand(command, workspace)].filter(Boolean);
}

function decisionPrompt(command) {
  if (command.decisionPrompt) {
    return command.decisionPrompt;
  }
  if (command.id === "generate_image_candidate" && /(mehrseitig\w* entwurf|entwurfsreihe|kandidatenreihe)/i.test(command.label || "")) {
    return "Soll ich einen weiteren mehrseitigen Entwurf mit allen geplanten Seiten erstellen?";
  }
  if (command.id === "generate_image_candidate" && /variante/i.test(command.label || "")) {
    return "Soll ich einen weiteren Entwurf mit demselben Arbeitsblatt-Konzept erzeugen?";
  }
  if (command.id === "generate_content_mirror_proposal" && /überarbeiten|ueberarbeiten|aktualisieren/i.test(command.label || "")) {
    return "Soll ich das Arbeitsblatt-Konzept mit deiner Änderung überarbeiten?";
  }
  if (command.id === "adopt_content_mirror_proposal" && /aktualisieren/i.test(command.label || "")) {
    return "Das überarbeitete Arbeitsblatt-Konzept liegt vor. Soll ich daraus den nächsten Entwurf vorbereiten?";
  }
  const prompts = {
    generate_lessonbrief_proposal: "Ich kann daraus ein vollständiges Arbeitsblatt-Konzept mit Text, Aufgaben und Bildidee schreiben. Soll ich das machen?",
    create_brief_draft: "Ich kann daraus direkt ein erstes Arbeitsblatt-Konzept anlegen. Soll ich das machen?",
    adopt_lessonbrief_proposal: "Der interne Konzeptstand liegt vor. Soll ich daraus das vollständige Arbeitsblatt-Konzept ausformulieren?",
    generate_content_mirror_proposal: "Soll ich daraus das vollständige Arbeitsblatt-Konzept ausformulieren?",
    create_content_draft: "Soll ich daraus direkt die Aufgabenstruktur und Materialseite anlegen?",
    adopt_content_mirror_proposal: "Das Arbeitsblatt-Konzept liegt vor. Soll ich mit diesem Stand weiterarbeiten?",
    generate_candidate_from_content_proposal: "Soll ich aus diesem Arbeitsblatt-Konzept einen Entwurf erstellen? Dafür kommt vorher die Kostenbestätigung.",
    approve_current_content: "Das Arbeitsblatt-Konzept wirkt bereit. Soll ich mit diesem Stand weiterarbeiten?",
    prepare_image_spec: "Soll ich prüfen, ob der nächste Entwurf eine Referenz oder Vorlage braucht?",
    prepare_reference_asset: "Für diese Visualisierung kann ich ein hochgeladenes Referenzbild nutzen. Soll ich das machen?",
    prepare_web_reference_asset: "Hier kann eine offene Bildreferenz helfen. Soll ich eine passende Wikimedia-Bildreferenz suchen und für die Generierung anhängen?",
    adopt_image_spec: "Soll ich den internen Stand für die Bildgenerierung nutzen?",
    generate_image_candidate: "Soll ich jetzt einen Entwurf erstellen?"
  };
  return prompts[command.id] || "Soll ich mit dem nächsten Schritt weitermachen?";
}

function decisionButtonLabel(command) {
  if (command.decisionLabel) {
    return command.decisionLabel;
  }
  if (command.id === "generate_image_candidate" && /\baus konzept v\d+\b/i.test(command.label || "")) {
    return command.label;
  }
  if (command.id === "generate_image_candidate" && /(mehrseitig\w* entwurf|entwurfsreihe|kandidatenreihe)/i.test(command.label || "")) {
    return /weitere/i.test(command.label || "") ? "Weiteren mehrseitigen Entwurf erstellen" : "Mehrseitigen Entwurf erstellen";
  }
  if (command.id === "generate_image_candidate" && /variante/i.test(command.label || "")) {
    return appLocale?.current() === "en" ? "Create another draft" : "Weitere Entwurfsvariante erzeugen";
  }
  if (command.id === "generate_content_mirror_proposal" && /überarbeiten|ueberarbeiten|aktualisieren/i.test(command.label || "")) {
    return "Konzept überarbeiten";
  }
  if (command.id === "adopt_content_mirror_proposal" && /aktualisieren/i.test(command.label || "")) {
    return "Mit diesem Konzept weiterarbeiten";
  }
  const labels = {
    generate_lessonbrief_proposal: "Ja, Konzept schreiben",
    create_brief_draft: "Ja, direkt anlegen",
    adopt_lessonbrief_proposal: "Ja, Konzept ausformulieren",
    generate_content_mirror_proposal: "Ja, Konzept ausformulieren",
    create_content_draft: "Ja, direkt anlegen",
    adopt_content_mirror_proposal: "Mit diesem Konzept weiterarbeiten",
    generate_candidate_from_content_proposal: "Entwurf erstellen",
    approve_current_content: "Mit diesem Konzept weiterarbeiten",
    prepare_image_spec: "Referenzbedarf prüfen",
    prepare_reference_asset: "Referenzbild nutzen",
    prepare_web_reference_asset: "Bildreferenz suchen",
    adopt_image_spec: "Internen Stand nutzen",
    generate_image_candidate: "Ja, Entwurf erstellen"
  };
  return labels[command.id] || command.label;
}

function timeOnly(value) {
  const match = String(value).match(/T(\d{2}:\d{2})/);
  return match?.[1] || "";
}

function workspaceCards(workspace) {
  const proposalCards = proposalWorkspaceCards(workspace);
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
    const candidatePages = countPreviewCandidatePages(workspace.preview);
    const candidateCount = workspace.latestRun.candidateCount || 0;
    return [{
      title: "Entwürfe",
      subtitle: [
        candidateCountLabel(candidateCount),
        candidatePages > candidateCount ? `${candidatePages} Seiten` : null,
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
  if (proposals.latestContentMirror && !hasContent && !hasSelectionOrExport) {
    cards.push({
      title: "Arbeitsblatt-Konzept",
      subtitle: proposals.latestContentMirror.summary || proposals.latestContentMirror.title,
      tag: "AI",
      mode: "content_proposal",
      actions: commandActions(workspace, ["adopt_content_mirror_proposal"])
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
  return mobilePreviewRenderer.mobileSheetCommand(workspace, ids);
}

function mobileCommandButton(command, label = null, primary = false, workspace = state.workspace) {
  return mobilePreviewRenderer.mobileCommandButton(command, label, primary, workspace);
}

function mobileFocusChatButton(label = "Konzept ändern") {
  return mobilePreviewRenderer.mobileFocusChatButton(label);
}

function mobileCloseButton(label = "Schließen") {
  return mobilePreviewRenderer.mobileCloseButton(label);
}

function libraryWorkspaceFromItem(item = {}) {
  if (item.worksheet) {
    const worksheet = item.worksheet;
    return {
      project: {
        projectId: worksheet.source?.projectId || "",
        title: worksheet.source?.projectTitle || worksheet.source?.projectId || ""
      },
      worksheet,
      preview: {
        previewType: "pdf",
        pdfs: worksheet.pdf ? [{
          ...worksheet.pdf,
          pageCount: worksheet.pageCount,
          concept: worksheet.source?.concept || null
        }] : [],
        pages: worksheet.pages || [],
        candidates: []
      },
      documents: {},
      proposals: {},
      teachingContext: {},
      approval: { canGenerate: false },
      latestRun: {
        candidateCount: 0,
        renderedCandidateCount: 0,
        selectedPageCount: 0
      },
      workspaceEntry: {
        availability: {
          hasExport: Boolean(worksheet.pdf?.url)
        }
      },
      commands: []
    };
  }
  const derived = item.project?.derivedStatus || {};
  const latestRun = Array.isArray(derived.runs) ? derived.runs[derived.runs.length - 1] : null;
  const preview = item.preview || {};
  return {
    project: item.project || {},
    documents: item.documents || {},
    inputReadiness: item.inputReadiness || {},
    chat: item.chat || {},
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

function mobilePreviewUiState() {
  return {
    selectedId: state.selectedId,
    selectedItem: state.selectedItem,
    activeArtifactSelection: state.activeArtifactSelection
  };
}

function openMobilePreviewMode(mode) {
  openMobilePreview(mode, {
    source: state.mobilePreview.source || (state.workspace ? "workspace" : "library")
  });
}

function mobilePreviewStatusLabel(workspace = {}, mode = "") {
  return mobilePreviewRenderer.mobilePreviewStatusLabel(workspace, mode);
}

function mobileConceptData(workspace = {}, mode = "", ui = mobilePreviewUiState()) {
  return mobilePreviewRenderer.mobileConceptData(workspace, mode, ui);
}

function renderMobileConceptBody(workspace = {}, mode = "", ui = mobilePreviewUiState()) {
  return mobilePreviewRenderer.renderMobileConceptBody(workspace, mode, ui);
}

function renderMobileConceptFooter(workspace = {}, mode = "", ui = mobilePreviewUiState()) {
  return mobilePreviewRenderer.renderMobileConceptFooter(workspace, mode, ui);
}

function firstCandidatePage(candidate = {}) {
  return mobilePreviewRenderer.firstCandidatePage(candidate);
}

function renderMobileCandidateRow(candidate = {}, index = 0, options = {}) {
  return mobilePreviewRenderer.renderMobileCandidateRow(candidate, index, options);
}

function renderMobileCandidatesBody(workspace = {}, options = {}) {
  return mobilePreviewRenderer.renderMobileCandidatesBody(workspace, options);
}

function renderMobileInputBody(workspace = {}) {
  return mobilePreviewRenderer.renderMobileInputBody(workspace, mobilePreviewUiState());
}

function renderMobileContextBody(workspace = {}) {
  return mobilePreviewRenderer.renderMobileContextBody(workspace);
}

function renderMobileProjectStepPills(item = {}) {
  return mobilePreviewRenderer.renderMobileProjectStepPills(item);
}

function mobileProjectStepMode(stepId) {
  return mobilePreviewRenderer.mobileProjectStepMode(stepId);
}

function mobileProjectStepMeta(item = {}, row = {}) {
  return mobilePreviewRenderer.mobileProjectStepMeta(item, row);
}

function renderMobileProjectBody(workspace = {}) {
  return mobilePreviewRenderer.renderMobileProjectBody(workspace, mobilePreviewUiState());
}

function renderMobileProjectFooter(workspace = {}) {
  return mobilePreviewRenderer.renderMobileProjectFooter(workspace, mobilePreviewUiState());
}

function renderMobileWorksheetBody(workspace = {}) {
  return mobilePreviewRenderer.renderMobileWorksheetBody(workspace);
}

function renderMobileWorksheetFooter(workspace = {}) {
  return mobilePreviewRenderer.renderMobileWorksheetFooter(workspace);
}

function mobileSheetTitleForMode(workspace = {}, mode = "") {
  return mobilePreviewRenderer.mobileSheetTitleForMode(workspace, mode, mobilePreviewUiState());
}

function renderMobilePreviewFooter(workspace = {}, mode = "") {
  return mobilePreviewRenderer.renderMobilePreviewFooter(workspace, mode, mobilePreviewUiState());
}

function renderMobilePreviewBodyForMode(workspace = {}, mode = "") {
  return mobilePreviewRenderer.renderMobilePreviewBodyForMode(workspace, mode, mobilePreviewUiState());
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
    minimized: false,
    lastFocusedElement: options.lastFocusedElement || document.activeElement
  };
  elements.mobilePreviewLayer.classList.remove("hidden", "is-minimized");
  elements.mobilePreviewLayer.setAttribute("aria-hidden", "false");
  elements.mobilePreviewMini?.classList.add("hidden");
  renderMobilePreview();
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
  if (elements.mobilePreviewMiniLabel) {
    elements.mobilePreviewMiniLabel.textContent = copy.title || "Vorschau";
  }
  setCustomScrollContent(elements.mobilePreviewBody, renderMobilePreviewBodyForMode(context, mode));
  elements.mobilePreviewFooter.innerHTML = renderMobilePreviewFooter(context, mode);
  elements.mobilePreviewLayer.classList.toggle("is-minimized", Boolean(state.mobilePreview.minimized));
  elements.mobilePreviewMini?.classList.toggle("hidden", !state.mobilePreview.minimized);
  elements.mobilePreviewFooter?.classList.toggle("hidden", !elements.mobilePreviewFooter.innerHTML.trim());
  bindMobilePreviewActions();
}

function resetMobilePreviewSwipeState() {
  state.mobilePreviewSwipe = {
    active: false,
    dragging: false,
    pointerId: null,
    startX: 0,
    startY: 0,
    lastY: 0,
    startTime: 0,
    lastTime: 0,
    source: ""
  };
}

function clearMobilePreviewSwipeVisuals({ animate = false } = {}) {
  const sheet = elements.mobilePreviewSheet;
  if (!sheet) {
    return;
  }
  const backdrop = elements.mobilePreviewBackdrop;
  sheet.classList.remove("is-dragging");
  if (animate) {
    sheet.style.transition = "transform 160ms ease-out";
    if (backdrop) {
      backdrop.style.transition = "opacity 160ms ease-out";
    }
    requestAnimationFrame(() => {
      sheet.style.transform = "";
      if (backdrop) {
        backdrop.style.opacity = "";
      }
    });
    window.setTimeout(() => {
      sheet.style.transition = "";
      if (backdrop) {
        backdrop.style.transition = "";
      }
    }, 180);
    return;
  }
  sheet.style.transition = "";
  sheet.style.transform = "";
  if (backdrop) {
    backdrop.style.transition = "";
    backdrop.style.opacity = "";
  }
}

function mobilePreviewSwipeStartSource(target) {
  if (!target || typeof target.closest !== "function") {
    return "";
  }
  if (target.closest("button, a, input, textarea, select, summary, [data-command], [data-mobile-open-url], [data-mobile-download-url]")) {
    return "";
  }
  if (target.closest(".mobile-preview-header") || target.closest(".mobile-preview-grip")) {
    return "header";
  }
  return "";
}

function startMobilePreviewSwipe(event) {
  if (!isMobileViewport()
    || !elements.mobilePreviewLayer
    || elements.mobilePreviewLayer.classList.contains("hidden")
    || !state.mobilePreview.mode
    || (event.button !== undefined && event.button !== 0)) {
    return;
  }
  const source = mobilePreviewSwipeStartSource(event.target);
  if (!source) {
    return;
  }
  state.mobilePreviewSwipe = {
    active: true,
    dragging: false,
    pointerId: event.pointerId,
    startX: event.clientX,
    startY: event.clientY,
    lastY: event.clientY,
    startTime: event.timeStamp || performance.now(),
    lastTime: event.timeStamp || performance.now(),
    source
  };
}

function moveMobilePreviewSwipe(event) {
  const swipe = state.mobilePreviewSwipe;
  if (!swipe.active || event.pointerId !== swipe.pointerId || !elements.mobilePreviewSheet) {
    return;
  }
  const deltaX = event.clientX - swipe.startX;
  const deltaY = event.clientY - swipe.startY;
  const absX = Math.abs(deltaX);
  if (!swipe.dragging) {
    if (deltaY < 10 && absX < 10) {
      return;
    }
    if (deltaY <= 10 || deltaY < absX * 1.2) {
      resetMobilePreviewSwipeState();
      return;
    }
    swipe.dragging = true;
    elements.mobilePreviewSheet.classList.add("is-dragging");
    elements.mobilePreviewSheet.setPointerCapture?.(event.pointerId);
  }
  const dragY = Math.max(0, deltaY);
  swipe.lastY = event.clientY;
  swipe.lastTime = event.timeStamp || performance.now();
  elements.mobilePreviewSheet.style.transform = `translateY(${Math.min(dragY, window.innerHeight)}px)`;
  if (elements.mobilePreviewBackdrop) {
    elements.mobilePreviewBackdrop.style.opacity = String(Math.max(0.16, 1 - dragY / 280));
  }
  event.preventDefault();
}

function endMobilePreviewSwipe(event) {
  const swipe = state.mobilePreviewSwipe;
  if (!swipe.active || event.pointerId !== swipe.pointerId) {
    return;
  }
  elements.mobilePreviewSheet?.releasePointerCapture?.(event.pointerId);
  const deltaY = event.clientY - swipe.startY;
  const elapsed = Math.max(1, (event.timeStamp || performance.now()) - swipe.startTime);
  const velocity = deltaY / elapsed;
  const shouldMinimize = swipe.dragging && (deltaY > 96 || (deltaY > 44 && velocity > 0.45));
  resetMobilePreviewSwipeState();
  if (shouldMinimize) {
    clearMobilePreviewSwipeVisuals();
    minimizeMobilePreview();
    return;
  }
  clearMobilePreviewSwipeVisuals({ animate: true });
}

function cancelMobilePreviewSwipe(event) {
  const swipe = state.mobilePreviewSwipe;
  if (!swipe.active || (event?.pointerId !== undefined && event.pointerId !== swipe.pointerId)) {
    return;
  }
  resetMobilePreviewSwipeState();
  clearMobilePreviewSwipeVisuals({ animate: true });
}

function minimizeMobilePreview() {
  if (!state.mobilePreview.mode || !elements.mobilePreviewLayer) {
    return;
  }
  state.mobilePreview.minimized = true;
  clearMobilePreviewSwipeVisuals();
  elements.mobilePreviewLayer.classList.add("is-minimized");
  elements.mobilePreviewLayer.setAttribute("aria-hidden", "true");
  elements.mobilePreviewMini?.classList.remove("hidden");
  elements.mobilePreviewMini?.focus?.();
}

function restoreMobilePreview() {
  if (!state.mobilePreview.mode || !elements.mobilePreviewLayer) {
    return;
  }
  state.mobilePreview.minimized = false;
  elements.mobilePreviewLayer.classList.remove("hidden", "is-minimized");
  elements.mobilePreviewLayer.setAttribute("aria-hidden", "false");
  elements.mobilePreviewMini?.classList.add("hidden");
  renderMobilePreview();
}

function closeMobilePreview() {
  if (!elements.mobilePreviewLayer || elements.mobilePreviewLayer.classList.contains("hidden")) {
    return;
  }
  resetMobilePreviewSwipeState();
  clearMobilePreviewSwipeVisuals();
  elements.mobilePreviewLayer.classList.add("hidden");
  elements.mobilePreviewLayer.classList.remove("is-minimized");
  elements.mobilePreviewLayer.setAttribute("aria-hidden", "true");
  setCustomScrollContent(elements.mobilePreviewBody, "");
  elements.mobilePreviewFooter.innerHTML = "";
  elements.mobilePreviewMini?.classList.add("hidden");
  const lastFocusedElement = state.mobilePreview.lastFocusedElement;
  state.mobilePreview = {
    mode: null,
    source: "workspace",
    minimized: false,
    lastFocusedElement: null
  };
  lastFocusedElement?.focus?.();
}

function bindMobilePreviewActions() {
  if (!elements.mobilePreviewLayer) {
    return;
  }
  bindCommandButtons(elements.mobilePreviewLayer);
  elements.mobilePreviewLayer.querySelectorAll("[data-mobile-focus-chat]").forEach((button) => {
    button.addEventListener("click", () => {
      closeMobilePreview();
      elements.chatInput?.focus();
    });
  });
  elements.mobilePreviewLayer.querySelectorAll("[data-mobile-revise-concept]").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      const updated = startConceptRevisionFromButton(button);
      if (updated) {
        closeMobilePreview();
        elements.chatInput?.focus();
      }
    });
  });
  elements.mobilePreviewLayer.querySelectorAll("[data-mobile-revise-draft]").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      const row = button.closest("[data-capture-kind='candidate']");
      const updated = startDraftRevisionFromElement(row || button);
      if (updated) {
        closeMobilePreview();
        elements.chatInput?.focus();
      }
    });
  });
  elements.mobilePreviewLayer.querySelectorAll("[data-mobile-close]").forEach((button) => {
    button.addEventListener("click", closeMobilePreview);
  });
  elements.mobilePreviewLayer.querySelectorAll("[data-mobile-open-preview]").forEach((button) => {
    button.addEventListener("click", () => {
      openMobilePreviewMode(button.dataset.mobileOpenPreview);
    });
  });
  elements.mobilePreviewLayer.querySelectorAll("[data-mobile-concept-version]").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      const selection = artifactSelectionFromButton(button);
      if (!selection) {
        return;
      }
      triggerArtifactRelationPulse(selection);
      state.activeCanvasMode = "content";
      state.activeArtifactSelection = selection;
      state.mobilePreview.mode = "content";
      renderMobilePreview();
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
  elements.mobilePreviewLayer.querySelectorAll("[data-mobile-share-url]").forEach((button) => {
    const prepareShareFile = () => prepareWorksheetShareFile({
      url: button.dataset.mobileShareUrl,
      fileNameHint: button.dataset.mobileShareName
    })?.catch(() => {});
    prepareShareFile();
    button.addEventListener("pointerdown", prepareShareFile, { passive: true });
    button.addEventListener("touchstart", prepareShareFile, { passive: true });
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      shareWorksheetPdf({
        url: button.dataset.mobileShareUrl,
        title: button.dataset.mobileShareTitle,
        fileNameHint: button.dataset.mobileShareName
      });
    });
  });
  elements.mobilePreviewLayer.querySelectorAll("[data-mobile-download-url]").forEach((button) => {
    prepareWorksheetShareFile({
      url: button.dataset.mobileDownloadUrl,
      fileNameHint: button.dataset.mobileDownloadName
    })?.catch(() => {});
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      downloadPreparedWorksheetPdf({
        url: button.dataset.mobileDownloadUrl,
        fileNameHint: button.dataset.mobileDownloadName
      });
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
  bindConceptCopyActions(elements.mobilePreviewBody);
  worksheetBlueprint.bind(elements.mobilePreviewBody);
  bindPreviewCardActions(elements.mobilePreviewBody);
}

function setCanvasMode(mode, artifactSelection = null) {
  triggerArtifactRelationPulse(artifactSelection);
  state.activeCanvasMode = mode || "content";
  state.activeArtifactSelection = artifactSelection;
  ensureDesktopCanvasVisibleForMode(state.activeCanvasMode);
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
    deposit_worksheet: "candidates"
  };
  return modes[commandId] || null;
}

function shouldRevealCanvasAfterCommand(commandId) {
  return shouldAutoRevealDesktopCanvasMode(canvasModeAfterCommand(commandId));
}

function applyCommandNavigation(commandId, response = {}) {
  const mode = canvasModeAfterCommand(commandId);
  if (mode) {
    state.activeCanvasMode = mode;
    state.activeArtifactSelection = null;
  }
  if (commandId === "generate_image_candidate") {
    state.focusCandidateId = response.result?.candidate?.id || null;
  }
  if (shouldRevealCanvasAfterCommand(commandId)) {
    ensureDesktopCanvasVisibleForMode(state.activeCanvasMode);
  }
}

function canvasUiState() {
  return {
    activeArtifactSelection: state.activeArtifactSelection
  };
}

function renderCanvas(workspace, mode) {
  const localizedCanvasLabels = {
    assignment: "Input",
    brief: t("app.concept.title"),
    content: t("app.concept.title"),
    warnings: t("app.concept.title"),
    candidates: t("app.preview.drafts"),
    lessonbrief_proposal: t("app.concept.title"),
    content_proposal: t("app.concept.title"),
    warnings_proposal: appLocale?.current() === "en" ? "Concept feedback" : "Konzept-Feedback",
    image_spec_proposal: appLocale?.current() === "en" ? "Reference/template" : "Referenz/Vorlage"
  };
  const title = localizedCanvasLabels[mode] || canvasLabels[mode] || "Canvas";
  elements.canvasTitle.textContent = title;
  const canCapture = canvasRenderer.canCapture(workspace, mode, canvasUiState());
  if (!canCapture && state.canvasCapture.active) {
    setCanvasCaptureActive(false);
  }
  if (elements.canvasCaptureButton) {
    elements.canvasCaptureButton.classList.toggle("hidden", !canCapture);
    elements.canvasCaptureButton.disabled = !canCapture;
    elements.canvasCaptureButton.title = canCapture ? "Ausschnitt markieren" : "Ausschnitt ist nur bei Entwürfen verfügbar";
  }
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
  } else if (mode === "lessonbrief_proposal" || mode === "content_proposal" || mode === "warnings_proposal" || mode === "image_spec_proposal") {
    renderCanvasProposal(workspace, mode);
  } else {
    setCustomScrollContent(elements.canvasBody, '<div class="no-preview">Keine Canvas-Ansicht verfuegbar.</div>');
  }
}

function firstCanvasAsset(workspace, mode) {
  return canvasRenderer.firstCanvasAsset(workspace, mode, canvasUiState());
}

function renderCanvasAssignment(workspace) {
  setCustomScrollContent(elements.canvasBody, canvasRenderer.renderCanvasAssignment(workspace));
  bindPreviewCardActions(elements.canvasBody);
}

function renderCanvasBrief(workspace) {
  setCustomScrollContent(elements.canvasBody, canvasRenderer.renderCanvasBrief(workspace));
  bindConceptCopyActions(elements.canvasBody);
}

function renderCanvasContent(workspace) {
  setCustomScrollContent(elements.canvasBody, canvasRenderer.renderCanvasContent(workspace, canvasUiState()));
  worksheetBlueprint.bind(elements.canvasBody);
  bindConceptCopyActions(elements.canvasBody);
}

function selectedConceptArtifact(workspace = {}) {
  return canvasRenderer.selectedConceptArtifact(workspace, canvasUiState());
}

function renderCanvasWarnings(workspace) {
  setCustomScrollContent(elements.canvasBody, canvasRenderer.renderCanvasWarnings(workspace));
}

function renderCanvasCandidates(workspace) {
  setCustomScrollContent(elements.canvasBody, canvasRenderer.renderCanvasCandidates(workspace, canvasUiState()));
  bindPreviewCardActions(elements.canvasBody);
  focusNewCandidateCard();
  requestCanvasCandidateSheetWidthSync();
}

function selectedCanvasCandidates(workspace = {}) {
  return canvasRenderer.selectedCanvasCandidates(workspace, canvasUiState());
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
  setCustomScrollContent(elements.canvasBody, canvasRenderer.renderCanvasPages(pages, emptyText));
  bindPreviewCardActions(elements.canvasBody);
}

function renderInternalImageSpecDetails(workspace) {
  return canvasRenderer.renderInternalImageSpecDetails(workspace);
}

function proposalKindForMode(mode) {
  const kinds = {
    lessonbrief_proposal: "lessonbrief",
    content_proposal: "content_mirror",
    warnings_proposal: "content_warnings",
    image_spec_proposal: "image_spec"
  };
  return kinds[mode] || null;
}

function proposalMatchesMode(proposal = {}, mode = "") {
  const expectedKind = proposalKindForMode(mode);
  return Boolean(expectedKind && proposal.kind === expectedKind);
}

function proposalCreatedArtifact(workspace = {}, proposal = {}) {
  const proposalId = proposal.proposalId || null;
  if (!proposalId) {
    return null;
  }
  if (proposal.kind === "content_mirror") {
    return workspaceConceptArtifacts(workspace)
      .find((concept) => (concept.createdFrom || []).includes(proposalId)) || null;
  }
  if (proposal.kind === "lessonbrief") {
    const brief = workspace.artifacts?.currentBrief || null;
    return (brief?.createdFrom || []).includes(proposalId) ? brief : null;
  }
  if (proposal.kind === "image_spec") {
    const active = workspace.proposals?.activeImageSpec || null;
    return active?.proposalId === proposalId ? active : null;
  }
  return null;
}

function proposalWithWorkspaceStatus(workspace = {}, proposal = {}) {
  const artifact = proposalCreatedArtifact(workspace, proposal);
  if (!artifact) {
    return proposal;
  }
  return {
    ...proposal,
    status: "adopted",
    adoptedArtifact: {
      id: artifact.id || artifact.artifactId || artifact.proposalId || null,
      version: artifact.version || null,
      current: artifact.current === true
    }
  };
}

function chatProposalById(workspace = {}, proposalId = "", mode = "") {
  if (!proposalId) {
    return null;
  }
  const messages = workspace.chat?.messages || [];
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const proposal = messages[index]?.proposal || null;
    if (proposal?.proposalId === proposalId && proposalMatchesMode(proposal, mode)) {
      return proposalWithWorkspaceStatus(workspace, proposal);
    }
  }
  return null;
}

function selectedChatProposal(workspace = {}, mode = "") {
  const selection = state.activeArtifactSelection || null;
  if (selection?.kind !== "proposal") {
    return null;
  }
  return chatProposalById(workspace, selection.id, mode);
}

function proposalForMode(workspace, mode) {
  const selectedProposal = selectedChatProposal(workspace, mode);
  if (selectedProposal) {
    return selectedProposal;
  }
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
    setCustomScrollContent(elements.canvasBody, '<div class="no-preview">Kein offener Vorschlag vorhanden.</div>');
    return;
  }
  if (mode === "content_proposal" || (proposal.status === "adopted" && mode === "lessonbrief_proposal")) {
    elements.canvasTitle.textContent = t("app.concept.title");
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

function renderLessonBriefProposal(proposal, workspace = {}) {
  const brief = proposal.data || {};
  const adopted = proposal.status === "adopted";
  const sections = conceptSectionsFromContent({}, {
    brief,
    project: workspace.project || {},
    teachingContext: workspace.teachingContext || {}
  });
  setCustomScrollContent(elements.canvasBody, `
    <article class="canvas-document">
      ${renderConceptDocumentHeader({
        project: workspace.project || {},
        brief,
        content: {},
        teachingContext: workspace.teachingContext || {},
        label: "Arbeitsblatt-Konzept",
        titleTag: "h3",
        statusLabel: statusWord(proposal.status),
        eyebrow: "Arbeitsblatt-Konzept"
      })}
      ${renderConceptSections(sections, { compact: false })}
    </article>
  `);
  bindConceptCopyActions(elements.canvasBody);
}

function renderContentProposal(proposal, workspace = {}) {
  const content = proposal.data || {};
  const brief = workspace.documents?.brief?.data || workspace.proposals?.latestLessonBrief?.data || {};
  setCustomScrollContent(elements.canvasBody, `
    <div class="worksheet-blueprint-proposal">
      ${worksheetBlueprint.render({
        content,
        brief,
        project: workspace.project || {},
        teachingContext: workspace.teachingContext || {}
      })}
    </div>
  `);
  worksheetBlueprint.bind(elements.canvasBody);
  bindConceptCopyActions(elements.canvasBody);
}

function renderWarningsProposal(proposal) {
  const warningState = proposal.data || {};
  const warnings = warningState.warnings || [];
  setCustomScrollContent(elements.canvasBody, `
    <article class="canvas-document">
      <p class="detail-label">Konzept-Feedback</p>
      <h3>${escapeHtml(warningState.summary || proposal.title || "Konzept-Feedback")}</h3>
      <section class="detail-section">
        <p class="detail-label">Hinweise</p>
        ${warnings.length ? `<ul>${warnings.map((warning) => `
          <li><strong>${escapeHtml(warning.severity || "medium")}</strong> · ${escapeHtml(warning.message || "")}${warning.recommendation ? `<br><span class="detail-muted">${escapeHtml(warning.recommendation)}</span>` : ""}</li>
        `).join("")}</ul>` : '<p class="detail-muted">Keine Hinweise vorgeschlagen.</p>'}
      </section>
    </article>
  `);
}

function renderImageSpecProposal(proposal) {
  const spec = proposal.data || {};
  const referencePolicy = spec.referencePolicy || null;
  const referenceImages = spec.referenceImages || [];
  const pagePlan = Array.isArray(spec.pagePlan) ? spec.pagePlan : [];
  const promptPreview = spec.promptPreview || spec.finalPrompt || "";
  setCustomScrollContent(elements.canvasBody, `
    <article class="canvas-document">
      <p class="detail-label">Referenz/Vorlage</p>
      <h3>${escapeHtml(spec.purpose || proposal.title || "Referenzbedarf")}</h3>
      ${pagePlan.length ? `
        <section class="detail-section">
          <p class="detail-label">Geplante Seiten</p>
          <p>${escapeHtml(`${spec.pageCount || pagePlan.length} Seite${(spec.pageCount || pagePlan.length) === 1 ? "" : "n"} pro Entwurf`)}</p>
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
        <p class="detail-label">Bildabsicht</p>
        <p>${escapeHtml(spec.visualBrief || spec.purpose || "Keine Bildabsicht formuliert.")}</p>
      </section>
      <section class="detail-section">
        <p class="detail-label">Layoutabsicht</p>
        <p>${escapeHtml(spec.layoutIntent || spec.placement || "Keine Layoutabsicht formuliert.")}</p>
      </section>
      <section class="detail-section">
        <p class="detail-label">Stil und Platzierung</p>
        <p>${escapeHtml(spec.style || "clean_scientific")} · ${escapeHtml(spec.placement || "auto")}</p>
        ${spec.styleNotes ? `<p class="detail-muted">${escapeHtml(spec.styleNotes)}</p>` : ""}
      </section>
      ${referencePolicy ? `
        <section class="detail-section">
          <p class="detail-label">Referenz/Vorlage</p>
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
        <p class="detail-label">Prompt-Vorschau</p>
        <p>${escapeHtml(promptPreview)}</p>
      </section>
    </article>
  `);
}

async function executeCommand(commandId, payload = {}) {
  if (!commandId) {
    return;
  }
  const projectId = currentProjectId();
  const command = workspaceCommandById(commandId);
  if (!command || !command.enabled) {
    if (commandId === "generate_image_candidate" && isCandidateGenerationPendingForWorkspace(state.workspace)) {
      showToast(`${candidateGenerationBusyLabel(state.workspace, command || { id: commandId })}.`, "info");
      return;
    }
    showToast("Dieser Schritt ist nicht mehr aktuell. Ich habe den aktuellen Arbeitsstand geladen.", "warning");
    if (projectId) {
      const payload = await fetchJson(`/api/workspace/${encodeURIComponent(projectId)}`);
      state.workspace = payload.workspace;
      renderWorkspace();
    }
    return;
  }
  let nextPayload = withConfiguredImageProvider(command, {
    ...commandPayload(command),
    ...payload
  });
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
    const confirmationResult = await requestCommandConfirmation(command, nextPayload);
    if (!confirmationResult) {
      return;
    }
    const confirmationPayload = typeof confirmationResult === "object"
      ? confirmationResult.payload || {}
      : {};
    nextPayload = { ...nextPayload, ...confirmationPayload, [confirmationFlag]: true };
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
    if (state.mode === "workspace" && state.selectedId === `project:${projectId}`) {
      state.workspace = response.workspace;
    }
    if (commandUsesImageProvider(command)) {
      state.settingsModal.billingStatus = null;
      state.settingsModal.billingProjectId = null;
    }
    applyCommandNavigation(commandId, response);
    if (commandId === "deposit_worksheet") {
      const worksheet = response.result?.item || response.result?.existing || response.result?.items?.[0] || null;
      if (worksheet?.worksheetId) {
        await openWorksheetInLibrary(worksheet.worksheetId);
      }
      showToast(worksheetDepositToastMessage(response.result), "success");
      return;
    }
    if (state.mode === "workspace" && state.workspace?.project?.projectId === projectId) {
      renderWorkspace();
    } else {
      syncBackgroundRefresh();
    }
    await loadTree({ keepSelection: true, selectAfterLoad: state.mode === "library" });
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
    if (projectId && state.mode === "workspace" && state.selectedId === `project:${projectId}`) {
      try {
        const payload = await fetchJson(`/api/workspace/${encodeURIComponent(projectId)}`);
        state.workspace = payload.workspace;
        renderWorkspace();
      } catch {
        // Keep the original command error visible in the toast.
      }
    } else {
      syncBackgroundRefresh();
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
  const revisionTarget = revisionTargetForRequest(context.revisionTarget || null);
  const voiceInput = context.voiceInput || null;
  const blueprintSelection = context.blueprintSelection || state.blueprintSelection;
  const pendingChat = {
    projectId,
    message,
    attachments,
    revisionTarget,
    voiceInput,
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
          ...(blueprintSelection
            ? {
                blockId: blueprintSelection.id,
                selectionType: `concept_${blueprintSelection.type}`,
                page: blueprintSelection.page
              }
            : {}),
          ...(context.canvasFocus || {})
        },
        revisionTarget,
        voiceInput,
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
    elements.chatInput.placeholder = t("app.chat.placeholder");
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
      <button class="icon-button icon-button-plain" type="button" data-remove-upload-receipt="${escapeHtml(receipt.id)}" aria-label="Anhang entfernen" title="Anhang entfernen">
        ${icon("x", "icon icon-small")}
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
        ${icon("x", "icon icon-small")}
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
  const voiceBusy = state.voiceInput.recording || state.voiceInput.transcribing || state.voiceInput.starting;
  elements.chatAttachmentButton.disabled = busy || voiceBusy;
  elements.chatSendButton.disabled = busy || voiceBusy;
  updateVoiceButton();
  renderRevisionTargetPill();
  renderComposerAttachments();
  syncVoiceTranscriptReviewButton();
}

function submitComposerMessage() {
  if (isChatBusy()) {
    return;
  }
  if (state.voiceInput.recording || state.voiceInput.starting || state.voiceInput.transcribing) {
    showToast(state.voiceInput.transcribing ? "Sprache wird noch transkribiert." : "Bitte Aufnahme zuerst stoppen.", "info");
    return;
  }
  const message = elements.chatInput.value.trim();
  const uploadingReceipts = state.inputUploadReceipts.filter((receipt) => receipt.status === "uploading");
  if (uploadingReceipts.length) {
    showToast(uploadingReceipts.length === 1 ? "Die Datei wird noch gespeichert." : "Die Dateien werden noch gespeichert.", "info");
    return;
  }
  const failedReceipts = state.inputUploadReceipts.filter((receipt) => receipt.status === "error");
  if (failedReceipts.length) {
    showToast("Bitte entferne fehlgeschlagene Anhänge vor dem Senden.", "error");
    return;
  }
  const inputUploads = inputUploadAttachmentsForRequest();
  if (state.composerAttachments.length && !message) {
    showToast("Bitte kurz beschreiben, was am Ausschnitt geändert werden soll.", "error");
    elements.chatInput.focus();
    return;
  }
  if (!message && !inputUploads.length) {
    return;
  }
  stopVoiceInput();
  const effectiveMessage = message || (inputUploads.length === 1
    ? `Bitte berücksichtige die angehängte Datei: ${inputUploads[0].label}.`
    : "Bitte berücksichtige die angehängten Dateien.");
  const attachments = [
    ...state.composerAttachments,
    ...inputUploads
  ];
  const revisionTarget = revisionTargetForRequest(state.revisionTarget);
  const voiceInput = state.voiceDraft;
  state.voiceDraft = null;
  setChatInputValue("");
  state.composerAttachments = [];
  clearInputUploadReceipts();
  clearRevisionTarget();
  elements.chatInput.placeholder = t("app.chat.placeholder");
  renderComposerAttachments();
  sendChatMessage(effectiveMessage, {
    ...(attachments.length
      ? {
        uiEvent: chatUiEventForAttachments(attachments),
        attachments,
        canvasFocus: visualFeedbackCanvasFocus(attachments)
      }
      : {}),
    revisionTarget,
    voiceInput
  });
}

async function uploadInputFiles(fileList, options = {}) {
  const projectId = currentProjectId();
  const files = Array.from(fileList || []).filter(Boolean);
  if (!files.length) {
    return;
  }
  if (!projectId) {
    showToast("Öffne zuerst ein Projekt, um Dateien hinzuzufügen.", "error");
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
      formData.append("deferChatReceipt", "true");
      try {
        const response = await fetchJson(`/api/workspace/${encodeURIComponent(projectId)}/input-upload`, {
          method: "POST",
          body: formData
        });
        latestWorkspace = response.workspace;
        state.workspace = latestWorkspace;
        state.inputUploadReceipts = state.inputUploadReceipts.map((receipt) => receipt.id === receipts[index].id
          ? { ...receipt, status: "saved", uploadedFile: response.upload?.file || null }
          : receipt);
        renderComposerAttachments();
        renderWorkspace();
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
  } catch (error) {
    showToast(error.message, "error");
  } finally {
    elements.chatAttachmentButton.disabled = false;
    elements.chatAttachmentInput.value = "";
  }
}

function handleChatPaste(event) {
  const imageFiles = imageFilesFromPasteEvent(event);
  if (!imageFiles.length) {
    return;
  }
  event.preventDefault();
  uploadInputFiles(imageFiles, { source: "clipboard" });
}

function setNewWorksheetFormVisible(visible) {
  if (visible && !isProjectsLibraryView()) {
    return;
  }
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
  if (!isProjectsLibraryView()) {
    return;
  }
  const title = elements.newWorksheetTitle.value.trim();
  if (!title) {
    elements.newWorksheetTitle.focus();
    return;
  }

  elements.createNewWorksheetButton.disabled = true;
  elements.createNewWorksheetButton.textContent = "Lege Projekt an...";

  try {
    const payload = await fetchJson("/api/projects/single", {
      method: "POST",
      body: JSON.stringify({
        title
      })
    });
    const projectId = payload.project?.projectId;
    state.query = "";
    elements.searchInput.value = "";
    if (projectId) {
      setTreeSelection([`project:${projectId}`], {
        primaryId: `project:${projectId}`,
        anchorId: `project:${projectId}`
      });
    }
    state.collapsedFolders.delete("folder:projects");
    resetNewWorksheetForm();
    setNewWorksheetFormVisible(false);
    await loadTree({
      keepSelection: true,
      selectAfterLoad: false,
      revealSelected: Boolean(projectId)
    });
    if (projectId) {
      await openWorkspace(projectId);
      if (!isMobileViewport()) {
        elements.chatInput?.focus();
      }
    }
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
elements.projectsViewButton?.addEventListener("click", () => setLibraryView("projects"));
elements.worksheetsViewButton?.addEventListener("click", () => setLibraryView("worksheets"));
elements.refreshButton.addEventListener("click", () => {
  loadTree({ keepSelection: true, selectAfterLoad: state.mode === "library" });
});
elements.settingsButton?.addEventListener("click", openSettings);
elements.workspaceMobileSettingsButton?.addEventListener("click", openSettings);
elements.settingsCloseButton?.addEventListener("click", closeSettings);
elements.settingsDisconnectButton?.addEventListener("click", disconnectCurrentDevice);
elements.settingsModal?.addEventListener("click", (event) => {
  if (event.target === elements.settingsModal) {
    closeSettings();
  }
});
elements.manualCopyCloseButton?.addEventListener("click", closeManualCopy);
elements.manualCopyModal?.addEventListener("click", (event) => {
  if (event.target === elements.manualCopyModal) {
    closeManualCopy();
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
elements.loadProjectButton.addEventListener("click", () => {
  const projectId = currentProjectId();
  if (projectId) {
    openWorkspace(projectId);
  }
});
elements.downloadButton.addEventListener("click", () => {
  const firstPdf = state.selectedItem?.worksheet?.pdf || null;
  if (firstPdf?.url) {
    downloadUrl(firstPdf.url, fileName(firstPdf.path));
  }
});
elements.backToLibraryButton.addEventListener("click", closeWorkspace);
elements.workspaceLibraryButton.addEventListener("click", closeWorkspace);
elements.workspaceMobileLibraryButton?.addEventListener("click", closeWorkspace);
for (const button of shareButtons()) {
  button.addEventListener("click", (event) => {
    event.preventDefault();
    togglePinnedSharePanel();
  });
  button.addEventListener("mouseenter", () => openSharePanel({ pinned: false }));
  button.addEventListener("focus", () => {
    if (state.sharePanel.suppressFocusOpen) {
      return;
    }
    openSharePanel({ pinned: false });
  });
  button.addEventListener("mouseleave", scheduleSharePanelClose);
}
elements.sharePopover?.addEventListener("mouseenter", clearShareCloseTimer);
elements.sharePopover?.addEventListener("mouseleave", scheduleSharePanelClose);
elements.shareCloseButton?.addEventListener("click", () => closeSharePanel({ restoreFocus: true }));
elements.shareCopyLinkButton?.addEventListener("click", copySelectedShareUrl);
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
elements.chatInput.addEventListener("input", () => {
  syncVoiceTranscriptReviewButton();
});
elements.chatInput.addEventListener("paste", handleChatPaste);
elements.chatVoiceButton?.addEventListener("click", toggleVoiceInput);
elements.voiceTranscriptReviewButton?.addEventListener("click", openVoiceTranscriptReview);
elements.voiceTranscriptBackdrop?.addEventListener("click", () => closeVoiceTranscriptReview());
elements.voiceTranscriptCloseButton?.addEventListener("click", () => closeVoiceTranscriptReview());
elements.voiceTranscriptSaveButton?.addEventListener("click", saveVoiceTranscriptReview);
elements.revisionTargetClearButton?.addEventListener("click", () => clearRevisionTarget({ focus: true }));
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
elements.candidateInfoModal?.addEventListener("click", (event) => {
  if (event.target === elements.candidateInfoModal) {
    closeCandidateInfo();
  }
});
elements.candidateInfoCloseButton?.addEventListener("click", closeCandidateInfo);
elements.mobilePreviewBackdrop?.addEventListener("click", closeMobilePreview);
elements.mobilePreviewCloseIconButton?.addEventListener("click", closeMobilePreview);
elements.mobilePreviewSheet?.addEventListener("pointerdown", startMobilePreviewSwipe);
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
elements.projectSplitHandle?.addEventListener("pointerdown", startProjectSplitResize);
elements.projectSplitHandle?.addEventListener("click", () => {
  if (state.projectSplitLayout.suppressClick) {
    state.projectSplitLayout.suppressClick = false;
    return;
  }
  if (state.projectSplitLayout.collapsed) {
    expandProjectSplit();
    return;
  }
  collapseProjectSplit();
});
window.addEventListener("pointermove", moveProjectSplitResize);
window.addEventListener("pointerup", endProjectSplitResize);
window.addEventListener("pointercancel", endProjectSplitResize);
window.addEventListener("pointermove", moveCanvasResize);
window.addEventListener("pointerup", endCanvasResize);
window.addEventListener("pointercancel", endCanvasResize);
window.addEventListener("pointermove", moveMobilePreviewSwipe, { passive: false });
window.addEventListener("pointerup", endMobilePreviewSwipe);
window.addEventListener("pointercancel", cancelMobilePreviewSwipe);
window.addEventListener("resize", () => {
  if (!elements.projectView.classList.contains("hidden")) {
    applyProjectSplitLayout();
  }
  if (state.mode === "workspace") {
    applyCanvasLayout();
  }
  syncVoiceTranscriptReviewButton();
  if (!isMobileViewport() && state.mobilePreview.mode) {
    closeMobilePreview();
  }
  if (!isMobileViewport() && isVoiceTranscriptReviewOpen()) {
    closeVoiceTranscriptReview({ restoreFocus: false });
  }
});
document.addEventListener("click", (event) => {
  if (!event.target.closest(".tree-context-menu")) {
    closeTreeContextMenu();
  }
  if (isSharePanelOpen()
    && !event.target.closest(".share-popover")
    && !event.target.closest("[data-share-button]")) {
    closeSharePanel();
  }
});
document.addEventListener("keydown", (event) => {
  if (isSharePanelOpen() && event.key === "Escape") {
    event.preventDefault();
    closeSharePanel({ restoreFocus: true });
    return;
  }
  if (isSettingsOpen()) {
    if (event.key === "Escape") {
      event.preventDefault();
      closeSettings();
      return;
    }
  }
  if (isManualCopyOpen()) {
    if (event.key === "Escape") {
      event.preventDefault();
      closeManualCopy();
      return;
    }
  }
  if (isVoiceTranscriptReviewOpen()) {
    if (event.key === "Escape") {
      event.preventDefault();
      closeVoiceTranscriptReview();
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

window.sheetifyBetaFeedbackContext = () => {
  const viewerItem = currentCandidateViewerItem();
  const source = viewerItem?.source || {};
  const artifact = state.activeArtifactSelection || {};
  return {
    projectId: currentProjectId() || null,
    runId: source.runId || viewerItem?.runId || artifact.runId || null,
    candidateId: source.candidateId || artifact.candidateId || null,
    page: Number(source.page || viewerItem?.page || 0) || null,
    uiView: state.mode === "workspace" ? "workspace" : state.libraryView
  };
};

window.addEventListener("sheetify:localechange", () => {
  appLocale?.apply(document);
  renderLibraryViewChrome();
  if (state.mode === "workspace" && state.workspace) {
    renderWorkspace();
  } else if (state.selectedItem) {
    if (isTreeWorksheetItemId(state.selectedId)) {
      renderWorksheetItem(state.selectedItem);
    } else {
      renderProject(state.selectedItem, state.activeStatusStep);
    }
  }
});

initializeCustomScrollbars();
updateVoiceButton();
loadTree();
