-- =============================================================================
-- Migration 004: Telemetry Fact Tables
-- Purpose: Ensure telemetry_frames is the canonical read path for replay and
--          analytics. Adds missing columns (x_pos, y_pos were inserted by
--          iracing.js but the column never existed — silent failure).
--          Also ensures corner_segments, lap_features, and lap_segment_features
--          exist so that migrations 005 and 007 can reference/FK them on a
--          fresh DB that has never had setup-database.sql applied.
-- =============================================================================

-- ── corner_segments ───────────────────────────────────────────────────────────
-- Grain: one row per (track_id text, segment_number).
-- Physical table kept; new code uses the normalized segments table (migration 001).
-- lap_segment_features FKs to this table — it must exist before migration 005.
CREATE TABLE IF NOT EXISTS corner_segments (
  id             BIGSERIAL PRIMARY KEY,
  track_id       VARCHAR(128) NOT NULL,
  track_config   VARCHAR(128),
  segment_number INTEGER      NOT NULL,
  name           VARCHAR(128),
  start_dist_pct NUMERIC(8,6) NOT NULL,
  apex_dist_pct  NUMERIC(8,6),
  end_dist_pct   NUMERIC(8,6) NOT NULL,
  kind           VARCHAR(16)  NOT NULL DEFAULT 'corner',
  created_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE corner_segments IS
  'Legacy segment definitions keyed by free-text track_id. '
  'Grain: one row per (track_id, segment_number). '
  'New code: use segments table (migration 001). '
  'Physical table kept for lap_segment_features FK. '
  'Compat view: corner_segments_normalized defined in 007_compatibility_views.sql.';

CREATE INDEX IF NOT EXISTS idx_corner_segments_track
  ON corner_segments(track_id, track_config);

-- ── lap_features ──────────────────────────────────────────────────────────────
-- Grain: one row per lap. Legacy analytics table.
-- Kept as physical table; fact_lap (migration 005) is the new destination.
-- Merged via lap_features_v view in 007_compatibility_views.sql.
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
  brake_peak          NUMERIC(6,4),
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

COMMENT ON TABLE lap_features IS
  'Legacy lap analytics. Grain: one row per lap. '
  'New writes go to fact_lap (migration 005). '
  'Read both via lap_features_v (007_compatibility_views.sql).';

-- ── lap_segment_features ──────────────────────────────────────────────────────
-- Grain: one row per (lap_id, segment_id) where segment_id = corner_segments.id.
-- Kept as physical table; fact_lap_segment (migration 005) is the new destination.
CREATE TABLE IF NOT EXISTS lap_segment_features (
  id                       BIGSERIAL PRIMARY KEY,
  lap_id                   INTEGER NOT NULL REFERENCES laps(id)            ON DELETE CASCADE,
  segment_id               BIGINT  NOT NULL REFERENCES corner_segments(id) ON DELETE CASCADE,

  entry_speed_kph          NUMERIC(8,3),
  apex_speed_kph           NUMERIC(8,3),
  exit_speed_kph           NUMERIC(8,3),
  min_speed_kph            NUMERIC(8,3),

  brake_start_dist_pct     NUMERIC(8,6),
  brake_release_dist_pct   NUMERIC(8,6),
  throttle_pickup_dist_pct NUMERIC(8,6),

  max_brake                NUMERIC(6,4),
  min_throttle             NUMERIC(6,4),
  steering_peak_deg        NUMERIC(8,3),

  time_loss_vs_ref         NUMERIC(10,4),
  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE lap_segment_features IS
  'Legacy lap x corner analytics. Grain: one row per (lap_id, corner_segments.id). '
  'New writes go to fact_lap_segment (migration 005). '
  'Read both via lap_segment_features_v (007_compatibility_views.sql).';

CREATE INDEX IF NOT EXISTS idx_lsf_lap     ON lap_segment_features(lap_id);
CREATE INDEX IF NOT EXISTS idx_lsf_segment ON lap_segment_features(segment_id);

-- ── telemetry_frames: canonical telemetry fact ────────────────────────────────
-- Grain: one row per telemetry sample point.
-- This is the SOURCE OF TRUTH for: replay, lap overlay charts, delta time,
-- segment/corner metrics, AI coaching feature extraction.
-- Do NOT use live_telemetry for any analytics reads.
CREATE TABLE IF NOT EXISTS telemetry_frames (
  id               BIGSERIAL PRIMARY KEY,
  session_id       INTEGER NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  lap_id           INTEGER          REFERENCES laps(id)     ON DELETE SET NULL,
  user_id          INTEGER NOT NULL REFERENCES users(id)    ON DELETE CASCADE,

  -- Time coordinates
  ts               TIMESTAMPTZ NOT NULL,
  session_time     DOUBLE PRECISION,        -- seconds since session start; use this for delta analysis
  lap_number       INTEGER,
  lap_dist_pct     DOUBLE PRECISION,        -- 0.0 – 1.0
  lap_dist_meters  DOUBLE PRECISION,

  -- Motion channels
  speed_kph        DOUBLE PRECISION,        -- km/h
  throttle         DOUBLE PRECISION,        -- 0.0 – 1.0
  brake            DOUBLE PRECISION,        -- 0.0 – 1.0
  clutch           DOUBLE PRECISION,
  steering_deg     DOUBLE PRECISION,        -- degrees
  gear             INTEGER,
  rpm              DOUBLE PRECISION,

  -- Dynamics
  lat_accel        DOUBLE PRECISION,        -- m/s² lateral
  long_accel       DOUBLE PRECISION,        -- m/s² longitudinal
  yaw_rate         DOUBLE PRECISION,        -- rad/s
  steer_torque     DOUBLE PRECISION,

  -- World position (for track map rendering)
  x_pos            DOUBLE PRECISION,        -- iRacing world X (was missing — added here)
  y_pos            DOUBLE PRECISION,        -- iRacing world Y (was missing — added here)
  lat              DOUBLE PRECISION,        -- GPS latitude
  lon              DOUBLE PRECISION,        -- GPS longitude

  -- Environment
  track_temp_c     DOUBLE PRECISION,
  air_temp_c       DOUBLE PRECISION,
  fuel_level       DOUBLE PRECISION,
  is_on_track      BOOLEAN,

  -- Provenance
  source           VARCHAR(16) NOT NULL DEFAULT 'live',
  frame_metadata   JSONB,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE telemetry_frames IS
  'Canonical telemetry fact. Grain: one row per sample point. '
  'READ PATH for replay, lap overlay, delta time, corner metrics, AI coaching. '
  'WRITE PATH: iracing.js live ingest + telemetry.js IBT parser. '
  'Do NOT use live_telemetry for analytics queries.';

-- Add any missing columns to pre-existing table (all idempotent)
ALTER TABLE telemetry_frames
  ADD COLUMN IF NOT EXISTS lap_dist_meters DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS long_accel      DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS yaw_rate        DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS x_pos           DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS y_pos           DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS lat             DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS lon             DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS fuel_level      DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS is_on_track     BOOLEAN,
  ADD COLUMN IF NOT EXISTS frame_metadata  JSONB;

-- ── Performance indexes for main read paths ───────────────────────────────────

-- Replay / time-ordered read within a session
CREATE INDEX IF NOT EXISTS idx_tf_session_ts
  ON telemetry_frames(session_id, ts);

-- Lap overlay / distance-based chart (primary analytics path)
CREATE INDEX IF NOT EXISTS idx_tf_lap_dist
  ON telemetry_frames(lap_id, lap_dist_pct)
  WHERE lap_id IS NOT NULL;

-- Comparison: two laps at matching distance
CREATE INDEX IF NOT EXISTS idx_tf_session_lap_dist
  ON telemetry_frames(session_id, lap_number, lap_dist_pct);

-- Driver history across sessions
CREATE INDEX IF NOT EXISTS idx_tf_user_ts
  ON telemetry_frames(user_id, ts);

-- General session reads
CREATE INDEX IF NOT EXISTS idx_tf_session_id
  ON telemetry_frames(session_id);

-- Lap-based lookups
CREATE INDEX IF NOT EXISTS idx_tf_lap_id
  ON telemetry_frames(lap_id)
  WHERE lap_id IS NOT NULL;

-- Time-series
CREATE INDEX IF NOT EXISTS idx_tf_ts
  ON telemetry_frames(ts);

-- Legacy index names (from setup-database.sql) — safe no-ops if already exist
CREATE INDEX IF NOT EXISTS idx_tf_session_time
  ON telemetry_frames(session_id, session_time);
