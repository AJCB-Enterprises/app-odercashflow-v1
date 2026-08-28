import { PoolClient } from "pg";

/**
 * Next human-readable document number, e.g. nextDocNo(c, "SO") -> "SO-2026-0007".
 * Uses an upsert on doc_counters inside the caller's transaction, so numbers
 * are gapless per year and safe under concurrency (row-level lock on upsert).
 * Sales Invoice numbers are the real, admin-entered official document numbers
 * and are never generated here.
 */
export const nextDocNo = async (client: PoolClient, kind: "SO"): Promise<string> => {
  const year = new Date().getFullYear();
  const res = await client.query(
    `INSERT INTO doc_counters (kind, year, counter) VALUES ($1, $2, 1)
     ON CONFLICT (kind, year) DO UPDATE SET counter = doc_counters.counter + 1
     RETURNING counter`,
    [kind, year]
  );
  const n = String(res.rows[0].counter).padStart(4, "0");
  return `${kind}-${year}-${n}`;
};

export const peso = (amount: string | number) =>
  "₱" + Number(amount).toLocaleString("en-PH", { minimumFractionDigits: 2 });

export const shortDate = (d: string | Date) =>
  new Date(d).toLocaleDateString("en-PH", { month: "short", day: "numeric", year: "numeric" });
