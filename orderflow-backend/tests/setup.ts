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

// Mirrors migrations/002_default_settings.sql. reminder_settings is reference
// data, not per-test data, but TRUNCATE ... CASCADE wipes it anyway (it has
// an FK -- updated_by -- referencing users, which is truncated below), so
// it's upserted back to defaults after every truncate rather than excluded.
const REMINDER_DEFAULTS_SQL = `
  INSERT INTO reminder_settings (id, type, days_before, frequency_days, send_time, timezone, template, is_enabled, updated_by)
  VALUES
    (1, 'payment', 3, 2, '08:00', 'Asia/Manila',
     'Hi {{contact}}, this is a friendly reminder that invoice {{invoice}} for {{amount}} is due on {{due}}. Use your secure link below to upload your payment receipt — no login needed.',
     true, NULL),
    (2, 'order', 0, 7, '09:00', 'Asia/Manila',
     'Hi {{contact}}, order {{order}} is awaiting action. Your agent will follow up, or expect an update soon.',
     true, NULL)
  ON CONFLICT (id) DO UPDATE SET
    days_before = EXCLUDED.days_before, frequency_days = EXCLUDED.frequency_days,
    send_time = EXCLUDED.send_time, timezone = EXCLUDED.timezone,
    template = EXCLUDED.template, is_enabled = EXCLUDED.is_enabled, updated_by = NULL
`;

/** Wipe all data between tests so they don't see each other's rows. */
export const truncateAll = async () => {
  const { rows } = await pool.query(
    "SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename != 'schema_migrations'"
  );
  const tables = rows.map((r: { tablename: string }) => `"${r.tablename}"`).join(", ");
  if (tables) await pool.query(`TRUNCATE TABLE ${tables} RESTART IDENTITY CASCADE`);
  await pool.query(REMINDER_DEFAULTS_SQL);
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
