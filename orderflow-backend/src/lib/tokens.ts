import crypto from "node:crypto";
import { PoolClient } from "pg";
import { one, q } from "../db";
import { config } from "../config";

const hash = (raw: string) => crypto.createHash("sha256").update(raw).digest("hex");

/**
 * Create an upload token for an invoice. Only the SHA-256 hash is stored;
 * the raw token goes into the emailed link and is never persisted or logged.
 */
export const issueUploadToken = async (invoiceId: string, client?: PoolClient): Promise<string> => {
  const raw = crypto.randomBytes(32).toString("base64url");
  const sql = `INSERT INTO upload_tokens (invoice_id, token_hash, expires_at)
               VALUES ($1, $2, now() + make_interval(days => $3))`;
  const params = [invoiceId, hash(raw), config.tokenTtlDays];
  if (client) await client.query(sql, params);
  else await q(sql, params);
  return raw;
};

export interface TokenInvoice {
  token_id: string;
  invoice_id: string;
  invoice_no: string;
  amount: string;
  balance_due: string;
  due_date: string;
  status: string;
  company_name: string;
  contact_name: string;
}

/**
 * Resolve a raw token to its invoice. Returns undefined for missing, expired,
 * and revoked tokens alike — callers must respond with an identical 404 for all
 * three so tokens cannot be probed.
 */
export const resolveUploadToken = async (raw: string): Promise<TokenInvoice | undefined> => {
  if (!raw || raw.length > 128) return undefined;
  const row = await one<TokenInvoice>(
    `SELECT t.id AS token_id, i.id AS invoice_id, i.invoice_no, i.amount, i.due_date, i.status,
            (i.amount - COALESCE((SELECT SUM(amount_received + ewt_amount) FROM invoice_payments WHERE invoice_id = i.id), 0)) AS balance_due,
            c.company_name, c.contact_name
       FROM upload_tokens t
       JOIN invoices i ON i.id = t.invoice_id
       JOIN clients  c ON c.id = i.client_id
      WHERE t.token_hash = $1
        AND t.revoked_at IS NULL
        AND t.expires_at > now()`,
    [hash(raw)]
  );
  if (row) await q("UPDATE upload_tokens SET last_used_at = now() WHERE id = $1", [row.token_id]);
  return row;
};

/** Invalidate every outstanding link for an invoice (called on mark-paid / void). */
export const revokeInvoiceTokens = async (invoiceId: string, client?: PoolClient) => {
  const sql = "UPDATE upload_tokens SET revoked_at = now() WHERE invoice_id = $1 AND revoked_at IS NULL";
  if (client) await client.query(sql, [invoiceId]);
  else await q(sql, [invoiceId]);
};

export const uploadUrl = (rawToken: string) => `${config.publicBaseUrl}/u/${rawToken}`;
