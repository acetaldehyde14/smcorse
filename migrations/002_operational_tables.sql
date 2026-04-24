-- =============================================================================
-- Migration 002: Operational Tables
-- Purpose: Ensure all operational tables exist with correct columns.
--          Creates races/stint_roster/iracing_events/race_state if absent
--          (these come from scripts/migrate-enduro.sql but that file may not
--          have been run on all environments).
--          Adds the three tables that were missing from ALL prior schema files:
--          teams, team_members, race_laps.
-- =============================================================================

-- ── Core enduro tables (from scripts/migrate-enduro.sql) ─────────────────────
-- Created here with IF NOT EXISTS so this migration is safe whether or not
-- migrate-enduro.sql was previously run.

CREATE TABLE IF NOT EXISTS races (
  id         SERIAL PRIMARY KEY,
  name       TEXT NOT NULL,
  track      TEXT,
  started_at TIMESTAMPTZ,
  ended_at   TIMESTAMPTZ,
  is_active  BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS stint_roster (
  id                        SERIAL PRIMARY KEY,
  race_id                   INTEGER REFERENCES races(id) ON DELETE CASCADE,
  driver_user_id            INTEGER REFERENCES users(id),
  stint_order               INTEGER NOT NULL,
  planned_duration_mins     INTEGER,
  actual_start_session_time DOUBLE PRECISION,
  actual_end_session_time   DOUBLE PRECISION,
  notified_ready            BOOLEAN DEFAULT FALSE,
  created_at                TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_stint_roster_race ON stint_roster(race_id);

CREATE TABLE IF NOT EXISTS iracing_events (
  id                  SERIAL PRIMARY KEY,
  event_type          TEXT NOT NULL,
  race_id             INTEGER REFERENCES races(id),
  driver_name         TEXT,
  driver_user_id      INTEGER REFERENCES users(id),
  fuel_level          DOUBLE PRECISION,
  fuel_pct            DOUBLE PRECISION,
  mins_remaining      DOUBLE PRECISION,
  session_time        DOUBLE PRECISION,
  reported_by_user_id INTEGER REFERENCES users(id),
  created_at          TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_iracing_events_race ON iracing_events(race_id);
CREATE INDEX IF NOT EXISTS idx_iracing_events_type ON iracing_events(event_type);

CREATE TABLE IF NOT EXISTS race_state (
  race_id             INTEGER PRIMARY KEY REFERENCES races(id),
  current_driver_name TEXT,
  last_fuel_level     DOUBLE PRECISION,
  low_fuel_notified   BOOLEAN DEFAULT FALSE,
  last_event_at       TIMESTAMPTZ DEFAULT NOW()
);

-- ── Ensure sessions has all required columns ──────────────────────────────────
ALTER TABLE sessions
  ADD COLUMN IF NOT EXISTS sim_session_uid   VARCHAR(64),
  ADD COLUMN IF NOT EXISTS sub_session_id    INTEGER,
  ADD COLUMN IF NOT EXISTS iracing_driver_id INTEGER,
  ADD COLUMN IF NOT EXISTS ingest_mode       VARCHAR(16) NOT NULL DEFAULT 'file',
  ADD COLUMN IF NOT EXISTS status            VARCHAR(16) NOT NULL DEFAULT 'open',
  ADD COLUMN IF NOT EXISTS ended_at          TIMESTAMPTZ;

-- ── Ensure laps has all required columns ─────────────────────────────────────
ALTER TABLE laps
  ADD COLUMN IF NOT EXISTS lap_time       NUMERIC(10,3),
  ADD COLUMN IF NOT EXISTS ibt_file_path  TEXT,
  ADD COLUMN IF NOT EXISTS blap_file_path TEXT,
  ADD COLUMN IF NOT EXISTS olap_file_path TEXT,
  ADD COLUMN IF NOT EXISTS created_at     TIMESTAMPTZ DEFAULT NOW();

-- ── Stint Planner Sessions ────────────────────────────────────────────────────
-- Grain: one row per shared race plan session.
CREATE TABLE IF NOT EXISTS stint_planner_sessions (
  id           SERIAL       PRIMARY KEY,
  name         VARCHAR(255) NOT NULL DEFAULT 'Untitled Race',
  created_by   INTEGER      REFERENCES users(id) ON DELETE SET NULL,
  config       JSONB        NOT NULL DEFAULT '{}',
  availability JSONB        NOT NULL DEFAULT '{}',
  plan         JSONB        NOT NULL DEFAULT '[]',
  created_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE stint_planner_sessions IS
  'Collaborative race plan. Grain: one row per planning session. '
  'config: race metadata. availability: driver time blocks. plan: ordered stint list.';

-- ── Ensure races/race_state have all extended columns ─────────────────────────
-- (races was created above; this adds the FK that references stint_planner_sessions)
ALTER TABLE races
  ADD COLUMN IF NOT EXISTS active_stint_session_id
    INTEGER REFERENCES stint_planner_sessions(id);

ALTER TABLE race_state
  ADD COLUMN IF NOT EXISTS current_stint_index INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS stint_started_at    TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS position            INTEGER,
  ADD COLUMN IF NOT EXISTS class_position      INTEGER,
  ADD COLUMN IF NOT EXISTS gap_to_leader       DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS gap_ahead           DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS gap_behind          DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS laps_completed      INTEGER,
  ADD COLUMN IF NOT EXISTS last_lap_time       DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS best_lap_time       DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS nearby_cars         JSONB;

COMMENT ON TABLE race_state IS
  'Live operational race state. Grain: one row per race (PK = race_id). '
  'Written by desktop client events; served via mart_live_race_state view.';

-- ── Race Events / Calendar ────────────────────────────────────────────────────
-- Grain: one row per scheduled race event (calendar entry).
CREATE TABLE IF NOT EXISTS race_events (
  id             SERIAL PRIMARY KEY,
  name           TEXT NOT NULL,
  track          TEXT,
  series         TEXT,
  car_class      TEXT,
  race_date      TIMESTAMPTZ NOT NULL,
  duration_hours DOUBLE PRECISION,
  signup_open    BOOLEAN DEFAULT TRUE,
  created_by     INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at     TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON TABLE race_events IS
  'Race calendar. Grain: one row per scheduled race event. '
  'Distinct from the races table (which tracks live/active races).';

CREATE INDEX IF NOT EXISTS idx_race_events_date ON race_events(race_date);

-- ── Teams (PREVIOUSLY MISSING from all schema files) ─────────────────────────
CREATE TABLE IF NOT EXISTS teams (
  id          SERIAL PRIMARY KEY,
  name        VARCHAR(255) NOT NULL,
  description TEXT,
  created_by  INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON TABLE teams IS
  'Team entity. Grain: one row per team. '
  'Previously referenced in team routes but never defined in any SQL schema file.';

CREATE INDEX IF NOT EXISTS idx_teams_created_by ON teams(created_by);

-- ── Team Members (PREVIOUSLY MISSING from all schema files) ──────────────────
CREATE TABLE IF NOT EXISTS team_members (
  id              SERIAL PRIMARY KEY,
  team_id         INTEGER REFERENCES teams(id) ON DELETE CASCADE,
  user_id         INTEGER REFERENCES users(id) ON DELETE SET NULL,
  name            VARCHAR(255),
  role            VARCHAR(100),
  iracing_name    VARCHAR(255),
  irating         INTEGER,
  safety_rating   DOUBLE PRECISION,
  preferred_car   VARCHAR(255),
  discord_user_id TEXT,
  avatar_url      TEXT,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON TABLE team_members IS
  'Team membership. Grain: one row per (team, member). '
  'Previously referenced in /api/team/members but never defined in schema.';

CREATE INDEX IF NOT EXISTS idx_team_members_team ON team_members(team_id);
CREATE INDEX IF NOT EXISTS idx_team_members_user ON team_members(user_id);

-- ── Race Laps (PREVIOUSLY MISSING from all schema files) ─────────────────────
-- Grain: one row per lap completed during a live race.
-- Written by iracing.js handlePositionUpdate when last_lap_time changes.
-- Exact columns match the INSERT in iracing.js:
--   INSERT INTO race_laps (race_id, lap_number, driver_name, driver_user_id, lap_time, session_time)
CREATE TABLE IF NOT EXISTS race_laps (
  id             SERIAL PRIMARY KEY,
  race_id        INTEGER NOT NULL REFERENCES races(id) ON DELETE CASCADE,
  lap_number     INTEGER,
  driver_name    TEXT,
  driver_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  lap_time       DOUBLE PRECISION,
  session_time   DOUBLE PRECISION,
  position       INTEGER,
  class_position INTEGER,
  fuel_level     DOUBLE PRECISION,
  lap_dist_pct   DOUBLE PRECISION,
  created_at     TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON TABLE race_laps IS
  'Live race lap log. Grain: one row per lap completed during a live race. '
  'Populated by iracing.js handlePositionUpdate when last_lap_time changes.';

CREATE INDEX IF NOT EXISTS idx_race_laps_race   ON race_laps(race_id);
CREATE INDEX IF NOT EXISTS idx_race_laps_driver ON race_laps(driver_user_id);
CREATE INDEX IF NOT EXISTS idx_race_laps_number ON race_laps(race_id, lap_number);
