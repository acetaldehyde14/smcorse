-- Migration 013: Car Setups
CREATE TABLE IF NOT EXISTS car_setups (
  id            SERIAL PRIMARY KEY,
  track_name    TEXT        NOT NULL,
  car_name      TEXT        NOT NULL,
  label         TEXT        NOT NULL,
  notes         TEXT,
  filename      TEXT        NOT NULL,
  file_path     TEXT        NOT NULL,
  uploaded_by   INTEGER     REFERENCES users(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_car_setups_track ON car_setups(track_name);
CREATE INDEX IF NOT EXISTS idx_car_setups_car   ON car_setups(car_name);
