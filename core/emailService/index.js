"use strict";

const { createResendProvider } = require("./resendProvider");
const {
  betaInvitationTemplate,
  betaPassActivatedTemplate,
  creditGrantedTemplate,
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
        appUrl: input.appUrl || publicUrl
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
