import { Router } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import { one } from "../db";
import { config } from "../config";
import { PASSWORD_VERSION_SQL, requireAuth } from "../middleware/auth";
import { audit } from "../lib/notify";

export const authRouter = Router();

const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 20, standardHeaders: true });
// Per account as well as per network address, so guesses spread across many
// addresses still run into a ceiling. Only failed attempts count. The trade-off
// is that someone hammering an email can briefly lock that account's sign-in.
const loginAccountLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  skipSuccessfulRequests: true,
  keyGenerator: (req) => String(req.body?.email ?? "").trim().toLowerCase() || "no-email",
  message: { error: "Too many failed sign-in attempts for this account. Try again in a few minutes." },
});

// Compared against when the email is unknown, so a wrong email takes as long
// to answer as a wrong password and can't be told apart by response time.
const DUMMY_HASH = bcrypt.hashSync("not-a-real-password", 12);

const signToken = (user: { id: string; role: string }, passwordVersion: number) =>
  jwt.sign({ sub: user.id, role: user.role, pv: passwordVersion }, config.jwtSecret, {
    algorithm: "HS256",
    expiresIn: config.jwtExpires,
  } as jwt.SignOptions);

const passwordChangeLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 10, standardHeaders: true });

const LoginBody = z.object({ email: z.string().email(), password: z.string().min(1) });

authRouter.post("/login", loginLimiter, loginAccountLimiter, async (req, res) => {
  const parsed = LoginBody.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Email and password are required" });
  const { email, password } = parsed.data;

  const user = await one<{
    id: string; password_hash: string; role: string; full_name: string; is_active: boolean;
    can_manage_agents: boolean; can_manage_announcements: boolean; can_manage_products: boolean; pv: string;
  }>(
    `SELECT id, password_hash, role, full_name, is_active, can_manage_agents, can_manage_announcements, can_manage_products,
            ${PASSWORD_VERSION_SQL} AS pv
       FROM users WHERE email = $1`,
    [email]
  );
  // Same message for unknown email / wrong password / deactivated account.
  const fail = () => res.status(401).json({ error: "Invalid email or password" });
  const passwordOk = await bcrypt.compare(password, user?.password_hash ?? DUMMY_HASH);
  if (!user || !user.is_active || !passwordOk) return fail();

  const token = signToken(user, Number(user.pv));
  res.json({
    token,
    user: {
      id: user.id,
      role: user.role,
      full_name: user.full_name,
      can_manage_agents: user.can_manage_agents,
      can_manage_announcements: user.can_manage_announcements,
      can_manage_products: user.can_manage_products,
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
  // 400 rather than 401: the app treats any 401 as an expired session and signs the user out.
  if (!row || !(await bcrypt.compare(current_password, row.password_hash)))
    return res.status(400).json({ error: "Current password is incorrect" });

  const newHash = await bcrypt.hash(new_password, 12);
  const updated = await one<{ pv: string }>(
    `UPDATE users SET password_hash = $1, password_changed_at = now(), updated_at = now()
      WHERE id = $2 RETURNING ${PASSWORD_VERSION_SQL} AS pv`,
    [newHash, req.user!.id]
  );
  await audit(req.user!.id, "user.password_changed", "user", req.user!.id);
  // Every earlier token is now invalid, so hand this session a fresh one.
  res.json({ token: signToken(req.user!, Number(updated!.pv)) });
});
