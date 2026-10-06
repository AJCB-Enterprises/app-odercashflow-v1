-- Monthly sales target per agent, set by an admin. One row per agent per
-- month (month = first day of that month); a month with no row uses the most
-- recent earlier row, so a target set once carries forward until changed.
-- A row of 0 means "no target from this month on".
CREATE TABLE agent_targets (
  agent_id      UUID NOT NULL REFERENCES users(id),
  month         DATE NOT NULL CHECK (EXTRACT(DAY FROM month) = 1),
  target_amount NUMERIC(14,2) NOT NULL CHECK (target_amount >= 0),
  set_by        UUID REFERENCES users(id),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (agent_id, month)
);
