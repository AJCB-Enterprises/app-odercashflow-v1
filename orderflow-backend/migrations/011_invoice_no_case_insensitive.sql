-- invoice_no was a plain TEXT UNIQUE column, so "SI-2026-0001" and
-- "si-2026-0001" were treated as different values -- letting a typo'd case
-- slip past the duplicate check. CITEXT (already used for email columns)
-- makes the UNIQUE constraint itself case-insensitive.
ALTER TABLE invoices ALTER COLUMN invoice_no TYPE CITEXT;
