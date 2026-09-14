-- Clients should only hear from OrderFlow by email once their order is
-- approved (order-approved notice, payment reminders, statements, etc.) --
-- not while it's still awaiting review. The "order" reminder type ("order
-- {{order}} is awaiting action...") was emailing the client directly for a
-- still-pending order, which is agent/admin-facing information, not
-- something a client should be nudged about. Disabled by default; admin can
-- still re-enable it from Reminder scheduling if that policy ever changes.
UPDATE reminder_settings SET is_enabled = false WHERE type = 'order';
