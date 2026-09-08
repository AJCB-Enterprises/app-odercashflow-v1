-- Consolidated-invoicing clients don't get a Sales Invoice at approval time
-- (see 014_consolidated_invoicing.sql) — instead each delivered order is
-- logged against its own Delivery Receipt (DR) number, the proof-of-delivery
-- document, so the eventual consolidated invoice can be traced back to every
-- DR it bills. CITEXT + unique, same treatment as invoices.invoice_no
-- (011_invoice_no_case_insensitive.sql) — DR books are also official
-- pre-numbered documents.
ALTER TABLE orders ADD COLUMN dr_no CITEXT;
CREATE UNIQUE INDEX idx_orders_dr_no_unique ON orders(dr_no);
