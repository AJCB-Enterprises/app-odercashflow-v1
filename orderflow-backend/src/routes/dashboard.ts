import { Router } from "express";
import { one, q } from "../db";
import { requireAdmin, requireAuth } from "../middleware/auth";

export const dashboardRouter = Router();
dashboardRouter.use(requireAuth, requireAdmin);

/**
 * GET /dashboard/payments-due
 * Customers with payments coming due or already overdue. "Overdue" is derived
 * from due_date, never stored.
 */
dashboardRouter.get("/payments-due", async (_req, res) => {
  const settings = await one<{ days_before: number }>(
    "SELECT days_before FROM reminder_settings WHERE type = 'payment'"
  );
  const daysBefore = settings?.days_before ?? 3;

  const rows = await q(
    `SELECT i.id, i.invoice_no, i.amount, i.due_date, i.status,
            (i.status = 'unpaid' AND i.due_date < CURRENT_DATE) AS is_overdue,
            (i.due_date - CURRENT_DATE) AS days_until_due,
            (i.amount - COALESCE((SELECT SUM(amount_received + ewt_amount) FROM invoice_payments WHERE invoice_id = i.id), 0)) AS balance_due,
            c.id AS client_id, c.company_name, c.contact_name, c.email
       FROM invoices i
       JOIN clients c ON c.id = i.client_id
      WHERE i.status IN ('unpaid', 'receipt_uploaded')
      ORDER BY i.due_date ASC`,
  );

  const overdue = rows.filter((r: any) => r.is_overdue);
  const dueSoon = rows.filter((r: any) => !r.is_overdue && r.status === "unpaid" && r.days_until_due <= daysBefore);
  res.json({
    summary: {
      overdue_count: overdue.length,
      due_soon_count: dueSoon.length,
      due_soon_window_days: daysBefore,
      receipts_to_verify: rows.filter((r: any) => r.status === "receipt_uploaded").length,
      outstanding_total: rows.reduce((s: number, r: any) => s + Number(r.balance_due), 0),
    },
    invoices: rows,
  });
});
