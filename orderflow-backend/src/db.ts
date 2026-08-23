import { Pool, PoolClient } from "pg";
import { config } from "./config";

export const pool = new Pool({ connectionString: config.databaseUrl });

export const q = async <T = any>(text: string, params: any[] = []): Promise<T[]> => {
  const res = await pool.query(text, params);
  return res.rows as T[];
};

export const one = async <T = any>(text: string, params: any[] = []): Promise<T | undefined> =>
  (await q<T>(text, params))[0];

/** Run fn inside a transaction; rolls back on throw. */
export const tx = async <T>(fn: (c: PoolClient) => Promise<T>): Promise<T> => {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const out = await fn(client);
    await client.query("COMMIT");
    return out;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
};
