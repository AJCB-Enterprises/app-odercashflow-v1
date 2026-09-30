-- A simple admin-maintained price list agents can pick from when drafting a
-- quotation. Picking one just pre-fills that line item's description/price
-- into the form — nothing here is referenced by quotation_items, so
-- deactivating (or editing) a product never touches quotations already sent.
CREATE TABLE products (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  description TEXT NOT NULL,
  unit_price NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (unit_price >= 0),
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
