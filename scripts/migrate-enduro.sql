-- ============================================================
-- iRacing Enduro — Database Migration
-- Run this once against your existing PostgreSQL database.
-- Assumes you already have a `users` table with at least:
--   id (serial/int), username (text), password_hash (text)
-- ============================================================

-- Add iRacing & notification columns to existing users table
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS iracing_name       TEXT,
  ADD COLUMN IF NOT EXISTS iracing_id         TEXT,
  ADD COLUMN IF NOT EXISTS telegram_chat_id   TEXT,
  ADD COLUMN IF NOT EXISTS discord_user_id    TEXT,
  ADD COLUMN IF NOT EXISTS discord_webhook    TEXT,
  ADD COLUMN IF NOT EXISTS is_active          BOOLEAN DEFAULT TRUE;

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
  event_type          TEXT NOT NULL,   -- 'driver_change' | 'fuel_update'
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

-- Indexes for fast lookups
CREATE INDEX IF NOT EXISTS idx_iracing_events_race    ON iracing_events(race_id);
CREATE INDEX IF NOT EXISTS idx_iracing_events_type    ON iracing_events(event_type);
CREATE INDEX IF NOT EXISTS idx_stint_roster_race      ON stint_roster(race_id, stint_order);
CREATE INDEX IF NOT EXISTS idx_users_iracing_name     ON users(iracing_name);
