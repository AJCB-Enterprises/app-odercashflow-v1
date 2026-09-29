-- Agents can draft a price quotation for a client and email it directly --
-- simpler than a Sales Order: no PO number, no admin approval, and (for
-- now) no public accept/decline page or conversion into an order. VAT
-- status and payment terms are picked per quotation, pre-filled from the
-- client's own record by the frontend but not locked to it -- a quote is
-- just a proposal, unlike an order's payment_terms/vat_status.
CREATE TABLE quotations (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  quote_no      TEXT NOT NULL UNIQUE,
  client_id     UUID NOT NULL REFERENCES clients(id),
  created_by    UUID REFERENCES users(id),
  payment_terms payment_term_enum NOT NULL,
  vat_status    vat_status_enum NOT NULL,
  valid_until   DATE NOT NULL,
  sent_at       TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_quotations_client ON quotations(client_id);

CREATE TABLE quotation_items (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  quotation_id  UUID NOT NULL REFERENCES quotations(id) ON DELETE CASCADE,
  description   TEXT NOT NULL,
  qty           NUMERIC(12,2) NOT NULL CHECK (qty > 0),
  unit_price    NUMERIC(12,2) NOT NULL CHECK (unit_price >= 0)
);
