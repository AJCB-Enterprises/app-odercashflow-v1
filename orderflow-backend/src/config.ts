import "dotenv/config";

const req = (key: string): string => {
  const v = process.env[key];
  if (!v) throw new Error(`Missing required env var ${key} (see .env.example)`);
  return v;
};

export const config = {
  databaseUrl: req("DATABASE_URL"),
  jwtSecret: req("JWT_SECRET"),
  jwtExpires: process.env.JWT_EXPIRES || "12h",
  port: Number(process.env.PORT || 4000),
  publicBaseUrl: process.env.PUBLIC_BASE_URL || "http://localhost:4000",
  uploadDir: process.env.UPLOAD_DIR || "./data/receipts",
  maxUploadMb: Number(process.env.MAX_UPLOAD_MB || 10),
  smtpUrl: process.env.SMTP_URL || "",
  resendApiKey: process.env.RESEND_API_KEY || "",
  mailFrom: process.env.MAIL_FROM || "OrderFlow Billing <billing@example.com>",
  appTz: process.env.APP_TZ || "Asia/Manila",
  tokenTtlDays: Number(process.env.TOKEN_TTL_DAYS || 30),
  corsOrigin: process.env.CORS_ORIGIN || "*",
};
