# OrderFlow Frontend

React + Vite + TypeScript client for the OrderFlow API. Staff (admin/agent) sign in;
clients never log in — they land on the public upload page from the tokenized link in
their reminder email.

## Setup

```bash
# 1. Start the backend first (orderflow-backend: npm run dev — API on :4000)
npm install
npm run dev            # http://localhost:5173
```

All API calls go to `/api/*`; the Vite dev server strips the prefix and proxies to
`http://localhost:4000` (see `vite.config.ts`).

Seed logins: `admin@orderflow.ph` / `admin-pass-123` · `rosa@orderflow.ph` / `agent-pass-123`.

## Trying the client upload flow locally

Set `PUBLIC_BASE_URL=http://localhost:5173` in the backend `.env` so emailed links point
at this app. Run a reminder (Admin → Reminder scheduling → Run now), copy the
`http://localhost:5173/u/<token>` link from the backend console output, and open it in a
private window — the upload page needs no login.

## Routes

```
/login                     staff sign-in
/u/:token                  public payment-receipt upload page (token = credential)
/admin/dashboard           payment-due dashboard
/admin/orders[/:id]        order review, approve/reject (embeds client pending invoices)
/admin/receipts            uploaded receipts: view file, mark paid
/admin/reminders           settings (frequency/timing/template), run now, send ledger
/admin/agents              create accounts, permissions, deactivate
/admin/mapping             clients grouped per agent, reassignment
/admin/directory[/:id]     searchable customer database + client detail
/agent/clients             assigned clients
/agent/new-order           purchase order creation
/agent/orders              orders grouped by client
/agent/invoices            client invoices (needs the view-invoices permission)
/notifications             in-app alerts (both roles)
```

## Production

`npm run build` outputs static files in `dist/`. Serve them behind the same reverse proxy
as the API and mirror the dev proxy rule, e.g. nginx:

```nginx
location /api/ { proxy_pass http://127.0.0.1:4000/; }   # note trailing slash = strip /api
location /     { root /srv/orderflow/dist; try_files $uri /index.html; }
```

Set the backend's `PUBLIC_BASE_URL` to the public site origin so emailed upload links
resolve to `/u/:token` on this app. The auth token is kept in localStorage for
simplicity; if you later serve the app on a shared-subdomain setup or want stricter
XSS posture, switch the backend to httpOnly cookie sessions.
