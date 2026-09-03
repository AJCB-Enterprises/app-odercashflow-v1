-- Admin-level access was previously all-or-nothing (any role='admin' user
-- had unconditional full access). These two flags let a restricted admin
-- account be created that lacks specific admin-only capabilities, mirroring
-- how can_create_po/can_view_invoices already restrict agents. Default TRUE
-- so every existing admin keeps exactly the access they already had.
ALTER TABLE users ADD COLUMN can_manage_agents BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE users ADD COLUMN can_manage_announcements BOOLEAN NOT NULL DEFAULT TRUE;
