import "dotenv/config";
import bcrypt from "bcryptjs";
import { pool } from "./db";

/**
 * One-off bootstrap for the first real Admin on a fresh database (e.g. a new
 * satellite-office instance). Not part of the migration pipeline — run once
 * by hand. Never run seed.ts (demo data) against a production database.
 */
async function main() {
  const email = process.env.ADMIN_EMAIL;
  const name = process.env.ADMIN_NAME;
  const password = process.env.ADMIN_PASSWORD;
  if (!email || !name || !password) {
    console.error("Usage: ADMIN_EMAIL=... ADMIN_NAME=... ADMIN_PASSWORD=... npm run create-admin");
    process.exit(1);
  }

  const existing = await pool.query("SELECT id FROM users WHERE email = $1", [email]);
  if (existing.rows[0]) {
    console.log(`User ${email} already exists (id ${existing.rows[0].id}) — no changes made.`);
    await pool.end();
    process.exit(0);
  }

  const hash = await bcrypt.hash(password, 12);
  const { rows } = await pool.query(
    `INSERT INTO users (role, full_name, email, password_hash, can_manage_agents, can_manage_announcements)
     VALUES ('admin', $1, $2, $3, true, true) RETURNING id`,
    [name, email, hash]
  );
  console.log(`Created admin ${email} (id ${rows[0].id}).`);
  await pool.end();
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
