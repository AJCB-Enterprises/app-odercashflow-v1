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
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

/** Bearer-token auth. Re-reads the user row so deactivation takes effect immediately. */
export const requireAuth = async (req: Request, res: Response, next: NextFunction) => {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  try {
    const payload = jwt.verify(token, config.jwtSecret) as { sub: string };
    const user = await one<AuthUser>(
      "SELECT id, role, full_name, can_create_po, can_view_invoices FROM users WHERE id = $1 AND is_active",
      [payload.sub]
    );
    if (!user) return res.status(401).json({ error: "Account not found or deactivated" });
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
 * Agent row-scoping: every client-linked query appends this fragment so an
 * agent can only ever see rows for clients assigned to them. `alias` is the
 * clients table alias in the query; the caller pushes user.id into params.
 */
export const clientScopeSql = (user: AuthUser, alias: string, paramIndex: number) =>
  user.role === "admin" ? { sql: "", param: null } : { sql: ` AND ${alias}.agent_id = $${paramIndex}`, param: user.id };
