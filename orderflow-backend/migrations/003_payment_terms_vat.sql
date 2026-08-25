-- Payment terms and VAT status, settable per client (as a default) and per order (can override).
CREATE TYPE payment_term_enum AS ENUM ('net_15', 'net_30', 'net_45', 'cod');
CREATE TYPE vat_status_enum   AS ENUM ('vat_exempt', 'vat_inclusive', 'zero_rated');

ALTER TABLE clients ADD COLUMN payment_terms payment_term_enum NOT NULL DEFAULT 'net_30';
ALTER TABLE clients ADD COLUMN vat_status     vat_status_enum   NOT NULL DEFAULT 'vat_inclusive';

ALTER TABLE orders ADD COLUMN payment_terms payment_term_enum NOT NULL DEFAULT 'net_30';
ALTER TABLE orders ADD COLUMN vat_status     vat_status_enum   NOT NULL DEFAULT 'vat_inclusive';
