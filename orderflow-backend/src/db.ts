import { Pool, PoolClient } from "pg";
import { config } from "./config";

export const pool = new Pool({ connectionString: config.databaseUrl });

// When the database drops an idle connection (a restart, maintenance, a region
// move), the pool emits 'error'. With no listener that is an unhandled event
// and the whole server exits. With one, the pool discards the broken
// connection and opens a fresh one on the next query.
pool.on("error", (err) => {
  console.error(`database connection lost, will reconnect on the next query: ${err.message}`);
});

/**
 * Wait until the database accepts queries. On boot the database may still be
 * starting (after a restart or a region move took several minutes), and giving
 * up straight away would leave the service crashed once its restarts run out.
 */
export const waitForDatabase = async (
  check: () => Promise<unknown> = () => pool.query("SELECT 1"),
  { attempts = 90, delayMs = 2000 }: { attempts?: number; delayMs?: number } = {}
): Promise<void> => {
  for (let attempt = 1; ; attempt++) {
    try {
      await check();
      return;
    } catch (err: any) {
      if (attempt >= attempts) throw err;
      console.warn(`database not reachable yet (attempt ${attempt}/${attempts}): ${err.message}`);
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
};

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
