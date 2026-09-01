-- Tax Identification Number and compliance documents per client. PEZA
-- Certificate matters specifically for Zero-Rated clients; BIR COR 2303
-- applies more broadly. Both are optional uploads.
ALTER TABLE clients ADD COLUMN tin TEXT;

ALTER TABLE clients ADD COLUMN bir_cor_key         TEXT;
ALTER TABLE clients ADD COLUMN bir_cor_name        TEXT;
ALTER TABLE clients ADD COLUMN bir_cor_mime        TEXT;
ALTER TABLE clients ADD COLUMN bir_cor_size_bytes  BIGINT;

ALTER TABLE clients ADD COLUMN peza_cert_key        TEXT;
ALTER TABLE clients ADD COLUMN peza_cert_name       TEXT;
ALTER TABLE clients ADD COLUMN peza_cert_mime       TEXT;
ALTER TABLE clients ADD COLUMN peza_cert_size_bytes BIGINT;
