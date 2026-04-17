-- Alternative setup script if batch file doesn't work
-- Open pgAdmin or psql and run these commands manually

-- 1. Create database
CREATE DATABASE iracing_coach;

-- 2. Connect to it: \c iracing_coach

-- 3. Then copy and paste the schema from iracing-coach\database\schema.sql
-- Or run: \i 'C:/Users/maxim/Documents/smcorse/iracing-coach/database/schema.sql'

-- ── Race Events / Calendar ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS race_events (
  id              SERIAL PRIMARY KEY,
  name            TEXT NOT NULL,
  track           TEXT,
  series          TEXT,
  car_class       TEXT,
  race_date       TIMESTAMPTZ NOT NULL,
  duration_hours  FLOAT,
  signup_open     BOOLEAN DEFAULT TRUE,
  created_by      INTEGER REFERENCES users(id),
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- ── Races extra columns ──────────────────────────────────────────
ALTER TABLE races ADD COLUMN IF NOT EXISTS active_stint_session_id INTEGER REFERENCES stint_planner_sessions(id);
ALTER TABLE race_state ADD COLUMN IF NOT EXISTS current_stint_index INTEGER DEFAULT 0;
ALTER TABLE race_state ADD COLUMN IF NOT EXISTS stint_started_at TIMESTAMPTZ;
ALTER TABLE race_state ADD COLUMN IF NOT EXISTS position        INTEGER;
ALTER TABLE race_state ADD COLUMN IF NOT EXISTS class_position  INTEGER;
ALTER TABLE race_state ADD COLUMN IF NOT EXISTS gap_to_leader   FLOAT;
ALTER TABLE race_state ADD COLUMN IF NOT EXISTS gap_ahead       FLOAT;
ALTER TABLE race_state ADD COLUMN IF NOT EXISTS gap_behind      FLOAT;
ALTER TABLE race_state ADD COLUMN IF NOT EXISTS laps_completed  INTEGER;
ALTER TABLE race_state ADD COLUMN IF NOT EXISTS last_lap_time   FLOAT;
ALTER TABLE race_state ADD COLUMN IF NOT EXISTS best_lap_time   FLOAT;
ALTER TABLE race_state ADD COLUMN IF NOT EXISTS nearby_cars     JSONB;

-- ── Stint Planner Sessions (run this after initial schema setup) ──
CREATE TABLE IF NOT EXISTS stint_planner_sessions (
  id           SERIAL PRIMARY KEY,
  name         VARCHAR(255)  NOT NULL DEFAULT 'Untitled Race',
  created_by   INTEGER       REFERENCES users(id) ON DELETE SET NULL,
  config       JSONB         NOT NULL DEFAULT '{}',
  availability JSONB         NOT NULL DEFAULT '{}',
  plan         JSONB         NOT NULL DEFAULT '[]',
  created_at   TIMESTAMP     NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMP     NOT NULL DEFAULT NOW()
);


-- Live telemetry from desktop client (high-frequency samples)
CREATE TABLE IF NOT EXISTS live_telemetry (
  id           BIGSERIAL PRIMARY KEY,
  race_id      INTEGER REFERENCES races(id),
  user_id      INTEGER REFERENCES users(id),
  lap          INTEGER,
  samples      JSONB NOT NULL,
  sample_count INTEGER,
  received_at  TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_live_telem_race ON live_telemetry(race_id, received_at DESC);
CREATE INDEX IF NOT EXISTS idx_live_telem_lap  ON live_telemetry(race_id, lap);

-- ── Telemetry pipeline: new columns on sessions ───────────────────
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS sim_session_uid    VARCHAR(64);
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS sub_session_id     INTEGER;
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS iracing_driver_id  INTEGER;
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS ingest_mode        VARCHAR(16) NOT NULL DEFAULT 'file';
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS status             VARCHAR(16) NOT NULL DEFAULT 'open';
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS ended_at           TIMESTAMPTZ;

-- ── High-frequency telemetry frames (live collector + IBT backfill) ──
CREATE TABLE IF NOT EXISTS telemetry_frames (
  id            BIGSERIAL PRIMARY KEY,
  session_id    INTEGER     NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  lap_id        INTEGER     NULL     REFERENCES laps(id)     ON DELETE CASCADE,
  user_id       INTEGER     NOT NULL REFERENCES users(id)    ON DELETE CASCADE,

  ts            TIMESTAMPTZ NOT NULL,
  session_time  NUMERIC(10,3) NOT NULL,
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

  source        VARCHAR(16) NOT NULL DEFAULT 'live',  -- live | ibt
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tf_session_time ON telemetry_frames(session_id, session_time);
CREATE INDEX IF NOT EXISTS idx_tf_lap_dist     ON telemetry_frames(lap_id, lap_dist_pct);
CREATE INDEX IF NOT EXISTS idx_tf_user_ts      ON telemetry_frames(user_id, ts);

-- ── Per-lap aggregate features ────────────────────────────────────
CREATE TABLE IF NOT EXISTS lap_features (
  lap_id              INTEGER PRIMARY KEY REFERENCES laps(id) ON DELETE CASCADE,
  session_id          INTEGER NOT NULL    REFERENCES sessions(id) ON DELETE CASCADE,
  user_id             INTEGER NOT NULL    REFERENCES users(id)    ON DELETE CASCADE,

  lap_time            NUMERIC(10,3),
  sector1_time        NUMERIC(10,3),
  sector2_time        NUMERIC(10,3),
  sector3_time        NUMERIC(10,3),

  avg_speed_kph       NUMERIC(8,3),
  max_speed_kph       NUMERIC(8,3),
  min_speed_kph       NUMERIC(8,3),

  throttle_full_pct   NUMERIC(6,3),
  brake_peak          NUMERIC(6,3),
  brake_zone_count    INTEGER,
  steering_variance   NUMERIC(10,5),

  entry_speed_avg     NUMERIC(8,3),
  apex_speed_avg      NUMERIC(8,3),
  exit_speed_avg      NUMERIC(8,3),

  lift_count          INTEGER,
  wheelspin_events    INTEGER,
  lockup_events       INTEGER,

  consistency_score   NUMERIC(6,3),
  smoothness_score    NUMERIC(6,3),

  feature_version     VARCHAR(32) NOT NULL DEFAULT 'v1',
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── Corner/segment definitions per track ─────────────────────────
CREATE TABLE IF NOT EXISTS corner_segments (
  id               BIGSERIAL PRIMARY KEY,
  track_id         VARCHAR(128) NOT NULL,
  track_config     VARCHAR(128),
  segment_number   INTEGER      NOT NULL,
  name             VARCHAR(128),
  start_dist_pct   NUMERIC(8,6) NOT NULL,
  apex_dist_pct    NUMERIC(8,6),
  end_dist_pct     NUMERIC(8,6) NOT NULL,
  kind             VARCHAR(16)  NOT NULL,  -- corner | straight | chicane
  created_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- ── Per-lap per-corner features ───────────────────────────────────
CREATE TABLE IF NOT EXISTS lap_segment_features (
  id                      BIGSERIAL PRIMARY KEY,
  lap_id                  INTEGER  NOT NULL REFERENCES laps(id)            ON DELETE CASCADE,
  segment_id              BIGINT   NOT NULL REFERENCES corner_segments(id) ON DELETE CASCADE,

  entry_speed_kph         NUMERIC(8,3),
  apex_speed_kph          NUMERIC(8,3),
  exit_speed_kph          NUMERIC(8,3),
  min_speed_kph           NUMERIC(8,3),

  brake_start_dist_pct    NUMERIC(8,6),
  brake_release_dist_pct  NUMERIC(8,6),
  throttle_pickup_dist_pct NUMERIC(8,6),

  max_brake               NUMERIC(6,4),
  min_throttle            NUMERIC(6,4),
  steering_peak_deg       NUMERIC(8,3),

  time_loss_vs_ref        NUMERIC(10,4),
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
