-- =============================================================================
-- Migration 005: Derived Fact Tables
-- Purpose: Warehouse-style fact tables for lap-level and segment-level analytics.
--          fact_lap replaces lap_features role (compat view in 007).
--          fact_lap_segment replaces lap_segment_features role (compat view in 007).
--          fact_stint captures per-stint race data.
-- =============================================================================

-- ── fact_lap ──────────────────────────────────────────────────────────────────
-- Grain: one row per lap (lap_id PK).
-- Computed from telemetry_frames after a lap completes.
-- backward compat: lap_features view defined in 007_compatibility_views.sql.
CREATE TABLE IF NOT EXISTS fact_lap (
  lap_id            INTEGER PRIMARY KEY REFERENCES laps(id) ON DELETE CASCADE,
  session_id        INTEGER NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  user_id           INTEGER NOT NULL REFERENCES users(id)    ON DELETE CASCADE,
  track_config_id   INTEGER REFERENCES track_configs(id),

  -- Core lap metrics (mirrors laps table for denorm convenience)
  lap_number        INTEGER,
  lap_time          DOUBLE PRECISION,
  is_valid          BOOLEAN,

  -- Speed channels
  max_speed_kph     DOUBLE PRECISION,
  avg_speed_kph     DOUBLE PRECISION,
  min_speed_kph     DOUBLE PRECISION,

  -- Input metrics
  throttle_full_pct DOUBLE PRECISION,   -- % of lap at 100% throttle
  brake_pct_avg     DOUBLE PRECISION,   -- avg brake pressure
  brake_peak        DOUBLE PRECISION,   -- peak brake application
  brake_zone_count  INTEGER,
  coasting_pct      DOUBLE PRECISION,   -- % of lap at 0 throttle 0 brake

  -- Steering / smoothness
  steering_variance     DOUBLE PRECISION,
  steering_trace_entropy DOUBLE PRECISION,

  -- Corner aggregates
  entry_speed_avg   DOUBLE PRECISION,
  apex_speed_avg    DOUBLE PRECISION,
  exit_speed_avg    DOUBLE PRECISION,

  -- Event counts
  lift_count        INTEGER,
  wheelspin_events  INTEGER,
  lockup_events     INTEGER,

  -- Efficiency
  fuel_used         DOUBLE PRECISION,

  -- Composite scores
  consistency_score DOUBLE PRECISION,
  smoothness_score  DOUBLE PRECISION,

  feature_version   VARCHAR(32) DEFAULT 'v2',
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  updated_at        TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON TABLE fact_lap IS
  'Lap-level analytics fact. Grain: one row per lap. '
  'Computed from telemetry_frames after lap completes. '
  'Backward compat: lap_features view defined in 007_compatibility_views.sql.';

CREATE INDEX IF NOT EXISTS idx_fact_lap_session      ON fact_lap(session_id);
CREATE INDEX IF NOT EXISTS idx_fact_lap_user         ON fact_lap(user_id);
CREATE INDEX IF NOT EXISTS idx_fact_lap_track_config ON fact_lap(track_config_id)
  WHERE track_config_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_fact_lap_time         ON fact_lap(lap_time)
  WHERE is_valid = TRUE;

-- ── fact_lap_segment ──────────────────────────────────────────────────────────
-- Grain: one row per (lap_id, segment_id).
-- Computed from telemetry_frames using segment distance boundaries.
-- backward compat: lap_segment_features view defined in 007.
CREATE TABLE IF NOT EXISTS fact_lap_segment (
  id                       BIGSERIAL PRIMARY KEY,
  lap_id                   INTEGER NOT NULL REFERENCES laps(id)     ON DELETE CASCADE,
  segment_id               BIGINT           REFERENCES segments(id)  ON DELETE SET NULL,
  -- Legacy FK kept during transition from corner_segments
  corner_segment_id        BIGINT           REFERENCES corner_segments(id) ON DELETE SET NULL,
  session_id               INTEGER          REFERENCES sessions(id)  ON DELETE SET NULL,
  user_id                  INTEGER          REFERENCES users(id)     ON DELETE SET NULL,

  -- Speed profile
  entry_speed_kph          DOUBLE PRECISION,
  min_speed_kph            DOUBLE PRECISION,
  apex_speed_kph           DOUBLE PRECISION,
  exit_speed_kph           DOUBLE PRECISION,

  -- Input trace
  brake_start_dist_pct     DOUBLE PRECISION,
  brake_release_dist_pct   DOUBLE PRECISION,
  throttle_pickup_dist_pct DOUBLE PRECISION,
  max_brake                DOUBLE PRECISION,
  min_throttle             DOUBLE PRECISION,
  steering_peak_deg        DOUBLE PRECISION,

  -- Time metrics
  time_in_segment          DOUBLE PRECISION,
  delta_vs_best            DOUBLE PRECISION,   -- vs personal best lap in session
  time_loss_vs_ref         DOUBLE PRECISION,   -- vs reference/coach lap

  created_at               TIMESTAMPTZ DEFAULT NOW(),
  updated_at               TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON TABLE fact_lap_segment IS
  'Lap x segment analytics fact. Grain: one row per (lap_id, segment_id). '
  'Source of truth for corner time loss analysis and coaching overlays.';

-- Unique per lap+segment when segment FK is set
CREATE UNIQUE INDEX IF NOT EXISTS idx_fls_lap_segment
  ON fact_lap_segment(lap_id, segment_id)
  WHERE segment_id IS NOT NULL;

-- Unique per lap+corner_segment (legacy) when corner_segment_id is set
CREATE UNIQUE INDEX IF NOT EXISTS idx_fls_lap_corner_segment
  ON fact_lap_segment(lap_id, corner_segment_id)
  WHERE corner_segment_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_fls_lap       ON fact_lap_segment(lap_id);
CREATE INDEX IF NOT EXISTS idx_fls_segment   ON fact_lap_segment(segment_id)
  WHERE segment_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_fls_user      ON fact_lap_segment(user_id);
CREATE INDEX IF NOT EXISTS idx_fls_session   ON fact_lap_segment(session_id);

-- ── fact_stint ────────────────────────────────────────────────────────────────
-- Grain: one row per driver stint within a race.
-- Populated from iracing_events driver_change records post-hoc.
CREATE TABLE IF NOT EXISTS fact_stint (
  id               SERIAL PRIMARY KEY,
  race_id          INTEGER NOT NULL REFERENCES races(id)    ON DELETE CASCADE,
  user_id          INTEGER          REFERENCES users(id)    ON DELETE SET NULL,
  session_id       INTEGER          REFERENCES sessions(id) ON DELETE SET NULL,
  stint_index      INTEGER NOT NULL,

  started_at       TIMESTAMPTZ,
  ended_at         TIMESTAMPTZ,
  duration_seconds DOUBLE PRECISION,
  laps_completed   INTEGER,
  fuel_used        DOUBLE PRECISION,
  tyre_change      BOOLEAN,
  notes            TEXT,
  created_at       TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON TABLE fact_stint IS
  'Stint-level fact. Grain: one row per driver stint in a race. '
  'Populated from iracing_events driver_change records by a post-processing step.';

CREATE INDEX IF NOT EXISTS idx_fact_stint_race ON fact_stint(race_id);
CREATE INDEX IF NOT EXISTS idx_fact_stint_user ON fact_stint(user_id);
