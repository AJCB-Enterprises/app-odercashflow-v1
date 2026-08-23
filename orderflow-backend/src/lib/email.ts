import nodemailer, { Transporter } from "nodemailer";
import { config } from "../config";

let transporter: Transporter | null = null;
if (config.smtpUrl) transporter = nodemailer.createTransport(config.smtpUrl);

export interface SentMail {
  providerId: string;
}

/**
 * Send an email. With SMTP_URL unset (dev), the message is printed to the
 * console instead — link included — so the whole flow is testable locally.
 * Never log message bodies in production: reminder emails contain upload links.
 */
export const sendMail = async (to: string, subject: string, text: string): Promise<SentMail> => {
  if (!transporter) {
    console.log(`\n--- EMAIL (dev console transport) ---\nTo: ${to}\nSubject: ${subject}\n\n${text}\n--- END EMAIL ---\n`);
    return { providerId: "console" };
  }
  const info = await transporter.sendMail({ from: config.mailFrom, to, subject, text });
  return { providerId: info.messageId || "smtp" };
};

/** Render {{placeholder}} templates. Unknown placeholders are left intact. */
export const renderTemplate = (tpl: string, vars: Record<string, string>) =>
  tpl.replace(/\{\{(\w+)\}\}/g, (m, key) => (key in vars ? vars[key] : m));
