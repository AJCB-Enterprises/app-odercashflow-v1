import { Router } from "express";
import { z } from "zod";
import { one, q } from "../db";
import { requireAdmin, requireAuth } from "../middleware/auth";
import { runReminders } from "../worker/reminders";
import { audit } from "../lib/notify";

export const remindersRouter = Router();
remindersRouter.use(requireAuth, requireAdmin);

/** GET /reminders/settings */
remindersRouter.get("/settings", async (_req, res) => {
  res.json(await q("SELECT * FROM reminder_settings ORDER BY id"));
});

const SettingsBody = z.object({
  days_before: z.number().int().min(0).max(60).optional(),
  frequency_days: z.number().int().min(1).max(30).optional(),
  send_time: z.string().regex(/^\d{2}:\d{2}$/, "send_time must be HH:MM").optional(),
  timezone: z.string().optional(),
  template: z.string().min(1).optional(),
  is_enabled: z.boolean().optional(),
});

/** PUT /reminders/settings/:type — admin edits frequency, timing, template. */
remindersRouter.put("/settings/:type", async (req, res) => {
  const type = req.params.type;
  if (type !== "payment" && type !== "order") return res.status(404).json({ error: "Unknown reminder type" });
  const parsed = SettingsBody.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });
  const fields = Object.entries(parsed.data).filter(([, v]) => v !== undefined);
  if (!fields.length) return res.status(400).json({ error: "Nothing to update" });

  const sets = fields.map(([k], i) => `${k} = $${i + 2}`).join(", ");
  const row = await one(
    `UPDATE reminder_settings SET ${sets}, updated_by = $${fields.length + 2}, updated_at = now()
      WHERE type = $1::reminder_type RETURNING *`,
    [type, ...fields.map(([, v]) => v), req.user!.id]
  );
  await audit(req.user!.id, "reminder_settings.updated", "reminder_settings", String(row!.id), parsed.data);
  res.json(row);
});

/** POST /reminders/run/:type — the admin's "run now" button (ignores the send-time window). */
remindersRouter.post("/run/:type", async (req, res) => {
  const type = req.params.type;
  if (type !== "payment" && type !== "order") return res.status(404).json({ error: "Unknown reminder type" });
  const result = await runReminders(type, { force: true });
  await audit(req.user!.id, "reminders.manual_run", "reminder_settings", type === "payment" ? "1" : "2", result);
  res.json(result);
});

/** GET /reminders/logs?limit= — the send ledger, for auditing and bounce follow-up. */
remindersRouter.get("/logs", async (req, res) => {
  const limit = Math.min(Number(req.query.limit || 100), 500);
  const rows = await q(
    `SELECT rl.*, c.company_name, i.invoice_no, o.order_no
       FROM reminder_logs rl
       JOIN clients c ON c.id = rl.client_id
       LEFT JOIN invoices i ON i.id = rl.invoice_id
       LEFT JOIN orders o ON o.id = rl.order_id
      ORDER BY rl.sent_at DESC LIMIT $1`,
    [limit]
  );
  res.json(rows);
});
