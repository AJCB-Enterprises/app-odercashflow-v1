-- OrderFlow initial schema (see orderflow-architecture.md §3)
CREATE EXTENSION IF NOT EXISTS citext;
CREATE EXTENSION IF NOT EXISTS pgcrypto; -- gen_random_uuid on PG < 13

CREATE TYPE user_role      AS ENUM ('admin', 'agent');
CREATE TYPE order_status   AS ENUM ('pending', 'approved', 'rejected', 'cancelled');
CREATE TYPE invoice_status AS ENUM ('unpaid', 'receipt_uploaded', 'paid', 'void');
CREATE TYPE reminder_type  AS ENUM ('payment', 'order');

CREATE TABLE users (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  role              user_role NOT NULL,
  full_name         TEXT NOT NULL,
  email             CITEXT NOT NULL UNIQUE,
  password_hash     TEXT NOT NULL,
  is_active         BOOLEAN NOT NULL DEFAULT TRUE,
  can_create_po     BOOLEAN NOT NULL DEFAULT TRUE,
  can_view_invoices BOOLEAN NOT NULL DEFAULT TRUE,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE clients (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_name TEXT NOT NULL,
  contact_name TEXT NOT NULL,
  email        CITEXT NOT NULL,
  phone        TEXT,
  address      TEXT,
  agent_id     UUID REFERENCES users(id),
  notes        TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_clients_agent ON clients(agent_id);
CREATE INDEX idx_clients_search ON clients
  USING gin (to_tsvector('simple', company_name || ' ' || contact_name || ' ' || coalesce(email::text, '')));

CREATE TABLE orders (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_no      TEXT NOT NULL UNIQUE,
  client_id     UUID NOT NULL REFERENCES clients(id),
  created_by    UUID REFERENCES users(id),
  status        order_status NOT NULL DEFAULT 'pending',
  reject_reason TEXT,
  reviewed_by   UUID REFERENCES users(id),
  reviewed_at   TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_orders_client ON orders(client_id);
CREATE INDEX idx_orders_pending ON orders(status) WHERE status = 'pending';

CREATE TABLE order_items (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id    UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  description TEXT NOT NULL,
  qty         NUMERIC(12,2) NOT NULL CHECK (qty > 0),
  unit_price  NUMERIC(12,2) NOT NULL CHECK (unit_price >= 0)
);
CREATE INDEX idx_items_order ON order_items(order_id);

CREATE TABLE invoices (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_no TEXT NOT NULL UNIQUE,
  order_id   UUID REFERENCES orders(id),
  client_id  UUID NOT NULL REFERENCES clients(id),
  amount     NUMERIC(12,2) NOT NULL CHECK (amount >= 0),
  due_date   DATE NOT NULL,
  status     invoice_status NOT NULL DEFAULT 'unpaid',
  paid_at    TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_invoices_client ON invoices(client_id);
CREATE INDEX idx_invoices_open_due ON invoices(due_date) WHERE status IN ('unpaid','receipt_uploaded');

CREATE TABLE receipts (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id    UUID NOT NULL REFERENCES invoices(id),
  storage_key   TEXT NOT NULL,
  original_name TEXT NOT NULL,
  mime_type     TEXT NOT NULL,
  size_bytes    BIGINT NOT NULL,
  uploaded_via  UUID,
  uploaded_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  verified_by   UUID REFERENCES users(id),
  verified_at   TIMESTAMPTZ
);
CREATE INDEX idx_receipts_invoice ON receipts(invoice_id);

CREATE TABLE upload_tokens (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id   UUID NOT NULL REFERENCES invoices(id),
  token_hash   TEXT NOT NULL UNIQUE,
  expires_at   TIMESTAMPTZ NOT NULL,
  revoked_at   TIMESTAMPTZ,
  last_used_at TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_tokens_invoice ON upload_tokens(invoice_id);

CREATE TABLE reminder_settings (
  id             SMALLINT PRIMARY KEY,
  type           reminder_type NOT NULL UNIQUE,
  days_before    INT NOT NULL DEFAULT 3,
  frequency_days INT NOT NULL DEFAULT 2,
  send_time      TIME NOT NULL DEFAULT '08:00',
  timezone       TEXT NOT NULL DEFAULT 'Asia/Manila',
  template       TEXT NOT NULL,
  is_enabled     BOOLEAN NOT NULL DEFAULT TRUE,
  updated_by     UUID REFERENCES users(id),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE reminder_logs (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type        reminder_type NOT NULL,
  invoice_id  UUID REFERENCES invoices(id),
  order_id    UUID REFERENCES orders(id),
  client_id   UUID NOT NULL REFERENCES clients(id),
  sent_to     CITEXT NOT NULL,
  subject     TEXT NOT NULL,
  provider_id TEXT,
  sent_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_rlogs_invoice ON reminder_logs(invoice_id, sent_at DESC);
CREATE INDEX idx_rlogs_order ON reminder_logs(order_id, sent_at DESC);

CREATE TABLE notifications (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES users(id),
  body       TEXT NOT NULL,
  link_path  TEXT,
  read_at    TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_notif_user ON notifications(user_id, read_at, created_at DESC);

CREATE TABLE audit_log (
  id          BIGSERIAL PRIMARY KEY,
  actor_id    UUID REFERENCES users(id),
  action      TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id   TEXT NOT NULL,   -- not always a UUID (e.g. reminder_settings, doc types)
  detail      JSONB,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Per-year human-readable document numbers (PO-2026-0001, INV-2026-0001)
CREATE TABLE doc_counters (
  kind    TEXT NOT NULL,
  year    INT NOT NULL,
  counter INT NOT NULL DEFAULT 0,
  PRIMARY KEY (kind, year)
);
