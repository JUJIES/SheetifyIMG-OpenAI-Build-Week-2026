"use strict";

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
  supportButton: document.querySelector("#supportButton")
};

function deviceName() {
  const agent = navigator.userAgent;
  if (/iPhone/i.test(agent)) return "iPhone";
  if (/iPad/i.test(agent)) return "iPad";
  if (/Android/i.test(agent)) return "Android-Gerät";
  if (/Windows/i.test(agent)) return "Windows-PC";
  if (/Macintosh|Mac OS/i.test(agent)) return "Mac";
  return "Browser-Gerät";
}

function showNotice(message, error = false) {
  elements.notice.textContent = message;
  elements.notice.classList.toggle("error", error);
  elements.notice.classList.remove("hidden");
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
    throw new Error(payload.message || "Die Verbindung konnte nicht hergestellt werden.");
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

async function redeemPendingTopup() {
  const code = sessionStorage.getItem("sheetify.pendingTopup");
  if (!code) return;
  sessionStorage.removeItem("sheetify.pendingTopup");
  const result = await api("/api/pass/topup", {
    method: "POST",
    body: JSON.stringify({ code })
  });
  showNotice(`${result.credits} Entwurfsseiten wurden gutgeschrieben.`);
}

async function connect(code) {
  const normalized = String(code || "").trim();
  if (!normalized) return;
  elements.button.disabled = true;
  try {
    const pairing = /^PAIR/i.test(normalized);
    await api(pairing ? "/api/auth/pair" : "/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ code: normalized, deviceName: deviceName() })
    });
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
    const result = await api("/api/auth/recovery", {
      method: "POST",
      body: JSON.stringify({
        kind: elements.requestKind.value,
        email: elements.supportEmail.value,
        message: elements.supportMessage.value
      })
    });
    showNotice(result.message);
    elements.supportForm.reset();
    elements.supportForm.classList.add("hidden");
  } catch (error) {
    showNotice(error.message, true);
  } finally {
    elements.supportButton.disabled = false;
  }
});

(async () => {
  const payload = hashPayload();
  if (payload.topup) {
    sessionStorage.setItem("sheetify.pendingTopup", payload.topup);
  }
  if (payload.recover) {
    try {
      await api("/api/auth/recover", {
        method: "POST",
        body: JSON.stringify({ token: payload.recover, deviceName: deviceName() })
      });
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
    try {
      await redeemPendingTopup();
    } catch (error) {
      showNotice(error.message, true);
      return;
    }
    location.replace("/app");
  }
})();
