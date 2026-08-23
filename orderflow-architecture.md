# OrderFlow — Backend Architecture & Database Schema

This document turns the prototype into a buildable system. It covers the system architecture, the secure-token design for the client upload flow, the reminder scheduler, the PostgreSQL schema, and the API surface. Everything maps 1:1 to the project scope: client-facing reminder emails and receipt upload, the admin console, and the agent portal.

---

## 1. System overview

```
                        ┌─────────────────────────────────────────────┐
                        │                  Frontend                   │
                        │  React SPA (Admin + Agent, authenticated)   │
                        │  Public upload page (token URL, no login)   │
                        └────────────────┬────────────────────────────┘
                                         │ HTTPS / JSON
                        ┌────────────────▼────────────────────────────┐
                        │              API server                     │
                        │  Auth (sessions/JWT) · RBAC (admin/agent)   │
                        │  Orders · Invoices · Clients · Reminders    │
                        │  Public endpoints: GET/POST /upload/:token  │
                        └───────┬───────────────┬─────────────┬───────┘
                                │               │             │
                 ┌──────────────▼──┐   ┌────────▼──────┐  ┌───▼─────────────┐
                 │  PostgreSQL     │   │ Object storage│  │ Queue + worker  │
                 │  (all app data) │   │ (S3-style,    │  │ (reminder cron, │
                 │                 │   │  receipts)    │  │  email sending) │
                 └─────────────────┘   └───────────────┘  └───┬─────────────┘
                                                              │ SMTP/API
                                                      ┌───────▼─────────┐
                                                      │  Email service  │
                                                      │ (SES/Postmark/  │
                                                      │  SendGrid)      │
                                                      └─────────────────┘
```

A single API server with a background worker is enough for this scope — there is no payment processing, no high traffic, and the heaviest job is a daily reminder run. Avoid microservices here; a modular monolith keeps Mugna's build and hosting costs low.

**Suggested stack** (swap for team preference — the schema and flows are stack-agnostic):

| Layer | Recommendation | Alternative |
|---|---|---|
| API | Node.js + NestJS (TypeScript) | Laravel (PHP) — common in PH agencies |
| DB | PostgreSQL 16 | MySQL 8 |
| Queue/scheduler | BullMQ + Redis (or node-cron for v1) | Laravel Scheduler + Horizon |
| Object storage | AWS S3 / Cloudflare R2 | DigitalOcean Spaces |
| Email | Amazon SES or Postmark | SendGrid |
| Frontend | React + Vite (the prototype's UI carries over) | — |
| Hosting | Single VPS or ECS/App Platform + managed Postgres | — |

---

## 2. Key design decisions

### 2.1 Secure tokenized upload links (no login)

The scope requires that a client clicks an emailed link and lands on an upload page with no full login. The token *is* the authentication, so treat it like a credential:

1. When a reminder email is generated, create a random 256-bit token (`crypto.randomBytes(32)`), store only its SHA-256 hash in `upload_tokens`, and put the raw token in the URL: `https://pay.orderflow.ph/u/{token}`.
2. Scope each token to exactly one invoice, with an expiry (e.g. 30 days) and an optional max-use policy. Don't hard-limit to single use — clients often re-open the email — but invalidate all tokens for an invoice once it is marked paid.
3. The public page is read-minimal: it shows invoice number, client display name, amount, and due date — nothing else from the account — and accepts one file upload.
4. Rate-limit the public endpoints by IP and by token, and return the same 404 for "expired", "used", and "not found" so tokens can't be probed.

Upload handling: validate MIME type (JPEG/PNG/PDF) and size (≤10 MB) server-side, store to object storage under a non-guessable key (`receipts/{invoice_id}/{uuid}.{ext}`), never serve the bucket publicly, and generate short-lived signed URLs when the admin views a receipt. Add antivirus scanning (ClamAV lambda or a scanning proxy) if budget allows.

### 2.2 Reminder scheduler

One worker job runs every 15 minutes and asks: *which reminders are due to send right now?* This handles both reminder types from a single mechanism driven by the `reminder_settings` rows the admin edits.

Payment reminders — an invoice qualifies when it is `unpaid`, and `due_date - days_before ≤ today`, and the last entry in `reminder_logs` for that invoice is older than the configured frequency (or there is none). Overdue invoices keep qualifying on the same cadence until a receipt is uploaded. Each send generates a fresh upload token and renders the admin's template with `{{contact}}`, `{{invoice}}`, `{{amount}}`, `{{due}}`.

Order reminders — an order qualifies when it is `pending` (or `approved` with an unpaid invoice, if the client wants that variant) and its last order-reminder log is older than the configured frequency.

`reminder_logs` is the idempotency ledger: the worker writes a row per email inside the same transaction that enqueues it, so a crashed run never double-sends. The admin's "send time" is respected by only dispatching within the configured window in the business's timezone (`Asia/Manila`).

### 2.3 Roles and permissions

Two authenticated roles: `admin` and `agent`. Admin sees everything. Agents are row-scoped: every agent query is filtered by `clients.agent_id = current_user.id`, enforced in the API layer (and optionally with Postgres row-level security as defense in depth). The two per-agent toggles from the prototype (`can_create_po`, `can_view_invoices`) live as boolean columns and are checked per endpoint. Deactivating an agent (`is_active = false`) blocks login but preserves history.

### 2.4 Invoice status

Store only real states: `unpaid → receipt_uploaded → paid` (plus `void`). "Overdue" is derived (`status = 'unpaid' AND due_date < now()`), never stored — this avoids a nightly job flipping flags and guarantees the dashboard is always correct.

---

## 3. Database schema (PostgreSQL)

```sql
-- Enums ------------------------------------------------------------
CREATE TYPE user_role       AS ENUM ('admin', 'agent');
CREATE TYPE order_status    AS ENUM ('pending', 'approved', 'rejected', 'cancelled');
CREATE TYPE invoice_status  AS ENUM ('unpaid', 'receipt_uploaded', 'paid', 'void');
CREATE TYPE reminder_type   AS ENUM ('payment', 'order');

-- Users: admins and agents ----------------------------------------
CREATE TABLE users (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  role              user_role NOT NULL,
  full_name         TEXT NOT NULL,
  email             CITEXT NOT NULL UNIQUE,
  password_hash     TEXT NOT NULL,               -- argon2id
  is_active         BOOLEAN NOT NULL DEFAULT TRUE,
  can_create_po     BOOLEAN NOT NULL DEFAULT TRUE,   -- agent permission
  can_view_invoices BOOLEAN NOT NULL DEFAULT TRUE,   -- agent permission
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Clients: the customer directory ---------------------------------
CREATE TABLE clients (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_name  TEXT NOT NULL,
  contact_name  TEXT NOT NULL,
  email         CITEXT NOT NULL,
  phone         TEXT,
  address       TEXT,
  agent_id      UUID REFERENCES users(id),       -- agent–client mapping
  notes         TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_clients_agent  ON clients(agent_id);
CREATE INDEX idx_clients_search ON clients
  USING gin (to_tsvector('simple',
    company_name || ' ' || contact_name || ' ' || coalesce(email::text,'')));

-- Orders / purchase orders ----------------------------------------
CREATE TABLE orders (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_no       TEXT NOT NULL UNIQUE,           -- e.g. PO-2026-0043
  client_id      UUID NOT NULL REFERENCES clients(id),
  created_by     UUID REFERENCES users(id),      -- agent (NULL if client-submitted later)
  status         order_status NOT NULL DEFAULT 'pending',
  reject_reason  TEXT,
  reviewed_by    UUID REFERENCES users(id),
  reviewed_at    TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_orders_client ON orders(client_id);
CREATE INDEX idx_orders_status ON orders(status) WHERE status = 'pending';

CREATE TABLE order_items (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id    UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  description TEXT NOT NULL,
  qty         NUMERIC(12,2) NOT NULL CHECK (qty > 0),
  unit_price  NUMERIC(12,2) NOT NULL CHECK (unit_price >= 0)
);
CREATE INDEX idx_items_order ON order_items(order_id);

-- Invoices ---------------------------------------------------------
CREATE TABLE invoices (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_no  TEXT NOT NULL UNIQUE,              -- e.g. INV-2026-0121
  order_id    UUID REFERENCES orders(id),
  client_id   UUID NOT NULL REFERENCES clients(id),
  amount      NUMERIC(12,2) NOT NULL CHECK (amount >= 0),
  due_date    DATE NOT NULL,
  status      invoice_status NOT NULL DEFAULT 'unpaid',
  paid_at     TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_invoices_client ON invoices(client_id);
CREATE INDEX idx_invoices_due    ON invoices(due_date)
  WHERE status IN ('unpaid', 'receipt_uploaded');
-- "Overdue" is derived: status = 'unpaid' AND due_date < CURRENT_DATE

-- Receipt uploads --------------------------------------------------
CREATE TABLE receipts (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id     UUID NOT NULL REFERENCES invoices(id),
  storage_key    TEXT NOT NULL,                  -- s3 object key, never public
  original_name  TEXT NOT NULL,
  mime_type      TEXT NOT NULL,
  size_bytes     BIGINT NOT NULL,
  uploaded_via   UUID,                           -- upload_tokens.id used
  uploaded_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  verified_by    UUID REFERENCES users(id),      -- admin who marked paid
  verified_at    TIMESTAMPTZ
);
CREATE INDEX idx_receipts_invoice ON receipts(invoice_id);

-- Tokenized upload links ------------------------------------------
CREATE TABLE upload_tokens (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id  UUID NOT NULL REFERENCES invoices(id),
  token_hash  TEXT NOT NULL UNIQUE,              -- sha256(raw token)
  expires_at  TIMESTAMPTZ NOT NULL,
  revoked_at  TIMESTAMPTZ,                       -- set when invoice paid/void
  last_used_at TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_tokens_invoice ON upload_tokens(invoice_id);

-- Reminder configuration (admin-editable) -------------------------
CREATE TABLE reminder_settings (
  id             SMALLINT PRIMARY KEY,           -- one row per type
  type           reminder_type NOT NULL UNIQUE,
  days_before    INT NOT NULL DEFAULT 3,         -- payment only
  frequency_days INT NOT NULL DEFAULT 2,         -- resend cadence
  send_time      TIME NOT NULL DEFAULT '08:00',
  timezone       TEXT NOT NULL DEFAULT 'Asia/Manila',
  template       TEXT NOT NULL,
  is_enabled     BOOLEAN NOT NULL DEFAULT TRUE,
  updated_by     UUID REFERENCES users(id),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Reminder send ledger (idempotency + audit) ----------------------
CREATE TABLE reminder_logs (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type        reminder_type NOT NULL,
  invoice_id  UUID REFERENCES invoices(id),
  order_id    UUID REFERENCES orders(id),
  client_id   UUID NOT NULL REFERENCES clients(id),
  sent_to     CITEXT NOT NULL,
  subject     TEXT NOT NULL,
  provider_id TEXT,                              -- SES/Postmark message id
  sent_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_rlogs_invoice ON reminder_logs(invoice_id, sent_at DESC);
CREATE INDEX idx_rlogs_order   ON reminder_logs(order_id, sent_at DESC);

-- In-app notifications (admin + agent) ----------------------------
CREATE TABLE notifications (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users(id),
  body        TEXT NOT NULL,
  link_path   TEXT,                              -- e.g. /orders/PO-2026-0043
  read_at     TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_notif_user ON notifications(user_id, read_at, created_at DESC);

-- Audit trail (recommended) ---------------------------------------
CREATE TABLE audit_log (
  id          BIGSERIAL PRIMARY KEY,
  actor_id    UUID REFERENCES users(id),         -- NULL for token/public actions
  action      TEXT NOT NULL,                     -- 'order.approved', 'receipt.uploaded'
  entity_type TEXT NOT NULL,
  entity_id   UUID NOT NULL,
  detail      JSONB,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

Notes on the schema. Money uses `NUMERIC(12,2)`, never floats. `CITEXT` (extension) gives case-insensitive emails. Human-readable numbers (`PO-2026-0043`, `INV-2026-0121`) come from a per-year sequence at insert time so business documents stay recognizable while UUIDs remain the join keys. Admin notifications fan out to all admin users at write time, which keeps reads trivially simple at this scale.

---

## 4. API surface

Authenticated routes (session or JWT; `A` = admin only, `G` = agent, scoped to own clients):

```
POST   /auth/login · /auth/logout

GET    /dashboard/payments-due            A   overdue + due-soon summary
GET    /orders?status=pending             A/G list (agents: own clients only)
POST   /orders                            G   create PO (requires can_create_po)
GET    /orders/:id                        A/G includes client's pending invoices
POST   /orders/:id/approve                A   creates invoice, notifies, emails client
POST   /orders/:id/reject                 A   body: { reason? }

GET    /clients?search=                   A   directory (agents: GET /my/clients)
GET    /clients/:id                       A/G contact + orders + invoice status
PATCH  /clients/:id                       A   includes agent_id reassignment

GET    /invoices?client_id=&state=        A/G (agents require can_view_invoices)
POST   /invoices/:id/mark-paid            A   verifies receipt, revokes tokens

GET    /agents · POST /agents             A   create account, set permissions
PATCH  /agents/:id                        A   toggle active / permissions

GET    /reminders/settings                A
PUT    /reminders/settings/:type          A
POST   /reminders/run/:type               A   manual "run now"
GET    /reminders/logs                    A

GET    /notifications · POST /notifications/read-all
```

Public, token-authenticated, rate-limited:

```
GET    /u/:token          invoice summary for the upload page (404 on any failure)
POST   /u/:token/receipt  multipart upload → validates, stores, sets
                          invoice = receipt_uploaded, notifies admin + agent
```

---

## 5. Core flows (sequence)

**Order → invoice.** Agent `POST /orders` → row `pending` + notification to admins → admin opens review (response embeds the client's pending invoices, per scope) → approve: transactionally set `approved`, insert invoice (due date = terms, default net-14), notify agent, enqueue "order approved" email to client. Reject: set `rejected` + optional reason, notify agent.

**Payment reminder → receipt → paid.** Worker tick → eligible invoices (§2.2) → per invoice: insert `reminder_logs`, insert `upload_tokens`, enqueue email with link → client opens `/u/:token`, uploads receipt → API validates file, writes to S3, inserts `receipts`, sets invoice `receipt_uploaded`, notifies admins and the client's agent → admin views receipt via signed URL, `mark-paid` → invoice `paid`, tokens revoked, audit logged.

---

## 6. Security & operational checklist

Argon2id password hashing and lockout on repeated failures; HTTPS everywhere with HSTS; tokens hashed at rest and never logged; public endpoints rate-limited by IP and token with uniform 404s; file uploads validated by magic bytes, size-capped, stored privately, served only via short-lived signed URLs; SPF/DKIM/DMARC configured on the sending domain so reminders reach inboxes; email bounces recorded against `reminder_logs.provider_id` and surfaced to the admin; daily Postgres backups plus S3 versioning; all times stored UTC, rendered `Asia/Manila`; audit log rows for every approve/reject/mark-paid and every token-based upload.

A reasonable build sequence: (1) auth, users, clients, agent scoping · (2) orders + review + notifications · (3) invoices + token upload flow · (4) reminder settings + scheduler + email · (5) dashboard, directory search, audit, polish.
