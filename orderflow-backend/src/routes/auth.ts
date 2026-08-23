import { Router } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import { one } from "../db";
import { config } from "../config";

export const authRouter = Router();

const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 20, standardHeaders: true });

const LoginBody = z.object({ email: z.string().email(), password: z.string().min(1) });

authRouter.post("/login", loginLimiter, async (req, res) => {
  const parsed = LoginBody.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Email and password are required" });
  const { email, password } = parsed.data;

  const user = await one<{ id: string; password_hash: string; role: string; full_name: string; is_active: boolean }>(
    "SELECT id, password_hash, role, full_name, is_active FROM users WHERE email = $1",
    [email]
  );
  // Same message for unknown email / wrong password / deactivated account.
  const fail = () => res.status(401).json({ error: "Invalid email or password" });
  if (!user || !user.is_active) return fail();
  if (!(await bcrypt.compare(password, user.password_hash))) return fail();

  const token = jwt.sign({ sub: user.id, role: user.role }, config.jwtSecret, {
    expiresIn: config.jwtExpires,
  } as jwt.SignOptions);
  res.json({ token, user: { id: user.id, role: user.role, full_name: user.full_name } });
});
