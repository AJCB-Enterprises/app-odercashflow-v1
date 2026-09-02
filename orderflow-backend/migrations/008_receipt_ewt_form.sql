-- Optional BIR Form 2307 (Certificate of Creditable Tax Withheld / EWT),
-- uploaded by the client alongside their payment receipt.
ALTER TABLE receipts ADD COLUMN ewt_key TEXT;
ALTER TABLE receipts ADD COLUMN ewt_name TEXT;
ALTER TABLE receipts ADD COLUMN ewt_mime TEXT;
ALTER TABLE receipts ADD COLUMN ewt_size_bytes BIGINT;
