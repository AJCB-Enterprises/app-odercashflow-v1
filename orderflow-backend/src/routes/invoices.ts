import { Router } from "express";
import { z } from "zod";
import { one, q, tx } from "../db";
import { clientScopeSql, requireAdmin, requireAgentPermission, requireAuth } from "../middleware/auth";
import { ewtUploadUrl, issueUploadToken, revokeInvoiceTokens } from "../lib/tokens";
import { audit } from "../lib/notify";
import { clientEmails, sendMail } from "../lib/email";
import { readEwtForm, readReceipt } from "../lib/storage";

export const invoicesRouter = Router();
invoicesRouter.use(requireAuth);

/**
 * What's still owed, computed from the payment ledger rather than stored, so
 * it can never drift. amount_received covers cash/bank proceeds; ewt_amount
 * covers tax withheld at source (BIR Form 2307) — both close the balance.
 */
const BALANCE_DUE_SQL =
  "(i.amount - COALESCE((SELECT SUM(amount_received + ewt_amount) FROM invoice_payments WHERE invoice_id = i.id), 0))";

/** Total EWT applied across all payments — shown even after the invoice is fully paid. */
const TOTAL_EWT_SQL = "COALESCE((SELECT SUM(ewt_amount) FROM invoice_payments WHERE invoice_id = i.id), 0)";

/** Rounding tolerance (pesos) below which a balance counts as fully settled. */
const BALANCE_TOLERANCE = 1.0;

/**
 * GET /invoices?client_id=&state=open|paid|receipt_uploaded
 * Agents need the can_view_invoices permission and only see their clients.
 */
invoicesRouter.get("/", requireAgentPermission("can_view_invoices"), async (req, res) => {
  const user = req.user!;
  const params: any[] = [];
  let where = "WHERE TRUE";
  if (req.query.client_id) {
    params.push(String(req.query.client_id));
    where += ` AND i.client_id = $${params.length}`;
  }
  const state = String(req.query.state || "");
  if (state === "open") where += " AND i.status IN ('unpaid','receipt_uploaded')";
  else if (state === "paid") where += " AND i.status = 'paid'";
  else if (state === "receipt_uploaded") where += " AND i.status = 'receipt_uploaded'";

  const scope = clientScopeSql(user, "c", params.length + 1);
  if (scope.param) params.push(scope.param);

  const rows = await q(
    `SELECT i.id, i.invoice_no, i.amount, i.due_date, i.status, i.paid_at,
            (i.status = 'unpaid' AND i.due_date < CURRENT_DATE) AS is_overdue,
            ${BALANCE_DUE_SQL} AS balance_due,
            ${TOTAL_EWT_SQL} AS total_ewt,
            i.ewt_name,
            c.id AS client_id, c.company_name,
            r.id AS receipt_id, r.original_name AS receipt_name, r.uploaded_at AS receipt_uploaded_at
       FROM invoices i
       JOIN clients c ON c.id = i.client_id
       LEFT JOIN LATERAL (
         SELECT id, original_name, uploaded_at FROM receipts
          WHERE invoice_id = i.id ORDER BY uploaded_at DESC LIMIT 1
       ) r ON TRUE
       ${where}${scope.sql}
      ORDER BY i.due_date DESC`,
    params
  );
  res.json(rows);
});

/**
 * GET /invoices/:id/receipt — streams the latest uploaded receipt to the admin.
 * With S3 storage this endpoint would instead redirect to a short-lived signed URL.
 */
invoicesRouter.get("/:id/receipt", requireAdmin, async (req, res) => {
  const receipt = await one(
    "SELECT storage_key, original_name, mime_type FROM receipts WHERE invoice_id = $1 ORDER BY uploaded_at DESC LIMIT 1",
    [req.params.id]
  );
  if (!receipt) return res.status(404).json({ error: "No receipt uploaded for this invoice" });
  const data = await readReceipt(receipt.storage_key);
  res.setHeader("Content-Type", receipt.mime_type);
  res.setHeader("Content-Disposition", `inline; filename="${receipt.original_name.replace(/"/g, "")}"`);
  res.send(data);
});

/**
 * GET /invoices/:id/receipt/ewt — streams the client's BIR Form 2307 (EWT)
 * on file for this invoice, however it got there: bundled with a receipt, or
 * submitted separately (possibly after the invoice was already paid).
 */
invoicesRouter.get("/:id/receipt/ewt", requireAdmin, async (req, res) => {
  const inv = await one(
    "SELECT ewt_key, ewt_name, ewt_mime FROM invoices WHERE id = $1 AND ewt_key IS NOT NULL",
    [req.params.id]
  );
  if (!inv) return res.status(404).json({ error: "No BIR 2307 form uploaded for this invoice" });
  const data = await readEwtForm(inv.ewt_key);
  res.setHeader("Content-Type", inv.ewt_mime);
  res.setHeader("Content-Disposition", `inline; filename="${inv.ewt_name.replace(/"/g, "")}"`);
  res.send(data);
});

/**
 * POST /invoices/:id/ewt-link — admin requests the client's BIR Form 2307
 * for an invoice that's already settled (or otherwise didn't come bundled
 * with the receipt). Emails a secure link that keeps working even after the
 * invoice is fully paid, since payment-receipt links are revoked at that
 * point but this is a different purpose.
 */
invoicesRouter.post("/:id/ewt-link", requireAdmin, async (req, res) => {
  const inv = await one<{ id: string; invoice_no: string; client_id: string }>(
    "SELECT id, invoice_no, client_id FROM invoices WHERE id = $1 AND status != 'void'",
    [req.params.id]
  );
  if (!inv) return res.status(404).json({ error: "Invoice not found" });
  const client = await one<{ company_name: string; contact_name: string; email: string; extra_emails: string[] }>(
    "SELECT company_name, contact_name, email, extra_emails FROM clients WHERE id = $1",
    [inv.client_id]
  );
  if (!client) return res.status(404).json({ error: "Client not found" });

  const rawToken = await issueUploadToken(inv.id, undefined, "ewt");
  await sendMail(
    clientEmails(client),
    `Please submit your BIR Form 2307 for ${inv.invoice_no}`,
    `Hi ${client.contact_name}, could you please submit your BIR Form 2307 (Certificate of Creditable ` +
      `Tax Withheld) for invoice ${inv.invoice_no}?\n\nUpload it here (secure link, no login needed):\n${ewtUploadUrl(rawToken)}`
  );
  await audit(req.user!.id, "invoice.ewt_link_sent", "invoice", inv.id, { invoice_no: inv.invoice_no });
  res.json({ ok: true, sent_to: clientEmails(client) });
});

const PaymentBody = z.object({
  amount_received: z.number().min(0),
  ewt_amount: z.number().min(0).optional(),
  note: z.string().optional(),
});

/**
 * POST /invoices/:id/payments — admin records what actually came in against
 * this invoice, checked against bank records: cash/bank proceeds
 * (amount_received) plus any tax withheld at source (ewt_amount, from the
 * client's BIR Form 2307). A short payment — e.g. paid net of EWT with the
 * 2307 still outstanding — leaves a balance: the invoice stays open and
 * automatically re-enters the normal reminder cycle for the remainder,
 * rather than being silently treated as settled. Once the running balance
 * closes out (within a small rounding tolerance), the invoice is marked paid
 * and its upload links are revoked, same as before.
 */
invoicesRouter.post("/:id/payments", requireAdmin, async (req, res) => {
  const parsed = PaymentBody.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });
  const { amount_received, note } = parsed.data;
  const ewt_amount = parsed.data.ewt_amount ?? 0;
  const user = req.user!;

  const result = await tx(async (c) => {
    const invRes = await c.query(
      "SELECT id, invoice_no, amount FROM invoices WHERE id = $1 AND status IN ('unpaid','receipt_uploaded')",
      [req.params.id]
    );
    const inv = invRes.rows[0];
    if (!inv) return null;

    const receipt = await one("SELECT id FROM receipts WHERE invoice_id = $1 ORDER BY uploaded_at DESC LIMIT 1", [
      inv.id,
    ]);
    await c.query(
      `INSERT INTO invoice_payments (invoice_id, receipt_id, amount_received, ewt_amount, verified_by, note)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [inv.id, receipt?.id ?? null, amount_received, ewt_amount, user.id, note ?? null]
    );
    await c.query(
      `UPDATE receipts SET verified_by = $2, verified_at = now()
        WHERE invoice_id = $1 AND verified_at IS NULL`,
      [inv.id, user.id]
    );

    const balanceRes = await c.query(
      `SELECT ${BALANCE_DUE_SQL} AS balance_due FROM invoices i WHERE i.id = $1`,
      [inv.id]
    );
    const balanceDue = Number(balanceRes.rows[0].balance_due);
    const fullyPaid = balanceDue <= BALANCE_TOLERANCE;

    const updRes = await c.query(
      `UPDATE invoices SET status = $2, paid_at = $3 WHERE id = $1 RETURNING *`,
      [inv.id, fullyPaid ? "paid" : "unpaid", fullyPaid ? new Date() : null]
    );

    if (fullyPaid) {
      await revokeInvoiceTokens(inv.id, c, "receipt");
      await audit(user.id, "invoice.marked_paid", "invoice", inv.id, { invoice_no: inv.invoice_no }, c);
    } else {
      await audit(
        user.id,
        "invoice.payment_recorded",
        "invoice",
        inv.id,
        { invoice_no: inv.invoice_no, amount_received, ewt_amount, balance_due: balanceDue },
        c
      );
    }
    return { invoice: updRes.rows[0], balance_due: balanceDue, fully_paid: fullyPaid };
  });

  if (!result) return res.status(409).json({ error: "Invoice is already paid or void" });
  res.json(result);
});
