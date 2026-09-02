import { Router } from "express";
import multer from "multer";
import { z } from "zod";
import { one, q, tx } from "../db";
import { clientScopeSql, requireAdmin, requireAgentPermission, requireAuth } from "../middleware/auth";
import { nextDocNo, peso, shortDate } from "../lib/numbering";
import { audit, notifyAdmins, notifyUser } from "../lib/notify";
import { clientEmails, sendMail } from "../lib/email";
import { config } from "../config";
import { readOrderAttachment, saveOrderAttachment, validateUpload } from "../lib/storage";
import rateLimit from "express-rate-limit";
import { sendPaymentReminder } from "../worker/reminders";

export const ordersRouter = Router();
ordersRouter.use(requireAuth);

const uploadAttachment = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: config.maxUploadMb * 1024 * 1024, files: 1 },
});

// Order creation always runs through here (attachment or not) — bounds both
// plain order spam and the more expensive file-upload path in one place.
const createOrderLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 30,
  standardHeaders: true,
  message: { error: "Too many orders submitted, try again later" },
});

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
    `SELECT o.*, c.company_name, c.contact_name, c.email AS client_email, u.full_name AS agent_name,
            c.tin, c.bir_cor_name, c.peza_cert_name
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
  po_date: z.string().date().optional().or(z.literal("")),
  po_number: z.string().optional(),
});

/** Days until due for each payment term; COD invoices are due immediately. */
const DUE_DAYS: Record<string, number> = { net_15: 15, net_30: 30, net_45: 45, cod: 0 };

const PAYMENT_TERM_LABELS: Record<string, string> = { net_15: "Net 15", net_30: "Net 30", net_45: "Net 45", cod: "COD" };
const VAT_STATUS_LABELS: Record<string, string> = { vat_exempt: "SO/ DR", vat_inclusive: "VAT-Inclusive", zero_rated: "Zero-Rated" };

/**
 * POST /orders — agent creates a sales order on behalf of an assigned client.
 * Multipart: "items" arrives as a JSON string (siblings of an optional file
 * can't otherwise ride in the same multipart request); "file" is optional —
 * a photo/scan of the client's own PO document (JPG, PNG, or PDF).
 */
ordersRouter.post("/", requireAgentPermission("can_create_po"), createOrderLimiter, uploadAttachment.single("file"), async (req, res) => {
  const user = req.user!;
  let itemsInput: unknown;
  try {
    itemsInput = JSON.parse(String(req.body.items ?? "[]"));
  } catch {
    return res.status(400).json({ error: "Invalid items" });
  }
  const parsed = OrderBody.safeParse({ ...req.body, items: itemsInput });
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });
  const { client_id, items, payment_terms, vat_status, po_date, po_number } = parsed.data;

  let attachment: { ext: string; mime: string } | null = null;
  if (req.file) {
    attachment = validateUpload(req.file);
    if (!attachment) return res.status(400).json({ error: "PO attachment must be a JPG, PNG, or PDF" });
  }

  // Agents may only order for their own clients.
  const clientRow = await one(
    "SELECT id, company_name, agent_id, payment_terms, vat_status FROM clients WHERE id = $1",
    [client_id]
  );
  if (!clientRow || (user.role === "agent" && clientRow.agent_id !== user.id))
    return res.status(404).json({ error: "Client not found" });

  const created = await tx(async (c) => {
    const orderNo = await nextDocNo(c, "SO");
    const orderRes = await c.query(
      `INSERT INTO orders (order_no, client_id, created_by, payment_terms, vat_status, po_date, po_number)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [
        orderNo, client_id, user.id, payment_terms ?? clientRow.payment_terms, vat_status ?? clientRow.vat_status,
        po_date || null, po_number?.trim() || null,
      ]
    );
    let order = orderRes.rows[0];
    for (const it of items)
      await c.query("INSERT INTO order_items (order_id, description, qty, unit_price) VALUES ($1,$2,$3,$4)", [
        order.id,
        it.description,
        it.qty,
        it.unit_price,
      ]);

    if (req.file && attachment) {
      const key = await saveOrderAttachment(order.id, attachment.ext, req.file.buffer);
      const updRes = await c.query(
        `UPDATE orders SET attachment_key = $2, attachment_name = $3, attachment_mime = $4, attachment_size_bytes = $5
          WHERE id = $1 RETURNING *`,
        [order.id, key, (req.file.originalname || `po.${attachment.ext}`).slice(0, 200), attachment.mime, req.file.size]
      );
      order = updRes.rows[0];
    }

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

/** GET /orders/:id/attachment — streams the client's PO document, if one was uploaded. */
ordersRouter.get("/:id/attachment", async (req, res) => {
  const user = req.user!;
  const params: any[] = [req.params.id];
  const scope = clientScopeSql(user, "c", 2);
  if (scope.param) params.push(scope.param);

  const order = await one(
    `SELECT o.attachment_key, o.attachment_name, o.attachment_mime FROM orders o
       JOIN clients c ON c.id = o.client_id
      WHERE o.id = $1${scope.sql}`,
    params
  );
  if (!order || !order.attachment_key) return res.status(404).json({ error: "No attachment for this order" });
  const data = await readOrderAttachment(order.attachment_key);
  res.setHeader("Content-Type", order.attachment_mime);
  res.setHeader("Content-Disposition", `inline; filename="${order.attachment_name.replace(/"/g, "")}"`);
  res.send(data);
});

const ApproveBody = z.object({
  invoice_no: z.string().trim().min(1, "Sales Invoice number is required"),
});

/**
 * POST /orders/:id/approve — admin approves and records the real Sales
 * Invoice number (SI books are official pre-numbered documents, so the app
 * never invents one). Due date is still derived from the order's payment
 * terms. Notifies the agent, emails the client.
 */
ordersRouter.post("/:id/approve", requireAdmin, async (req, res) => {
  const user = req.user!;
  const parsed = ApproveBody.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });
  const invoiceNo = parsed.data.invoice_no;

  let result;
  try {
    result = await tx(async (c) => {
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
  } catch (err: any) {
    if (err?.code === "23505") return res.status(409).json({ error: `Invoice number ${invoiceNo} is already in use` });
    throw err;
  }
  if (!result) return res.status(409).json({ error: "Order is not pending review" });

  // Email outside the transaction: a mail failure must not roll back the approval.
  const client = await one<{ company_name: string; contact_name: string; email: string; extra_emails: string[] }>(
    "SELECT company_name, contact_name, email, extra_emails FROM clients WHERE id = $1",
    [result.order.client_id]
  );
  if (client)
    sendMail(
      clientEmails(client),
      `Order ${result.order.order_no} approved — invoice ${result.invoice.invoice_no}`,
      `Hi ${client.contact_name}, your order ${result.order.order_no} has been approved. ` +
        `Invoice ${result.invoice.invoice_no} for ${peso(result.invoice.amount)} is due on ` +
        `${shortDate(result.invoice.due_date)}. You'll receive payment reminders with a secure upload link.`
    ).catch((e) => console.error("approval email failed:", e.message));

  // COD is due on delivery, i.e. right now — send the payment reminder (with
  // the upload link) immediately instead of waiting for the next 15-minute tick.
  if (client && result.order.payment_terms === "cod") {
    one<{ template: string; is_enabled: boolean }>(
      "SELECT template, is_enabled FROM reminder_settings WHERE type = 'payment'"
    )
      .then((settings) => {
        if (!settings?.is_enabled) return;
        return sendPaymentReminder(
          {
            id: result.invoice.id,
            invoice_no: result.invoice.invoice_no,
            amount: result.invoice.amount,
            due_date: result.invoice.due_date,
            is_overdue: false,
            client_id: result.order.client_id,
            contact_name: client.contact_name,
            email: client.email,
            extra_emails: client.extra_emails,
          },
          settings.template
        );
      })
      .catch((e) => console.error("COD real-time reminder failed:", e.message));
  }

  // Internal copy of the full approved order — sales/fulfillment don't have
  // app logins, so this is their only view into what was just approved.
  if (config.salesForwardEmail && client) {
    Promise.all([
      result.order.created_by
        ? one<{ full_name: string }>("SELECT full_name FROM users WHERE id = $1", [result.order.created_by])
        : Promise.resolve(null),
      q<{ description: string; qty: string; unit_price: string }>(
        "SELECT description, qty, unit_price FROM order_items WHERE order_id = $1",
        [result.order.id]
      ),
    ])
      .then(([agent, items]) => {
        const lines = items
          .map(
            (it) =>
              `  - ${it.description} — qty ${Number(it.qty)} x ${peso(it.unit_price)} = ${peso(
                Number(it.qty) * Number(it.unit_price)
              )}`
          )
          .join("\n");
        const poLine = result.order.po_number || result.order.po_date
          ? `Client's PO: ${result.order.po_number || "no number given"}${
              result.order.po_date ? ` (dated ${shortDate(result.order.po_date)})` : ""
            }\n`
          : "";
        const body =
          `Client: ${client.company_name} (${client.contact_name})\n` +
          `Agent: ${agent?.full_name || "—"}\n` +
          `Sales Order: ${result.order.order_no}\n` +
          `Sales Invoice: ${result.invoice.invoice_no}\n` +
          `Payment terms: ${PAYMENT_TERM_LABELS[result.order.payment_terms] || result.order.payment_terms}\n` +
          `VAT status: ${VAT_STATUS_LABELS[result.order.vat_status] || result.order.vat_status}\n` +
          poLine +
          `\nLine items:\n${lines}\n\n` +
          `Total: ${peso(result.invoice.amount)}\n` +
          `Due: ${shortDate(result.invoice.due_date)}`;
        return sendMail(config.salesForwardEmail, `Order approved — ${result.order.order_no}`, body);
      })
      .catch((e) => console.error("sales forward email failed:", e.message));
  }

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
