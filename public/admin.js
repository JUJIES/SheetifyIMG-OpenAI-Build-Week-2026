"use strict";

const state = {
  overview: null,
  cardSvg: null,
  cardPngDataUrl: null,
  cardName: "sheetify-card",
  recoveryLinks: new Map()
};

const elements = {
  status: document.querySelector("#adminStatus"),
  createPassForm: document.querySelector("#createPassForm"),
  createTopupForm: document.querySelector("#createTopupForm"),
  generated: document.querySelector("#generatedCard"),
  generatedTitle: document.querySelector("#generatedTitle"),
  generatedPreview: document.querySelector("#generatedPreview"),
  downloadPng: document.querySelector("#downloadCardPng"),
  downloadSvg: document.querySelector("#downloadCardSvg"),
  passList: document.querySelector("#passList"),
  requestList: document.querySelector("#requestList"),
  refreshPasses: document.querySelector("#refreshPasses"),
  refreshRequests: document.querySelector("#refreshRequests"),
  contact: document.querySelector(".admin-contact"),
  toast: document.querySelector("#adminToast")
};

async function api(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: { ...(options.body ? { "content-type": "application/json" } : {}), ...(options.headers || {}) }
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.message || "Admin-Anfrage fehlgeschlagen.");
  return payload;
}

function toast(message) {
  elements.toast.textContent = message;
  elements.toast.classList.remove("hidden");
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => elements.toast.classList.add("hidden"), 3200);
}

function emailDeliveryNotice(delivery) {
  if (delivery?.status === "sent") return " Karte wurde per E-Mail versendet.";
  if (delivery?.status === "failed") return " Die Karte wurde erstellt, aber die E-Mail konnte nicht versendet werden.";
  if (delivery?.status === "disabled") return " Mailversand ist noch nicht aktiviert.";
  return "";
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);
}

function showCard(payload, title, fileName) {
  state.cardSvg = payload.svg;
  state.cardPngDataUrl = payload.pngDataUrl;
  state.cardName = fileName;
  elements.generatedTitle.textContent = title;
  const image = document.createElement("img");
  image.src = payload.pngDataUrl;
  image.alt = title;
  elements.generatedPreview.replaceChildren(image);
  elements.generated.classList.remove("hidden");
  elements.generated.scrollIntoView({ behavior: "smooth", block: "center" });
}

function passStatusLabel(status) {
  return ({ active: "Aktiv", paused: "Pausiert", revoked: "Gesperrt" })[status] || status;
}

function requestKindLabel(kind) {
  return ({
    recovery: "Pass wiederherstellen",
    beta_access: "Beta-Zugang",
    problem: "Problem oder Frage",
    email: "Eingehende E-Mail"
  })[kind] || kind;
}

function shortDate(value) {
  if (!value) return "";
  return new Intl.DateTimeFormat("de-DE", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

function mailtoHref(request, recoveryUrl = "") {
  const subject = recoveryUrl
    ? "Dein Sheetify IMG Pass – Wiederherstellung"
    : `Re: ${request.subject || requestKindLabel(request.kind)}`;
  const greeting = request.name ? `Hallo ${request.name},` : "Hallo,";
  const body = recoveryUrl
    ? `${greeting}\n\nhier ist dein einmaliger Sheetify-IMG-Wiederherstellungslink. Er ist 30 Minuten gültig:\n\n${recoveryUrl}\n\nViele Grüße\nSheetify IMG`
    : `${greeting}\n\nvielen Dank für deine Nachricht.\n\n\nViele Grüße\nSheetify IMG`;
  return `mailto:${request.email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

async function copyText(value) {
  try {
    await navigator.clipboard.writeText(value);
  } catch {
    const field = document.createElement("textarea");
    field.value = value;
    field.style.position = "fixed";
    field.style.opacity = "0";
    document.body.append(field);
    field.select();
    document.execCommand("copy");
    field.remove();
  }
}

function renderPasses() {
  const passes = state.overview?.passes || [];
  if (!passes.length) {
    elements.passList.innerHTML = '<div class="empty">Noch keine Sheetify IMG Pässe.</div>';
    return;
  }
  elements.passList.innerHTML = passes.map((pass) => `
    <article class="pass-row" data-pass-id="${escapeHtml(pass.id)}">
      <div>
        <h3>${escapeHtml(pass.label)}</h3>
        <div class="pass-meta">
          <span class="pass-status ${escapeHtml(pass.status)}">${escapeHtml(passStatusLabel(pass.status))}</span>
          <span>${pass.deviceCount} ${pass.deviceCount === 1 ? "Gerät" : "Geräte"}</span>
          <span>Code ···· ${escapeHtml(pass.codeHint || "")}</span>
          ${pass.recoveryEmail ? `<span>${escapeHtml(pass.recoveryEmail)}</span>` : ""}
        </div>
      </div>
      <div class="pass-balance"><strong>${pass.balance}</strong><span>Entwurfsseiten</span></div>
      <div class="pass-actions">
        <button class="secondary" data-grant="3">+3</button>
        <button class="secondary" data-grant="5">+5</button>
        <button class="secondary" data-grant="10">+10</button>
        <button class="ghost" data-toggle-status="${pass.status === "active" ? "paused" : "active"}">${pass.status === "active" ? "Pausieren" : "Aktivieren"}</button>
        <button class="ghost" data-rotate>Code erneuern</button>
      </div>
    </article>`).join("");
}

function renderRequests() {
  const requests = state.overview?.requests || [];
  if (!requests.length) {
    elements.requestList.innerHTML = '<div class="empty">Noch keine Anfragen.</div>';
    return;
  }
  elements.requestList.innerHTML = requests.map((request) => {
    const recovery = state.recoveryLinks.get(request.id);
    const title = request.subject || requestKindLabel(request.kind);
    const attachments = request.attachments?.length
      ? `<p class="request-attachments">Anhänge nur im Proton-Postfach: ${escapeHtml(request.attachments.join(", "))}</p>`
      : "";
    const pass = request.pass
      ? `<p class="request-pass">Pass: <strong>${escapeHtml(request.pass.label)}</strong> · Code ···· ${escapeHtml(request.pass.codeHint || "")}</p>`
      : "";
    const recoveryBox = recovery ? `
      <div class="recovery-ready">
        <input value="${escapeHtml(recovery.url)}" readonly aria-label="Wiederherstellungslink">
        <button class="secondary" type="button" data-copy-link>Link kopieren</button>
        <a class="button-link primary" href="${escapeHtml(mailtoHref(request, recovery.url))}">Antwort vorbereiten</a>
        <small>Gültig bis ${escapeHtml(shortDate(recovery.expiresAt))}</small>
      </div>` : "";
    return `
      <article class="request-row ${request.status === "resolved" ? "resolved" : ""}" data-request-id="${escapeHtml(request.id)}">
        <div class="request-head">
          <div class="request-tags">
            <span class="request-source ${escapeHtml(request.source)}">${request.source === "email" ? "E-Mail" : "App"}</span>
            <span>${escapeHtml(requestKindLabel(request.kind))}</span>
            <span class="request-status">${request.status === "resolved" ? "Erledigt" : "Offen"}</span>
          </div>
          <time datetime="${escapeHtml(request.createdAt)}">${escapeHtml(shortDate(request.createdAt))}</time>
        </div>
        <h3>${escapeHtml(title)}</h3>
        <a class="request-email" href="mailto:${escapeHtml(request.email)}">${escapeHtml(request.name ? `${request.name} · ${request.email}` : request.email)}</a>
        ${request.message ? `<p class="request-message">${escapeHtml(request.message)}</p>` : ""}
        ${attachments}
        ${pass}
        ${recoveryBox}
        <div class="request-actions">
          <a class="button-link secondary" href="${escapeHtml(mailtoHref(request))}">Antworten</a>
          ${request.kind === "recovery" && request.pass && !recovery ? '<button class="primary" type="button" data-create-recovery>Wiederherstellungslink</button>' : ""}
          <button class="ghost" type="button" data-request-status="${request.status === "resolved" ? "open" : "resolved"}">${request.status === "resolved" ? "Wieder öffnen" : "Erledigt"}</button>
        </div>
      </article>`;
  }).join("");
}

async function loadOverview() {
  state.overview = await api("/api/admin/overview");
  const beta = state.overview.beta;
  const openRequests = state.overview.requests.filter((request) => request.status === "open").length;
  elements.status.textContent = `${state.overview.passes.length}/10 Pässe · ${openRequests} offen · Entwürfe ${beta.paidGenerationEnabled ? "aktiv" : "pausiert"} · Postfach ${beta.inboundMailEnabled ? "gespiegelt" : "manuell"}`;
  if (elements.contact && beta.contactEmail) {
    elements.contact.textContent = beta.contactEmail;
    elements.contact.href = `mailto:${beta.contactEmail}`;
  }
  renderPasses();
  renderRequests();
}

elements.createPassForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const data = new FormData(elements.createPassForm);
  try {
    const result = await api("/api/admin/passes", {
      method: "POST",
      body: JSON.stringify({ label: data.get("label"), email: data.get("email"), credits: Number(data.get("credits")) })
    });
    showCard(result, "Sheetify IMG Pass erstellt", `sheetify-img-pass-${result.pass.id}`);
    const notice = emailDeliveryNotice(result.emailDelivery);
    if (notice) toast(notice.trim());
    elements.createPassForm.reset();
    elements.createPassForm.elements.credits.value = 20;
    await loadOverview();
  } catch (error) { toast(error.message); }
});

elements.createTopupForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const data = new FormData(elements.createTopupForm);
  try {
    const result = await api("/api/admin/topup-cards", {
      method: "POST",
      body: JSON.stringify({ amount: Number(data.get("amount")), label: data.get("label"), email: data.get("email") })
    });
    showCard(result, "Guthabenkarte erstellt", `sheetify-guthaben-${result.card.credits}`);
    const notice = emailDeliveryNotice(result.emailDelivery);
    if (notice) toast(notice.trim());
  } catch (error) { toast(error.message); }
});

elements.passList.addEventListener("click", async (event) => {
  const row = event.target.closest("[data-pass-id]");
  const button = event.target.closest("button");
  if (!row || !button) return;
  const passId = row.dataset.passId;
  try {
    if (button.dataset.grant) {
      const result = await api(`/api/admin/passes/${encodeURIComponent(passId)}/grant`, { method: "POST", body: JSON.stringify({ amount: Number(button.dataset.grant) }) });
      toast(`${button.dataset.grant} Entwurfsseiten gutgeschrieben.${emailDeliveryNotice(result.emailDelivery)}`);
    } else if (button.dataset.toggleStatus) {
      await api(`/api/admin/passes/${encodeURIComponent(passId)}`, { method: "PATCH", body: JSON.stringify({ status: button.dataset.toggleStatus }) });
    } else if (button.hasAttribute("data-rotate")) {
      if (!confirm("Passcode erneuern und alle verbundenen Geräte abmelden?")) return;
      const result = await api(`/api/admin/passes/${encodeURIComponent(passId)}/rotate`, { method: "POST", body: JSON.stringify({ revokeSessions: true }) });
      showCard(result, "Neuer Sheetify IMG Pass", `sheetify-img-pass-${passId}`);
      const notice = emailDeliveryNotice(result.emailDelivery);
      if (notice) toast(notice.trim());
    }
    await loadOverview();
  } catch (error) { toast(error.message); }
});

elements.requestList.addEventListener("click", async (event) => {
  const row = event.target.closest("[data-request-id]");
  const button = event.target.closest("button");
  if (!row || !button) return;
  const requestId = row.dataset.requestId;
  try {
    if (button.hasAttribute("data-create-recovery")) {
      const recovery = await api(`/api/admin/requests/${encodeURIComponent(requestId)}/recovery-link`, {
        method: "POST",
        body: "{}"
      });
      state.recoveryLinks.set(requestId, recovery);
      await copyText(recovery.url);
      renderRequests();
      toast("Wiederherstellungslink erstellt und kopiert.");
      return;
    }
    if (button.hasAttribute("data-copy-link")) {
      await copyText(state.recoveryLinks.get(requestId)?.url || "");
      toast("Link kopiert.");
      return;
    }
    if (button.dataset.requestStatus) {
      await api(`/api/admin/requests/${encodeURIComponent(requestId)}`, {
        method: "PATCH",
        body: JSON.stringify({ status: button.dataset.requestStatus })
      });
      await loadOverview();
    }
  } catch (error) { toast(error.message); }
});

elements.downloadSvg.addEventListener("click", () => {
  if (!state.cardSvg) return;
  const link = document.createElement("a");
  link.href = URL.createObjectURL(new Blob([state.cardSvg], { type: "image/svg+xml" }));
  link.download = `${state.cardName}.svg`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
});

elements.downloadPng.addEventListener("click", () => {
  if (!state.cardPngDataUrl) return;
  const link = document.createElement("a");
  link.href = state.cardPngDataUrl;
  link.download = `${state.cardName}.png`;
  link.click();
});

elements.refreshPasses.addEventListener("click", () => loadOverview().catch((error) => toast(error.message)));
elements.refreshRequests.addEventListener("click", () => loadOverview().catch((error) => toast(error.message)));
loadOverview().catch((error) => toast(error.message));
