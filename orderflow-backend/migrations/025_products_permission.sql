-- Managing the price list (add/edit/import) is restricted per-admin, opt-in
-- (unlike can_manage_agents/can_manage_announcements, which default true) --
-- the whole point of this flag is that most admins should NOT get it by
-- default. Reading the list (GET /products) stays open to any authenticated
-- user, since agents need it for the quotation picker.
ALTER TABLE users ADD COLUMN can_manage_products BOOLEAN NOT NULL DEFAULT false;
