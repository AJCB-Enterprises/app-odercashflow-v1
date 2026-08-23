import fs from "node:fs";
import path from "node:path";
import { pool } from "./db";

/** Applies migrations/*.sql in filename order, tracking them in schema_migrations. */
const run = async () => {
  await pool.query(
    "CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())"
  );
  const dir = path.join(__dirname, "..", "migrations");
  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
  for (const file of files) {
    const done = await pool.query("SELECT 1 FROM schema_migrations WHERE name = $1", [file]);
    if (done.rowCount) continue;
    const sql = fs.readFileSync(path.join(dir, file), "utf8");
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(sql);
      await client.query("INSERT INTO schema_migrations (name) VALUES ($1)", [file]);
      await client.query("COMMIT");
      console.log(`applied ${file}`);
    } catch (err) {
      await client.query("ROLLBACK");
      console.error(`FAILED ${file}`);
      throw err;
    } finally {
      client.release();
    }
  }
  await pool.end();
  console.log("migrations up to date");
};

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
