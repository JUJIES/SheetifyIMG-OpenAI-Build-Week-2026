"use strict";

const dns = require("node:dns").promises;
const net = require("node:net");

function normalizeIp(value) {
  return String(value || "").trim().replace(/^::ffff:/i, "").toLowerCase();
}

function normalizeHostname(value) {
  return String(value || "").trim().replace(/\.$/, "").toLowerCase();
}

function isLoopbackAddress(value) {
  const address = normalizeIp(value);
  return address === "127.0.0.1" || address === "::1";
}

function createForwardEmailWebhookVerifier(options = {}) {
  const reverse = options.reverse || dns.reverse;
  const lookup = options.lookup || dns.lookup;
  const allowedHosts = new Set((options.allowedHosts || [
    "mx1.forwardemail.net",
    "mx2.forwardemail.net"
  ]).map(normalizeHostname).filter(Boolean));
  const allowLoopback = options.allowLoopback === true;

  return async function verifyForwardEmailSource(sourceAddress) {
    const address = normalizeIp(sourceAddress);
    if (allowLoopback && isLoopbackAddress(address)) {
      return true;
    }
    if (!net.isIP(address)) {
      return false;
    }

    let reverseNames;
    try {
      reverseNames = await reverse(address);
    } catch {
      return false;
    }

    for (const reverseName of reverseNames || []) {
      const hostname = normalizeHostname(reverseName);
      if (!allowedHosts.has(hostname)) {
        continue;
      }
      try {
        const addresses = await lookup(hostname, { all: true, verbatim: true });
        if (addresses.some((entry) => normalizeIp(entry.address) === address)) {
          return true;
        }
      } catch {
        // A transient DNS failure leaves the webhook unauthenticated.
      }
    }
    return false;
  };
}

function emailAddress(value) {
  if (!value) {
    return null;
  }
  if (Array.isArray(value)) {
    return value.map(emailAddress).find(Boolean) || null;
  }
  if (typeof value === "object") {
    return emailAddress(value.value)
      || emailAddress(value.address)
      || emailAddress(value.text)
      || emailAddress(value.mailFrom);
  }
  const text = String(value).trim();
  const bracketed = text.match(/<([^<>\s]+@[^<>\s]+)>/);
  const candidate = (bracketed?.[1] || text).trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(candidate) ? candidate : null;
}

function senderName(value) {
  if (!value) {
    return "";
  }
  if (Array.isArray(value)) {
    return value.map(senderName).find(Boolean) || "";
  }
  if (typeof value === "object") {
    if (value.name) {
      return String(value.name).trim();
    }
    return senderName(value.value);
  }
  const text = String(value).trim();
  const bracketIndex = text.lastIndexOf("<");
  return bracketIndex > 0 ? text.slice(0, bracketIndex).replace(/^['"]|['"]$/g, "").trim() : "";
}

function forwardedEmailRequest(payload = {}) {
  const from = payload.from || payload.sender || payload.session?.envelope?.mailFrom || null;
  const replyTo = payload.replyTo || payload.reply_to || null;
  const email = emailAddress(replyTo) || emailAddress(from);
  if (!email) {
    return null;
  }
  const text = typeof payload.text === "string" ? payload.text.trim() : "";
  const htmlOnly = !text && Boolean(payload.html);
  const attachments = Array.isArray(payload.attachments)
    ? payload.attachments.map((entry) => entry?.filename || entry?.name || "Anhang").filter(Boolean)
    : [];
  const messageId = String(payload.messageId || payload.message_id || "").trim();
  const receivedAt = payload.date || payload.session?.arrivalDate || "";
  const fallbackId = receivedAt
    ? [email, payload.subject, receivedAt].filter(Boolean).join("|")
    : "";

  return {
    source: "email",
    kind: "email",
    email,
    name: senderName(from),
    subject: String(payload.subject || "E-Mail an SheetifyIMG"),
    message: text || (htmlOnly
      ? "Diese Nachricht enthält nur HTML. Den vollständigen Inhalt bitte im Proton-Postfach öffnen."
      : "Diese Nachricht enthält keinen Text."),
    attachments,
    sourceId: messageId || fallbackId || null
  };
}

module.exports = {
  createForwardEmailWebhookVerifier,
  forwardedEmailRequest,
  normalizeHostname,
  normalizeIp
};
