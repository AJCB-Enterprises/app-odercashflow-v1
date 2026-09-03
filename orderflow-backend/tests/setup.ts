import dotenv from "dotenv";
import path from "node:path";
import fs from "node:fs";
import { Pool } from "pg";

dotenv.config({ path: path.join(__dirname, "..", ".env.test") });

let pool: Pool;

const applyMigrations = async () => {
  pool = new Pool({ connectionString: process.env.DATABASE_URL });
  await pool.query("DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;");
  const dir = path.join(__dirname, "..", "migrations");
  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
  for (const file of files) {
    await pool.query(fs.readFileSync(path.join(dir, file), "utf8"));
  }
};

/** Wipe all data between tests so they don't see each other's rows. */
export const truncateAll = async () => {
  const { rows } = await pool.query("SELECT tablename FROM pg_tables WHERE schemaname = 'public'");
  const tables = rows.map((r: { tablename: string }) => `"${r.tablename}"`).join(", ");
  if (tables) await pool.query(`TRUNCATE TABLE ${tables} RESTART IDENTITY CASCADE`);
};

beforeAll(async () => {
  await applyMigrations();
});

beforeEach(async () => {
  await truncateAll();
});

afterAll(async () => {
  await pool.end();
});
