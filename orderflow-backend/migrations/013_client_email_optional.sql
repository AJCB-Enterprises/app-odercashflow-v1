-- Some clients have no email address at all. Phone stays required, so every
-- client always has at least one manual contact channel for Admin/agents.
ALTER TABLE clients ALTER COLUMN email DROP NOT NULL;
