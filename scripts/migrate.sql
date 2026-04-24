-- =============================================================================
-- DEPRECATED: scripts/migrate.sql
-- =============================================================================
-- This file is superseded by migrations/001-009. Do not use for new installs.
--
-- This file is now FULLY superseded by migrations 001-010:
--   races, stint_roster, iracing_events, race_state → migration 002
--   users columns → migration 001
--   telemetry_sessions, telemetry_laps, telemetry_batches → migration 010
--
-- Do NOT run this file manually on new installs. Use npm run db:migrate instead.
-- Kept for git history only.
-- =============================================================================

-- ============================================================
-- iRacing Enduro — Database Migration
-- ============================================================

-- Add iRacing & notification columns to existing users table
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS iracing_name       TEXT,
  ADD COLUMN IF NOT EXISTS iracing_id         TEXT,
  ADD COLUMN IF NOT EXISTS telegram_chat_id   TEXT,
  ADD COLUMN IF NOT EXISTS discord_user_id    TEXT,
  ADD COLUMN IF NOT EXISTS discord_webhook    TEXT,
  ADD COLUMN IF NOT EXISTS is_active          BOOLEAN DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS created_at         TIMESTAMPTZ DEFAULT NOW();

-- Races table (one row per endurance event)
CREATE TABLE IF NOT EXISTS races (
  id           SERIAL PRIMARY KEY,
  name         TEXT NOT NULL,
  track        TEXT,
  started_at   TIMESTAMPTZ,
  ended_at     TIMESTAMPTZ,
  is_active    BOOLEAN DEFAULT FALSE,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

-- Stint roster: who drives when
CREATE TABLE IF NOT EXISTS stint_roster (
  id                        SERIAL PRIMARY KEY,
  race_id                   INTEGER REFERENCES races(id) ON DELETE CASCADE,
  driver_user_id            INTEGER REFERENCES users(id),
  stint_order               INTEGER NOT NULL,
  planned_duration_mins     INTEGER,
  actual_start_session_time FLOAT,
  actual_end_session_time   FLOAT,
  notified_ready            BOOLEAN DEFAULT FALSE,
  created_at                TIMESTAMPTZ DEFAULT NOW()
);

-- All iRacing telemetry events from desktop clients
CREATE TABLE IF NOT EXISTS iracing_events (
  id                  SERIAL PRIMARY KEY,
  event_type          TEXT NOT NULL,
  race_id             INTEGER REFERENCES races(id),
  driver_name         TEXT,
  driver_user_id      INTEGER REFERENCES users(id),
  fuel_level          FLOAT,
  fuel_pct            FLOAT,
  mins_remaining      FLOAT,
  session_time        FLOAT,
  reported_by_user_id INTEGER REFERENCES users(id),
  created_at          TIMESTAMPTZ DEFAULT NOW()
);

-- Track dedup state per race
CREATE TABLE IF NOT EXISTS race_state (
  race_id             INTEGER PRIMARY KEY REFERENCES races(id),
  current_driver_name TEXT,
  last_fuel_level     FLOAT,
  low_fuel_notified   BOOLEAN DEFAULT FALSE,
  last_event_at       TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_iracing_events_race    ON iracing_events(race_id);
CREATE INDEX IF NOT EXISTS idx_iracing_events_type    ON iracing_events(event_type);
CREATE INDEX IF NOT EXISTS idx_stint_roster_race      ON stint_roster(race_id, stint_order);
CREATE INDEX IF NOT EXISTS idx_users_iracing_name     ON users(iracing_name);

-- ── New telemetry pipeline tables ─────────────────────────────

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

CREATE TABLE IF NOT EXISTS telemetry_batches (
  id           SERIAL PRIMARY KEY,
  session_id   INTEGER NOT NULL REFERENCES telemetry_sessions(id) ON DELETE CASCADE,
  lap_number   INTEGER NOT NULL,
  sample_rate  FLOAT NOT NULL,
  samples      JSONB NOT NULL,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_telem_sessions_user    ON telemetry_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_telem_sessions_uid     ON telemetry_sessions(sim_session_uid);
CREATE INDEX IF NOT EXISTS idx_telem_laps_session     ON telemetry_laps(session_id, lap_number);
CREATE INDEX IF NOT EXISTS idx_telem_batches_session  ON telemetry_batches(session_id, lap_number);
