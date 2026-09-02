import express from "express";
import cors from "cors";
import helmet from "helmet";
import { config } from "./config";
import { authRouter } from "./routes/auth";
import { dashboardRouter } from "./routes/dashboard";
import { clientsRouter } from "./routes/clients";
import { ordersRouter } from "./routes/orders";
import { invoicesRouter } from "./routes/invoices";
import { agentsRouter } from "./routes/agents";
import { remindersRouter } from "./routes/reminders";
import { notificationsRouter } from "./routes/notifications";
import { announcementsRouter } from "./routes/announcements";
import { publicRouter } from "./routes/public";
import { startReminderWorker } from "./worker/reminders";

const app = express();
app.set("trust proxy", 1);
// crossOriginResourcePolicy is relaxed to cross-origin since the frontend
// (app.ajcb.com.ph) and this API (api.ajcb.com.ph) are deliberately on
// different subdomains — the default same-origin policy would otherwise
// block the frontend from loading receipts/attachments/documents.
app.use(helmet({ crossOriginResourcePolicy: { policy: "cross-origin" } }));
app.use(cors({ origin: config.corsOrigin === "*" ? true : config.corsOrigin.split(",") }));
app.use(express.json({ limit: "256kb" }));

app.get("/health", (_req, res) => res.json({ ok: true }));

app.use("/auth", authRouter);
app.use("/dashboard", dashboardRouter);
app.use("/clients", clientsRouter);
app.use("/orders", ordersRouter);
app.use("/invoices", invoicesRouter);
app.use("/agents", agentsRouter);
app.use("/reminders", remindersRouter);
app.use("/notifications", notificationsRouter);
app.use("/announcements", announcementsRouter);
app.use("/", publicRouter); // GET/POST /u/:token

// Final error handler — never leak internals.
app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  if (err?.type === "entity.too.large" || err?.code === "LIMIT_FILE_SIZE")
    return res.status(413).json({ error: `File too large (max ${config.maxUploadMb} MB)` });
  console.error(err);
  res.status(500).json({ error: "Something went wrong on our side. Try again." });
});

app.listen(config.port, () => {
  console.log(`OrderFlow API listening on :${config.port}`);
  startReminderWorker();
});
