import { config } from "../config";

/**
 * Settings that are legal but weaker than they should be on a real deployment.
 * Logged at startup (visible in Railway's logs) rather than refused, so a
 * deploy never fails because of one.
 */
export const startupWarnings = (c: Pick<typeof config, "jwtSecret" | "corsOrigin" | "resendApiKey" | "smtpUrl">): string[] => {
  const warnings: string[] = [];
  if (c.jwtSecret.length < 32)
    warnings.push("JWT_SECRET is shorter than 32 characters — use a long random value.");
  if (c.corsOrigin.trim() === "*")
    warnings.push("CORS_ORIGIN is unset or '*' — set it to this deployment's frontend URL.");
  if (!c.resendApiKey && !c.smtpUrl)
    warnings.push("No email provider is configured (RESEND_API_KEY / SMTP_URL) — emails are printed to this log, including upload links, instead of being sent.");
  return warnings;
};
