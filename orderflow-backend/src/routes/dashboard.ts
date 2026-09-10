import { Router } from "express";
import { one, q } from "../db";
import { clientScopeSql, requireAuth } from "../middleware/auth";

export const dashboardRouter = Router();
dashboardRouter.use(requireAuth);

/**
 * GET /dashboard/payments-due
 * Customers with payments coming due or already overdue. "Overdue" is derived
 * from due_date, never stored. Admin sees every client; an agent sees only
 * their own assigned clients (same scoping as orders/clients/invoices).
 */
dashboardRouter.get("/payments-due", async (req, res) => {
  const user = req.user!;
  const settings = await one<{ days_before: number }>(
    "SELECT days_before FROM reminder_settings WHERE type = 'payment'"
  );
  const daysBefore = settings?.days_before ?? 3;

  const params: any[] = [];
  const scope = clientScopeSql(user, "c", params.length + 1);
  if (scope.param) params.push(scope.param);

  const rows = await q(
    `SELECT i.id, i.invoice_no, i.amount, i.due_date, i.status,
            (i.status = 'unpaid' AND i.due_date < CURRENT_DATE) AS is_overdue,
            (i.due_date - CURRENT_DATE) AS days_until_due,
            (i.amount - COALESCE((SELECT SUM(amount_received + ewt_amount + discount_amount) FROM invoice_payments WHERE invoice_id = i.id), 0)) AS balance_due,
            c.id AS client_id, c.company_name, c.contact_name, c.email, c.collects_in_person,
            (c.email IS NOT NULL OR cardinality(c.extra_emails) > 0) AS has_email
       FROM invoices i
       JOIN clients c ON c.id = i.client_id
      WHERE i.status IN ('unpaid', 'receipt_uploaded')${scope.sql}
      ORDER BY i.due_date ASC`,
    params
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
      no_email_count: rows.filter((r: any) => !r.has_email).length,
      manual_collection_count: rows.filter((r: any) => r.collects_in_person).length,
    },
    invoices: rows,
  });
});
