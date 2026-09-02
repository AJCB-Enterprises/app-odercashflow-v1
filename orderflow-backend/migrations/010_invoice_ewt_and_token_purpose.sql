-- Move the BIR 2307 (EWT) file from receipts (tied to one upload event) to
-- invoices (a property of the invoice itself). This lets a client submit it
-- independently, any time -- including after the invoice is already paid --
-- rather than only bundled with a payment receipt.
ALTER TABLE invoices ADD COLUMN ewt_key TEXT;
ALTER TABLE invoices ADD COLUMN ewt_name TEXT;
ALTER TABLE invoices ADD COLUMN ewt_mime TEXT;
ALTER TABLE invoices ADD COLUMN ewt_size_bytes BIGINT;
ALTER TABLE invoices ADD COLUMN ewt_submitted_at TIMESTAMPTZ;

-- Carry forward any 2307 already submitted bundled with a receipt.
UPDATE invoices i SET
  ewt_key = r.ewt_key, ewt_name = r.ewt_name, ewt_mime = r.ewt_mime,
  ewt_size_bytes = r.ewt_size_bytes, ewt_submitted_at = r.uploaded_at
FROM (
  SELECT DISTINCT ON (invoice_id) invoice_id, ewt_key, ewt_name, ewt_mime, ewt_size_bytes, uploaded_at
    FROM receipts WHERE ewt_key IS NOT NULL
   ORDER BY invoice_id, uploaded_at DESC
) r
WHERE r.invoice_id = i.id;

ALTER TABLE receipts DROP COLUMN ewt_key;
ALTER TABLE receipts DROP COLUMN ewt_name;
ALTER TABLE receipts DROP COLUMN ewt_mime;
ALTER TABLE receipts DROP COLUMN ewt_size_bytes;

-- Upload tokens now come in two flavors: 'receipt' links are revoked once an
-- invoice is fully paid (nothing left to upload a receipt for); 'ewt' links
-- are deliberately left alive so a client can still submit their 2307 after
-- settling payment.
ALTER TABLE upload_tokens ADD COLUMN purpose TEXT NOT NULL DEFAULT 'receipt';
ALTER TABLE upload_tokens ADD CONSTRAINT upload_tokens_purpose_check CHECK (purpose IN ('receipt', 'ewt'));
