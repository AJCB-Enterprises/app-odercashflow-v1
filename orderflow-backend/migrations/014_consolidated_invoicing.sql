-- Some clients place one PO covering a month of incremental deliveries and
-- want a single consolidated Sales Invoice issued only once the whole PO
-- has been delivered, instead of one invoice per approved order. This is a
-- pure client-level billing-arrangement flag, mirroring vat_status: no
-- per-order override (see orders.ts POST /orders comment on vat_status).
ALTER TABLE clients ADD COLUMN consolidated_invoicing BOOLEAN NOT NULL DEFAULT FALSE;

-- Junction table for consolidated invoices ONLY. The existing scalar
-- invoices.order_id column and the 1:1 non-consolidated approval flow are
-- completely untouched. For a consolidated invoice, invoices.order_id stays
-- NULL; this table records which orders it covers instead.
CREATE TABLE invoice_orders (
  invoice_id UUID NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  order_id   UUID NOT NULL REFERENCES orders(id),
  PRIMARY KEY (invoice_id, order_id)
);

-- An order can be consolidated into at most one invoice — defense in depth
-- alongside the application-level "not already invoiced" check.
CREATE UNIQUE INDEX idx_invoice_orders_order_unique ON invoice_orders(order_id);
