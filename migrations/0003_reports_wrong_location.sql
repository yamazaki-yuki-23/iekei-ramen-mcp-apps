-- 店のページの報告に「場所が違う」（wrong-location）を足す（#255）。
-- SQLite は CHECK を後から変えられないので、新しい表を作って今の行を写し、入れ替える。
CREATE TABLE reports_new (
  id TEXT PRIMARY KEY NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('not-iekei', 'closed', 'wrong-location', 'missing')),
  shop_id TEXT,
  name TEXT,
  location TEXT,
  received_at TEXT NOT NULL,
  CHECK (
    (kind IN ('not-iekei', 'closed', 'wrong-location') AND shop_id IS NOT NULL AND name IS NULL AND location IS NULL)
    OR (kind = 'missing' AND shop_id IS NULL AND name IS NOT NULL AND location IS NOT NULL)
  )
);
INSERT INTO reports_new (id, kind, shop_id, name, location, received_at)
  SELECT id, kind, shop_id, name, location, received_at FROM reports;
DROP TABLE reports;
ALTER TABLE reports_new RENAME TO reports;
CREATE INDEX IF NOT EXISTS reports_received_at ON reports (received_at);
