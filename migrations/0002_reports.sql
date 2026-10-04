CREATE TABLE IF NOT EXISTS reports (
  id TEXT PRIMARY KEY NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('not-iekei', 'closed', 'missing')),
  shop_id TEXT,
  name TEXT,
  location TEXT,
  received_at TEXT NOT NULL,
  CHECK (
    (kind IN ('not-iekei', 'closed') AND shop_id IS NOT NULL AND name IS NULL AND location IS NULL)
    OR (kind = 'missing' AND shop_id IS NULL AND name IS NOT NULL AND location IS NOT NULL)
  )
);
CREATE INDEX IF NOT EXISTS reports_received_at ON reports (received_at);
