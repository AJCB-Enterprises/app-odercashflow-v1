-- A voided Sales Invoice number should be reusable — the SI book number
-- identifies the physical document, and once that invoice is void, admin
-- can reissue the same number on a different (corrected) approved order.
-- Replace the blanket unique constraint with one that only applies to
-- non-void invoices, so a void row no longer permanently occupies its number.
ALTER TABLE invoices DROP CONSTRAINT invoices_invoice_no_key;
CREATE UNIQUE INDEX idx_invoices_invoice_no_unique ON invoices(invoice_no) WHERE status != 'void';
