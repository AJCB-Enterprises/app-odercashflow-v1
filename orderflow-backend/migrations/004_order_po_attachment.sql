-- Client's own PO reference (date + number) and an optional scanned/photographed copy.
ALTER TABLE orders ADD COLUMN po_date DATE;
ALTER TABLE orders ADD COLUMN po_number TEXT;
ALTER TABLE orders ADD COLUMN attachment_key TEXT;
ALTER TABLE orders ADD COLUMN attachment_name TEXT;
ALTER TABLE orders ADD COLUMN attachment_mime TEXT;
ALTER TABLE orders ADD COLUMN attachment_size_bytes BIGINT;
