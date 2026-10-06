-- recipient_count only ever said how many emails went out, so a broadcast to a
-- directory where some clients have no email (or a send fails) looked like it
-- under-delivered with no explanation. Record the other two outcomes too.
-- Nullable: broadcasts sent before this migration have no recorded breakdown,
-- and NULL ("unknown") is honest where 0 would claim nothing was skipped.
ALTER TABLE announcements ADD COLUMN no_email_count INT;
ALTER TABLE announcements ADD COLUMN failed_count INT;
