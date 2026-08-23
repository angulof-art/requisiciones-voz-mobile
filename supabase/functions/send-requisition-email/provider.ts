import { HttpError } from "./validation.ts";

export class ResendEmailProvider {
  private apiKey = String(Deno.env.get("RESEND_API_KEY") || "");
  private from = String(Deno.env.get("REQUISITION_EMAIL_FROM") || "");
  private replyTo = String(Deno.env.get("REQUISITION_EMAIL_REPLY_TO") || "");

  configured() {
    return Boolean(this.apiKey && this.from);
  }

  async sendEmail(message: { to: string[]; cc: string[]; bcc: string[]; subject: string; html: string; idempotencyKey: string }) {
    if (!this.configured()) {
      throw new HttpError(503, "provider_not_configured", "El proveedor de correo todavia no esta configurado.");
    }
    const payload: Record<string, unknown> = { from: this.from, to: message.to, subject: message.subject, html: message.html };
    if (message.cc.length) payload.cc = message.cc;
    if (message.bcc.length) payload.bcc = message.bcc;
    if (this.replyTo) payload.reply_to = this.replyTo;
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${this.apiKey}`, "Content-Type": "application/json", "Idempotency-Key": message.idempotencyKey },
      body: JSON.stringify(payload)
    });
    if (!response.ok) throw new HttpError(502, `provider_${response.status}`, "El proveedor no acepto el correo.");
    const data = await response.json();
    return { messageId: String(data?.id || "") };
  }
}
