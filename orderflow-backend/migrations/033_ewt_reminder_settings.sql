-- Automatic BIR Form 2307 reminders. For this type, days_before means "days
-- after the tax withholding was recorded to send the first request" and
-- frequency_days is the repeat interval; max_reminders caps how many are sent
-- per invoice so a client who never responds isn't emailed forever.
-- Disabled by default: an admin turns it on after checking how many invoices
-- would be emailed on the first run.
ALTER TABLE reminder_settings ADD COLUMN max_reminders INT CHECK (max_reminders IS NULL OR max_reminders >= 1);

INSERT INTO reminder_settings (id, type, days_before, frequency_days, send_time, timezone, template, is_enabled, max_reminders)
VALUES
  (3, 'ewt', 7, 14, '09:00', 'Asia/Manila',
   'Hi {{contact}}, we recorded tax withheld ({{ewt}}) on your payment for {{invoice}}, but we have not yet received the matching BIR Form 2307 (Certificate of Creditable Tax Withheld). Could you please upload it using the secure link below? No login is needed.',
   false, 4)
ON CONFLICT (id) DO NOTHING;
