"use strict";

(() => {
  const modal = document.querySelector("#passModal");
  const content = document.querySelector("#passModalContent");
  const openButton = document.querySelector("#passButton");
  if (!modal || !content || !openButton) return;
  const locale = window.sheetifyLocale;

  let summary = null;

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);
  }

  function t(key, variables = {}) {
    return locale?.t(key, variables) || key;
  }

  function languageFlag(language) {
    return language === "de" ? "/icons/flags/de.svg" : "/icons/flags/gb.svg";
  }

  function localizedError(payload = {}) {
    const passKey = `pass.error.${payload.error || "default"}`;
    const passMessage = t(passKey);
    if (passMessage !== passKey) return passMessage;
    if (locale?.current() === "de" && payload.message) return payload.message;
    return t("passUi.error");
  }

  async function api(url, options = {}) {
    const response = await fetch(url, {
      ...options,
      headers: { ...(options.body ? { "content-type": "application/json" } : {}), ...(options.headers || {}) }
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(localizedError(payload));
    return payload;
  }

  function shortDate(value) {
    if (!value) return "";
    return new Intl.DateTimeFormat(locale?.current() === "en" ? "en-GB" : "de-DE", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
  }

  function render(message = "", error = false) {
    const pass = summary?.pass;
    if (!pass) {
      content.innerHTML = `<p class="pass-ui-message ${error ? "error" : ""}">${escapeHtml(message || t("passUi.loading"))}</p>`;
      return;
    }
    content.innerHTML = `
      ${message ? `<p class="pass-ui-message ${error ? "error" : ""}">${escapeHtml(message)}</p>` : ""}
      <article class="pass-overview-card">
        <div><h3>${escapeHtml(t("passUi.overview.title"))}</h3><p>${escapeHtml(t("passUi.workspace", { hint: pass.codeHint || "" }))}</p></div>
        <div class="pass-balance-badge"><strong>${pass.balance}</strong><span>${escapeHtml(t("passUi.draftPages"))}</span></div>
      </article>
      <section class="pass-ui-section">
        <div class="pass-ui-section-head"><div><h3>${escapeHtml(t("passUi.pair.title"))}</h3><p class="pass-ui-help">${escapeHtml(t("passUi.pair.help"))}</p></div><button class="pass-ui-button primary" type="button" data-create-pair>${escapeHtml(t("passUi.pair.start"))}</button></div>
        <div id="pairingResult"></div>
      </section>
      <section class="pass-ui-section">
        <div class="pass-ui-section-head"><div><h3>${escapeHtml(t("passUi.topup.title"))}</h3><p class="pass-ui-help">${escapeHtml(t("passUi.topup.help"))}</p></div></div>
        <form class="topup-form" id="passTopupForm"><input name="code" autocomplete="one-time-code" placeholder="PLUS-••••-••••-••••" required><button class="pass-ui-button" type="submit">${escapeHtml(t("passUi.topup.redeem"))}</button></form>
      </section>
      <section class="pass-ui-section">
        <div class="pass-ui-section-head"><h3>${escapeHtml(t("passUi.devices.title"))}</h3><span class="pass-ui-help">${escapeHtml(t("passUi.devices.connected", { count: summary.devices.length }))}</span></div>
        <div class="device-list">${summary.devices.map((device) => `
          <div class="device-row" data-device-id="${escapeHtml(device.id)}">
            <div><strong>${escapeHtml(device.deviceName)}</strong><span class="${device.current ? "device-current" : ""}">${device.current ? escapeHtml(t("passUi.devices.current")) : escapeHtml(t("passUi.devices.last", { date: shortDate(device.lastSeenAt) }))}</span></div>
            <button class="pass-ui-button ${device.current ? "danger" : ""}" type="button" data-revoke-device>${escapeHtml(t(device.current ? "passUi.devices.logout" : "passUi.devices.remove"))}</button>
          </div>`).join("")}</div>
      </section>
      <section class="pass-ui-section">
        <div class="pass-ui-section-head"><div><h3>${escapeHtml(t("passUi.language.title"))}</h3><p class="pass-ui-help">${escapeHtml(t("passUi.language.help"))}</p></div></div>
        <div class="pass-ui-language" role="group" aria-label="${escapeHtml(t("pass.languageLabel"))}">
          ${locale.SUPPORTED_LOCALES.map((language) => `<button class="pass-ui-language-option" type="button" data-pass-ui-locale="${language}" aria-pressed="${locale.current() === language ? "true" : "false"}" aria-label="${escapeHtml(t(`language.${language}`))}" title="${escapeHtml(t(`language.${language}`))}"><img src="${languageFlag(language)}" alt=""></button>`).join("")}
        </div>
      </section>
      <footer class="pass-ui-footer">
        <p>${escapeHtml(t("passUi.help"))} <a href="mailto:sheetify@jujies.app">sheetify@jujies.app</a></p>
        <button class="pass-ui-button danger" type="button" data-logout>${escapeHtml(t("passUi.logout"))}</button>
      </footer>`;
  }

  async function load(message = "") {
    summary = await api("/api/pass");
    render(message);
  }

  async function refreshBalance() {
    if (modal.classList.contains("hidden")) return;
    const next = await api("/api/pass");
    summary = next;
    const value = content.querySelector(".pass-balance-badge strong");
    if (value) value.textContent = String(next.pass.balance);
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
    const languageButton = event.target.closest("[data-pass-ui-locale]");
    if (languageButton) {
      const nextLocale = locale.normalize(languageButton.dataset.passUiLocale);
      if (nextLocale === locale.current()) return;
      locale.set(nextLocale);
      try {
        await api("/api/auth/session", {
          method: "PATCH",
          body: JSON.stringify({ uiLocale: nextLocale })
        });
      } catch (error) {
        render(error.message, true);
        return;
      }
      locale.apply(document);
      window.dispatchEvent(new CustomEvent("sheetify:localechange", { detail: { locale: nextLocale } }));
      render();
      return;
    }
    if (event.target.closest("[data-create-pair]")) {
      try {
        const result = await api("/api/pass/pairings", { method: "POST", body: "{}" });
        const target = content.querySelector("#pairingResult");
        target.innerHTML = `<div class="pairing-result">${result.pairing.qrSvg}<div><p class="pass-ui-help">${escapeHtml(t("passUi.pair.valid"))}</p><code class="pairing-code">${escapeHtml(result.pairing.code)}</code><p class="pass-ui-help">${escapeHtml(t("passUi.pair.persistent"))}</p></div></div>`;
      } catch (error) { render(error.message, true); }
      return;
    }
    const row = event.target.closest("[data-device-id]");
    if (row && event.target.closest("[data-revoke-device]")) {
      try {
        const result = await api(`/api/pass/devices/${encodeURIComponent(row.dataset.deviceId)}`, { method: "DELETE" });
        if (result.currentRevoked) location.replace("/");
        else await load(t("passUi.devices.removed"));
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
      await load(result.credits === 1 ? t("pass.notice.topupOne") : t("pass.notice.topup", { count: result.credits }));
    } catch (error) { render(error.message, true); }
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !modal.classList.contains("hidden")) close();
  });

  window.addEventListener("sheetify:balancechange", (event) => {
    const balance = Number(event.detail?.balance);
    if (summary?.pass && Number.isFinite(balance)) summary.pass.balance = balance;
    const value = content.querySelector(".pass-balance-badge strong");
    if (value && Number.isFinite(balance)) value.textContent = String(balance);
  });
  window.addEventListener("focus", () => refreshBalance().catch(() => {}));
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") refreshBalance().catch(() => {});
  });
  setInterval(() => refreshBalance().catch(() => {}), 12000);

  api("/api/auth/session")
    .then((session) => {
      if (!session.authenticated) openButton.hidden = true;
    })
    .catch(() => {
      openButton.hidden = true;
    });
})();
