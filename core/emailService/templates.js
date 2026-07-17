"use strict";

const { localeTag, normalizeLocale } = require("../locale");

const BRAND = Object.freeze({
  background: "#f4f1eb",
  card: "#fffdf8",
  ink: "#25221f",
  muted: "#6f6962",
  accent: "#df6c4f",
  accentDark: "#b94f36",
  blue: "#1f63d6"
});

const EMAIL_MESSAGES = Object.freeze({
  de: Object.freeze({
    greeting: (name) => name ? `Hallo ${name},` : "Hallo,",
    signoff: "Viele Grüße",
    invitation: Object.freeze({
      workspaceFallback: "dein SheetifyIMG-Arbeitsbereich",
      subject: "Dein Zugang zur SheetifyIMG Beta",
      preheader: "Dein SheetifyIMG Pass ist bereit.",
      title: "Willkommen in der SheetifyIMG Beta",
      ready: (workspace) => `dein Zugang für ${workspace} ist bereit.`,
      passLabel: "SheetifyIMG Pass",
      open: "SheetifyIMG öffnen",
      keepSafe: "Bewahre den Pass gut auf. Er verbindet Geräte mit demselben Arbeitsbereich.",
      cardAlt: "Dein SheetifyIMG Beta Pass"
    }),
    topup: Object.freeze({
      subject: (amount) => `Deine SheetifyIMG Guthabenkarte: ${amount} Entwurfsseiten`,
      preheader: (amount) => `${amount} Entwurfsseiten für SheetifyIMG.`,
      title: "Deine SheetifyIMG Guthabenkarte",
      intro: (amount) => `hier ist deine Guthabenkarte über ${amount} Entwurfsseiten.`,
      htmlIntro: (amount) => `Hier sind <strong>${amount} Entwurfsseiten</strong> zum Einlösen in SheetifyIMG.`,
      codeLabel: "Guthabencode",
      open: "Guthaben einlösen",
      openText: "In SheetifyIMG einlösen",
      singleUse: "Der Code ist einmal einlösbar.",
      cardAlt: "Deine SheetifyIMG Guthabenkarte"
    }),
    activated: Object.freeze({
      workspaceFallback: "Dein SheetifyIMG-Arbeitsbereich",
      subject: "Dein SheetifyIMG Pass ist aktiviert",
      preheader: "Dein SheetifyIMG-Arbeitsbereich ist verbunden.",
      title: "SheetifyIMG ist bereit",
      ready: (workspace) => `${workspace} ist jetzt verbunden und einsatzbereit.`,
      open: "Arbeitsbereich öffnen",
      openText: "SheetifyIMG öffnen"
    }),
    support: Object.freeze({
      subject: "Deine Nachricht an SheetifyIMG ist angekommen",
      preheader: "Wir haben deine Nachricht erhalten.",
      title: "Nachricht erhalten",
      received: "vielen Dank für deine Nachricht. Sie ist bei uns angekommen und wir melden uns, wenn eine Antwort nötig ist.",
      reference: "Referenz"
    }),
    recovery: Object.freeze({
      workspaceFallback: "dein SheetifyIMG-Arbeitsbereich",
      subject: "Dein SheetifyIMG Wiederherstellungslink",
      preheader: "Verbinde deinen SheetifyIMG-Arbeitsbereich wieder.",
      title: "Arbeitsbereich wiederherstellen",
      intro: (workspace) => `mit diesem einmaligen Link verbindest du ein neues Gerät wieder mit ${workspace}:`,
      htmlIntro: (workspace) => `Mit diesem einmaligen Link verbindest du ein neues Gerät wieder mit <strong>${workspace}</strong>.`,
      open: "Arbeitsbereich wiederherstellen",
      expiry: (date) => date
        ? `Der Link ist bis ${date} gültig und kann nur einmal verwendet werden.`
        : "Der Link ist zeitlich begrenzt und kann nur einmal verwendet werden.",
      ignore: "Falls du die Wiederherstellung nicht angefordert hast, kannst du diese Nachricht ignorieren."
    }),
    credit: Object.freeze({
      subject: "Dein SheetifyIMG-Guthaben wurde erweitert",
      preheader: (amount) => `${amount} neue Entwurfsseiten für deinen Arbeitsbereich.`,
      title: "Neues Entwurfsguthaben",
      granted: (amount, balance) => `dir wurden ${amount} Entwurfsseiten gutgeschrieben.${Number.isSafeInteger(balance) ? ` Dein neues Guthaben: ${balance}.` : ""}`,
      htmlGranted: (amount, balance) => `Dir wurden <strong>${amount} Entwurfsseiten</strong> gutgeschrieben.${Number.isSafeInteger(balance) ? ` Dein neues Guthaben beträgt <strong>${balance}</strong>.` : ""}`
    })
  }),
  en: Object.freeze({
    greeting: (name) => name ? `Hello ${name},` : "Hello,",
    signoff: "Best wishes",
    invitation: Object.freeze({
      workspaceFallback: "your SheetifyIMG workspace",
      subject: "Your access to the SheetifyIMG Beta",
      preheader: "Your SheetifyIMG Pass is ready.",
      title: "Welcome to the SheetifyIMG Beta",
      ready: (workspace) => `your access to ${workspace} is ready.`,
      passLabel: "SheetifyIMG Pass",
      open: "Open SheetifyIMG",
      keepSafe: "Keep this pass safe. It connects devices to the same shared workspace.",
      cardAlt: "Your SheetifyIMG Beta Pass"
    }),
    topup: Object.freeze({
      subject: (amount) => `Your SheetifyIMG credit voucher: ${amount} draft pages`,
      preheader: (amount) => `${amount} draft pages for SheetifyIMG.`,
      title: "Your SheetifyIMG credit voucher",
      intro: (amount) => `here is your credit voucher for ${amount} draft pages.`,
      htmlIntro: (amount) => `Here are <strong>${amount} draft pages</strong> to redeem in SheetifyIMG.`,
      codeLabel: "Credit code",
      open: "Redeem credit",
      openText: "Redeem in SheetifyIMG",
      singleUse: "The code can only be redeemed once.",
      cardAlt: "Your SheetifyIMG credit voucher"
    }),
    activated: Object.freeze({
      workspaceFallback: "Your SheetifyIMG workspace",
      subject: "Your SheetifyIMG Pass is active",
      preheader: "Your SheetifyIMG workspace is connected.",
      title: "SheetifyIMG is ready",
      ready: (workspace) => `${workspace} is now connected and ready to use.`,
      open: "Open workspace",
      openText: "Open SheetifyIMG"
    }),
    support: Object.freeze({
      subject: "We received your message to SheetifyIMG",
      preheader: "We received your message.",
      title: "Message received",
      received: "thank you for your message. We have received it and will get back to you if a reply is needed.",
      reference: "Reference"
    }),
    recovery: Object.freeze({
      workspaceFallback: "your SheetifyIMG workspace",
      subject: "Your SheetifyIMG recovery link",
      preheader: "Reconnect your SheetifyIMG workspace.",
      title: "Recover your workspace",
      intro: (workspace) => `use this one-time link to reconnect a new device to ${workspace}:`,
      htmlIntro: (workspace) => `Use this one-time link to reconnect a new device to <strong>${workspace}</strong>.`,
      open: "Recover workspace",
      expiry: (date) => date
        ? `The link is valid until ${date} and can only be used once.`
        : "The link is time-limited and can only be used once.",
      ignore: "If you did not request this recovery link, you can ignore this message."
    }),
    credit: Object.freeze({
      subject: "Your SheetifyIMG credit has been increased",
      preheader: (amount) => `${amount} new draft pages for your workspace.`,
      title: "New draft credit",
      granted: (amount, balance) => `${amount} draft pages have been added to your workspace.${Number.isSafeInteger(balance) ? ` Your new balance is ${balance}.` : ""}`,
      htmlGranted: (amount, balance) => `<strong>${amount} draft pages</strong> have been added to your workspace.${Number.isSafeInteger(balance) ? ` Your new balance is <strong>${balance}</strong>.` : ""}`
    })
  })
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

function templateContext(input = {}) {
  const locale = normalizeLocale(input.locale);
  return { locale, messages: EMAIL_MESSAGES[locale] };
}

function greeting(name, messages) {
  return messages.greeting(cleanText(name));
}

function formattedExpiry(value, locale) {
  const date = new Date(cleanText(value));
  if (!Number.isFinite(date.getTime())) return "";
  return new Intl.DateTimeFormat(localeTag(locale), {
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
  return `<span style="color:${BRAND.ink};font-size:18px;font-weight:800;letter-spacing:-.05em">Sheetify</span><span style="color:${BRAND.blue};font-size:20px;font-weight:850;letter-spacing:-.005em">IMG</span>`;
}

function layout({ locale, messages, preheader, title, bodyHtml }) {
  return `<!doctype html>
<html lang="${locale}">
  <head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
  <body style="margin:0;background:${BRAND.background};color:${BRAND.ink};font-family:Inter,Segoe UI,Arial,sans-serif">
    <div style="display:none;max-height:0;overflow:hidden;opacity:0">${escapeHtml(preheader)}</div>
    <div style="padding:36px 16px">
      <main style="max-width:600px;margin:0 auto;padding:34px;border:1px solid #e5ddd2;border-radius:18px;background:${BRAND.card}">
        <div style="margin-bottom:24px">${brandWordmark()}</div>
        <h1 style="margin:0 0 20px;font-size:28px;line-height:1.2">${escapeHtml(title)}</h1>
        <div style="font-size:16px;line-height:1.65">${bodyHtml}</div>
        <p style="margin:30px 0 0;color:${BRAND.muted};font-size:14px">${escapeHtml(messages.signoff)}<br>SheetifyIMG</p>
      </main>
    </div>
  </body>
</html>`;
}

function betaInvitationTemplate(input = {}) {
  const { locale, messages } = templateContext(input);
  const copy = messages.invitation;
  const name = cleanText(input.name);
  const workspaceName = cleanText(input.workspaceName, copy.workspaceFallback);
  const passCode = cleanText(input.passCode);
  const appUrl = cleanText(input.appUrl);
  if (!passCode) throw new Error("passCode is required for a beta invitation.");
  return {
    subject: copy.subject,
    text: `${greeting(name, messages)}\n\n${copy.ready(workspaceName)}\n\n${copy.passLabel}: ${passCode}${appUrl ? `\n\n${copy.open}: ${appUrl}` : ""}\n\n${copy.keepSafe}\n\n${messages.signoff}\nSheetifyIMG`,
    html: layout({
      locale,
      messages,
      preheader: copy.preheader,
      title: copy.title,
      bodyHtml: `<p>${escapeHtml(greeting(name, messages))}</p><p>${escapeHtml(copy.ready(workspaceName))}</p>${cardImage(input.cardContentId, copy.cardAlt)}<p style="padding:16px;border-radius:12px;background:#f3eee6;font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-size:18px;font-weight:800;letter-spacing:.04em">${escapeHtml(passCode)}</p>${button(copy.open, appUrl)}<p style="color:${BRAND.muted}">${escapeHtml(copy.keepSafe)}</p>`
    })
  };
}

function topupCardTemplate(input = {}) {
  const { locale, messages } = templateContext(input);
  const copy = messages.topup;
  const name = cleanText(input.name);
  const amount = Number(input.amount);
  const topupCode = cleanText(input.topupCode);
  const appUrl = cleanText(input.appUrl);
  if (!Number.isSafeInteger(amount) || amount <= 0) throw new Error("amount must be a positive integer.");
  if (!topupCode) throw new Error("topupCode is required for a top-up card.");
  return {
    subject: copy.subject(amount),
    text: `${greeting(name, messages)}\n\n${copy.intro(amount)}\n\n${copy.codeLabel}: ${topupCode}${appUrl ? `\n\n${copy.openText}: ${appUrl}` : ""}\n\n${copy.singleUse}\n\n${messages.signoff}\nSheetifyIMG`,
    html: layout({
      locale,
      messages,
      preheader: copy.preheader(amount),
      title: copy.title,
      bodyHtml: `<p>${escapeHtml(greeting(name, messages))}</p><p>${copy.htmlIntro(amount)}</p>${cardImage(input.cardContentId, copy.cardAlt)}<p style="padding:16px;border-radius:12px;background:#f3eee6;font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-size:18px;font-weight:800;letter-spacing:.04em">${escapeHtml(topupCode)}</p>${button(copy.open, appUrl)}<p style="color:${BRAND.muted}">${escapeHtml(copy.singleUse)}</p>`
    })
  };
}

function betaPassActivatedTemplate(input = {}) {
  const { locale, messages } = templateContext(input);
  const copy = messages.activated;
  const name = cleanText(input.name);
  const workspaceName = cleanText(input.workspaceName, copy.workspaceFallback);
  const appUrl = cleanText(input.appUrl);
  return {
    subject: copy.subject,
    text: `${greeting(name, messages)}\n\n${copy.ready(workspaceName)}${appUrl ? `\n\n${copy.openText}: ${appUrl}` : ""}\n\n${messages.signoff}\nSheetifyIMG`,
    html: layout({
      locale,
      messages,
      preheader: copy.preheader,
      title: copy.title,
      bodyHtml: `<p>${escapeHtml(greeting(name, messages))}</p><p><strong>${escapeHtml(workspaceName)}</strong> ${escapeHtml(copy.ready("").trim())}</p>${button(copy.open, appUrl)}`
    })
  };
}

function supportConfirmationTemplate(input = {}) {
  const { locale, messages } = templateContext(input);
  const copy = messages.support;
  const name = cleanText(input.name);
  const requestId = cleanText(input.requestId);
  return {
    subject: copy.subject,
    text: `${greeting(name, messages)}\n\n${copy.received}${requestId ? `\n\n${copy.reference}: ${requestId}` : ""}\n\n${messages.signoff}\nSheetifyIMG`,
    html: layout({
      locale,
      messages,
      preheader: copy.preheader,
      title: copy.title,
      bodyHtml: `<p>${escapeHtml(greeting(name, messages))}</p><p>${escapeHtml(copy.received)}</p>${requestId ? `<p style="color:${BRAND.muted};font-size:14px">${escapeHtml(copy.reference)}: ${escapeHtml(requestId)}</p>` : ""}`
    })
  };
}

function recoveryLinkTemplate(input = {}) {
  const { locale, messages } = templateContext(input);
  const copy = messages.recovery;
  const name = cleanText(input.name);
  const workspaceName = cleanText(input.workspaceName, copy.workspaceFallback);
  const recoveryUrl = cleanText(input.recoveryUrl);
  const expiresAt = formattedExpiry(input.expiresAt, locale);
  if (!recoveryUrl) throw new Error("recoveryUrl is required for a recovery email.");
  const expiryText = copy.expiry(expiresAt);
  return {
    subject: copy.subject,
    text: `${greeting(name, messages)}\n\n${copy.intro(workspaceName)}\n\n${recoveryUrl}\n\n${expiryText}\n\n${copy.ignore}\n\n${messages.signoff}\nSheetifyIMG`,
    html: layout({
      locale,
      messages,
      preheader: copy.preheader,
      title: copy.title,
      bodyHtml: `<p>${escapeHtml(greeting(name, messages))}</p><p>${copy.htmlIntro(escapeHtml(workspaceName))}</p>${button(copy.open, recoveryUrl)}<p style="color:${BRAND.muted}">${escapeHtml(expiryText)}</p><p style="color:${BRAND.muted}">${escapeHtml(copy.ignore)}</p>`
    })
  };
}

function creditGrantedTemplate(input = {}) {
  const { locale, messages } = templateContext(input);
  const copy = messages.credit;
  const name = cleanText(input.name);
  const amount = Number(input.amount);
  const balance = Number(input.balance);
  if (!Number.isSafeInteger(amount) || amount <= 0) throw new Error("amount must be a positive integer.");
  return {
    subject: copy.subject,
    text: `${greeting(name, messages)}\n\n${copy.granted(amount, balance)}\n\n${messages.signoff}\nSheetifyIMG`,
    html: layout({
      locale,
      messages,
      preheader: copy.preheader(amount),
      title: copy.title,
      bodyHtml: `<p>${escapeHtml(greeting(name, messages))}</p><p>${copy.htmlGranted(amount, balance)}</p>`
    })
  };
}

module.exports = {
  EMAIL_MESSAGES,
  betaInvitationTemplate,
  betaPassActivatedTemplate,
  creditGrantedTemplate,
  recoveryLinkTemplate,
  topupCardTemplate,
  supportConfirmationTemplate
};
