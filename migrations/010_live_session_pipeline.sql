-- =============================================================================
-- Migration 010: Live Session Pipeline Tables
-- Purpose: Formalize the three live-telemetry pipeline tables that were
--          previously only created by scripts/migrate.sql.
--
-- These tables are runtime-critical for the live-session API endpoints:
--   POST /api/telemetry/live/session/start  → telemetry_sessions
--   POST /api/telemetry/live/session/end    → telemetry_sessions (update)
--   POST /api/telemetry/live/batch          → telemetry_batches
--   POST /api/telemetry/live/lap-complete   → telemetry_laps
--   GET  /api/telemetry/live/active         → telemetry_sessions
--   GET  /api/telemetry/sessions/:id/laps   → telemetry_laps
--   GET  /api/telemetry/sessions/:id/laps/:n → telemetry_batches
--
-- After this migration is applied, scripts/migrate.sql is fully superseded
-- for the telemetry_sessions / telemetry_laps / telemetry_batches tables.
-- The CREATE TABLE IF NOT EXISTS guards make this safe on databases that
-- already have these tables from the old manual migration.
-- =============================================================================

-- ── telemetry_sessions ────────────────────────────────────────────────────────
-- One row per live practice/race session opened by the desktop client.
-- Separate from the `sessions` table (file-upload sessions) — both can exist
-- for the same physical iRacing session.
CREATE TABLE IF NOT EXISTS telemetry_sessions (
  id                SERIAL PRIMARY KEY,
  user_id           INTEGER REFERENCES users(id),
  sim_session_uid   TEXT,
  track_id          TEXT,
  track_name        TEXT,
  car_id            TEXT,
  car_name          TEXT,
  session_type      TEXT,
  driver_name       TEXT,
  iracing_driver_id TEXT,
  started_at        TIMESTAMPTZ,
  ended_at          TIMESTAMPTZ,
  total_laps        INTEGER,
  best_lap_s        FLOAT,
  avg_fuel_per_lap  FLOAT,
  created_at        TIMESTAMPTZ DEFAULT NOW()
);

-- ── telemetry_laps ────────────────────────────────────────────────────────────
-- One row per completed lap within a telemetry_session.
CREATE TABLE IF NOT EXISTS telemetry_laps (
  id           SERIAL PRIMARY KEY,
  session_id   INTEGER NOT NULL REFERENCES telemetry_sessions(id) ON DELETE CASCADE,
  lap_number   INTEGER NOT NULL,
  lap_time_s   FLOAT,
  is_valid     BOOLEAN DEFAULT TRUE,
  incidents    INTEGER DEFAULT 0,
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (session_id, lap_number)
);

-- ── telemetry_batches ─────────────────────────────────────────────────────────
-- Raw JSONB sample batches from the desktop client (compressed, ~15 Hz).
-- The replay endpoint reconstructs ordered frame data from these.
CREATE TABLE IF NOT EXISTS telemetry_batches (
  id           SERIAL PRIMARY KEY,
  session_id   INTEGER NOT NULL REFERENCES telemetry_sessions(id) ON DELETE CASCADE,
  lap_number   INTEGER NOT NULL,
  sample_rate  FLOAT NOT NULL,
  samples      JSONB NOT NULL,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

-- ── Indexes ───────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_telem_sessions_user   ON telemetry_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_telem_sessions_uid    ON telemetry_sessions(sim_session_uid);
CREATE INDEX IF NOT EXISTS idx_telem_laps_session    ON telemetry_laps(session_id, lap_number);
CREATE INDEX IF NOT EXISTS idx_telem_batches_session ON telemetry_batches(session_id, lap_number);

-- ── Update deprecation note in scripts/migrate.sql ───────────────────────────
-- (informational comment only — migration 010 now fully supersedes the
--  telemetry_sessions / telemetry_laps / telemetry_batches portion of
--  scripts/migrate.sql. The races/users portions were already covered
--  by migrations 001 and 002.)
