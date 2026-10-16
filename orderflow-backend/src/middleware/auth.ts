import { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import { config } from "../config";
import { one } from "../db";

export interface AuthUser {
  id: string;
  role: "admin" | "agent";
  full_name: string;
  can_create_po: boolean;
  can_view_invoices: boolean;
  can_manage_agents: boolean;
  can_manage_announcements: boolean;
  can_manage_products: boolean;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

/** Milliseconds-since-epoch of the last password change, or 0 if it never changed. */
export const PASSWORD_VERSION_SQL = "COALESCE(floor(extract(epoch FROM password_changed_at) * 1000), 0)::bigint";

/** Bearer-token auth. Re-reads the user row so deactivation takes effect immediately. */
export const requireAuth = async (req: Request, res: Response, next: NextFunction) => {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  try {
    const payload = jwt.verify(token, config.jwtSecret, { algorithms: ["HS256"] }) as { sub: string; pv?: number };
    const row = await one<AuthUser & { pv: string }>(
      `SELECT id, role, full_name, can_create_po, can_view_invoices, can_manage_agents, can_manage_announcements, can_manage_products,
              ${PASSWORD_VERSION_SQL} AS pv
         FROM users WHERE id = $1 AND is_active`,
      [payload.sub]
    );
    if (!row) return res.status(401).json({ error: "Account not found or deactivated" });
    // The token carries the password version it was issued under; changing the
    // password moves the version on, which retires every earlier token. Tokens
    // issued before this existed have no version and match an unchanged password.
    if ((payload.pv ?? 0) !== Number(row.pv)) return res.status(401).json({ error: "Sign in required" });
    const { pv: _omit, ...user } = row;
    req.user = user;
    next();
  } catch {
    return res.status(401).json({ error: "Sign in required" });
  }
};

export const requireAdmin = (req: Request, res: Response, next: NextFunction) => {
  if (req.user?.role !== "admin") return res.status(403).json({ error: "Admin access required" });
  next();
};

export const requireAgentPermission =
  (perm: "can_create_po" | "can_view_invoices") => (req: Request, res: Response, next: NextFunction) => {
    const u = req.user!;
    if (u.role === "admin") return next();
    if (!u[perm]) return res.status(403).json({ error: "Your account does not have this permission" });
    next();
  };

/**
 * Gates an admin-only capability behind a per-account flag, for admin users
 * who shouldn't have full access (e.g. a restricted admin who can't manage
 * other accounts or send announcements). Non-admins are rejected the same
 * way requireAdmin does.
 */
export const requireAdminPermission =
  (perm: "can_manage_agents" | "can_manage_announcements" | "can_manage_products") => (req: Request, res: Response, next: NextFunction) => {
    const u = req.user!;
    if (u.role !== "admin") return res.status(403).json({ error: "Admin access required" });
    if (!u[perm]) return res.status(403).json({ error: "Your account does not have this permission" });
    next();
  };

/**
 * Agent row-scoping: every client-linked query appends this fragment so an
 * agent can only ever see rows for clients assigned to them. `alias` is the
 * clients table alias in the query; the caller pushes user.id into params.
 */
export const clientScopeSql = (user: AuthUser, alias: string, paramIndex: number) =>
  user.role === "admin" ? { sql: "", param: null } : { sql: ` AND ${alias}.agent_id = $${paramIndex}`, param: user.id };
