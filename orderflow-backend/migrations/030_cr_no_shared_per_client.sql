-- One client payment can settle several invoices, and the one Collection
-- Receipt issued for it should be recorded on each of them. The blanket unique
-- index on collection_receipt_no forbade that, so it becomes a plain lookup
-- index; the API now refuses a CR number only when it is already used for a
-- different client (almost always a typo), which a unique index can't express.
DROP INDEX IF EXISTS idx_invoice_payments_cr_no_unique;
CREATE INDEX idx_invoice_payments_cr_no ON invoice_payments(collection_receipt_no) WHERE collection_receipt_no IS NOT NULL;
