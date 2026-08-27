import nodemailer, { Transporter } from "nodemailer";
import { config } from "../config";

let transporter: Transporter | null = null;
if (config.smtpUrl) transporter = nodemailer.createTransport(config.smtpUrl);

export interface SentMail {
  providerId: string;
}

/**
 * Send an email. Prefers Resend's HTTPS API (RESEND_API_KEY) — many hosts,
 * Railway included, block outbound SMTP entirely, so raw SMTP (SMTP_URL) is
 * kept only as a fallback for providers/hosts where it actually works. With
 * neither set (dev), the message is printed to the console instead — link
 * included — so the whole flow is testable locally. Never log message bodies
 * in production: reminder emails contain upload links.
 */
export const sendMail = async (to: string, subject: string, text: string): Promise<SentMail> => {
  if (config.resendApiKey) {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${config.resendApiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: config.mailFrom, to, subject, text }),
    });
    if (!res.ok) throw new Error(`Resend API error ${res.status}: ${await res.text().catch(() => "")}`);
    const data = (await res.json()) as { id?: string };
    return { providerId: data.id || "resend" };
  }
  if (transporter) {
    const info = await transporter.sendMail({ from: config.mailFrom, to, subject, text });
    return { providerId: info.messageId || "smtp" };
  }
  console.log(`\n--- EMAIL (dev console transport) ---\nTo: ${to}\nSubject: ${subject}\n\n${text}\n--- END EMAIL ---\n`);
  return { providerId: "console" };
};

/** Render {{placeholder}} templates. Unknown placeholders are left intact. */
export const renderTemplate = (tpl: string, vars: Record<string, string>) =>
  tpl.replace(/\{\{(\w+)\}\}/g, (m, key) => (key in vars ? vars[key] : m));
