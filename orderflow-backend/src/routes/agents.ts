import { Router } from "express";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { one, q } from "../db";
import { requireAdminPermission, requireAuth } from "../middleware/auth";
import { audit } from "../lib/notify";

export const agentsRouter = Router();
agentsRouter.use(requireAuth, requireAdminPermission("can_manage_agents"));

/** GET /agents — accounts with client counts, plus each agent's client group (mapping view). */
agentsRouter.get("/", async (_req, res) => {
  const rows = await q(
    `SELECT u.id, u.full_name, u.email, u.is_active, u.can_create_po, u.can_view_invoices,
            count(c.id) AS client_count
       FROM users u LEFT JOIN clients c ON c.agent_id = u.id
      WHERE u.role = 'agent'
      GROUP BY u.id ORDER BY u.full_name`
  );
  res.json(rows);
});

/** GET /agents/:id/clients — the agent–client mapping drill-down with order visibility. */
agentsRouter.get("/:id/clients", async (req, res) => {
  const rows = await q(
    `SELECT c.id, c.company_name, c.contact_name,
            count(o.id) AS order_count,
            max(o.created_at) AS latest_order_at
       FROM clients c LEFT JOIN orders o ON o.client_id = c.id
      WHERE c.agent_id = $1
      GROUP BY c.id ORDER BY c.company_name`,
    [req.params.id]
  );
  res.json(rows);
});

const CreateAgent = z.object({
  full_name: z.string().min(1),
  email: z.string().email(),
  password: z.string().min(10, "Password must be at least 10 characters"),
  can_create_po: z.boolean().optional(),
  can_view_invoices: z.boolean().optional(),
});

/** POST /agents — create an agent account. */
agentsRouter.post("/", async (req, res) => {
  const parsed = CreateAgent.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });
  const b = parsed.data;
  const exists = await one("SELECT 1 FROM users WHERE email = $1", [b.email]);
  if (exists) return res.status(409).json({ error: "An account with this email already exists" });

  const row = await one(
    `INSERT INTO users (role, full_name, email, password_hash, can_create_po, can_view_invoices)
     VALUES ('agent', $1, $2, $3, $4, $5)
     RETURNING id, full_name, email, is_active, can_create_po, can_view_invoices`,
    [b.full_name, b.email, await bcrypt.hash(b.password, 12), b.can_create_po ?? true, b.can_view_invoices ?? true]
  );
  await audit(req.user!.id, "agent.created", "user", row.id);
  res.status(201).json(row);
});

const PatchAgent = z.object({
  is_active: z.boolean().optional(),
  can_create_po: z.boolean().optional(),
  can_view_invoices: z.boolean().optional(),
  full_name: z.string().min(1).optional(),
});

/** PATCH /agents/:id — toggle active status and permissions. */
agentsRouter.patch("/:id", async (req, res) => {
  const parsed = PatchAgent.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });
  const fields = Object.entries(parsed.data).filter(([, v]) => v !== undefined);
  if (!fields.length) return res.status(400).json({ error: "Nothing to update" });

  const sets = fields.map(([k], i) => `${k} = $${i + 2}`).join(", ");
  const row = await one(
    `UPDATE users SET ${sets}, updated_at = now()
      WHERE id = $1 AND role = 'agent'
      RETURNING id, full_name, email, is_active, can_create_po, can_view_invoices`,
    [req.params.id, ...fields.map(([, v]) => v)]
  );
  if (!row) return res.status(404).json({ error: "Agent not found" });
  await audit(req.user!.id, "agent.updated", "user", row.id, parsed.data);
  res.json(row);
});

/** GET /agents/admins — every admin account and its restricted-access flags. */
agentsRouter.get("/admins", async (_req, res) => {
  const rows = await q(
    `SELECT id, full_name, email, is_active, can_manage_agents, can_manage_announcements
       FROM users WHERE role = 'admin' ORDER BY full_name`
  );
  res.json(rows);
});

const CreateAdmin = z.object({
  full_name: z.string().min(1),
  email: z.string().email(),
  password: z.string().min(10, "Password must be at least 10 characters"),
  can_manage_agents: z.boolean().optional(),
  can_manage_announcements: z.boolean().optional(),
});

/** POST /agents/admins — create an admin account, optionally restricted. */
agentsRouter.post("/admins", async (req, res) => {
  const parsed = CreateAdmin.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });
  const b = parsed.data;
  const exists = await one("SELECT 1 FROM users WHERE email = $1", [b.email]);
  if (exists) return res.status(409).json({ error: "An account with this email already exists" });

  const row = await one(
    `INSERT INTO users (role, full_name, email, password_hash, can_manage_agents, can_manage_announcements)
     VALUES ('admin', $1, $2, $3, $4, $5)
     RETURNING id, full_name, email, is_active, can_manage_agents, can_manage_announcements`,
    [
      b.full_name, b.email, await bcrypt.hash(b.password, 12),
      b.can_manage_agents ?? true, b.can_manage_announcements ?? true,
    ]
  );
  await audit(req.user!.id, "admin.created", "user", row.id);
  res.status(201).json(row);
});

const PatchAdmin = z.object({
  is_active: z.boolean().optional(),
  can_manage_agents: z.boolean().optional(),
  can_manage_announcements: z.boolean().optional(),
  full_name: z.string().min(1).optional(),
});

/** PATCH /agents/admins/:id — toggle another admin's active status and permissions. */
agentsRouter.patch("/admins/:id", async (req, res) => {
  if (req.params.id === req.user!.id)
    return res.status(400).json({ error: "You can't change your own permissions here — ask another admin." });

  const parsed = PatchAdmin.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });
  const fields = Object.entries(parsed.data).filter(([, v]) => v !== undefined);
  if (!fields.length) return res.status(400).json({ error: "Nothing to update" });

  const sets = fields.map(([k], i) => `${k} = $${i + 2}`).join(", ");
  const row = await one(
    `UPDATE users SET ${sets}, updated_at = now()
      WHERE id = $1 AND role = 'admin'
      RETURNING id, full_name, email, is_active, can_manage_agents, can_manage_announcements`,
    [req.params.id, ...fields.map(([, v]) => v)]
  );
  if (!row) return res.status(404).json({ error: "Admin account not found" });
  await audit(req.user!.id, "admin.updated", "user", row.id, parsed.data);
  res.json(row);
});
