-- Clients flagged collects_in_person pay admin directly (check/cash) with no
-- self-service upload, so there's nothing on file proving the collection
-- happened. Admin can now encode the Collection Receipt (CR) number issued
-- for that payment -- an official pre-numbered document, same treatment as
-- invoice_no/dr_no elsewhere (never invented by the app, unique while set).
-- Nullable: most payments (uploaded-receipt clients) won't have one.
ALTER TABLE invoice_payments ADD COLUMN collection_receipt_no TEXT;
CREATE UNIQUE INDEX idx_invoice_payments_cr_no_unique ON invoice_payments(collection_receipt_no) WHERE collection_receipt_no IS NOT NULL;
