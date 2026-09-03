import { Router } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import { one } from "../db";
import { config } from "../config";
import { requireAuth } from "../middleware/auth";
import { audit } from "../lib/notify";

export const authRouter = Router();

const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 20, standardHeaders: true });
const passwordChangeLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 10, standardHeaders: true });

const LoginBody = z.object({ email: z.string().email(), password: z.string().min(1) });

authRouter.post("/login", loginLimiter, async (req, res) => {
  const parsed = LoginBody.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Email and password are required" });
  const { email, password } = parsed.data;

  const user = await one<{
    id: string; password_hash: string; role: string; full_name: string; is_active: boolean;
    can_manage_agents: boolean; can_manage_announcements: boolean;
  }>(
    "SELECT id, password_hash, role, full_name, is_active, can_manage_agents, can_manage_announcements FROM users WHERE email = $1",
    [email]
  );
  // Same message for unknown email / wrong password / deactivated account.
  const fail = () => res.status(401).json({ error: "Invalid email or password" });
  if (!user || !user.is_active) return fail();
  if (!(await bcrypt.compare(password, user.password_hash))) return fail();

  const token = jwt.sign({ sub: user.id, role: user.role }, config.jwtSecret, {
    expiresIn: config.jwtExpires,
  } as jwt.SignOptions);
  res.json({
    token,
    user: {
      id: user.id,
      role: user.role,
      full_name: user.full_name,
      can_manage_agents: user.can_manage_agents,
      can_manage_announcements: user.can_manage_announcements,
    },
  });
});

const ChangePasswordBody = z.object({
  current_password: z.string().min(1),
  new_password: z.string().min(10, "New password must be at least 10 characters"),
});

/** PATCH /auth/password — self-service password change; requires the current password. */
authRouter.patch("/password", requireAuth, passwordChangeLimiter, async (req, res) => {
  const parsed = ChangePasswordBody.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });
  const { current_password, new_password } = parsed.data;

  const row = await one<{ password_hash: string }>("SELECT password_hash FROM users WHERE id = $1", [req.user!.id]);
  if (!row || !(await bcrypt.compare(current_password, row.password_hash)))
    return res.status(401).json({ error: "Current password is incorrect" });

  const newHash = await bcrypt.hash(new_password, 12);
  await one("UPDATE users SET password_hash = $1, updated_at = now() WHERE id = $2 RETURNING id", [
    newHash,
    req.user!.id,
  ]);
  await audit(req.user!.id, "user.password_changed", "user", req.user!.id);
  res.status(204).end();
});
