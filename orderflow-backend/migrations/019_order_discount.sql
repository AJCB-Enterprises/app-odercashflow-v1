-- Agents can apply a discount when creating (or revising, while still
-- pending) a sales order -- e.g. a bulk or loyalty discount agreed with the
-- client. It reduces the amount invoiced on approval. Capped at the item
-- subtotal at the application layer, since the subtotal itself is derived
-- from order_items rather than stored on the order.
ALTER TABLE orders ADD COLUMN discount_amount NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (discount_amount >= 0);
