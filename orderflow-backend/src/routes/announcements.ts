import { Router } from "express";
import { z } from "zod";
import { one, q } from "../db";
import { requireAdmin, requireAuth } from "../middleware/auth";
import { clientEmails, renderTemplate, sendMail } from "../lib/email";
import { audit } from "../lib/notify";

export const announcementsRouter = Router();
announcementsRouter.use(requireAuth, requireAdmin);

/** GET /announcements — history of past broadcasts. */
announcementsRouter.get("/", async (_req, res) => {
  res.json(
    await q(
      `SELECT a.*, u.full_name AS sent_by_name FROM announcements a
        LEFT JOIN users u ON u.id = a.sent_by
       ORDER BY a.created_at DESC LIMIT 50`
    )
  );
});

const AnnouncementBody = z.object({
  subject: z.string().trim().min(1),
  body: z.string().trim().min(1),
});

/**
 * POST /announcements — emails every client in the customer directory and
 * logs the broadcast. {{contact}} in the body is replaced per-recipient.
 */
announcementsRouter.post("/", async (req, res) => {
  const parsed = AnnouncementBody.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });
  const { subject, body } = parsed.data;

  const clients = await q<{ email: string; contact_name: string; extra_emails: string[] }>(
    "SELECT email, contact_name, extra_emails FROM clients"
  );
  if (!clients.length) return res.status(400).json({ error: "No clients in the directory to send to" });

  let sent = 0;
  for (const c of clients) {
    try {
      await sendMail(clientEmails(c), subject, renderTemplate(body, { contact: c.contact_name }));
      sent++;
    } catch (err: any) {
      console.error(`announcement failed for ${c.email}:`, err.message);
    }
  }

  const row = await one(
    `INSERT INTO announcements (subject, body, sent_by, recipient_count)
     VALUES ($1, $2, $3, $4) RETURNING *`,
    [subject, body, req.user!.id, sent]
  );
  await audit(req.user!.id, "announcement.sent", "announcement", row!.id, { subject, recipient_count: sent });
  res.status(201).json({ ...row, attempted: clients.length, sent });
});
