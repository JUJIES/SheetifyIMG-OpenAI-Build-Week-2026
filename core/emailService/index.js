"use strict";

const { createResendProvider } = require("./resendProvider");
const {
  betaInvitationTemplate,
  betaPassActivatedTemplate,
  creditGrantedTemplate,
  topupCardTemplate,
  supportConfirmationTemplate
} = require("./templates");

const DEFAULT_FROM = "Sheetify <sheetify@jujies.app>";
const DEFAULT_REPLY_TO = "sheetify@jujies.app";

function emailAddress(value, name = "email") {
  const email = String(value || "").trim().toLowerCase();
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error(`${name} must be a valid email address.`);
  }
  return email;
}

function idempotencyKey(value) {
  const key = String(value || "").trim();
  if (!key) return undefined;
  if (key.length > 256 || !/^[a-zA-Z0-9._:-]+$/.test(key)) {
    throw new Error("idempotencyKey contains unsupported characters.");
  }
  return key;
}

function emailAttachments(value) {
  if (!value) return undefined;
  if (!Array.isArray(value) || value.length > 4) throw new Error("attachments must be an array with at most four files.");
  return value.map((attachment) => {
    const filename = String(attachment?.filename || "").trim();
    if (!filename || filename.length > 160 || /[\\/]/.test(filename)) throw new Error("attachment filename is invalid.");
    if (!Buffer.isBuffer(attachment.content) && typeof attachment.content !== "string") {
      throw new Error("attachment content must be a Buffer or string.");
    }
    return {
      filename,
      content: attachment.content,
      contentType: String(attachment.contentType || "application/octet-stream"),
      ...(attachment.contentId ? { contentId: String(attachment.contentId) } : {})
    };
  });
}

function createEmailService(options = {}) {
  const apiKey = String(options.apiKey || "").trim();
  const provider = options.provider || (apiKey ? createResendProvider({ apiKey, client: options.resendClient }) : null);
  const from = String(options.from || DEFAULT_FROM).trim();
  const replyTo = emailAddress(options.replyTo || DEFAULT_REPLY_TO, "replyTo");
  const publicUrl = String(options.publicUrl || "").trim().replace(/\/+$/, "");

  async function sendTemplate(email, template, options = {}) {
    const to = emailAddress(email);
    if (!provider) {
      return { status: "disabled", provider: null };
    }
    const delivery = await provider.send({
      from,
      to,
      replyTo,
      subject: template.subject,
      html: template.html,
      text: template.text,
      attachments: emailAttachments(options.attachments),
      idempotencyKey: idempotencyKey(options.idempotencyKey)
    });
    return { status: "sent", provider: delivery.provider, id: delivery.id };
  }

  function requireConfigured() {
    if (!provider) {
      throw new Error("Outbound email is not configured. Set RESEND_API_KEY on the server.");
    }
  }

  return Object.freeze({
    configured: Boolean(provider),
    providerName: provider?.name || null,
    from,
    replyTo,
    requireConfigured,
    sendBetaInvitation(input = {}) {
      return sendTemplate(input.email, betaInvitationTemplate({
        name: input.name,
        workspaceName: input.workspaceName,
        passCode: input.passCode,
        appUrl: input.appUrl || publicUrl,
        cardContentId: input.cardContentId
      }), input);
    },
    sendBetaPassActivated(input = {}) {
      return sendTemplate(input.email, betaPassActivatedTemplate({
        name: input.name,
        workspaceName: input.workspaceName,
        appUrl: input.appUrl || publicUrl
      }), input);
    },
    sendCreditGranted(input = {}) {
      return sendTemplate(input.email, creditGrantedTemplate(input), input);
    },
    sendTopupCard(input = {}) {
      return sendTemplate(input.email, topupCardTemplate({
        name: input.name,
        amount: input.amount,
        topupCode: input.topupCode,
        appUrl: input.appUrl || publicUrl,
        cardContentId: input.cardContentId
      }), input);
    },
    sendSupportConfirmation(input = {}) {
      return sendTemplate(input.email, supportConfirmationTemplate(input), input);
    }
  });
}

module.exports = {
  DEFAULT_FROM,
  DEFAULT_REPLY_TO,
  createEmailService
};
