-- ============================================================
-- CropGuard — SQLite schema
-- Local relational DB for alerts + disease library
-- ============================================================

PRAGMA foreign_keys = ON;

-- Disease / crop reference (library). Seeded from PlantVillage metadata.
CREATE TABLE IF NOT EXISTS diseases (
    disease_id   INTEGER PRIMARY KEY AUTOINCREMENT,
    crop         TEXT NOT NULL,
    disease      TEXT NOT NULL,
    severity     TEXT NOT NULL CHECK (severity IN ('low', 'moderate', 'high')),
    advice       TEXT NOT NULL,
    raw_label    TEXT,
    created_at   DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(crop, disease)
);

-- One row per saved scan / alert
CREATE TABLE IF NOT EXISTS alerts (
    alert_id     INTEGER PRIMARY KEY AUTOINCREMENT,
    disease      TEXT NOT NULL,
    crop         TEXT,
    severity     TEXT NOT NULL CHECK (severity IN ('low', 'moderate', 'high')),
    confidence   REAL,
    advice       TEXT,
    image_path   TEXT,
    latitude     REAL,
    longitude    REAL,
    created_at   DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_alerts_created ON alerts(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_alerts_disease ON alerts(disease);
CREATE INDEX IF NOT EXISTS idx_diseases_crop  ON diseases(crop);
CREATE INDEX IF NOT EXISTS idx_diseases_label ON diseases(raw_label);