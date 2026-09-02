import crypto from "node:crypto";
import { PoolClient } from "pg";
import { one, q } from "../db";
import { config } from "../config";

const hash = (raw: string) => crypto.createHash("sha256").update(raw).digest("hex");

export type TokenPurpose = "receipt" | "ewt";

/**
 * Create an upload token for an invoice. Only the SHA-256 hash is stored;
 * the raw token goes into the emailed link and is never persisted or logged.
 * purpose distinguishes a payment-receipt link (revoked once the invoice is
 * fully paid) from a BIR 2307 (EWT) link (kept alive so a client can still
 * submit it after settling payment).
 */
export const issueUploadToken = async (
  invoiceId: string,
  client?: PoolClient,
  purpose: TokenPurpose = "receipt"
): Promise<string> => {
  const raw = crypto.randomBytes(32).toString("base64url");
  const sql = `INSERT INTO upload_tokens (invoice_id, token_hash, expires_at, purpose)
               VALUES ($1, $2, now() + make_interval(days => $3), $4)`;
  const params = [invoiceId, hash(raw), config.tokenTtlDays, purpose];
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
  ewt_name: string | null;
}

/**
 * Resolve a raw token to its invoice, scoped to the expected purpose (a
 * receipt link can't be used on the EWT page, and vice versa). Returns
 * undefined for missing, expired, revoked, and wrong-purpose tokens alike —
 * callers must respond with an identical 404 for all of them so tokens
 * cannot be probed.
 */
export const resolveUploadToken = async (
  raw: string,
  purpose: TokenPurpose = "receipt"
): Promise<TokenInvoice | undefined> => {
  if (!raw || raw.length > 128) return undefined;
  const row = await one<TokenInvoice>(
    `SELECT t.id AS token_id, i.id AS invoice_id, i.invoice_no, i.amount, i.due_date, i.status,
            (i.amount - COALESCE((SELECT SUM(amount_received + ewt_amount) FROM invoice_payments WHERE invoice_id = i.id), 0)) AS balance_due,
            c.company_name, c.contact_name, i.ewt_name
       FROM upload_tokens t
       JOIN invoices i ON i.id = t.invoice_id
       JOIN clients  c ON c.id = i.client_id
      WHERE t.token_hash = $1
        AND t.purpose = $2
        AND t.revoked_at IS NULL
        AND t.expires_at > now()`,
    [hash(raw), purpose]
  );
  if (row) await q("UPDATE upload_tokens SET last_used_at = now() WHERE id = $1", [row.token_id]);
  return row;
};

/**
 * Invalidate outstanding links for an invoice. Called with purpose="receipt"
 * when an invoice is fully paid, so any still-pending EWT link isn't killed
 * along with it; omit purpose to revoke everything (e.g. if the invoice is
 * voided).
 */
export const revokeInvoiceTokens = async (invoiceId: string, client?: PoolClient, purpose?: TokenPurpose) => {
  const sql = purpose
    ? "UPDATE upload_tokens SET revoked_at = now() WHERE invoice_id = $1 AND purpose = $2 AND revoked_at IS NULL"
    : "UPDATE upload_tokens SET revoked_at = now() WHERE invoice_id = $1 AND revoked_at IS NULL";
  const params = purpose ? [invoiceId, purpose] : [invoiceId];
  if (client) await client.query(sql, params);
  else await q(sql, params);
};

export const uploadUrl = (rawToken: string) => `${config.publicBaseUrl}/u/${rawToken}`;
export const ewtUploadUrl = (rawToken: string) => `${config.publicBaseUrl}/e/${rawToken}`;
