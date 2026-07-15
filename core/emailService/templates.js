"use strict";

const BRAND = Object.freeze({
  background: "#f4f1eb",
  card: "#fffdf8",
  ink: "#25221f",
  muted: "#6f6962",
  accent: "#df6c4f",
  accentDark: "#b94f36",
  blue: "#1f63d6"
});

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[character]);
}

function cleanText(value, fallback = "") {
  return String(value ?? "").trim() || fallback;
}

function greeting(name) {
  const cleaned = cleanText(name);
  return cleaned ? `Hallo ${cleaned},` : "Hallo,";
}

function formattedExpiry(value) {
  const date = new Date(cleanText(value));
  if (!Number.isFinite(date.getTime())) return "";
  return new Intl.DateTimeFormat("de-DE", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Europe/Berlin"
  }).format(date);
}

function button(label, url) {
  if (!url) return "";
  return `<p style="margin:28px 0"><a href="${escapeHtml(url)}" style="display:inline-block;padding:12px 18px;border-radius:10px;background:${BRAND.accent};color:#fff;text-decoration:none;font-weight:700">${escapeHtml(label)}</a></p>`;
}

function cardImage(contentId, alt) {
  if (!contentId) return "";
  return `<p style="margin:26px 0"><img src="cid:${escapeHtml(contentId)}" alt="${escapeHtml(alt)}" style="display:block;width:100%;height:auto;border-radius:18px"></p>`;
}

function brandWordmark() {
  return `<span style="color:${BRAND.ink};font-size:18px;font-weight:800;letter-spacing:-.05em">Sheetify</span><span style="margin-left:4px;color:${BRAND.blue};font-size:13px;font-weight:850;letter-spacing:.09em">IMG</span>`;
}

function layout({ preheader, title, bodyHtml }) {
  return `<!doctype html>
<html lang="de">
  <head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
  <body style="margin:0;background:${BRAND.background};color:${BRAND.ink};font-family:Inter,Segoe UI,Arial,sans-serif">
    <div style="display:none;max-height:0;overflow:hidden;opacity:0">${escapeHtml(preheader)}</div>
    <div style="padding:36px 16px">
      <main style="max-width:600px;margin:0 auto;padding:34px;border:1px solid #e5ddd2;border-radius:18px;background:${BRAND.card}">
        <div style="margin-bottom:24px">${brandWordmark()}</div>
        <h1 style="margin:0 0 20px;font-size:28px;line-height:1.2">${escapeHtml(title)}</h1>
        <div style="font-size:16px;line-height:1.65">${bodyHtml}</div>
        <p style="margin:30px 0 0;color:${BRAND.muted};font-size:14px">Viele Grüße<br>Sheetify IMG</p>
      </main>
    </div>
  </body>
</html>`;
}

function betaInvitationTemplate(input = {}) {
  const name = cleanText(input.name);
  const workspaceName = cleanText(input.workspaceName, "dein Sheetify-IMG-Arbeitsbereich");
  const passCode = cleanText(input.passCode);
  const appUrl = cleanText(input.appUrl);
  if (!passCode) throw new Error("passCode is required for a beta invitation.");
  return {
    subject: "Dein Zugang zur Sheetify IMG Beta",
    text: `${greeting(name)}\n\ndein Zugang für ${workspaceName} ist bereit.\n\nSheetify IMG Pass: ${passCode}${appUrl ? `\n\nSheetify IMG öffnen: ${appUrl}` : ""}\n\nBewahre den Pass gut auf. Er verbindet Geräte mit demselben Arbeitsbereich.\n\nViele Grüße\nSheetify IMG`,
    html: layout({
      preheader: "Dein Sheetify IMG Pass ist bereit.",
      title: "Willkommen in der Sheetify IMG Beta",
      bodyHtml: `<p>${escapeHtml(greeting(name))}</p><p>dein Zugang für <strong>${escapeHtml(workspaceName)}</strong> ist bereit.</p>${cardImage(input.cardContentId, "Dein Sheetify IMG Beta Pass")}<p style="padding:16px;border-radius:12px;background:#f3eee6;font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-size:18px;font-weight:800;letter-spacing:.04em">${escapeHtml(passCode)}</p>${button("Sheetify IMG öffnen", appUrl)}<p style="color:${BRAND.muted}">Bewahre den Pass gut auf. Er verbindet Geräte mit demselben Arbeitsbereich.</p>`
    })
  };
}

function topupCardTemplate(input = {}) {
  const name = cleanText(input.name);
  const amount = Number(input.amount);
  const topupCode = cleanText(input.topupCode);
  const appUrl = cleanText(input.appUrl);
  if (!Number.isSafeInteger(amount) || amount <= 0) throw new Error("amount must be a positive integer.");
  if (!topupCode) throw new Error("topupCode is required for a top-up card.");
  return {
    subject: `Deine Sheetify IMG Guthabenkarte: ${amount} Entwurfsseiten`,
    text: `${greeting(name)}\n\nhier ist deine Guthabenkarte über ${amount} Entwurfsseiten.\n\nGuthabencode: ${topupCode}${appUrl ? `\n\nIn Sheetify IMG einlösen: ${appUrl}` : ""}\n\nDer Code ist einmal einlösbar.\n\nViele Grüße\nSheetify IMG`,
    html: layout({
      preheader: `${amount} Entwurfsseiten für Sheetify IMG.`,
      title: "Deine Sheetify IMG Guthabenkarte",
      bodyHtml: `<p>${escapeHtml(greeting(name))}</p><p>Hier sind <strong>${amount} Entwurfsseiten</strong> zum Einlösen in Sheetify IMG.</p>${cardImage(input.cardContentId, "Deine Sheetify IMG Guthabenkarte")}<p style="padding:16px;border-radius:12px;background:#f3eee6;font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-size:18px;font-weight:800;letter-spacing:.04em">${escapeHtml(topupCode)}</p>${button("Guthaben einlösen", appUrl)}<p style="color:${BRAND.muted}">Der Code ist einmal einlösbar.</p>`
    })
  };
}

function betaPassActivatedTemplate(input = {}) {
  const name = cleanText(input.name);
  const workspaceName = cleanText(input.workspaceName, "Dein Sheetify-IMG-Arbeitsbereich");
  const appUrl = cleanText(input.appUrl);
  return {
    subject: "Dein Sheetify IMG Pass ist aktiviert",
    text: `${greeting(name)}\n\n${workspaceName} ist jetzt verbunden und einsatzbereit.${appUrl ? `\n\nSheetify IMG öffnen: ${appUrl}` : ""}\n\nViele Grüße\nSheetify IMG`,
    html: layout({
      preheader: "Dein Sheetify-IMG-Arbeitsbereich ist verbunden.",
      title: "Sheetify IMG ist bereit",
      bodyHtml: `<p>${escapeHtml(greeting(name))}</p><p><strong>${escapeHtml(workspaceName)}</strong> ist jetzt verbunden und einsatzbereit.</p>${button("Arbeitsbereich öffnen", appUrl)}`
    })
  };
}

function supportConfirmationTemplate(input = {}) {
  const name = cleanText(input.name);
  const requestId = cleanText(input.requestId);
  return {
    subject: "Deine Nachricht an Sheetify IMG ist angekommen",
    text: `${greeting(name)}\n\nvielen Dank für deine Nachricht. Sie ist bei uns angekommen und wir melden uns, wenn eine Antwort nötig ist.${requestId ? `\n\nReferenz: ${requestId}` : ""}\n\nViele Grüße\nSheetify IMG`,
    html: layout({
      preheader: "Wir haben deine Nachricht erhalten.",
      title: "Nachricht erhalten",
      bodyHtml: `<p>${escapeHtml(greeting(name))}</p><p>vielen Dank für deine Nachricht. Sie ist bei uns angekommen und wir melden uns, wenn eine Antwort nötig ist.</p>${requestId ? `<p style="color:${BRAND.muted};font-size:14px">Referenz: ${escapeHtml(requestId)}</p>` : ""}`
    })
  };
}

function recoveryLinkTemplate(input = {}) {
  const name = cleanText(input.name);
  const workspaceName = cleanText(input.workspaceName, "dein Sheetify-IMG-Arbeitsbereich");
  const recoveryUrl = cleanText(input.recoveryUrl);
  const expiresAt = formattedExpiry(input.expiresAt);
  if (!recoveryUrl) throw new Error("recoveryUrl is required for a recovery email.");
  const expiryText = expiresAt
    ? `Der Link ist bis ${expiresAt} gültig und kann nur einmal verwendet werden.`
    : "Der Link ist zeitlich begrenzt und kann nur einmal verwendet werden.";
  return {
    subject: "Dein Sheetify IMG Wiederherstellungslink",
    text: `${greeting(name)}\n\nmit diesem einmaligen Link verbindest du ein neues Gerät wieder mit ${workspaceName}:\n\n${recoveryUrl}\n\n${expiryText}\n\nFalls du die Wiederherstellung nicht angefordert hast, kannst du diese Nachricht ignorieren.\n\nViele Grüße\nSheetify IMG`,
    html: layout({
      preheader: "Verbinde deinen Sheetify-IMG-Arbeitsbereich wieder.",
      title: "Arbeitsbereich wiederherstellen",
      bodyHtml: `<p>${escapeHtml(greeting(name))}</p><p>Mit diesem einmaligen Link verbindest du ein neues Gerät wieder mit <strong>${escapeHtml(workspaceName)}</strong>.</p>${button("Arbeitsbereich wiederherstellen", recoveryUrl)}<p style="color:${BRAND.muted}">${escapeHtml(expiryText)}</p><p style="color:${BRAND.muted}">Falls du die Wiederherstellung nicht angefordert hast, kannst du diese Nachricht ignorieren.</p>`
    })
  };
}

function creditGrantedTemplate(input = {}) {
  const name = cleanText(input.name);
  const amount = Number(input.amount);
  const balance = Number(input.balance);
  if (!Number.isSafeInteger(amount) || amount <= 0) throw new Error("amount must be a positive integer.");
  return {
    subject: "Dein Sheetify-IMG-Guthaben wurde erweitert",
    text: `${greeting(name)}\n\ndir wurden ${amount} Entwurfsseiten gutgeschrieben.${Number.isSafeInteger(balance) ? ` Dein neues Guthaben: ${balance}.` : ""}\n\nViele Grüße\nSheetify IMG`,
    html: layout({
      preheader: `${amount} neue Entwurfsseiten für deinen Arbeitsbereich.`,
      title: "Neues Entwurfsguthaben",
      bodyHtml: `<p>${escapeHtml(greeting(name))}</p><p>Dir wurden <strong>${amount} Entwurfsseiten</strong> gutgeschrieben.${Number.isSafeInteger(balance) ? ` Dein neues Guthaben beträgt <strong>${balance}</strong>.` : ""}</p>`
    })
  };
}

module.exports = {
  betaInvitationTemplate,
  betaPassActivatedTemplate,
  creditGrantedTemplate,
  recoveryLinkTemplate,
  topupCardTemplate,
  supportConfirmationTemplate
};
