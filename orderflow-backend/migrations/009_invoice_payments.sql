-- Payment ledger: supports partial/short payments (e.g. net of BIR EWT
-- withholding) without losing history. balance_due is always computed from
-- this table, never stored, to avoid drift.
CREATE TABLE invoice_payments (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id       UUID NOT NULL REFERENCES invoices(id),
  receipt_id       UUID REFERENCES receipts(id),
  amount_received  NUMERIC(12,2) NOT NULL DEFAULT 0,
  ewt_amount       NUMERIC(12,2) NOT NULL DEFAULT 0,
  verified_by      UUID NOT NULL REFERENCES users(id),
  verified_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  note             TEXT
);
CREATE INDEX idx_invoice_payments_invoice ON invoice_payments(invoice_id);
