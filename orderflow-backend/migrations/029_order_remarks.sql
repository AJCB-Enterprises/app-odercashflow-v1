-- Free-text notes the agent adds when logging an order (delivery instructions,
-- context for the reviewer, etc.). Internal: shown to the agent and admin
-- reviewing the order, never emailed to the client.
ALTER TABLE orders ADD COLUMN remarks TEXT;
