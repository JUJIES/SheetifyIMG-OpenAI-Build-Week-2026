"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const path = require("node:path");
const { readJsonFileIfExists, writeJsonFile } = require("../jsonFile");
const { normalizeLocale } = require("../locale");

const SCHEMA_VERSION = "sheetifyimg.beta-access.v1";
const CONSENT_VERSION = "sheetifyimg.beta-evaluation.v1";
const PASS_CODE_PREFIX = "SHEET";
const TOPUP_CODE_PREFIX = "PLUS";
const CODE_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
const ACTIVE_PASS_STATUSES = new Set(["active"]);
const REQUEST_KINDS = new Set(["recovery", "beta_access", "problem", "email"]);
const REQUEST_STATUSES = new Set(["open", "resolved"]);
const FEEDBACK_CATEGORIES = new Set(["result", "usability", "problem", "idea", "general"]);
const FEEDBACK_STATUSES = new Set(["new", "reviewed", "resolved"]);
const FEEDBACK_TAGS = new Set(["helpful", "unclear", "incorrect", "design", "technical"]);

function nowIso(options = {}) {
  return options.now || new Date().toISOString();
}

function randomId(prefix) {
  return `${prefix}_${crypto.randomUUID()}`;
}

function randomCode(prefix, groups = 3, groupLength = 4) {
  const bytes = crypto.randomBytes(groups * groupLength);
  const parts = [];
  for (let group = 0; group < groups; group += 1) {
    let value = "";
    for (let index = 0; index < groupLength; index += 1) {
      value += CODE_ALPHABET[bytes[(group * groupLength) + index] % CODE_ALPHABET.length];
    }
    parts.push(value);
  }
  return `${prefix}-${parts.join("-")}`;
}

function normalizeCode(value) {
  return String(value || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
}

function digestSecret(value, pepper) {
  return crypto.createHmac("sha256", pepper).update(normalizeCode(value), "utf8").digest("base64url");
}

function digestToken(value, pepper) {
  return crypto.createHmac("sha256", pepper).update(String(value || ""), "utf8").digest("base64url");
}

function safeEqual(left, right) {
  const leftBuffer = Buffer.from(String(left || ""), "utf8");
  const rightBuffer = Buffer.from(String(right || ""), "utf8");
  return leftBuffer.length === rightBuffer.length && crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function positiveInteger(value, fallback = 0) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : fallback;
}

function optionalEmail(value) {
  const email = String(value || "").trim().toLowerCase();
  if (!email) {
    return null;
  }
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw Object.assign(new Error("Bitte eine gültige E-Mail-Adresse angeben."), { statusCode: 400 });
  }
  return email;
}

function requiredEmail(value) {
  const email = optionalEmail(value);
  if (!email) {
    throw Object.assign(new Error("Bitte eine gültige E-Mail-Adresse angeben."), { statusCode: 400 });
  }
  return email;
}

function cleanText(value, maxLength) {
  return String(value || "")
    .replace(/\u0000/g, "")
    .trim()
    .slice(0, maxLength);
}

function cleanLabel(value, fallback = "Sheetify IMG Pass") {
  return String(value || fallback).trim().slice(0, 120) || fallback;
}

function optionalContextId(value, label) {
  const id = cleanText(value, 160);
  if (!id) {
    return null;
  }
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/.test(id)) {
    throw Object.assign(new Error(`Ungültige ${label}.`), { statusCode: 400 });
  }
  return id;
}

function optionalStoredLocale(value) {
  return value === undefined || value === null || value === ""
    ? null
    : normalizeLocale(value);
}

function emptyState(now) {
  return {
    schemaVersion: SCHEMA_VERSION,
    updatedAt: now,
    passes: [],
    sessions: [],
    pairings: [],
    requests: [],
    feedback: [],
    recoveryTokens: [],
    topupCards: [],
    reservations: [],
    ledger: [],
    audit: []
  };
}

function normalizeState(raw, now) {
  const state = { ...emptyState(now), ...(raw || {}) };
  for (const field of ["passes", "sessions", "pairings", "requests", "feedback", "recoveryTokens", "topupCards", "reservations", "ledger", "audit"]) {
    state[field] = Array.isArray(state[field]) ? state[field] : [];
  }
  state.passes = state.passes.map((pass) => ({
    ...pass,
    invitationLocale: normalizeLocale(pass.invitationLocale)
  }));
  state.sessions = state.sessions.map((session) => ({
    ...session,
    uiLocale: normalizeLocale(session.uiLocale),
    consentLocale: optionalStoredLocale(session.consentLocale)
  }));
  state.requests = state.requests.map((request) => ({
    ...request,
    uiLocale: optionalStoredLocale(request.uiLocale)
  }));
  state.feedback = state.feedback.map((feedback) => ({
    ...feedback,
    uiLocale: optionalStoredLocale(feedback.uiLocale),
    consentLocale: optionalStoredLocale(feedback.consentLocale)
  }));
  state.schemaVersion = SCHEMA_VERSION;
  return state;
}

function passBalance(state, passId) {
  return state.ledger
    .filter((entry) => entry.passId === passId)
    .reduce((total, entry) => total + Number(entry.amount || 0), 0);
}

function passRecord(state, passId) {
  const pass = state.passes.find((entry) => entry.id === passId) || null;
  if (!pass) {
    throw Object.assign(new Error("Sheetify IMG Pass wurde nicht gefunden."), { statusCode: 404 });
  }
  return pass;
}

function assertPassActive(pass, now = new Date().toISOString()) {
  if (!ACTIVE_PASS_STATUSES.has(pass.status)) {
    throw Object.assign(new Error("Dieser Sheetify IMG Pass ist derzeit nicht aktiv."), { statusCode: 403 });
  }
  if (pass.expiresAt && pass.expiresAt <= now) {
    throw Object.assign(new Error("Dieser Sheetify IMG Pass ist abgelaufen."), { statusCode: 403 });
  }
}

function publicPass(state, pass) {
  const activeSessions = state.sessions.filter((entry) => entry.passId === pass.id && !entry.revokedAt && entry.expiresAt > new Date().toISOString());
  return {
    id: pass.id,
    label: pass.label,
    status: pass.status,
    createdAt: pass.createdAt,
    updatedAt: pass.updatedAt,
    expiresAt: pass.expiresAt || null,
    recoveryEnabled: Boolean(pass.recoveryEmail),
    codeHint: pass.codeHint || null,
    invitationLocale: normalizeLocale(pass.invitationLocale),
    balance: passBalance(state, pass.id),
    deviceCount: activeSessions.length,
    lastActivityAt: activeSessions.map((entry) => entry.lastSeenAt || entry.createdAt).sort().at(-1) || null
  };
}

function adminPass(state, pass) {
  return {
    ...publicPass(state, pass),
    recoveryEmail: pass.recoveryEmail || null
  };
}

function publicSession(session, currentSessionId = null) {
  return {
    id: session.id,
    deviceName: session.deviceName,
    createdAt: session.createdAt,
    lastSeenAt: session.lastSeenAt,
    expiresAt: session.expiresAt,
    uiLocale: normalizeLocale(session.uiLocale),
    consentLocale: optionalStoredLocale(session.consentLocale),
    current: session.id === currentSessionId
  };
}

function publicRequest(state, request) {
  const pass = request.passId
    ? state.passes.find((entry) => entry.id === request.passId) || null
    : null;
  return {
    id: request.id,
    source: request.source,
    kind: request.kind,
    status: request.status,
    email: request.email,
    name: request.name || null,
    subject: request.subject || null,
    message: request.message || "",
    attachments: Array.isArray(request.attachments) ? request.attachments : [],
    createdAt: request.createdAt,
    updatedAt: request.updatedAt,
    resolvedAt: request.resolvedAt || null,
    adminNote: request.adminNote || "",
    uiLocale: optionalStoredLocale(request.uiLocale),
    pass: pass ? {
      id: pass.id,
      label: pass.label,
      status: pass.status,
      codeHint: pass.codeHint || null,
      invitationLocale: normalizeLocale(pass.invitationLocale)
    } : null
  };
}

function publicFeedback(state, feedback) {
  const pass = state.passes.find((entry) => entry.id === feedback.passId) || null;
  const session = state.sessions.find((entry) => entry.id === feedback.sessionId) || null;
  return {
    id: feedback.id,
    status: feedback.status,
    category: feedback.category,
    rating: feedback.rating || null,
    tags: Array.isArray(feedback.tags) ? feedback.tags : [],
    message: feedback.message || "",
    projectId: feedback.projectId || null,
    runId: feedback.runId || null,
    candidateId: feedback.candidateId || null,
    page: feedback.page || null,
    uiView: feedback.uiView || null,
    deviceClass: feedback.deviceClass || null,
    consentVersion: feedback.consentVersion,
    uiLocale: optionalStoredLocale(feedback.uiLocale),
    consentLocale: optionalStoredLocale(feedback.consentLocale),
    createdAt: feedback.createdAt,
    updatedAt: feedback.updatedAt,
    resolvedAt: feedback.resolvedAt || null,
    adminNote: feedback.adminNote || "",
    pass: pass ? {
      id: pass.id,
      label: pass.label,
      status: pass.status,
      codeHint: pass.codeHint || null
    } : null,
    participant: session ? {
      id: session.id,
      deviceName: session.deviceName,
      createdAt: session.createdAt
    } : { id: feedback.sessionId, deviceName: null, createdAt: null }
  };
}

function ledgerEntry(passId, type, amount, now, details = {}) {
  return {
    id: randomId("ledger"),
    passId,
    type,
    amount: Number(amount),
    createdAt: now,
    ...details
  };
}

function auditEntry(type, now, details = {}) {
  return {
    id: randomId("audit"),
    type,
    createdAt: now,
    ...details
  };
}

function addAudit(state, type, now, details = {}) {
  state.audit.push(auditEntry(type, now, details));
  if (state.audit.length > 5000) {
    state.audit.splice(0, state.audit.length - 5000);
  }
}

function cleanExpiredTransientState(state, now) {
  const pairingRetention = new Date(Date.parse(now) - (24 * 60 * 60 * 1000)).toISOString();
  state.pairings = state.pairings.filter((entry) => !entry.redeemedAt && entry.expiresAt > pairingRetention);
  const sessionRetention = new Date(Date.parse(now) - (30 * 24 * 60 * 60 * 1000)).toISOString();
  state.sessions = state.sessions.filter((entry) => !entry.revokedAt || entry.revokedAt > sessionRetention);
  const recoveryRetention = new Date(Date.parse(now) - (24 * 60 * 60 * 1000)).toISOString();
  state.recoveryTokens = state.recoveryTokens.filter((entry) => {
    if (!entry.usedAt && !entry.supersededAt && entry.expiresAt > now) {
      return true;
    }
    return (entry.usedAt || entry.supersededAt || entry.expiresAt) > recoveryRetention;
  });
}

function createBetaAccessManager(config = {}) {
  const stateFile = path.resolve(config.stateFile || path.join(process.cwd(), ".sheetifyimg", "state", "beta-access.json"));
  const storageRoot = path.resolve(config.storageRoot || path.join(path.dirname(stateFile), "passes"));
  const pepper = String(config.secret || "sheetifyimg-development-beta-secret");
  const sessionDays = positiveInteger(config.sessionDays, 180);
  const pairingMinutes = positiveInteger(config.pairingMinutes, 5);
  const recoveryMinutes = positiveInteger(config.recoveryMinutes, 30);
  const pageCap = positiveInteger(config.pageCap, 6);
  const perPassConcurrency = positiveInteger(config.perPassConcurrency, 1);
  const globalConcurrency = positiveInteger(config.globalConcurrency, 2);
  const paidGenerationEnabled = config.paidGenerationEnabled === true;
  let queue = Promise.resolve();

  async function readState(now = new Date().toISOString()) {
    return normalizeState(await readJsonFileIfExists(stateFile), now);
  }

  function transact(callback, options = {}) {
    const task = queue.then(async () => {
      const now = nowIso(options);
      const state = await readState(now);
      cleanExpiredTransientState(state, now);
      const result = await callback(state, now);
      state.updatedAt = now;
      await writeJsonFile(stateFile, state);
      return result;
    });
    queue = task.catch(() => {});
    return task;
  }

  async function ensureStorage(passId) {
    const rootDir = path.join(storageRoot, passId);
    const projectsDir = path.join(rootDir, "projects");
    const worksheetsDir = path.join(rootDir, "worksheets");
    await Promise.all([
      fs.mkdir(projectsDir, { recursive: true }),
      fs.mkdir(worksheetsDir, { recursive: true })
    ]);
    return { rootDir, projectsDir, worksheetsDir };
  }

  async function createPass(input = {}, options = {}) {
    const rawCode = randomCode(PASS_CODE_PREFIX);
    const result = await transact((state, now) => {
      const pass = {
        id: randomId("pass"),
        label: cleanLabel(input.label),
        status: "active",
        codeDigest: digestSecret(rawCode, pepper),
        codeHint: rawCode.slice(-4),
        invitationLocale: normalizeLocale(input.invitationLocale),
        recoveryEmail: optionalEmail(input.email),
        createdAt: now,
        updatedAt: now,
        expiresAt: input.expiresAt || null
      };
      state.passes.push(pass);
      const credits = positiveInteger(input.credits, 0);
      if (credits) {
        state.ledger.push(ledgerEntry(pass.id, "initial_grant", credits, now, {
          note: "Startguthaben"
        }));
      }
      addAudit(state, "pass_created", now, { passId: pass.id, credits });
      return { pass: adminPass(state, pass), code: rawCode };
    }, options);
    await ensureStorage(result.pass.id);
    return result;
  }

  async function listPasses() {
    const state = await readState();
    return state.passes.map((pass) => adminPass(state, pass))
      .sort((left, right) => String(right.createdAt).localeCompare(String(left.createdAt)));
  }

  async function createRequest(input = {}, options = {}) {
    const source = input.source === "email" ? "email" : "app";
    const kind = source === "email" ? "email" : String(input.kind || "problem");
    if (!REQUEST_KINDS.has(kind)) {
      throw Object.assign(new Error("Unbekannte Anfrageart."), { statusCode: 400 });
    }
    const email = requiredEmail(input.email);
    const sourceDigest = input.sourceId
      ? digestToken(`request:${cleanText(input.sourceId, 500)}`, pepper)
      : null;
    return transact((state, now) => {
      if (sourceDigest) {
        const existing = state.requests.find((entry) => entry.sourceDigest && safeEqual(entry.sourceDigest, sourceDigest));
        if (existing) {
          return { request: publicRequest(state, existing), duplicate: true };
        }
      }
      const matchingPass = kind === "recovery"
        ? state.passes.find((entry) => entry.recoveryEmail === email) || null
        : null;
      const request = {
        id: randomId("request"),
        source,
        kind,
        status: "open",
        email,
        name: cleanText(input.name, 120) || null,
        subject: cleanText(input.subject, 180) || null,
        message: cleanText(input.message, 6000),
        attachments: Array.isArray(input.attachments)
          ? input.attachments.slice(0, 10).map((entry) => cleanText(entry, 180)).filter(Boolean)
          : [],
        uiLocale: source === "app" ? normalizeLocale(input.uiLocale) : null,
        passId: matchingPass?.id || null,
        sourceDigest,
        createdAt: now,
        updatedAt: now,
        resolvedAt: null,
        adminNote: ""
      };
      state.requests.push(request);
      if (state.requests.length > 5000) {
        const removable = state.requests.findIndex((entry) => entry.status === "resolved");
        state.requests.splice(removable >= 0 ? removable : 0, 1);
      }
      addAudit(state, "request_created", now, {
        requestId: request.id,
        source,
        kind,
        passId: request.passId
      });
      return { request: publicRequest(state, request), duplicate: false };
    }, options);
  }

  async function listRequests() {
    const state = await readState();
    return state.requests
      .map((request) => publicRequest(state, request))
      .sort((left, right) => String(right.createdAt).localeCompare(String(left.createdAt)));
  }

  async function updateRequest(requestId, input = {}, options = {}) {
    return transact((state, now) => {
      const request = state.requests.find((entry) => entry.id === requestId) || null;
      if (!request) {
        throw Object.assign(new Error("Anfrage wurde nicht gefunden."), { statusCode: 404 });
      }
      if (input.status !== undefined) {
        const status = String(input.status);
        if (!REQUEST_STATUSES.has(status)) {
          throw Object.assign(new Error("Unbekannter Anfrage-Status."), { statusCode: 400 });
        }
        request.status = status;
        request.resolvedAt = status === "resolved" ? now : null;
      }
      if (input.adminNote !== undefined) {
        request.adminNote = cleanText(input.adminNote, 1000);
      }
      request.updatedAt = now;
      addAudit(state, "request_updated", now, { requestId, status: request.status });
      return publicRequest(state, request);
    }, options);
  }

  async function betaExperience(passId, sessionId) {
    const state = await readState();
    passRecord(state, passId);
    const session = state.sessions.find((entry) => entry.id === sessionId && entry.passId === passId) || null;
    if (!session || session.revokedAt) {
      throw Object.assign(new Error("Die aktuelle Gerätesitzung ist nicht mehr gültig."), { statusCode: 401 });
    }
    const ownFeedback = state.feedback.filter((entry) => entry.passId === passId && entry.sessionId === sessionId);
    return {
      uiLocale: normalizeLocale(session.uiLocale),
      consent: {
        requiredVersion: CONSENT_VERSION,
        accepted: session.consentVersion === CONSENT_VERSION,
        acceptedAt: session.consentVersion === CONSENT_VERSION ? session.consentAcceptedAt || null : null,
        consentLocale: session.consentVersion === CONSENT_VERSION
          ? optionalStoredLocale(session.consentLocale)
          : null
      },
      feedback: {
        count: ownFeedback.length,
        lastSubmittedAt: ownFeedback.map((entry) => entry.createdAt).sort().at(-1) || null
      }
    };
  }

  async function acceptConsent(passId, sessionId, input = {}, options = {}) {
    if (input.accepted !== true) {
      throw Object.assign(new Error("Die Beta-Einwilligung wurde nicht bestätigt."), { statusCode: 400 });
    }
    return transact((state, now) => {
      const session = state.sessions.find((entry) => entry.id === sessionId && entry.passId === passId) || null;
      if (!session || session.revokedAt || session.expiresAt <= now) {
        throw Object.assign(new Error("Die aktuelle Gerätesitzung ist nicht mehr gültig."), { statusCode: 401 });
      }
      const consentLocale = input.uiLocale === undefined
        ? normalizeLocale(session.uiLocale)
        : normalizeLocale(input.uiLocale, session.uiLocale);
      session.uiLocale = consentLocale;
      session.consentVersion = CONSENT_VERSION;
      session.consentLocale = consentLocale;
      session.consentAcceptedAt = now;
      addAudit(state, "beta_consent_accepted", now, {
        passId,
        sessionId,
        consentVersion: CONSENT_VERSION,
        consentLocale
      });
      return {
        requiredVersion: CONSENT_VERSION,
        accepted: true,
        acceptedAt: now,
        consentLocale
      };
    }, options);
  }

  async function createFeedback(passId, sessionId, input = {}, options = {}) {
    const category = String(input.category || "general");
    if (!FEEDBACK_CATEGORIES.has(category)) {
      throw Object.assign(new Error("Unbekannte Feedback-Kategorie."), { statusCode: 400 });
    }
    const rating = input.rating === undefined || input.rating === null || input.rating === ""
      ? null
      : Number(input.rating);
    if (rating !== null && (!Number.isSafeInteger(rating) || rating < 1 || rating > 5)) {
      throw Object.assign(new Error("Die Bewertung muss zwischen 1 und 5 liegen."), { statusCode: 400 });
    }
    const tags = [...new Set(Array.isArray(input.tags) ? input.tags.map(String).filter((tag) => FEEDBACK_TAGS.has(tag)) : [])].slice(0, 5);
    const message = cleanText(input.message, 4000);
    if (rating === null && !tags.length && !message) {
      throw Object.assign(new Error("Bitte eine Bewertung oder eine kurze Rückmeldung angeben."), { statusCode: 400 });
    }
    const projectId = optionalContextId(input.projectId, "Projekt-ID");
    const runId = optionalContextId(input.runId, "Run-ID");
    const candidateId = optionalContextId(input.candidateId, "Entwurf-ID");
    const page = input.page === undefined || input.page === null || input.page === ""
      ? null
      : positiveInteger(input.page, 0);
    if (input.page !== undefined && input.page !== null && input.page !== "" && (!page || page > 100)) {
      throw Object.assign(new Error("Ungültige Seitenangabe."), { statusCode: 400 });
    }
    const uiView = cleanText(input.uiView, 80) || null;
    const deviceClass = ["mobile", "tablet", "desktop"].includes(String(input.deviceClass))
      ? String(input.deviceClass)
      : null;

    return transact((state, now) => {
      passRecord(state, passId);
      const session = state.sessions.find((entry) => entry.id === sessionId && entry.passId === passId) || null;
      if (!session || session.revokedAt || session.expiresAt <= now) {
        throw Object.assign(new Error("Die aktuelle Gerätesitzung ist nicht mehr gültig."), { statusCode: 401 });
      }
      if (session.consentVersion !== CONSENT_VERSION) {
        throw Object.assign(new Error("Bitte zuerst der Beta-Auswertung zustimmen."), { statusCode: 403 });
      }
      const feedback = {
        id: randomId("feedback"),
        passId,
        sessionId,
        status: "new",
        category,
        rating,
        tags,
        message,
        projectId,
        runId,
        candidateId,
        page,
        uiView,
        deviceClass,
        consentVersion: CONSENT_VERSION,
        uiLocale: normalizeLocale(session.uiLocale),
        consentLocale: normalizeLocale(session.consentLocale, session.uiLocale),
        createdAt: now,
        updatedAt: now,
        resolvedAt: null,
        adminNote: ""
      };
      state.feedback.push(feedback);
      if (state.feedback.length > 5000) {
        const removable = state.feedback.findIndex((entry) => entry.status === "resolved");
        state.feedback.splice(removable >= 0 ? removable : 0, 1);
      }
      addAudit(state, "feedback_created", now, {
        feedbackId: feedback.id,
        passId,
        sessionId,
        projectId,
        runId,
        candidateId
      });
      return publicFeedback(state, feedback);
    }, options);
  }

  async function listFeedback() {
    const state = await readState();
    return state.feedback
      .map((feedback) => publicFeedback(state, feedback))
      .sort((left, right) => String(right.createdAt).localeCompare(String(left.createdAt)));
  }

  async function updateFeedback(feedbackId, input = {}, options = {}) {
    return transact((state, now) => {
      const feedback = state.feedback.find((entry) => entry.id === feedbackId) || null;
      if (!feedback) {
        throw Object.assign(new Error("Feedback wurde nicht gefunden."), { statusCode: 404 });
      }
      if (input.status !== undefined) {
        const status = String(input.status);
        if (!FEEDBACK_STATUSES.has(status)) {
          throw Object.assign(new Error("Unbekannter Feedback-Status."), { statusCode: 400 });
        }
        feedback.status = status;
        feedback.resolvedAt = status === "resolved" ? now : null;
      }
      if (input.adminNote !== undefined) {
        feedback.adminNote = cleanText(input.adminNote, 1000);
      }
      feedback.updatedAt = now;
      addAudit(state, "feedback_updated", now, { feedbackId, status: feedback.status });
      return publicFeedback(state, feedback);
    }, options);
  }

  async function createRecoveryChallenge(requestId, options = {}) {
    const rawToken = crypto.randomBytes(32).toString("base64url");
    return transact((state, now) => {
      const request = state.requests.find((entry) => entry.id === requestId) || null;
      if (!request || request.kind !== "recovery") {
        throw Object.assign(new Error("Für diese Anfrage kann kein Wiederherstellungslink erstellt werden."), { statusCode: 400 });
      }
      if (!request.passId) {
        throw Object.assign(new Error("Zu dieser E-Mail ist kein Sheetify IMG Pass hinterlegt."), { statusCode: 409 });
      }
      const pass = passRecord(state, request.passId);
      assertPassActive(pass, now);
      for (const entry of state.recoveryTokens.filter((item) => item.requestId === requestId && !item.usedAt && !item.supersededAt)) {
        entry.supersededAt = now;
      }
      const token = {
        id: randomId("recovery"),
        requestId,
        passId: pass.id,
        tokenDigest: digestToken(rawToken, pepper),
        createdAt: now,
        expiresAt: new Date(Date.parse(now) + (recoveryMinutes * 60 * 1000)).toISOString(),
        usedAt: null,
        supersededAt: null
      };
      state.recoveryTokens.push(token);
      addAudit(state, "recovery_created", now, { requestId, passId: pass.id, recoveryId: token.id });
      return {
        token: rawToken,
        expiresAt: token.expiresAt,
        request: publicRequest(state, request)
      };
    }, options);
  }

  async function redeemRecovery(token, deviceName, options = {}) {
    const tokenDigest = digestToken(token, pepper);
    return transact((state, now) => {
      const recovery = state.recoveryTokens.find((entry) => (
        !entry.usedAt
        && !entry.supersededAt
        && entry.expiresAt > now
        && safeEqual(entry.tokenDigest, tokenDigest)
      )) || null;
      if (!recovery) {
        throw Object.assign(new Error("Der Wiederherstellungslink ist ungültig oder abgelaufen."), { statusCode: 401 });
      }
      const pass = passRecord(state, recovery.passId);
      assertPassActive(pass, now);
      const created = createSessionRecord(pass, deviceName, now, options.uiLocale);
      state.sessions.push(created.session);
      recovery.usedAt = now;
      const request = state.requests.find((entry) => entry.id === recovery.requestId) || null;
      if (request) {
        request.status = "resolved";
        request.resolvedAt = now;
        request.updatedAt = now;
      }
      addAudit(state, "recovery_redeemed", now, {
        requestId: recovery.requestId,
        passId: pass.id,
        recoveryId: recovery.id,
        sessionId: created.session.id
      });
      return {
        token: created.token,
        session: publicSession(created.session, created.session.id),
        pass: publicPass(state, pass)
      };
    }, options);
  }

  async function updatePass(passId, input = {}, options = {}) {
    return transact((state, now) => {
      const pass = passRecord(state, passId);
      if (input.status && !["active", "paused", "revoked"].includes(input.status)) {
        throw Object.assign(new Error("Unbekannter Pass-Status."), { statusCode: 400 });
      }
      if (input.label !== undefined) {
        pass.label = cleanLabel(input.label);
      }
      if (input.email !== undefined) {
        pass.recoveryEmail = optionalEmail(input.email);
      }
      if (input.expiresAt !== undefined) {
        pass.expiresAt = input.expiresAt || null;
      }
      if (input.invitationLocale !== undefined) {
        pass.invitationLocale = normalizeLocale(input.invitationLocale);
      }
      if (input.status) {
        pass.status = input.status;
        if (input.status === "revoked") {
          for (const session of state.sessions.filter((entry) => entry.passId === pass.id && !entry.revokedAt)) {
            session.revokedAt = now;
          }
        }
      }
      pass.updatedAt = now;
      addAudit(state, "pass_updated", now, { passId: pass.id, status: pass.status });
      return adminPass(state, pass);
    }, options);
  }

  async function rotatePass(passId, input = {}, options = {}) {
    const rawCode = randomCode(PASS_CODE_PREFIX);
    return transact((state, now) => {
      const pass = passRecord(state, passId);
      pass.codeDigest = digestSecret(rawCode, pepper);
      pass.codeHint = rawCode.slice(-4);
      pass.updatedAt = now;
      if (input.revokeSessions !== false) {
        for (const session of state.sessions.filter((entry) => entry.passId === pass.id && !entry.revokedAt)) {
          session.revokedAt = now;
        }
      }
      addAudit(state, "pass_rotated", now, { passId: pass.id, sessionsRevoked: input.revokeSessions !== false });
      return { pass: adminPass(state, pass), code: rawCode };
    }, options);
  }

  function sessionExpiry(now) {
    return new Date(Date.parse(now) + (sessionDays * 24 * 60 * 60 * 1000)).toISOString();
  }

  function createSessionRecord(pass, deviceName, now, uiLocale) {
    const token = crypto.randomBytes(32).toString("base64url");
    return {
      token,
      session: {
        id: randomId("session"),
        passId: pass.id,
        tokenDigest: digestToken(token, pepper),
        uiLocale: normalizeLocale(uiLocale, pass.invitationLocale),
        consentLocale: null,
        deviceName: cleanLabel(deviceName, "Verbundenes Gerät"),
        createdAt: now,
        lastSeenAt: now,
        expiresAt: sessionExpiry(now),
        revokedAt: null
      }
    };
  }

  async function loginWithPass(code, deviceName, options = {}) {
    const codeDigest = digestSecret(code, pepper);
    return transact((state, now) => {
      const pass = state.passes.find((entry) => safeEqual(entry.codeDigest, codeDigest)) || null;
      if (!pass) {
        throw Object.assign(new Error("Der Sheetify IMG Pass ist ungültig."), { statusCode: 401 });
      }
      assertPassActive(pass, now);
      const created = createSessionRecord(pass, deviceName, now, options.uiLocale);
      state.sessions.push(created.session);
      addAudit(state, "session_created", now, { passId: pass.id, sessionId: created.session.id });
      return {
        token: created.token,
        session: publicSession(created.session, created.session.id),
        pass: publicPass(state, pass)
      };
    }, options);
  }

  async function authenticateToken(token, options = {}) {
    if (!token) {
      return null;
    }
    const tokenDigest = digestToken(token, pepper);
    const now = nowIso(options);
    const state = await readState(now);
    const session = state.sessions.find((entry) => safeEqual(entry.tokenDigest, tokenDigest)) || null;
    if (!session || session.revokedAt || session.expiresAt <= now) {
      return null;
    }
    const pass = state.passes.find((entry) => entry.id === session.passId) || null;
    if (!pass) {
      return null;
    }
    try {
      assertPassActive(pass, now);
    } catch {
      return null;
    }
    if (Date.parse(now) - Date.parse(session.lastSeenAt || session.createdAt) > 5 * 60 * 1000) {
      transact((nextState, touchedAt) => {
        const target = nextState.sessions.find((entry) => entry.id === session.id);
        if (target && !target.revokedAt) {
          target.lastSeenAt = touchedAt;
        }
        return null;
      }, { now }).catch(() => {});
    }
    return {
      session: publicSession(session, session.id),
      pass: publicPass(state, pass),
      passId: pass.id,
      sessionId: session.id,
      storage: await ensureStorage(pass.id)
    };
  }

  async function logout(sessionId, options = {}) {
    if (!sessionId) {
      return false;
    }
    return transact((state, now) => {
      const session = state.sessions.find((entry) => entry.id === sessionId) || null;
      if (!session || session.revokedAt) {
        return false;
      }
      session.revokedAt = now;
      addAudit(state, "session_revoked", now, { passId: session.passId, sessionId: session.id });
      return true;
    }, options);
  }

  async function updateSessionLocale(passId, sessionId, uiLocale, options = {}) {
    return transact((state, now) => {
      const session = state.sessions.find((entry) => entry.id === sessionId && entry.passId === passId) || null;
      if (!session || session.revokedAt || session.expiresAt <= now) {
        throw Object.assign(new Error("Die aktuelle Gerätesitzung ist nicht mehr gültig."), { statusCode: 401 });
      }
      session.uiLocale = normalizeLocale(uiLocale);
      session.lastSeenAt = now;
      addAudit(state, "session_locale_updated", now, {
        passId,
        sessionId,
        uiLocale: session.uiLocale
      });
      return publicSession(session, sessionId);
    }, options);
  }

  async function devices(passId, currentSessionId) {
    const state = await readState();
    passRecord(state, passId);
    const now = new Date().toISOString();
    return state.sessions
      .filter((entry) => entry.passId === passId && !entry.revokedAt && entry.expiresAt > now)
      .map((entry) => publicSession(entry, currentSessionId))
      .sort((left, right) => String(right.lastSeenAt).localeCompare(String(left.lastSeenAt)));
  }

  async function revokeDevice(passId, sessionId, options = {}) {
    return transact((state, now) => {
      const session = state.sessions.find((entry) => entry.id === sessionId && entry.passId === passId) || null;
      if (!session) {
        throw Object.assign(new Error("Gerät wurde nicht gefunden."), { statusCode: 404 });
      }
      session.revokedAt = now;
      addAudit(state, "session_revoked", now, { passId, sessionId });
      return true;
    }, options);
  }

  async function createPairing(passId, sessionId, options = {}) {
    const rawCode = randomCode("PAIR", 2, 4);
    return transact((state, now) => {
      const pass = passRecord(state, passId);
      assertPassActive(pass, now);
      const sourceSession = state.sessions.find((entry) => entry.id === sessionId && entry.passId === passId) || null;
      if (!sourceSession || sourceSession.revokedAt || sourceSession.expiresAt <= now) {
        throw Object.assign(new Error("Die aktuelle Gerätesitzung ist nicht mehr gültig."), { statusCode: 401 });
      }
      const expiresAt = new Date(Date.parse(now) + (pairingMinutes * 60 * 1000)).toISOString();
      const pairing = {
        id: randomId("pair"),
        passId,
        codeDigest: digestSecret(rawCode, pepper),
        createdBySessionId: sessionId,
        createdAt: now,
        expiresAt,
        redeemedAt: null,
        redeemedBySessionId: null
      };
      state.pairings.push(pairing);
      addAudit(state, "pairing_created", now, { passId, pairingId: pairing.id, sessionId });
      return { id: pairing.id, code: rawCode, expiresAt };
    }, options);
  }

  async function redeemPairing(code, deviceName, options = {}) {
    const codeDigest = digestSecret(code, pepper);
    return transact((state, now) => {
      const pairing = state.pairings.find((entry) => !entry.redeemedAt && entry.expiresAt > now && safeEqual(entry.codeDigest, codeDigest)) || null;
      if (!pairing) {
        throw Object.assign(new Error("Der Kopplungscode ist ungültig oder abgelaufen."), { statusCode: 401 });
      }
      const pass = passRecord(state, pairing.passId);
      assertPassActive(pass, now);
      const created = createSessionRecord(pass, deviceName, now, options.uiLocale);
      state.sessions.push(created.session);
      pairing.redeemedAt = now;
      pairing.redeemedBySessionId = created.session.id;
      addAudit(state, "pairing_redeemed", now, { passId: pass.id, pairingId: pairing.id, sessionId: created.session.id });
      return {
        token: created.token,
        session: publicSession(created.session, created.session.id),
        pass: publicPass(state, pass)
      };
    }, options);
  }

  async function grant(passId, amount, input = {}, options = {}) {
    const credits = positiveInteger(amount, 0);
    if (!credits) {
      throw Object.assign(new Error("Das Guthaben muss größer als 0 sein."), { statusCode: 400 });
    }
    return transact((state, now) => {
      const pass = passRecord(state, passId);
      state.ledger.push(ledgerEntry(passId, input.type || "admin_grant", credits, now, {
        note: String(input.note || "Admin-Gutschrift").slice(0, 200)
      }));
      addAudit(state, "quota_granted", now, { passId, amount: credits });
      return adminPass(state, pass);
    }, options);
  }

  async function createTopupCard(amount, input = {}, options = {}) {
    const credits = positiveInteger(amount, 0);
    if (!credits || credits > 1000) {
      throw Object.assign(new Error("Bitte ein Guthaben zwischen 1 und 1000 angeben."), { statusCode: 400 });
    }
    const rawCode = randomCode(TOPUP_CODE_PREFIX);
    return transact((state, now) => {
      const card = {
        id: randomId("card"),
        codeDigest: digestSecret(rawCode, pepper),
        codeHint: rawCode.slice(-4),
        credits,
        label: cleanLabel(input.label, `${credits} Entwurfsseiten`),
        createdAt: now,
        expiresAt: input.expiresAt || null,
        redeemedAt: null,
        redeemedByPassId: null
      };
      state.topupCards.push(card);
      addAudit(state, "topup_card_created", now, { cardId: card.id, credits });
      const { codeDigest: _codeDigest, ...publicCard } = card;
      return { card: publicCard, code: rawCode };
    }, options);
  }

  async function redeemTopup(passId, code, options = {}) {
    const codeDigest = digestSecret(code, pepper);
    return transact((state, now) => {
      const pass = passRecord(state, passId);
      assertPassActive(pass, now);
      const card = state.topupCards.find((entry) => !entry.redeemedAt && (!entry.expiresAt || entry.expiresAt > now) && safeEqual(entry.codeDigest, codeDigest)) || null;
      if (!card) {
        throw Object.assign(new Error("Die Guthabenkarte ist ungültig, abgelaufen oder bereits eingelöst."), { statusCode: 400 });
      }
      card.redeemedAt = now;
      card.redeemedByPassId = passId;
      state.ledger.push(ledgerEntry(passId, "topup_card", card.credits, now, { cardId: card.id }));
      addAudit(state, "topup_card_redeemed", now, { passId, cardId: card.id, credits: card.credits });
      return { pass: publicPass(state, pass), credits: card.credits };
    }, options);
  }

  async function reserveGeneration(passId, input = {}, options = {}) {
    const pages = positiveInteger(input.pageCount, 1);
    return transact((state, now) => {
      const pass = passRecord(state, passId);
      assertPassActive(pass, now);
      if (!paidGenerationEnabled) {
        throw Object.assign(new Error("Die Entwurfserstellung ist momentan global pausiert."), { statusCode: 503 });
      }
      if (pages > pageCap) {
        throw Object.assign(new Error(`Pro Entwurf sind in der Beta höchstens ${pageCap} Seiten möglich.`), { statusCode: 400 });
      }
      const active = state.reservations.filter((entry) => entry.status === "reserved");
      if (active.length >= globalConcurrency) {
        throw Object.assign(new Error("Momentan laufen bereits mehrere Entwürfe. Bitte gleich noch einmal versuchen."), { statusCode: 429 });
      }
      if (active.filter((entry) => entry.passId === passId).length >= perPassConcurrency) {
        throw Object.assign(new Error("In diesem Arbeitsbereich läuft bereits ein Entwurf."), { statusCode: 429 });
      }
      if (passBalance(state, passId) < pages) {
        throw Object.assign(new Error(`Für diesen Entwurf werden ${pages} Entwurfsseiten benötigt.`), { statusCode: 402 });
      }
      const reservation = {
        id: randomId("reservation"),
        passId,
        projectId: input.projectId || null,
        jobId: input.jobId || null,
        reservedPages: pages,
        generatedPages: null,
        status: "reserved",
        createdAt: now,
        updatedAt: now
      };
      state.reservations.push(reservation);
      state.ledger.push(ledgerEntry(passId, "generation_reservation", -pages, now, {
        reservationId: reservation.id,
        projectId: reservation.projectId,
        jobId: reservation.jobId
      }));
      addAudit(state, "generation_reserved", now, { passId, reservationId: reservation.id, pages });
      return { ...reservation, balance: passBalance(state, passId) };
    }, options);
  }

  async function settleGeneration(reservationId, generatedPages, options = {}) {
    return transact((state, now) => {
      const reservation = state.reservations.find((entry) => entry.id === reservationId) || null;
      if (!reservation || reservation.status !== "reserved") {
        return null;
      }
      const completed = Math.max(0, Math.min(reservation.reservedPages, Number(generatedPages) || 0));
      const refund = reservation.reservedPages - completed;
      reservation.status = "settled";
      reservation.generatedPages = completed;
      reservation.updatedAt = now;
      if (refund > 0) {
        state.ledger.push(ledgerEntry(reservation.passId, "generation_refund", refund, now, {
          reservationId,
          reason: "unused_pages"
        }));
      }
      state.ledger.push(ledgerEntry(reservation.passId, "generation_settlement", 0, now, {
        reservationId,
        generatedPages: completed
      }));
      addAudit(state, "generation_settled", now, { passId: reservation.passId, reservationId, generatedPages: completed, refund });
      return { ...reservation, refundedPages: refund, balance: passBalance(state, reservation.passId) };
    }, options);
  }

  async function refundGeneration(reservationId, reason = "generation_failed", options = {}) {
    return transact((state, now) => {
      const reservation = state.reservations.find((entry) => entry.id === reservationId) || null;
      if (!reservation || reservation.status !== "reserved") {
        return null;
      }
      reservation.status = "refunded";
      reservation.generatedPages = 0;
      reservation.updatedAt = now;
      state.ledger.push(ledgerEntry(reservation.passId, "generation_refund", reservation.reservedPages, now, {
        reservationId,
        reason: String(reason).slice(0, 120)
      }));
      addAudit(state, "generation_refunded", now, { passId: reservation.passId, reservationId, pages: reservation.reservedPages });
      return { ...reservation, balance: passBalance(state, reservation.passId) };
    }, options);
  }

  async function recoverReservations(options = {}) {
    return transact((state, now) => {
      const pending = state.reservations.filter((entry) => entry.status === "reserved");
      for (const reservation of pending) {
        reservation.status = "refunded";
        reservation.updatedAt = now;
        reservation.generatedPages = 0;
        state.ledger.push(ledgerEntry(reservation.passId, "generation_refund", reservation.reservedPages, now, {
          reservationId: reservation.id,
          reason: "service_restart"
        }));
        addAudit(state, "generation_refunded", now, { passId: reservation.passId, reservationId: reservation.id, pages: reservation.reservedPages });
      }
      return { recovered: pending.length };
    }, options);
  }

  async function passSummary(passId, currentSessionId) {
    const state = await readState();
    const pass = passRecord(state, passId);
    return {
      pass: publicPass(state, pass),
      devices: await devices(passId, currentSessionId),
      recentLedger: state.ledger.filter((entry) => entry.passId === passId).slice(-20).reverse()
    };
  }

  return Object.freeze({
    acceptConsent,
    authenticateToken,
    betaExperience,
    createPairing,
    createFeedback,
    createPass,
    createRecoveryChallenge,
    createRequest,
    createTopupCard,
    devices,
    ensureStorage,
    grant,
    listPasses,
    listFeedback,
    listRequests,
    loginWithPass,
    logout,
    passSummary,
    recoverReservations,
    redeemPairing,
    redeemRecovery,
    redeemTopup,
    refundGeneration,
    reserveGeneration,
    revokeDevice,
    rotatePass,
    settleGeneration,
    updatePass,
    updateFeedback,
    updateRequest,
    updateSessionLocale
  });
}

module.exports = {
  CONSENT_VERSION,
  PASS_CODE_PREFIX,
  SCHEMA_VERSION,
  TOPUP_CODE_PREFIX,
  createBetaAccessManager,
  normalizeCode
};
