-- Simple in/out-of-stock flag on the price list, so admin and agents can see
-- an unavailable item before an order for it is approved and invoiced, rather
-- than finding out afterward. Not a quantity -- just a manual availability
-- switch; defaults to in stock so existing products are unaffected.
ALTER TABLE products ADD COLUMN in_stock BOOLEAN NOT NULL DEFAULT true;
