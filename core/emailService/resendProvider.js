"use strict";

const { Resend } = require("resend");

class EmailDeliveryError extends Error {
  constructor(message, options = {}) {
    super(message);
    this.name = "EmailDeliveryError";
    this.code = options.code || "email_delivery_failed";
  }
}

function createResendProvider(options = {}) {
  const apiKey = String(options.apiKey || "").trim();
  if (!apiKey) throw new Error("RESEND_API_KEY is required to create the Resend provider.");
  const client = options.client || new Resend(apiKey);
  return Object.freeze({
    name: "resend",
    async send(message) {
      const { data, error } = await client.emails.send({
        from: message.from,
        to: [message.to],
        replyTo: message.replyTo,
        subject: message.subject,
        html: message.html,
        text: message.text,
        attachments: message.attachments
      }, message.idempotencyKey ? { idempotencyKey: message.idempotencyKey } : undefined);
      if (error || !data?.id) {
        throw new EmailDeliveryError("Resend rejected the email request.", {
          code: String(error?.name || error?.statusCode || "resend_rejected")
        });
      }
      return { provider: "resend", id: data.id };
    }
  });
}

module.exports = {
  EmailDeliveryError,
  createResendProvider
};
