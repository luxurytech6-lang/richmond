-- ============================================================
--  CropGuard — Supabase Schema
--  Run this in your Supabase SQL editor to set up the database
-- ============================================================

-- Alerts table: stores every disease detection event
CREATE TABLE IF NOT EXISTS alerts (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  disease     TEXT NOT NULL,
  crop        TEXT,
  severity    TEXT CHECK (severity IN ('low', 'moderate', 'high')),
  confidence  NUMERIC(5,1),
  advice      TEXT,
  image_url   TEXT,
  latitude    NUMERIC(9,6),
  longitude   NUMERIC(9,6),
  created_at  TIMESTAMPTZ DEFAULT now()
);

-- Index for geographic queries (heatmap of outbreaks)
CREATE INDEX IF NOT EXISTS alerts_location_idx
  ON alerts (latitude, longitude)
  WHERE latitude IS NOT NULL;

-- Index for time-series queries
CREATE INDEX IF NOT EXISTS alerts_time_idx ON alerts (created_at DESC);

-- Row Level Security: read-only for anon, insert for anon (open for farmers)
ALTER TABLE alerts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can insert an alert"
  ON alerts FOR INSERT TO anon WITH CHECK (true);

CREATE POLICY "Anyone can read alerts"
  ON alerts FOR SELECT TO anon USING (true);


-- ─── Outbreak Heatmap View ───────────────────────────────────────
-- Aggregates alerts by disease and region for dashboard use
CREATE OR REPLACE VIEW outbreak_summary AS
SELECT
  disease,
  crop,
  severity,
  COUNT(*) AS total_alerts,
  AVG(confidence) AS avg_confidence,
  DATE_TRUNC('day', created_at) AS day
FROM alerts
GROUP BY disease, crop, severity, DATE_TRUNC('day', created_at)
ORDER BY day DESC, total_alerts DESC;