-- Some clients only pay by check and prefer someone from AJCB to personally
-- collect payment, rather than using the self-service upload link. Pure
-- client-level flag, same pattern as consolidated_invoicing (014).
ALTER TABLE clients ADD COLUMN collects_in_person BOOLEAN NOT NULL DEFAULT FALSE;
