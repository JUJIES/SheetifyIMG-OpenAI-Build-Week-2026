"use strict";

const locale = window.sheetifyLocale;
let authenticatedSession = null;

const elements = {
  form: document.querySelector("#connectForm"),
  code: document.querySelector("#passCode"),
  button: document.querySelector("#connectButton"),
  notice: document.querySelector("#passNotice"),
  supportToggle: document.querySelector("#supportToggle"),
  supportForm: document.querySelector("#supportForm"),
  supportEmail: document.querySelector("#supportEmail"),
  supportMessage: document.querySelector("#supportMessage"),
  requestKind: document.querySelector("#requestKind"),
  supportButton: document.querySelector("#supportButton"),
  localeButtons: [...document.querySelectorAll("[data-pass-locale]")]
};

function t(key, variables = {}) {
  return locale.t(key, variables);
}

function applyLocale() {
  locale.apply(document);
  document.title = t("pass.documentTitle");
  elements.localeButtons.forEach((button) => {
    button.setAttribute("aria-pressed", String(button.dataset.passLocale === locale.current()));
  });
  document.documentElement.dataset.localeReady = "true";
}

function storedLocale() {
  try {
    return localStorage.getItem(locale.STORAGE_KEY);
  } catch {
    return null;
  }
}

function resolvedLocale(session = null, invitation = null) {
  return locale.resolve({
    query: new URLSearchParams(location.search),
    stored: storedLocale(),
    session,
    invitation,
    browser: navigator.languages
  });
}

function deviceName() {
  const agent = navigator.userAgent;
  if (/iPhone/i.test(agent)) return "iPhone";
  if (/iPad/i.test(agent)) return "iPad";
  if (/Android/i.test(agent)) return t("pass.device.android");
  if (/Windows/i.test(agent)) return t("pass.device.windows");
  if (/Macintosh|Mac OS/i.test(agent)) return "Mac";
  return t("pass.device.browser");
}

function normalizeCode(value) {
  return String(value || "")
    .trim()
    .toUpperCase()
    .replace(/[\s_–—−]+/g, "-")
    .replace(/[^A-Z0-9-]/g, "")
    .replace(/-+/g, "-");
}

function normalizeCodeField() {
  const normalized = normalizeCode(elements.code.value);
  if (elements.code.value !== normalized) elements.code.value = normalized;
  return normalized;
}

function focusCodeField() {
  if (window.matchMedia("(min-width: 821px)").matches) {
    elements.code.focus();
  }
}

function showNotice(message, error = false) {
  elements.notice.textContent = message;
  elements.notice.classList.toggle("error", error);
  elements.notice.classList.remove("hidden");
}

function localizedError(payload) {
  const key = `pass.error.${payload.error || "default"}`;
  const translated = t(key);
  if (translated !== key) return translated;
  if (locale.current() === "de" && payload.message) return payload.message;
  return t("pass.error.default");
}

async function api(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      ...(options.body ? { "content-type": "application/json" } : {}),
      ...(options.headers || {})
    }
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(localizedError(payload));
    error.code = payload.error || "unknown";
    throw error;
  }
  return payload;
}

function hashPayload() {
  const params = new URLSearchParams(location.hash.replace(/^#/, ""));
  return {
    pass: params.get("pass"),
    pair: params.get("pair"),
    topup: params.get("topup"),
    recover: params.get("recover")
  };
}

function cleanAddress() {
  history.replaceState(null, "", `${location.pathname}${location.search}`);
}

function updateLanguageQuery(value) {
  const url = new URL(location.href);
  url.searchParams.set("lang", value);
  history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
}

async function chooseLocale(value) {
  const selected = locale.set(value);
  updateLanguageQuery(selected);
  applyLocale();
  if (authenticatedSession && authenticatedSession.uiLocale !== selected) {
    const result = await api("/api/auth/session", {
      method: "PATCH",
      body: JSON.stringify({ uiLocale: selected })
    });
    authenticatedSession = result.session;
  }
}

async function redeemPendingTopup() {
  const code = sessionStorage.getItem("sheetify.pendingTopup");
  if (!code) return;
  sessionStorage.removeItem("sheetify.pendingTopup");
  const result = await api("/api/pass/topup", {
    method: "POST",
    body: JSON.stringify({ code })
  });
  showNotice(result.credits === 1
    ? t("pass.notice.topupOne")
    : t("pass.notice.topup", { count: result.credits }));
}

async function connect(code) {
  const normalized = normalizeCode(code);
  if (!normalized) return;
  elements.code.value = normalized;
  elements.button.disabled = true;
  try {
    const pairing = /^PAIR/i.test(normalized);
    const result = await api(pairing ? "/api/auth/pair" : "/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ code: normalized, deviceName: deviceName(), uiLocale: locale.current() })
    });
    authenticatedSession = result.session;
    locale.set(result.session?.uiLocale || locale.current());
    cleanAddress();
    await redeemPendingTopup();
    location.replace("/app");
  } catch (error) {
    showNotice(error.message, true);
  } finally {
    elements.button.disabled = false;
  }
}

elements.form.addEventListener("submit", (event) => {
  event.preventDefault();
  connect(elements.code.value);
});

elements.code.addEventListener("input", normalizeCodeField);

elements.localeButtons.forEach((button) => {
  button.addEventListener("click", () => chooseLocale(button.dataset.passLocale).catch((error) => showNotice(error.message, true)));
});

elements.supportToggle.addEventListener("click", () => {
  elements.supportForm.classList.toggle("hidden");
  if (!elements.supportForm.classList.contains("hidden")) {
    elements.supportEmail.focus();
  }
});

elements.supportForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  elements.supportButton.disabled = true;
  try {
    await api("/api/auth/recovery", {
      method: "POST",
      body: JSON.stringify({
        kind: elements.requestKind.value,
        email: elements.supportEmail.value,
        message: elements.supportMessage.value,
        uiLocale: locale.current()
      })
    });
    showNotice(t("pass.notice.supportAccepted"));
    elements.supportForm.reset();
    elements.supportForm.classList.add("hidden");
  } catch (error) {
    showNotice(error.message, true);
  } finally {
    elements.supportButton.disabled = false;
  }
});

applyLocale();

(async () => {
  const payload = hashPayload();
  if (payload.topup) {
    sessionStorage.setItem("sheetify.pendingTopup", payload.topup);
  }
  if (payload.recover) {
    try {
      const result = await api("/api/auth/recover", {
        method: "POST",
        body: JSON.stringify({ token: payload.recover, deviceName: deviceName(), uiLocale: locale.current() })
      });
      authenticatedSession = result.session;
      locale.set(result.session?.uiLocale || locale.current());
      cleanAddress();
      location.replace("/app");
    } catch (error) {
      cleanAddress();
      showNotice(error.message, true);
    }
    return;
  }
  if (payload.pass || payload.pair) {
    elements.code.value = payload.pass || payload.pair;
    await connect(payload.pass || payload.pair);
    return;
  }
  const session = await api("/api/auth/session").catch(() => ({ authenticated: false }));
  if (session.authenticated) {
    authenticatedSession = session.session;
    const selected = resolvedLocale(session.session?.uiLocale, session.pass?.invitationLocale);
    locale.set(selected);
    applyLocale();
    if (session.session?.uiLocale !== selected) {
      const updated = await api("/api/auth/session", {
        method: "PATCH",
        body: JSON.stringify({ uiLocale: selected })
      });
      authenticatedSession = updated.session;
    }
    try {
      await redeemPendingTopup();
    } catch (error) {
      showNotice(error.message, true);
      return;
    }
    location.replace("/app");
  }
  if (!session.authenticated) focusCodeField();
})();
