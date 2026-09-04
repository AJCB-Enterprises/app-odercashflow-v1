import { Router } from "express";
import multer from "multer";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import { one, q } from "../db";
import { clientScopeSql, requireAdmin, requireAuth } from "../middleware/auth";
import { audit } from "../lib/notify";
import { config } from "../config";
import { decryptField, encryptField } from "../lib/crypto";
import { sendImmediateReminderForClient } from "../worker/reminders";
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
            c.payment_terms, c.vat_status, c.extra_emails,
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
      `SELECT o.id, o.order_no, o.status, o.reject_reason, o.created_at,
              coalesce(sum(oi.qty * oi.unit_price), 0) AS total
         FROM orders o LEFT JOIN order_items oi ON oi.order_id = o.id
        WHERE o.client_id = $1 GROUP BY o.id ORDER BY o.created_at DESC`,
      [req.params.id]
    ),
    q(
      `SELECT id, invoice_no, amount, due_date, status, ewt_name,
              (status = 'unpaid' AND due_date < CURRENT_DATE) AS is_overdue,
              (amount - COALESCE((SELECT SUM(amount_received + ewt_amount) FROM invoice_payments WHERE invoice_id = invoices.id), 0)) AS balance_due,
              COALESCE((SELECT SUM(ewt_amount) FROM invoice_payments WHERE invoice_id = invoices.id), 0) AS total_ewt,
              (SELECT original_name FROM receipts WHERE invoice_id = invoices.id ORDER BY uploaded_at DESC LIMIT 1) AS receipt_name
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
  email: z.string().email(),
  phone: z.string().min(1, "Phone is required"),
  address: z.string().min(1, "Address is required"),
  agent_id: z.string().uuid().nullable().optional(),
  notes: z.string().optional(),
  payment_terms: z.enum(["net_15", "net_30", "net_45", "cod"]).optional(),
  vat_status: z.enum(["vat_exempt", "vat_inclusive", "zero_rated"]).optional(),
  extra_emails: z.array(z.string().email()).optional(),
  tin: z.string().min(1, "TIN is required"),
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
    `INSERT INTO clients (company_name, contact_name, email, phone, address, agent_id, notes, payment_terms, vat_status, extra_emails, tin)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
    [
      b.company_name, b.contact_name, b.email, b.phone ?? null, b.address ?? null, agentId, b.notes ?? null,
      b.payment_terms ?? "net_30", b.vat_status ?? "vat_inclusive", b.extra_emails ?? [], b.tin ? encryptField(b.tin) : null,
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
    .map(([k, v]) => (k === "tin" && v ? [k, encryptField(v as string)] : [k, v]));
  if (!fields.length) return res.status(400).json({ error: "Nothing to update" });

  const before = b.email !== undefined ? await one<{ email: string }>("SELECT email FROM clients WHERE id = $1", [req.params.id]) : null;

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
  if (before && b.email && before.email.toLowerCase() !== b.email.toLowerCase()) {
    sendImmediateReminderForClient(row.id).catch((e) =>
      console.error(`immediate reminder after email correction failed for client ${row.id}:`, e.message)
    );
  }

  res.json(row);
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
