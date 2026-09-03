import { one, q, tx } from "../db";
import { issueUploadToken, uploadUrl } from "../lib/tokens";
import { clientEmails, renderTemplate, sendMail } from "../lib/email";
import { peso, shortDate } from "../lib/numbering";
import { notifyAdmins } from "../lib/notify";

/**
 * The reminder scheduler (architecture §2.2). One tick every 15 minutes asks
 * "which reminders are due right now?" for each enabled type. reminder_logs is
 * the idempotency ledger: the log row is written in the same transaction that
 * records the send, so a crashed run never double-sends, and the frequency
 * check reads the same table.
 */

interface Settings {
  type: "payment" | "order";
  days_before: number;
  frequency_days: number;
  send_time: string; // "HH:MM:SS"
  timezone: string;
  template: string;
  is_enabled: boolean;
}

/** Is local time in the business timezone past today's send_time? */
const inSendWindow = (s: Settings): boolean => {
  const now = new Date();
  const local = new Intl.DateTimeFormat("en-GB", {
    timeZone: s.timezone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(now); // "HH:MM"
  return local >= s.send_time.slice(0, 5);
};

export interface RunResult {
  type: string;
  sent: number;
  skipped_reason?: string;
}

export const runReminders = async (type: "payment" | "order", opts: { force?: boolean } = {}): Promise<RunResult> => {
  const settings = await one<Settings>("SELECT * FROM reminder_settings WHERE type = $1::reminder_type", [type]);
  if (!settings || !settings.is_enabled) return { type, sent: 0, skipped_reason: "disabled" };
  if (!opts.force && !inSendWindow(settings)) return { type, sent: 0, skipped_reason: "outside send window" };

  const sent = type === "payment" ? await runPaymentReminders(settings) : await runOrderReminders(settings);
  if (sent > 0)
    await notifyAdmins(`${type === "payment" ? "Payment" : "Order"} reminder run: ${sent} email(s) sent.`);
  return { type, sent };
};

interface DueInvoice {
  id: string;
  invoice_no: string;
  /** The remaining balance (invoice total minus any recorded payments/EWT), not the original invoice total. */
  amount: string | number;
  due_date: string;
  is_overdue: boolean;
  client_id: string;
  contact_name: string;
  email: string;
  extra_emails?: string[];
}

/**
 * Sends one payment reminder email for an invoice and logs it (same
 * transaction, so a crash after sendMail can't double-send next tick).
 * Shared by the scheduled batch run and any real-time trigger (e.g. COD).
 * Goes to the client's primary email plus any extra addresses on file.
 */
export const sendPaymentReminder = async (inv: DueInvoice, template: string): Promise<void> => {
  const recipients = clientEmails(inv);
  await tx(async (c) => {
    const rawToken = await issueUploadToken(inv.id, c);
    const subject = `Payment reminder — ${inv.invoice_no} ${
      inv.is_overdue ? "is overdue" : "due " + shortDate(inv.due_date)
    }`;
    const body =
      renderTemplate(template, {
        contact: inv.contact_name,
        invoice: inv.invoice_no,
        amount: peso(inv.amount),
        due: shortDate(inv.due_date),
      }) + `\n\nUpload your receipt here (secure link, no login needed):\n${uploadUrl(rawToken)}`;

    const logRes = await c.query(
      `INSERT INTO reminder_logs (type, invoice_id, client_id, sent_to, subject)
       VALUES ('payment', $1, $2, $3, $4) RETURNING id`,
      [inv.id, inv.client_id, recipients.join(", "), subject]
    );
    const mail = await sendMail(recipients, subject, body);
    await c.query("UPDATE reminder_logs SET provider_id = $2 WHERE id = $1", [logRes.rows[0].id, mail.providerId]);
  });
};

/**
 * Sends one Statement of Account covering several invoices for the same
 * client, instead of a separate email per invoice. Each invoice still gets
 * its own upload token and its own reminder_logs row (so the per-invoice
 * frequency cooldown keeps working), but only one email goes out.
 */
export const sendStatementOfAccount = async (invoices: DueInvoice[]): Promise<void> => {
  const first = invoices[0];
  const recipients = clientEmails(first);
  await tx(async (c) => {
    const tokens: string[] = [];
    for (const inv of invoices) tokens.push(await issueUploadToken(inv.id, c));

    const total = invoices.reduce((s, inv) => s + Number(inv.amount), 0);
    const lines = invoices.map(
      (inv, i) =>
        `  - ${inv.invoice_no} — ${peso(inv.amount)} — due ${shortDate(inv.due_date)}${
          inv.is_overdue ? " (OVERDUE)" : ""
        }\n    Upload receipt: ${uploadUrl(tokens[i])}`
    );
    const subject = `Statement of Account — ${invoices.length} invoice(s) outstanding`;
    const body =
      `Hi ${first.contact_name}, this is a Statement of Account from AJCB Enterprises Inc. summarizing your outstanding invoices.\n\n` +
      lines.join("\n\n") +
      `\n\nTotal due: ${peso(total)}\n\nPlease settle at your earliest convenience.`;

    const logIds: string[] = [];
    for (const inv of invoices) {
      const logRes = await c.query(
        `INSERT INTO reminder_logs (type, invoice_id, client_id, sent_to, subject)
         VALUES ('payment', $1, $2, $3, $4) RETURNING id`,
        [inv.id, inv.client_id, recipients.join(", "), subject]
      );
      logIds.push(logRes.rows[0].id);
    }
    const mail = await sendMail(recipients, subject, body);
    await c.query("UPDATE reminder_logs SET provider_id = $1 WHERE id = ANY($2::uuid[])", [mail.providerId, logIds]);
  });
};

/**
 * Payment reminders. An invoice qualifies when it is unpaid, inside the
 * days-before window (or overdue), and its last payment reminder is older than
 * frequency_days. Each send gets a fresh upload token. Clients with 2+
 * invoices due at once get one consolidated Statement of Account instead of
 * separate emails.
 */
const runPaymentReminders = async (s: Settings): Promise<number> => {
  const due = await q<DueInvoice>(
    `SELECT i.id, i.invoice_no,
            (i.amount - COALESCE((SELECT SUM(amount_received + ewt_amount) FROM invoice_payments WHERE invoice_id = i.id), 0)) AS amount,
            i.due_date,
            (i.due_date < CURRENT_DATE) AS is_overdue,
            c.id AS client_id, c.contact_name, c.company_name, c.email, c.extra_emails
       FROM invoices i
       JOIN clients c ON c.id = i.client_id
      WHERE i.status = 'unpaid'
        AND i.due_date - make_interval(days => $1) <= now()
        AND NOT EXISTS (
          SELECT 1 FROM reminder_logs rl
           WHERE rl.invoice_id = i.id AND rl.type = 'payment'
             AND rl.sent_at > now() - make_interval(days => $2)
        )
      ORDER BY i.due_date`,
    [s.days_before, s.frequency_days]
  );

  const byClient = new Map<string, DueInvoice[]>();
  for (const inv of due) byClient.set(inv.client_id, [...(byClient.get(inv.client_id) || []), inv]);

  let sent = 0;
  for (const invoices of byClient.values()) {
    try {
      if (invoices.length >= 2) await sendStatementOfAccount(invoices);
      else await sendPaymentReminder(invoices[0], s.template);
      sent += invoices.length;
    } catch (err: any) {
      console.error(`payment reminder failed for client ${invoices[0].client_id}:`, err.message);
    }
  }
  return sent;
};

/**
 * Sends a payment reminder right away for a client's currently-due unpaid
 * invoices, skipping the frequency-days cooldown that normally prevents
 * re-sending too soon. For when an admin corrects a bad email address —
 * any prior "sent" reminders almost certainly never reached the client, so
 * that cooldown would otherwise block the corrected address for days.
 */
export const sendImmediateReminderForClient = async (clientId: string): Promise<number> => {
  const settings = await one<Settings>("SELECT * FROM reminder_settings WHERE type = 'payment'::reminder_type");
  if (!settings || !settings.is_enabled) return 0;

  const due = await q<DueInvoice>(
    `SELECT i.id, i.invoice_no,
            (i.amount - COALESCE((SELECT SUM(amount_received + ewt_amount) FROM invoice_payments WHERE invoice_id = i.id), 0)) AS amount,
            i.due_date,
            (i.due_date < CURRENT_DATE) AS is_overdue,
            c.id AS client_id, c.contact_name, c.company_name, c.email, c.extra_emails
       FROM invoices i
       JOIN clients c ON c.id = i.client_id
      WHERE i.status = 'unpaid'
        AND i.client_id = $1
        AND i.due_date - make_interval(days => $2) <= now()
      ORDER BY i.due_date`,
    [clientId, settings.days_before]
  );
  if (!due.length) return 0;

  if (due.length >= 2) await sendStatementOfAccount(due);
  else await sendPaymentReminder(due[0], settings.template);
  return due.length;
};

/** Order reminders for orders still pending review, on the configured cadence. */
const runOrderReminders = async (s: Settings): Promise<number> => {
  const pending = await q<{
    id: string; order_no: string; client_id: string; contact_name: string; company_name: string;
    email: string; extra_emails: string[];
  }>(
    `SELECT o.id, o.order_no, c.id AS client_id, c.contact_name, c.company_name, c.email, c.extra_emails
       FROM orders o
       JOIN clients c ON c.id = o.client_id
      WHERE o.status = 'pending'
        AND NOT EXISTS (
          SELECT 1 FROM reminder_logs rl
           WHERE rl.order_id = o.id AND rl.type = 'order'
             AND rl.sent_at > now() - make_interval(days => $1)
        )
      ORDER BY o.created_at`,
    [s.frequency_days]
  );

  let sent = 0;
  for (const o of pending) {
    const recipients = clientEmails(o);
    try {
      await tx(async (c) => {
        const subject = `Order reminder — ${o.order_no} is awaiting review`;
        const body = renderTemplate(s.template, { contact: o.contact_name, order: o.order_no });
        const logRes = await c.query(
          `INSERT INTO reminder_logs (type, order_id, client_id, sent_to, subject)
           VALUES ('order', $1, $2, $3, $4) RETURNING id`,
          [o.id, o.client_id, recipients.join(", "), subject]
        );
        const mail = await sendMail(recipients, subject, body);
        await c.query("UPDATE reminder_logs SET provider_id = $2 WHERE id = $1", [logRes.rows[0].id, mail.providerId]);
      });
      sent++;
    } catch (err: any) {
      console.error(`order reminder failed for ${o.order_no}:`, err.message);
    }
  }
  return sent;
};

/** Start the 15-minute scheduler loop. Returns a stop function. */
export const startReminderWorker = (): (() => void) => {
  const tick = async () => {
    try {
      await runReminders("payment");
      await runReminders("order");
    } catch (err: any) {
      console.error("reminder tick failed:", err.message);
    }
  };
  const interval = setInterval(tick, 15 * 60 * 1000);
  tick(); // run once at boot
  console.log("reminder worker started (15-minute tick)");
  return () => clearInterval(interval);
};
