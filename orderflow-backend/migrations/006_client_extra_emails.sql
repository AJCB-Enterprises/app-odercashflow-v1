-- Additional email addresses per client, so payment reminders and announcements
-- reach more than one inbox at the same company. clients.email stays the primary.
ALTER TABLE clients ADD COLUMN extra_emails TEXT[] NOT NULL DEFAULT '{}';
