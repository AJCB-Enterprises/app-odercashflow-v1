-- Admin broadcasts to the full customer directory. One row per broadcast (not
-- per recipient) — recipient_count is enough for an audit trail here.
CREATE TABLE announcements (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  subject          TEXT NOT NULL,
  body             TEXT NOT NULL,
  sent_by          UUID REFERENCES users(id),
  recipient_count  INT NOT NULL DEFAULT 0,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_announcements_created ON announcements(created_at DESC);
