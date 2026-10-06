import { Router } from "express";
import { z } from "zod";
import { one, q } from "../db";
import { requireAdminPermission, requireAuth } from "../middleware/auth";
import { audit } from "../lib/notify";
import { config } from "../config";

export const salesRouter = Router();
salesRouter.use(requireAuth);

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

/** The current month ("YYYY-MM") in the business timezone, not the server's. */
const currentMonth = () =>
  new Intl.DateTimeFormat("en-CA", { timeZone: config.appTz, year: "numeric", month: "2-digit" })
    .format(new Date())
    .slice(0, 7);

const parseMonth = (raw: unknown): string | null => {
  const m = raw === undefined || raw === "" ? currentMonth() : String(raw);
  return MONTH_RE.test(m) ? m : null;
};

/**
 * An order belongs to the agent who logged it. When an admin logged it on an
 * agent's behalf, it belongs to the client's assigned agent instead, so that
 * agent still gets the credit. Sales are grouped into months by when the
 * order was logged, in the business timezone. Only approved orders count as
 * achieved; pending ones are reported separately as pipeline. Rejected and
 * cancelled orders count for nothing. An order's value is its line items
 * less its own discount, matching the order list's total.
 */
const OWNER_SQL = "CASE WHEN cr.role = 'agent' THEN o.created_by ELSE c.agent_id END";
const ORDER_TOTALS_CTE = `
  ord AS (
    SELECT o.id, ${OWNER_SQL} AS agent_id, o.status, o.order_no, o.created_at, o.client_id,
           (cr.role = 'admin') AS logged_by_admin,
           greatest(0, coalesce(sum(oi.qty * oi.unit_price), 0) - o.discount_amount) AS total
      FROM orders o
      JOIN clients c ON c.id = o.client_id
      LEFT JOIN users cr ON cr.id = o.created_by
      LEFT JOIN order_items oi ON oi.order_id = o.id
     WHERE o.status IN ('approved', 'pending')
       AND (o.created_at AT TIME ZONE $2)::timestamp >= $1::date
       AND (o.created_at AT TIME ZONE $2)::timestamp < ($1::date + interval '1 month')
     GROUP BY o.id, cr.role, c.agent_id
  )`;

const SUMMARY_SELECT = `
  SELECT u.id AS agent_id, u.full_name, u.is_active,
         coalesce(sum(ord.total) FILTER (WHERE ord.status = 'approved'), 0) AS achieved,
         count(ord.id) FILTER (WHERE ord.status = 'approved')::int AS approved_count,
         coalesce(sum(ord.total) FILTER (WHERE ord.status = 'pending'), 0) AS pending_amount,
         count(ord.id) FILTER (WHERE ord.status = 'pending')::int AS pending_count,
         CASE WHEN t.target_amount > 0 THEN t.target_amount END AS target,
         CASE WHEN t.target_amount > 0 THEN to_char(t.month, 'YYYY-MM') END AS target_from
    FROM users u
    LEFT JOIN ord ON ord.agent_id = u.id
    LEFT JOIN LATERAL (
      SELECT target_amount, month FROM agent_targets
       WHERE agent_id = u.id AND month <= $1::date ORDER BY month DESC LIMIT 1
    ) t ON TRUE`;

const withMonth = (month: string) => `${month}-01`;

/**
 * GET /sales/summary?month=YYYY-MM — achieved vs target per agent for the
 * month. An admin sees every agent (inactive ones only if they logged orders
 * that month); an agent sees only themselves.
 */
salesRouter.get("/summary", async (req, res) => {
  const user = req.user!;
  const month = parseMonth(req.query.month);
  if (!month) return res.status(400).json({ error: "month must look like 2026-10" });

  const params: any[] = [withMonth(month), config.appTz];
  let where = "WHERE u.role = 'agent'";
  if (user.role !== "admin") {
    params.push(user.id);
    where += ` AND u.id = $${params.length}`;
  }
  const agents = await q(
    `WITH ${ORDER_TOTALS_CTE} ${SUMMARY_SELECT} ${where}
       AND (u.is_active OR EXISTS (SELECT 1 FROM ord WHERE ord.agent_id = u.id))
      GROUP BY u.id, t.target_amount, t.month
      ORDER BY achieved DESC, u.full_name`,
    params
  );
  res.json({ month, agents });
});

/**
 * GET /sales/agent/:id?month=YYYY-MM — one agent's month in detail: the
 * summary, the orders behind it, and the last six months side by side. An
 * agent can only open their own.
 */
salesRouter.get("/agent/:id", async (req, res) => {
  const user = req.user!;
  const agentId = String(req.params.id);
  if (user.role !== "admin" && user.id !== agentId) return res.status(403).json({ error: "Forbidden" });
  const month = parseMonth(req.query.month);
  if (!month) return res.status(400).json({ error: "month must look like 2026-10" });

  const start = withMonth(month);
  const summaryRows = await q(
    `WITH ${ORDER_TOTALS_CTE} ${SUMMARY_SELECT} WHERE u.id = $3 AND u.role = 'agent' GROUP BY u.id, t.target_amount, t.month`,
    [start, config.appTz, agentId]
  );
  if (!summaryRows.length) return res.status(404).json({ error: "Agent not found" });

  const [orders, history] = await Promise.all([
    q(
      `WITH ${ORDER_TOTALS_CTE}
       SELECT ord.id, ord.order_no, ord.status, ord.created_at, ord.total, ord.logged_by_admin, c.company_name
         FROM ord JOIN clients c ON c.id = ord.client_id
        WHERE ord.agent_id = $3 ORDER BY ord.created_at DESC`,
      [start, config.appTz, agentId]
    ),
    q(
      `SELECT to_char(m, 'YYYY-MM') AS month,
              coalesce((
                SELECT sum(t.total) FROM (
                  SELECT greatest(0, coalesce(sum(oi.qty * oi.unit_price), 0) - o.discount_amount) AS total
                    FROM orders o
                    JOIN clients c ON c.id = o.client_id
                    LEFT JOIN users cr ON cr.id = o.created_by
                    LEFT JOIN order_items oi ON oi.order_id = o.id
                   WHERE ${OWNER_SQL} = $1 AND o.status = 'approved'
                     AND (o.created_at AT TIME ZONE $3)::timestamp >= m
                     AND (o.created_at AT TIME ZONE $3)::timestamp < m + interval '1 month'
                   GROUP BY o.id, cr.role, c.agent_id
                ) t
              ), 0) AS achieved,
              (SELECT CASE WHEN target_amount > 0 THEN target_amount END FROM agent_targets
                WHERE agent_id = $1 AND month <= m::date ORDER BY month DESC LIMIT 1) AS target
         FROM generate_series($2::date - interval '5 months', $2::date, interval '1 month') m
        ORDER BY m DESC`,
      [agentId, start, config.appTz]
    ),
  ]);
  res.json({ month, summary: summaryRows[0], orders, history });
});

const TargetBody = z.object({
  agent_id: z.string().uuid(),
  month: z.string().regex(MONTH_RE, "month must look like 2026-10"),
  target_amount: z.number().min(0),
});

/**
 * PUT /sales/targets — admin sets an agent's target from a month onward (it
 * carries forward until a later month sets another). 0 clears the target.
 */
salesRouter.put("/targets", requireAdminPermission("can_manage_agents"), async (req, res) => {
  const parsed = TargetBody.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });
  const { agent_id, month, target_amount } = parsed.data;

  const agent = await one("SELECT id FROM users WHERE id = $1 AND role = 'agent'", [agent_id]);
  if (!agent) return res.status(404).json({ error: "Agent not found" });

  const row = await one(
    `INSERT INTO agent_targets (agent_id, month, target_amount, set_by) VALUES ($1, $2::date, $3, $4)
     ON CONFLICT (agent_id, month) DO UPDATE
       SET target_amount = EXCLUDED.target_amount, set_by = EXCLUDED.set_by, updated_at = now()
     RETURNING agent_id, to_char(month, 'YYYY-MM') AS month, target_amount`,
    [agent_id, withMonth(month), target_amount, req.user!.id]
  );
  await audit(req.user!.id, "sales.target_set", "user", agent_id, { month, target_amount });
  res.json(row);
});
