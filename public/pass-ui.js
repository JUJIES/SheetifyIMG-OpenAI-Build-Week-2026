"use strict";

(() => {
  const modal = document.querySelector("#passModal");
  const content = document.querySelector("#passModalContent");
  const openButton = document.querySelector("#passButton");
  if (!modal || !content || !openButton) return;

  let summary = null;

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);
  }

  async function api(url, options = {}) {
    const response = await fetch(url, {
      ...options,
      headers: { ...(options.body ? { "content-type": "application/json" } : {}), ...(options.headers || {}) }
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.message || "Pass-Anfrage fehlgeschlagen.");
    return payload;
  }

  function shortDate(value) {
    if (!value) return "";
    return new Intl.DateTimeFormat("de-DE", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
  }

  function render(message = "", error = false) {
    const pass = summary?.pass;
    if (!pass) {
      content.innerHTML = `<p class="pass-ui-message ${error ? "error" : ""}">${escapeHtml(message || "Pass wird geladen …")}</p>`;
      return;
    }
    content.innerHTML = `
      ${message ? `<p class="pass-ui-message ${error ? "error" : ""}">${escapeHtml(message)}</p>` : ""}
      <article class="pass-overview-card">
        <div><h3>${escapeHtml(pass.label)}</h3><p>Gemeinsamer Sheetify-IMG-Arbeitsbereich · Code ···· ${escapeHtml(pass.codeHint || "")}</p></div>
        <div class="pass-balance-badge"><strong>${pass.balance}</strong><span>Entwurfsseiten</span></div>
      </article>
      <section class="pass-ui-section">
        <div class="pass-ui-section-head"><div><h3>Weiteres Gerät verbinden</h3><p class="pass-ui-help">Code am Desktop eingeben oder QR mit dem Handy scannen.</p></div><button class="pass-ui-button primary" type="button" data-create-pair>Kopplung starten</button></div>
        <div id="pairingResult"></div>
      </section>
      <section class="pass-ui-section">
        <div class="pass-ui-section-head"><div><h3>Entwurfsguthaben aufladen</h3><p class="pass-ui-help">Code einer Guthabenkarte eingeben.</p></div></div>
        <form class="topup-form" id="passTopupForm"><input name="code" autocomplete="one-time-code" placeholder="PLUS-••••-••••-••••" required><button class="pass-ui-button" type="submit">Einlösen</button></form>
      </section>
      <section class="pass-ui-section">
        <div class="pass-ui-section-head"><h3>Verbundene Geräte</h3><span class="pass-ui-help">${summary.devices.length} verbunden</span></div>
        <div class="device-list">${summary.devices.map((device) => `
          <div class="device-row" data-device-id="${escapeHtml(device.id)}">
            <div><strong>${escapeHtml(device.deviceName)}</strong><span class="${device.current ? "device-current" : ""}">${device.current ? "Dieses Gerät" : `Zuletzt ${escapeHtml(shortDate(device.lastSeenAt))}`}</span></div>
            <button class="pass-ui-button ${device.current ? "danger" : ""}" type="button" data-revoke-device>${device.current ? "Abmelden" : "Entfernen"}</button>
          </div>`).join("")}</div>
      </section>
      <footer class="pass-ui-footer">
        <p>Hilfe oder ein Problem? <a href="mailto:sheetify@jujies.app">sheetify@jujies.app</a></p>
        <button class="pass-ui-button danger" type="button" data-logout>Auf diesem Gerät abmelden</button>
      </footer>`;
  }

  async function load(message = "") {
    summary = await api("/api/pass");
    render(message);
  }

  async function open() {
    modal.classList.remove("hidden");
    modal.setAttribute("aria-hidden", "false");
    document.body.style.overflow = "hidden";
    render();
    try { await load(); } catch (error) { render(error.message, true); }
  }

  function close() {
    modal.classList.add("hidden");
    modal.setAttribute("aria-hidden", "true");
    document.body.style.overflow = "";
    openButton.focus();
  }

  openButton.addEventListener("click", open);
  modal.querySelectorAll("[data-pass-close]").forEach((button) => button.addEventListener("click", close));
  modal.addEventListener("click", async (event) => {
    if (event.target.closest("[data-create-pair]")) {
      try {
        const result = await api("/api/pass/pairings", { method: "POST", body: "{}" });
        const target = content.querySelector("#pairingResult");
        target.innerHTML = `<div class="pairing-result">${result.pairing.qrSvg}<div><p class="pass-ui-help">Fünf Minuten gültig</p><code class="pairing-code">${escapeHtml(result.pairing.code)}</code><p class="pass-ui-help">Die neue Sitzung bleibt danach dauerhaft verbunden.</p></div></div>`;
      } catch (error) { render(error.message, true); }
      return;
    }
    const row = event.target.closest("[data-device-id]");
    if (row && event.target.closest("[data-revoke-device]")) {
      try {
        const result = await api(`/api/pass/devices/${encodeURIComponent(row.dataset.deviceId)}`, { method: "DELETE" });
        if (result.currentRevoked) location.replace("/");
        else await load("Gerät wurde entfernt.");
      } catch (error) { render(error.message, true); }
      return;
    }
    if (event.target.closest("[data-logout]")) {
      await api("/api/auth/logout", { method: "POST", body: "{}" }).catch(() => {});
      location.replace("/");
    }
  });

  modal.addEventListener("submit", async (event) => {
    if (event.target.id !== "passTopupForm") return;
    event.preventDefault();
    const code = new FormData(event.target).get("code");
    try {
      const result = await api("/api/pass/topup", { method: "POST", body: JSON.stringify({ code }) });
      await load(`${result.credits} Entwurfsseiten wurden gutgeschrieben.`);
    } catch (error) { render(error.message, true); }
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !modal.classList.contains("hidden")) close();
  });

  api("/api/auth/session")
    .then((session) => {
      if (!session.authenticated) openButton.hidden = true;
    })
    .catch(() => {
      openButton.hidden = true;
    });
})();
