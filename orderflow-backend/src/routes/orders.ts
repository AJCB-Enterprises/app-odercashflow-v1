import { Router } from "express";
import { z } from "zod";
import { one, q, tx } from "../db";
import { clientScopeSql, requireAdmin, requireAgentPermission, requireAuth } from "../middleware/auth";
import { nextDocNo, peso, shortDate } from "../lib/numbering";
import { audit, notifyAdmins, notifyUser } from "../lib/notify";
import { sendMail } from "../lib/email";

export const ordersRouter = Router();
ordersRouter.use(requireAuth);

/** GET /orders?status=pending — admin sees all; agents see their clients' orders. */
ordersRouter.get("/", async (req, res) => {
  const user = req.user!;
  const params: any[] = [];
  let where = "WHERE TRUE";
  if (req.query.status) {
    params.push(String(req.query.status));
    where += ` AND o.status = $${params.length}::order_status`;
  }
  const scope = clientScopeSql(user, "c", params.length + 1);
  if (scope.param) params.push(scope.param);

  const rows = await q(
    `SELECT o.id, o.order_no, o.status, o.reject_reason, o.created_at,
            c.id AS client_id, c.company_name,
            u.full_name AS agent_name,
            coalesce(sum(oi.qty * oi.unit_price), 0) AS total
       FROM orders o
       JOIN clients c ON c.id = o.client_id
       LEFT JOIN users u ON u.id = o.created_by
       LEFT JOIN order_items oi ON oi.order_id = o.id
       ${where}${scope.sql}
      GROUP BY o.id, c.id, u.full_name
      ORDER BY (o.status = 'pending') DESC, o.created_at DESC`,
    params
  );
  res.json(rows);
});

/**
 * GET /orders/:id — order detail. Per scope, the response embeds the client's
 * pending invoices so the reviewer sees them alongside the order.
 */
ordersRouter.get("/:id", async (req, res) => {
  const user = req.user!;
  const params: any[] = [req.params.id];
  const scope = clientScopeSql(user, "c", 2);
  if (scope.param) params.push(scope.param);

  const order = await one(
    `SELECT o.*, c.company_name, c.contact_name, c.email AS client_email, u.full_name AS agent_name
       FROM orders o JOIN clients c ON c.id = o.client_id
       LEFT JOIN users u ON u.id = o.created_by
      WHERE o.id = $1${scope.sql}`,
    params
  );
  if (!order) return res.status(404).json({ error: "Order not found" });

  const [items, pendingInvoices] = await Promise.all([
    q("SELECT id, description, qty, unit_price FROM order_items WHERE order_id = $1", [order.id]),
    q(
      `SELECT id, invoice_no, amount, due_date, status,
              (status = 'unpaid' AND due_date < CURRENT_DATE) AS is_overdue
         FROM invoices
        WHERE client_id = $1 AND status IN ('unpaid','receipt_uploaded')
        ORDER BY due_date`,
      [order.client_id]
    ),
  ]);
  res.json({ order, items, pending_invoices: pendingInvoices });
});

const OrderBody = z.object({
  client_id: z.string().uuid(),
  items: z
    .array(
      z.object({
        description: z.string().min(1),
        qty: z.number().positive(),
        unit_price: z.number().nonnegative(),
      })
    )
    .min(1),
  payment_terms: z.enum(["net_15", "net_30", "net_45", "cod"]).optional(),
  vat_status: z.enum(["vat_exempt", "vat_inclusive", "zero_rated"]).optional(),
});

/** Days until due for each payment term; COD invoices are due immediately. */
const DUE_DAYS: Record<string, number> = { net_15: 15, net_30: 30, net_45: 45, cod: 0 };

/** POST /orders — agent creates a PO on behalf of an assigned client. */
ordersRouter.post("/", requireAgentPermission("can_create_po"), async (req, res) => {
  const user = req.user!;
  const parsed = OrderBody.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });
  const { client_id, items, payment_terms, vat_status } = parsed.data;

  // Agents may only order for their own clients.
  const clientRow = await one(
    "SELECT id, company_name, agent_id, payment_terms, vat_status FROM clients WHERE id = $1",
    [client_id]
  );
  if (!clientRow || (user.role === "agent" && clientRow.agent_id !== user.id))
    return res.status(404).json({ error: "Client not found" });

  const created = await tx(async (c) => {
    const orderNo = await nextDocNo(c, "PO");
    const orderRes = await c.query(
      `INSERT INTO orders (order_no, client_id, created_by, payment_terms, vat_status)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [orderNo, client_id, user.id, payment_terms ?? clientRow.payment_terms, vat_status ?? clientRow.vat_status]
    );
    const order = orderRes.rows[0];
    for (const it of items)
      await c.query("INSERT INTO order_items (order_id, description, qty, unit_price) VALUES ($1,$2,$3,$4)", [
        order.id,
        it.description,
        it.qty,
        it.unit_price,
      ]);
    await notifyAdmins(
      `New order ${orderNo} submitted for ${clientRow.company_name} by ${user.full_name}.`,
      `/orders/${order.id}`,
      c
    );
    await audit(user.id, "order.created", "order", order.id, { order_no: orderNo }, c);
    return order;
  });
  res.status(201).json(created);
});

/**
 * POST /orders/:id/approve — admin approves; transactionally issues the
 * invoice (due date driven by the order's payment terms), notifies the
 * agent, emails the client.
 */
ordersRouter.post("/:id/approve", requireAdmin, async (req, res) => {
  const user = req.user!;

  const result = await tx(async (c) => {
    const ordRes = await c.query(
      `UPDATE orders SET status = 'approved', reviewed_by = $2, reviewed_at = now()
        WHERE id = $1 AND status = 'pending' RETURNING *`,
      [req.params.id, user.id]
    );
    const order = ordRes.rows[0];
    if (!order) return null;
    const dueDays = DUE_DAYS[order.payment_terms] ?? 30;

    const totalRes = await c.query(
      "SELECT coalesce(sum(qty * unit_price), 0) AS total FROM order_items WHERE order_id = $1",
      [order.id]
    );
    const invoiceNo = await nextDocNo(c, "INV");
    const invRes = await c.query(
      `INSERT INTO invoices (invoice_no, order_id, client_id, amount, due_date)
       VALUES ($1, $2, $3, $4, CURRENT_DATE + $5::int) RETURNING *`,
      [invoiceNo, order.id, order.client_id, totalRes.rows[0].total, dueDays]
    );
    const invoice = invRes.rows[0];

    if (order.created_by)
      await notifyUser(
        order.created_by,
        `${order.order_no} was approved. Invoice ${invoiceNo} issued, due ${shortDate(invoice.due_date)}.`,
        `/orders/${order.id}`,
        c
      );
    await audit(user.id, "order.approved", "order", order.id, { invoice_no: invoiceNo }, c);
    return { order, invoice };
  });
  if (!result) return res.status(409).json({ error: "Order is not pending review" });

  // Email outside the transaction: a mail failure must not roll back the approval.
  const client = await one("SELECT company_name, contact_name, email FROM clients WHERE id = $1", [
    result.order.client_id,
  ]);
  if (client)
    sendMail(
      client.email,
      `Order ${result.order.order_no} approved — invoice ${result.invoice.invoice_no}`,
      `Hi ${client.contact_name}, your order ${result.order.order_no} has been approved. ` +
        `Invoice ${result.invoice.invoice_no} for ${peso(result.invoice.amount)} is due on ` +
        `${shortDate(result.invoice.due_date)}. You'll receive payment reminders with a secure upload link.`
    ).catch((e) => console.error("approval email failed:", e.message));

  res.json(result);
});

/** POST /orders/:id/reject — admin rejects with an optional reason. */
ordersRouter.post("/:id/reject", requireAdmin, async (req, res) => {
  const user = req.user!;
  const reason = String(req.body?.reason ?? "").trim() || null;

  const order = await one(
    `UPDATE orders SET status = 'rejected', reject_reason = $2, reviewed_by = $3, reviewed_at = now()
      WHERE id = $1 AND status = 'pending' RETURNING *`,
    [req.params.id, reason, user.id]
  );
  if (!order) return res.status(409).json({ error: "Order is not pending review" });

  if (order.created_by)
    await notifyUser(order.created_by, `${order.order_no} was rejected${reason ? ": " + reason : "."}`, `/orders/${order.id}`);
  await audit(user.id, "order.rejected", "order", order.id, { reason });
  res.json(order);
});
