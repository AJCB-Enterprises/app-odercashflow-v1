import { Router } from "express";
import { z } from "zod";
import { one, q } from "../db";
import { clientScopeSql, requireAdmin, requireAuth } from "../middleware/auth";
import { audit } from "../lib/notify";

export const clientsRouter = Router();
clientsRouter.use(requireAuth);

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

  const [orders, invoices] = await Promise.all([
    q(
      `SELECT o.id, o.order_no, o.status, o.reject_reason, o.created_at,
              coalesce(sum(oi.qty * oi.unit_price), 0) AS total
         FROM orders o LEFT JOIN order_items oi ON oi.order_id = o.id
        WHERE o.client_id = $1 GROUP BY o.id ORDER BY o.created_at DESC`,
      [req.params.id]
    ),
    q(
      `SELECT id, invoice_no, amount, due_date, status,
              (status = 'unpaid' AND due_date < CURRENT_DATE) AS is_overdue
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
  phone: z.string().optional(),
  address: z.string().optional(),
  agent_id: z.string().uuid().nullable().optional(),
  notes: z.string().optional(),
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
    `INSERT INTO clients (company_name, contact_name, email, phone, address, agent_id, notes)
     VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
    [b.company_name, b.contact_name, b.email, b.phone ?? null, b.address ?? null, agentId, b.notes ?? null]
  );
  await audit(req.user!.id, "client.created", "client", row.id);
  res.status(201).json(row);
});

/** PATCH /clients/:id — admin edits details or reassigns the agent. */
clientsRouter.patch("/:id", requireAdmin, async (req, res) => {
  const parsed = ClientBody.partial().safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });
  const b = parsed.data;
  const fields = Object.entries(b).filter(([, v]) => v !== undefined);
  if (!fields.length) return res.status(400).json({ error: "Nothing to update" });
  const sets = fields.map(([k], i) => `${k} = $${i + 2}`).join(", ");
  const row = await one(
    `UPDATE clients SET ${sets}, updated_at = now() WHERE id = $1 RETURNING *`,
    [req.params.id, ...fields.map(([, v]) => v)]
  );
  if (!row) return res.status(404).json({ error: "Client not found" });
  await audit(req.user!.id, "client.updated", "client", row.id, b);
  res.json(row);
});
