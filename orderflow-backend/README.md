# OrderFlow Backend

Node.js + TypeScript + Express + PostgreSQL implementation of the OrderFlow scope: agent purchase orders, admin review and approval, invoices, secure tokenized receipt uploads (no client login), and scheduled payment/order reminder emails. See `orderflow-architecture.md` for the design rationale.

## Setup

Requires Node 20+ and PostgreSQL 13+.

```bash
cp .env.example .env          # then edit DATABASE_URL and JWT_SECRET
npm install
npm run migrate               # applies migrations/*.sql
npm run seed                  # demo admin, agents, clients, orders, invoices
npm run dev                   # API on :4000 + reminder worker (15-min tick)
```

With `SMTP_URL` left empty, every email prints to the console instead — including the tokenized upload link — so the whole flow is testable locally with nothing but Postgres.

Seed logins: `admin@orderflow.ph` / `admin-pass-123` and `rosa@orderflow.ph` / `agent-pass-123`.

## End-to-end walkthrough (curl)

```bash
# 1. Sign in as admin
TOKEN=$(curl -s localhost:4000/auth/login -H 'Content-Type: application/json' \
  -d '{"email":"admin@orderflow.ph","password":"admin-pass-123"}' | jq -r .token)
AUTH="Authorization: Bearer $TOKEN"

# 2. Payment-due dashboard (the seed includes an overdue invoice)
curl -s localhost:4000/dashboard/payments-due -H "$AUTH" | jq .summary

# 3. Review the pending order — response embeds the client's pending invoices
ORDER=$(curl -s 'localhost:4000/orders?status=pending' -H "$AUTH" | jq -r '.[0].id')
curl -s localhost:4000/orders/$ORDER -H "$AUTH" | jq '{order:.order.order_no, pending:.pending_invoices}'

# 4. Approve it — issues the invoice, notifies the agent, emails the client
curl -s -X POST localhost:4000/orders/$ORDER/approve -H "$AUTH" | jq .invoice.invoice_no

# 5. Run payment reminders now — watch the console for the emails + upload links
curl -s -X POST localhost:4000/reminders/run/payment -H "$AUTH" | jq

# 6. Act as the client: take a tok_... link from the console output
curl -s localhost:4000/u/<RAW_TOKEN> | jq                      # upload page data
curl -s -X POST localhost:4000/u/<RAW_TOKEN>/receipt -F file=@receipt.jpg | jq

# 7. Back as admin: verify and mark paid (revokes all tokens for the invoice)
curl -s 'localhost:4000/invoices?state=receipt_uploaded' -H "$AUTH" | jq
curl -s -X POST localhost:4000/invoices/<INVOICE_ID>/mark-paid -H "$AUTH" | jq .status
```

## Layout

```
migrations/            SQL schema (001) + default reminder settings (002)
src/index.ts           Express bootstrap + route mounting + worker start
src/migrate.ts         Minimal migration runner (schema_migrations table)
src/seed.ts            Demo data
src/config.ts          Env config
src/db.ts              pg pool, query helpers, tx()
src/middleware/auth.ts JWT auth, admin guard, agent permissions, row scoping
src/lib/tokens.ts      Upload tokens: random 256-bit, sha256 at rest, expiry, revoke
src/lib/storage.ts     Receipt storage (local disk, S3-shaped interface) + magic-byte sniffing
src/lib/email.ts       SMTP or console transport + {{placeholder}} templates
src/lib/numbering.ts   PO-2026-#### / INV-2026-#### counters (transactional)
src/lib/notify.ts      In-app notifications (admin fan-out) + audit log
src/routes/*.ts        auth, dashboard, clients, orders, invoices, agents, reminders, notifications, public
src/worker/reminders.ts Scheduler: eligibility queries, send-window, idempotency ledger
```

## Production notes

Swap `src/lib/storage.ts` internals for S3 (`PutObject` + presigned `GetObject`); the storage-key interface stays the same. Point `SMTP_URL` at SES/Postmark and set up SPF/DKIM/DMARC on the sending domain. Run the worker as a separate process if you scale beyond one API instance (or add a Postgres advisory lock around the tick). Terminate TLS at a proxy, keep `trust proxy` on, and schedule daily `pg_dump` backups plus receipt-directory (or bucket) versioning.
