import { Router } from "express";
import multer from "multer";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import { one, q, tx } from "../db";
import { clientScopeSql, requireAdmin, requireAuth } from "../middleware/auth";
import { audit } from "../lib/notify";
import { config } from "../config";
import { decryptField, encryptField } from "../lib/crypto";
import { DUE_DAYS } from "../lib/numbering";
import { sendConsolidatedInvoiceNotice, sendImmediateReminderForClient } from "../worker/reminders";
import { readClientDocument, saveClientDocument, sanitizeFilename, validateUpload } from "../lib/storage";

export const clientsRouter = Router();
clientsRouter.use(requireAuth);

const uploadDoc = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: config.maxUploadMb * 1024 * 1024, files: 1 },
});

const uploadDocLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  message: { error: "Too many document uploads, try again later" },
});

/** Column-name prefix per document type — never derived from the URL param directly. */
const DOC_COLUMNS: Record<string, string> = { bir_cor: "bir_cor", peza_cert: "peza_cert" };
const DOC_LABELS: Record<string, string> = { bir_cor: "BIR COR 2303", peza_cert: "PEZA Certificate" };

/**
 * GET /clients?search=
 * Admin: full searchable directory. Agent: only clients assigned to them.
 */
clientsRouter.get("/", async (req, res) => {
  const user = req.user!;
  const search = String(req.query.search || "").trim();
  const params: any[] = [];
  let where = "WHERE TRUE";
  if (search) {
    params.push(`%${search}%`);
    where += ` AND (c.company_name ILIKE $${params.length} OR c.contact_name ILIKE $${params.length}
               OR c.email::text ILIKE $${params.length} OR coalesce(c.phone,'') ILIKE $${params.length})`;
  }
  const scope = clientScopeSql(user, "c", params.length + 1);
  if (scope.param) params.push(scope.param);

  const rows = await q(
    `SELECT c.id, c.company_name, c.contact_name, c.email, c.phone, c.address, c.agent_id,
            c.payment_terms, c.vat_status, c.extra_emails, c.consolidated_invoicing,
            u.full_name AS agent_name,
            count(o.id) FILTER (WHERE o.id IS NOT NULL) AS order_count,
            count(i.id) FILTER (WHERE i.status IN ('unpaid','receipt_uploaded')) AS open_invoice_count,
            coalesce(sum(i.amount) FILTER (WHERE i.status IN ('unpaid','receipt_uploaded')), 0) AS open_invoice_total
       FROM clients c
       LEFT JOIN users u ON u.id = c.agent_id
       LEFT JOIN orders o ON o.client_id = c.id
       LEFT JOIN invoices i ON i.client_id = c.id
       ${where}${scope.sql}
      GROUP BY c.id, u.full_name
      ORDER BY c.company_name`,
    params
  );
  res.json(rows);
});

/**
 * GET /clients/:id
 * Contact details, order history, invoice status, and pending invoices —
 * everything the admin sees when reviewing an account.
 */
clientsRouter.get("/:id", async (req, res) => {
  const user = req.user!;
  const params: any[] = [req.params.id];
  const scope = clientScopeSql(user, "c", 2);
  if (scope.param) params.push(scope.param);

  const client = await one(
    `SELECT c.*, u.full_name AS agent_name FROM clients c
      LEFT JOIN users u ON u.id = c.agent_id
      WHERE c.id = $1${scope.sql}`,
    params
  );
  if (!client) return res.status(404).json({ error: "Client not found" });
  if (client.tin) client.tin = decryptField(client.tin);

  const [orders, invoices] = await Promise.all([
    q(
      `SELECT o.id, o.order_no, o.status, o.reject_reason, o.created_at, o.po_number, o.po_date,
              coalesce(sum(oi.qty * oi.unit_price), 0) AS total,
              (EXISTS (SELECT 1 FROM invoices iv WHERE iv.order_id = o.id)
               OR EXISTS (SELECT 1 FROM invoice_orders io WHERE io.order_id = o.id)) AS is_invoiced
         FROM orders o LEFT JOIN order_items oi ON oi.order_id = o.id
        WHERE o.client_id = $1 GROUP BY o.id ORDER BY o.created_at DESC`,
      [req.params.id]
    ),
    q(
      `SELECT id, invoice_no, amount, due_date, status, ewt_name,
              (status = 'unpaid' AND due_date < CURRENT_DATE) AS is_overdue,
              (amount - COALESCE((SELECT SUM(amount_received + ewt_amount) FROM invoice_payments WHERE invoice_id = invoices.id), 0)) AS balance_due,
              COALESCE((SELECT SUM(ewt_amount) FROM invoice_payments WHERE invoice_id = invoices.id), 0) AS total_ewt,
              (SELECT original_name FROM receipts WHERE invoice_id = invoices.id ORDER BY uploaded_at DESC LIMIT 1) AS receipt_name,
              (SELECT json_agg(json_build_object('order_no', o.order_no, 'po_number', o.po_number) ORDER BY o.order_no)
                 FROM invoice_orders io JOIN orders o ON o.id = io.order_id WHERE io.invoice_id = invoices.id) AS covered_orders
         FROM invoices WHERE client_id = $1 ORDER BY due_date DESC`,
      [req.params.id]
    ),
  ]);
  res.json({
    client,
    orders,
    invoices,
    pending_invoices: invoices.filter((i: any) => i.status === "unpaid" || i.status === "receipt_uploaded"),
  });
});

const ClientBody = z.object({
  company_name: z.string().min(1),
  contact_name: z.string().min(1),
  email: z.union([z.string().email(), z.literal("")]).optional(),
  phone: z.string().min(1, "Phone is required"),
  address: z.string().min(1, "Address is required"),
  agent_id: z.string().uuid().nullable().optional(),
  notes: z.string().optional(),
  payment_terms: z.enum(["net_15", "net_30", "net_45", "cod"]).optional(),
  vat_status: z.enum(["vat_exempt", "vat_inclusive", "zero_rated"]).optional(),
  extra_emails: z.array(z.string().email()).optional(),
  tin: z.string().min(1, "TIN is required"),
  consolidated_invoicing: z.boolean().optional(),
});

/**
 * POST /clients — creates a customer record.
 * Admin: can assign to any agent (or leave unassigned). Agent: always assigned to themselves.
 */
clientsRouter.post("/", async (req, res) => {
  const parsed = ClientBody.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });
  const b = parsed.data;
  const agentId = req.user!.role === "admin" ? (b.agent_id ?? null) : req.user!.id;
  const row = await one(
    `INSERT INTO clients (company_name, contact_name, email, phone, address, agent_id, notes, payment_terms, vat_status, extra_emails, tin, consolidated_invoicing)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
    [
      b.company_name, b.contact_name, b.email || null, b.phone ?? null, b.address ?? null, agentId, b.notes ?? null,
      b.payment_terms ?? "net_30", b.vat_status ?? "vat_inclusive", b.extra_emails ?? [], b.tin ? encryptField(b.tin) : null,
      b.consolidated_invoicing ?? false,
    ]
  );
  await audit(req.user!.id, "client.created", "client", row.id);
  if (row.tin) row.tin = decryptField(row.tin);
  res.status(201).json(row);
});

/** PATCH /clients/:id — admin edits details or reassigns the agent. */
clientsRouter.patch("/:id", requireAdmin, async (req, res) => {
  const parsed = ClientBody.partial().safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });
  const b = parsed.data;
  const fields = Object.entries(b)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => (k === "tin" && v ? [k, encryptField(v as string)] : [k, v]))
    .map(([k, v]) => (k === "email" && v === "" ? [k, null] : [k, v]));
  if (!fields.length) return res.status(400).json({ error: "Nothing to update" });

  // Turning this off would strand any already-delivered orders that are
  // still waiting to be bundled into a consolidated invoice — consolidate
  // them first.
  if (b.consolidated_invoicing === false) {
    const stranded = await one(
      `SELECT o.id FROM orders o
        WHERE o.client_id = $1 AND o.status = 'approved'
          AND NOT EXISTS (SELECT 1 FROM invoices iv WHERE iv.order_id = o.id)
          AND NOT EXISTS (SELECT 1 FROM invoice_orders io WHERE io.order_id = o.id)
        LIMIT 1`,
      [req.params.id]
    );
    if (stranded)
      return res.status(409).json({
        error: "This client has delivered orders awaiting a consolidated invoice — generate that invoice before turning this off",
      });
  }

  const before = b.email !== undefined ? await one<{ email: string | null }>("SELECT email FROM clients WHERE id = $1", [req.params.id]) : null;

  const sets = fields.map(([k], i) => `${k} = $${i + 2}`).join(", ");
  const row = await one(
    `UPDATE clients SET ${sets}, updated_at = now() WHERE id = $1 RETURNING *`,
    [req.params.id, ...fields.map(([, v]) => v)]
  );
  if (!row) return res.status(404).json({ error: "Client not found" });
  // tin is never logged in plaintext, even here — the audit trail shouldn't hold what the column encrypts.
  await audit(req.user!.id, "client.updated", "client", row.id, { ...b, ...(b.tin !== undefined ? { tin: "[redacted]" } : {}) });
  if (row.tin) row.tin = decryptField(row.tin);

  // A corrected email means prior reminders almost certainly never reached
  // the client — send one right away instead of waiting on the frequency
  // cooldown those undelivered sends would otherwise impose.
  if (before && b.email && before.email?.toLowerCase() !== b.email.toLowerCase()) {
    sendImmediateReminderForClient(row.id).catch((e) =>
      console.error(`immediate reminder after email correction failed for client ${row.id}:`, e.message)
    );
  }

  res.json(row);
});

const ConsolidateBody = z.object({
  order_ids: z.array(z.string().uuid()).min(1, "Select at least one order"),
  invoice_no: z.string().trim().min(1, "Sales Invoice number is required"),
});

/**
 * POST /clients/:id/consolidated-invoice — admin bundles a hand-picked set
 * of this client's approved-but-not-yet-invoiced orders into ONE Sales
 * Invoice. Only for clients with consolidated_invoicing = true. The admin
 * still types the real SI number (never auto-generated, same as a normal
 * approval). due_date is derived from the client's own payment_terms, not
 * any individual order's — a consolidated invoice is one row covering many
 * orders, so it can only have one due date.
 */
clientsRouter.post("/:id/consolidated-invoice", requireAdmin, async (req, res) => {
  const parsed = ConsolidateBody.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });
  const { order_ids, invoice_no } = parsed.data;
  const clientId = req.params.id;

  const client = await one<{
    id: string;
    consolidated_invoicing: boolean;
    payment_terms: string;
    company_name: string;
    contact_name: string;
    email: string | null;
    extra_emails: string[];
  }>(
    "SELECT id, consolidated_invoicing, payment_terms, company_name, contact_name, email, extra_emails FROM clients WHERE id = $1",
    [clientId]
  );
  if (!client) return res.status(404).json({ error: "Client not found" });
  if (!client.consolidated_invoicing)
    return res.status(400).json({ error: "This client is not set up for consolidated invoicing" });

  let result: { invoice: any; order_ids: string[]; orderNos: string[] };
  try {
    result = await tx(async (c) => {
      // Belongs to this client, approved, and not already invoiced (either
      // a standalone invoice or a prior consolidated one) — locked so a
      // concurrent consolidate call can't double-book the same order.
      const eligRes = await c.query(
        `SELECT o.id, o.order_no FROM orders o
          WHERE o.id = ANY($1::uuid[]) AND o.client_id = $2 AND o.status = 'approved'
            AND NOT EXISTS (SELECT 1 FROM invoices iv WHERE iv.order_id = o.id)
            AND NOT EXISTS (SELECT 1 FROM invoice_orders io WHERE io.order_id = o.id)
          FOR UPDATE OF o`,
        [order_ids, clientId]
      );
      if (eligRes.rows.length !== order_ids.length) {
        const err: any = new Error(
          "One or more selected orders are not eligible — check they belong to this client, are approved, and aren't already invoiced."
        );
        err.code = "INELIGIBLE_ORDERS";
        throw err;
      }
      const eligibleIds: string[] = eligRes.rows.map((r) => r.id);
      const orderNos: string[] = eligRes.rows.map((r) => r.order_no);

      const totalRes = await c.query(
        "SELECT coalesce(sum(qty * unit_price), 0) AS total FROM order_items WHERE order_id = ANY($1::uuid[])",
        [eligibleIds]
      );
      const dueDays = DUE_DAYS[client.payment_terms] ?? 30;

      const invRes = await c.query(
        `INSERT INTO invoices (invoice_no, client_id, amount, due_date)
         VALUES ($1, $2, $3, CURRENT_DATE + $4::int) RETURNING *`,
        [invoice_no, clientId, totalRes.rows[0].total, dueDays]
      );
      const invoice = invRes.rows[0];
      for (const orderId of eligibleIds)
        await c.query("INSERT INTO invoice_orders (invoice_id, order_id) VALUES ($1, $2)", [invoice.id, orderId]);

      await audit(
        req.user!.id,
        "invoice.consolidated_created",
        "invoice",
        invoice.id,
        { invoice_no, order_ids: eligibleIds, amount: invoice.amount },
        c
      );
      return { invoice, order_ids: eligibleIds, orderNos };
    });
  } catch (err: any) {
    if (err?.code === "23505") {
      if (err.constraint === "idx_invoice_orders_order_unique")
        return res.status(409).json({ error: "One or more selected orders were just consolidated into another invoice" });
      return res.status(409).json({ error: `Invoice number ${invoice_no} is already in use` });
    }
    if (err?.code === "INELIGIBLE_ORDERS") return res.status(409).json({ error: err.message });
    throw err;
  }

  sendConsolidatedInvoiceNotice(result.invoice, result.orderNos, client).catch((e) =>
    console.error(`consolidated invoice notice failed for client ${clientId}:`, e.message)
  );

  res.status(201).json({ invoice: result.invoice, order_ids: result.order_ids });
});

/**
 * POST /clients/:id/documents/:type — admin uploads BIR COR 2303 or a PEZA
 * Certificate (JPG, PNG, or PDF) for the client. Replaces any existing file
 * of that type.
 */
clientsRouter.post(
  "/:id/documents/:type",
  requireAdmin,
  uploadDocLimiter,
  uploadDoc.single("file"),
  async (req, res) => {
    const clientId = String(req.params.id);
    const docType = String(req.params.type);
    const prefix = DOC_COLUMNS[docType];
    if (!prefix) return res.status(404).json({ error: "Unknown document type" });
    if (!req.file) return res.status(400).json({ error: "Attach a file (JPG, PNG, or PDF)" });
    const kind = validateUpload(req.file);
    if (!kind) return res.status(400).json({ error: "File must be a JPG, PNG, or PDF" });

    const key = await saveClientDocument(clientId, prefix, kind.ext, req.file.buffer);
    const row = await one(
      `UPDATE clients SET ${prefix}_key = $2, ${prefix}_name = $3, ${prefix}_mime = $4, ${prefix}_size_bytes = $5,
              updated_at = now()
        WHERE id = $1 RETURNING *`,
      [
        clientId,
        key,
        sanitizeFilename(req.file.originalname, `${prefix}.${kind.ext}`),
        kind.mime,
        req.file.size,
      ]
    );
    if (!row) return res.status(404).json({ error: "Client not found" });
    await audit(req.user!.id, "client.document_uploaded", "client", row.id, { type: docType });
    res.status(201).json(row);
  }
);

/** GET /clients/:id/documents/:type — admin views/downloads the stored document. */
clientsRouter.get("/:id/documents/:type", requireAdmin, async (req, res) => {
  const clientId = String(req.params.id);
  const docType = String(req.params.type);
  const prefix = DOC_COLUMNS[docType];
  if (!prefix) return res.status(404).json({ error: "Unknown document type" });

  const client = await one<Record<string, any>>(
    `SELECT ${prefix}_key AS key, ${prefix}_name AS name, ${prefix}_mime AS mime FROM clients WHERE id = $1`,
    [clientId]
  );
  if (!client || !client.key)
    return res.status(404).json({ error: `No ${DOC_LABELS[docType]} uploaded for this client` });
  const data = await readClientDocument(client.key);
  res.setHeader("Content-Type", client.mime);
  res.setHeader("Content-Disposition", `inline; filename="${String(client.name).replace(/"/g, "")}"`);
  res.send(data);
});

/** DELETE /clients/:id — admin removes a client with no order/invoice history. */
clientsRouter.delete("/:id", requireAdmin, async (req, res) => {
  try {
    const row = await one("DELETE FROM clients WHERE id = $1 RETURNING id", [req.params.id]);
    if (!row) return res.status(404).json({ error: "Client not found" });
    await audit(req.user!.id, "client.deleted", "client", row.id);
    res.status(204).end();
  } catch (err: any) {
    if (err?.code === "23503")
      return res.status(409).json({ error: "Can't delete a client with existing orders or invoices" });
    throw err;
  }
});
