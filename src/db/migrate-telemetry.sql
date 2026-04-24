-- =============================================================================
-- DEPRECATED: src/db/migrate-telemetry.sql
-- =============================================================================
-- This file is superseded by migrations/002_operational_tables.sql and
-- migrations/004_telemetry_fact_tables.sql. Do not use for new installs.
--
-- Tables it created are now covered by:
--   sessions (base) → iracing-coach/database/schema.sql
--   sessions extensions → migration 002
--   laps (base) → iracing-coach/database/schema.sql
--   telemetry_frames → migration 004
--   lap_features → migration 004
--
-- Kept for git history only.
-- =============================================================================

-- Telemetry tables migration
-- Run once against the iracing_coach database to enable live telemetry ingestion.

-- ── sessions ──────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS sessions (
  id                SERIAL PRIMARY KEY,
  user_id           INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  track_id          VARCHAR(128),
  track_name        VARCHAR(256),
  car_id            VARCHAR(128),
  car_name          VARCHAR(256),
  session_type      VARCHAR(32)  DEFAULT 'practice',
  sim_session_uid   VARCHAR(64),
  sub_session_id    INTEGER,
  iracing_driver_id INTEGER,
  ingest_mode       VARCHAR(16)  DEFAULT 'file',
  status            VARCHAR(16)  DEFAULT 'open',
  ibt_file_path     TEXT,
  total_laps        INTEGER,
  best_lap_s        NUMERIC(10,3),
  avg_fuel_per_lap  NUMERIC(8,3),
  created_at        TIMESTAMPTZ  DEFAULT NOW(),
  ended_at          TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_sessions_user_id  ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_status   ON sessions(status);

-- ── laps ───────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS laps (
  id                SERIAL PRIMARY KEY,
  session_id        INTEGER NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  user_id           INTEGER NOT NULL REFERENCES users(id)   ON DELETE CASCADE,
  lap_number        INTEGER,
  lap_time          NUMERIC(10,3),
  sector1_time      NUMERIC(10,3),
  sector2_time      NUMERIC(10,3),
  sector3_time      NUMERIC(10,3),
  is_valid          BOOLEAN      DEFAULT TRUE,
  ibt_file_path     TEXT,
  blap_file_path    TEXT,
  olap_file_path    TEXT,
  telemetry_summary JSONB,
  created_at        TIMESTAMPTZ  DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_laps_session_id ON laps(session_id);

-- ── telemetry_frames ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS telemetry_frames (
  id            BIGSERIAL PRIMARY KEY,
  session_id    INTEGER      NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  lap_id        INTEGER               REFERENCES laps(id)     ON DELETE SET NULL,
  user_id       INTEGER      NOT NULL REFERENCES users(id)    ON DELETE CASCADE,
  ts            TIMESTAMPTZ  NOT NULL,
  session_time  NUMERIC(10,4),
  lap_number    INTEGER,
  lap_dist_pct  NUMERIC(8,6),
  speed_kph     NUMERIC(8,3),
  throttle      NUMERIC(6,4),
  brake         NUMERIC(6,4),
  clutch        NUMERIC(6,4),
  steering_deg  NUMERIC(8,3),
  gear          INTEGER,
  rpm           INTEGER,
  lat_accel     NUMERIC(8,4),
  long_accel    NUMERIC(8,4),
  yaw_rate      NUMERIC(8,4),
  steer_torque  NUMERIC(8,4),
  track_temp_c  NUMERIC(6,2),
  air_temp_c    NUMERIC(6,2),
  source        VARCHAR(16)  DEFAULT 'live'
);

CREATE INDEX IF NOT EXISTS idx_tf_session_lap ON telemetry_frames(session_id, lap_number);
CREATE INDEX IF NOT EXISTS idx_tf_lap_id      ON telemetry_frames(lap_id);
CREATE INDEX IF NOT EXISTS idx_tf_ts          ON telemetry_frames(ts);

-- ── lap_features ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS lap_features (
  lap_id             INTEGER PRIMARY KEY REFERENCES laps(id) ON DELETE CASCADE,
  session_id         INTEGER      NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  user_id            INTEGER      NOT NULL REFERENCES users(id)    ON DELETE CASCADE,
  lap_time           NUMERIC(10,3),
  sector1_time       NUMERIC(10,3),
  sector2_time       NUMERIC(10,3),
  sector3_time       NUMERIC(10,3),
  avg_speed_kph      NUMERIC(8,3),
  max_speed_kph      NUMERIC(8,3),
  min_speed_kph      NUMERIC(8,3),
  throttle_full_pct  NUMERIC(6,3),
  brake_peak         NUMERIC(6,4),
  brake_zone_count   INTEGER,
  steering_variance  NUMERIC(10,5),
  entry_speed_avg    NUMERIC(8,3),
  apex_speed_avg     NUMERIC(8,3),
  exit_speed_avg     NUMERIC(8,3),
  lift_count         INTEGER,
  wheelspin_events   INTEGER,
  lockup_events      INTEGER,
  consistency_score  NUMERIC(6,3),
  smoothness_score   NUMERIC(6,3),
  created_at         TIMESTAMPTZ  DEFAULT NOW()
);
