import { Router } from "express";
import { z } from "zod";
import { one, q } from "../db";
import { requireAdmin, requireAuth } from "../middleware/auth";
import { findEwtDue, runReminders } from "../worker/reminders";
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
  // BIR 2307 reminders only: the most reminders sent per invoice.
  max_reminders: z.number().int().min(1).max(12).optional(),
});

const REMINDER_TYPES = ["payment", "order", "ewt"];

/** PUT /reminders/settings/:type — admin edits frequency, timing, template. */
remindersRouter.put("/settings/:type", async (req, res) => {
  const type = req.params.type;
  if (!REMINDER_TYPES.includes(type)) return res.status(404).json({ error: "Unknown reminder type" });
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
  const type = req.params.type as "payment" | "order" | "ewt";
  if (!REMINDER_TYPES.includes(type)) return res.status(404).json({ error: "Unknown reminder type" });
  const result = await runReminders(type, { force: true });
  await audit(req.user!.id, "reminders.manual_run", "reminder_settings", String(REMINDER_TYPES.indexOf(type) + 1), result);
  res.json(result);
});

/**
 * GET /reminders/ewt-preview — what the BIR 2307 reminder would do on its next
 * run, and who it can't reach, so an admin can see the size of the first batch
 * before switching it on.
 */
remindersRouter.get("/ewt-preview", async (_req, res) => {
  const settings = await one<{ days_before: number; frequency_days: number; max_reminders: number | null }>(
    "SELECT days_before, frequency_days, max_reminders FROM reminder_settings WHERE type = 'ewt'::reminder_type"
  );
  if (!settings) return res.status(404).json({ error: "2307 reminders aren't set up" });
  const due = await findEwtDue(settings);
  const totals = await one<{ lacking: string; no_email: string; in_person: string }>(
    `SELECT count(*) AS lacking,
            count(*) FILTER (WHERE c.email IS NULL AND cardinality(c.extra_emails) = 0) AS no_email,
            count(*) FILTER (WHERE c.collects_in_person) AS in_person
       FROM invoices i JOIN clients c ON c.id = i.client_id
      WHERE i.status = 'paid' AND i.ewt_name IS NULL
        AND (SELECT coalesce(sum(ewt_amount), 0) FROM invoice_payments WHERE invoice_id = i.id) > 0`
  );
  res.json({
    due_invoices: due.length,
    due_clients: new Set(due.map((d) => d.client_id)).size,
    lacking_total: Number(totals!.lacking),
    lacking_no_email: Number(totals!.no_email),
    lacking_in_person: Number(totals!.in_person),
  });
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
