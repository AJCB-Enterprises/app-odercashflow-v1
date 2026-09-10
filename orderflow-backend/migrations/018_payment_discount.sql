-- Admin can apply a discount when recording a payment (e.g. an early-payment
-- or goodwill discount decided at settlement time, separate from any
-- discount already baked into the order) -- it closes the invoice balance
-- the same way EWT withholding does, without being cash actually received.
ALTER TABLE invoice_payments ADD COLUMN discount_amount NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (discount_amount >= 0);
