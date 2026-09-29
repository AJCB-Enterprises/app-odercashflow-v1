-- A quotation can carry its own flat peso discount (defaults to none) and a
-- free-text remarks field, both optional, same treatment as an order's own
-- discount_amount.
ALTER TABLE quotations ADD COLUMN discount_amount NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (discount_amount >= 0);
ALTER TABLE quotations ADD COLUMN remarks TEXT;
