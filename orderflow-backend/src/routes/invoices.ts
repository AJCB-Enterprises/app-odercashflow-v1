import { Router } from "express";
import { one, q, tx } from "../db";
import { clientScopeSql, requireAdmin, requireAgentPermission, requireAuth } from "../middleware/auth";
import { revokeInvoiceTokens } from "../lib/tokens";
import { audit } from "../lib/notify";
import { readReceipt } from "../lib/storage";

export const invoicesRouter = Router();
invoicesRouter.use(requireAuth);

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
 * POST /invoices/:id/mark-paid — admin verified the receipt against bank
 * records. Sets paid, stamps the receipt as verified, revokes all upload tokens.
 */
invoicesRouter.post("/:id/mark-paid", requireAdmin, async (req, res) => {
  const user = req.user!;
  const invoice = await tx(async (c) => {
    const invRes = await c.query(
      `UPDATE invoices SET status = 'paid', paid_at = now()
        WHERE id = $1 AND status IN ('unpaid','receipt_uploaded') RETURNING *`,
      [req.params.id]
    );
    const inv = invRes.rows[0];
    if (!inv) return null;
    await c.query(
      `UPDATE receipts SET verified_by = $2, verified_at = now()
        WHERE invoice_id = $1 AND verified_at IS NULL`,
      [inv.id, user.id]
    );
    await revokeInvoiceTokens(inv.id, c);
    await audit(user.id, "invoice.marked_paid", "invoice", inv.id, { invoice_no: inv.invoice_no }, c);
    return inv;
  });
  if (!invoice) return res.status(409).json({ error: "Invoice is already paid or void" });
  res.json(invoice);
});
