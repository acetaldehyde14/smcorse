-- =============================================================================
-- Migration 006: Serving Marts
-- Purpose: Views and functions optimised for specific app read patterns.
--          All marts are views unless otherwise noted.
--          mart_lap_comparison is a SQL FUNCTION (not a view) because a
--          cross-join view over telemetry_frames would be unusably slow.
-- =============================================================================

-- ── Warehouse dimension views ─────────────────────────────────────────────────

CREATE OR REPLACE VIEW dim_user AS
SELECT
  id           AS user_key,
  id           AS user_id,
  username,
  email,
  iracing_name,
  iracing_id,
  is_admin,
  is_active,
  created_at
FROM users;

COMMENT ON VIEW dim_user IS 'User dimension. 1-1 with users table.';

CREATE OR REPLACE VIEW dim_track AS
SELECT
  id                           AS track_key,
  id                           AS track_id,
  COALESCE(track_code,
    -- fall back to old track_id column if track_code not yet populated
    (SELECT t2.track_id::varchar FROM tracks t2 WHERE t2.id = t.id))
                               AS track_code,
  COALESCE(display_name,
    (SELECT t2.track_name FROM tracks t2 WHERE t2.id = t.id))
                               AS track_name,
  country,
  length_meters,
  created_at
FROM tracks t;

COMMENT ON VIEW dim_track IS
  'Track dimension view. Grain: one row per physical track. '
  'Coalesces new track_code/display_name with legacy track_id/track_name columns.';

CREATE OR REPLACE VIEW dim_track_config AS
SELECT
  tc.id           AS track_config_key,
  tc.id           AS track_config_id,
  tc.track_id,
  tc.config_code,
  tc.display_name AS config_name,
  tc.length_meters,
  tc.is_default
FROM track_configs tc;

COMMENT ON VIEW dim_track_config IS 'Track config dimension view. Grain: one row per track layout.';

CREATE OR REPLACE VIEW dim_car AS
SELECT
  id           AS car_key,
  id           AS car_id,
  car_code,
  display_name AS car_name,
  car_class,
  manufacturer,
  created_at
FROM cars;

COMMENT ON VIEW dim_car IS 'Car dimension view. Grain: one row per car model.';

CREATE OR REPLACE VIEW dim_session AS
SELECT
  s.id                    AS session_key,
  s.id                    AS session_id,
  s.user_id,
  s.track_ref_id          AS track_id,
  s.track_config_ref_id   AS track_config_id,
  s.car_ref_id            AS car_id,
  s.track_id              AS track_code_raw,
  s.track_name,
  s.car_id                AS car_code_raw,
  s.car_name,
  s.session_type,
  s.ingest_mode           AS source_type,
  s.status,
  s.created_at            AS started_at,
  s.ended_at
FROM sessions s;

COMMENT ON VIEW dim_session IS
  'Session dimension. Grain: one row per session. '
  'track_id/car_id FKs null until backfill/001 script runs.';

CREATE OR REPLACE VIEW dim_lap AS
SELECT
  l.id         AS lap_key,
  l.id         AS lap_id,
  l.session_id,
  l.user_id,
  l.lap_number,
  l.is_valid,
  l.lap_time,
  l.created_at
FROM laps l;

COMMENT ON VIEW dim_lap IS 'Lap dimension. Grain: one row per lap.';

CREATE OR REPLACE VIEW dim_segment AS
SELECT
  s.id               AS segment_key,
  s.id               AS segment_id,
  s.track_config_id,
  s.track_code,
  s.track_config_code,
  s.segment_number,
  s.display_name     AS segment_name,
  s.segment_type,
  s.start_dist_pct,
  s.end_dist_pct,
  s.apex_dist_pct
FROM segments s;

COMMENT ON VIEW dim_segment IS 'Segment dimension. Grain: one row per track_config x segment.';

-- ── mart_live_race_state ──────────────────────────────────────────────────────
-- Purpose: fast single read for live race dashboard.
-- Grain: one row per race.
CREATE OR REPLACE VIEW mart_live_race_state AS
SELECT
  rs.race_id,
  r.name              AS race_name,
  r.track             AS race_track,
  r.is_active,
  r.started_at        AS race_started_at,
  rs.current_driver_name,
  rs.current_stint_index,
  rs.position,
  rs.class_position,
  rs.laps_completed,
  rs.last_fuel_level  AS fuel_level,
  rs.low_fuel_notified,
  rs.last_lap_time,
  rs.best_lap_time,
  rs.gap_to_leader,
  rs.gap_ahead,
  rs.gap_behind,
  rs.nearby_cars,
  rs.stint_started_at,
  rs.last_event_at    AS updated_at,
  (SELECT COUNT(*)
   FROM iracing_events ie
   WHERE ie.race_id = rs.race_id) AS total_events
FROM race_state rs
JOIN races r ON r.id = rs.race_id;

COMMENT ON VIEW mart_live_race_state IS
  'Live race dashboard mart. Grain: one row per race. '
  'Backed by race_state + races. Refresh: live (standard view).';

-- ── mart_lap_comparison() ─────────────────────────────────────────────────────
-- Purpose: lap-vs-lap overlay — speed, throttle, brake at matching distance.
-- Implemented as a FUNCTION to avoid catastrophic cross-join over telemetry_frames.
--
-- FIX: Use FLOOR() (works natively with DOUBLE PRECISION) instead of
--      ROUND(NUMERIC / DOUBLE PRECISION) which fails with a type-mismatch error.
--
-- Usage: SELECT * FROM mart_lap_comparison(ref_lap_id, cmp_lap_id);
--        SELECT * FROM mart_lap_comparison(ref_lap_id, cmp_lap_id, 0.002);
CREATE OR REPLACE FUNCTION mart_lap_comparison(
  p_reference_lap_id  INTEGER,
  p_comparison_lap_id INTEGER,
  p_bucket            DOUBLE PRECISION DEFAULT 0.001  -- lap distance bucket width
) RETURNS TABLE (
  distance_pct      DOUBLE PRECISION,
  ref_speed_kph     DOUBLE PRECISION,
  cmp_speed_kph     DOUBLE PRECISION,
  speed_delta_kph   DOUBLE PRECISION,
  ref_throttle      DOUBLE PRECISION,
  cmp_throttle      DOUBLE PRECISION,
  ref_brake         DOUBLE PRECISION,
  cmp_brake         DOUBLE PRECISION,
  ref_steering_deg  DOUBLE PRECISION,
  cmp_steering_deg  DOUBLE PRECISION
) AS $$
  -- Bin each lap by FLOOR(lap_dist_pct / bucket) then average channels per bin.
  -- FLOOR on DOUBLE PRECISION avoids the NUMERIC / DOUBLE PRECISION type error.
  WITH
  ref_binned AS (
    SELECT
      FLOOR(lap_dist_pct / p_bucket) * p_bucket AS dist_bucket,
      AVG(speed_kph)    AS speed_kph,
      AVG(throttle)     AS throttle,
      AVG(brake)        AS brake,
      AVG(steering_deg) AS steering_deg
    FROM telemetry_frames
    WHERE lap_id = p_reference_lap_id
      AND lap_dist_pct IS NOT NULL
    GROUP BY 1
  ),
  cmp_binned AS (
    SELECT
      FLOOR(lap_dist_pct / p_bucket) * p_bucket AS dist_bucket,
      AVG(speed_kph)    AS speed_kph,
      AVG(throttle)     AS throttle,
      AVG(brake)        AS brake,
      AVG(steering_deg) AS steering_deg
    FROM telemetry_frames
    WHERE lap_id = p_comparison_lap_id
      AND lap_dist_pct IS NOT NULL
    GROUP BY 1
  )
  SELECT
    COALESCE(r.dist_bucket, c.dist_bucket)                       AS distance_pct,
    r.speed_kph                                                  AS ref_speed_kph,
    c.speed_kph                                                  AS cmp_speed_kph,
    COALESCE(c.speed_kph, 0) - COALESCE(r.speed_kph, 0)         AS speed_delta_kph,
    r.throttle                                                   AS ref_throttle,
    c.throttle                                                   AS cmp_throttle,
    r.brake                                                      AS ref_brake,
    c.brake                                                      AS cmp_brake,
    r.steering_deg                                               AS ref_steering_deg,
    c.steering_deg                                               AS cmp_steering_deg
  FROM ref_binned r
  FULL OUTER JOIN cmp_binned c ON c.dist_bucket = r.dist_bucket
  ORDER BY 1
$$ LANGUAGE SQL STABLE;

COMMENT ON FUNCTION mart_lap_comparison IS
  'Lap comparison mart. Returns channel data for two laps binned by lap_dist_pct. '
  'Usage: SELECT * FROM mart_lap_comparison(ref_lap_id, cmp_lap_id [, bucket_size]);';

-- ── mart_driver_consistency ───────────────────────────────────────────────────
-- Purpose: per driver x session consistency summary.
-- Grain: one row per (user_id, session_id).
--
-- FIX: pace_dropoff previously used a correlated subquery inside a FILTER clause,
--      which is invalid PostgreSQL syntax. Replaced with a CTE that pre-computes
--      the session midpoint lap number, then joined into the main aggregation.
CREATE OR REPLACE VIEW mart_driver_consistency AS
WITH session_midpoints AS (
  -- Pre-compute the midpoint lap number per session to avoid subquery in FILTER.
  SELECT
    session_id,
    MAX(lap_number) / 2.0 AS midpoint
  FROM laps
  WHERE lap_number IS NOT NULL AND lap_time IS NOT NULL
  GROUP BY session_id
)
SELECT
  l.user_id,
  u.username,
  u.iracing_name,
  l.session_id,
  s.track_name,
  s.car_name,
  COUNT(*)                                                       AS lap_count,
  COUNT(*) FILTER (WHERE l.is_valid)                            AS valid_lap_count,
  MIN(l.lap_time)                                               AS best_lap_time,
  AVG(l.lap_time) FILTER (WHERE l.is_valid)                    AS avg_lap_time,
  STDDEV(l.lap_time) FILTER (WHERE l.is_valid)                 AS lap_time_stddev,
  MAX(l.lap_time) - MIN(l.lap_time)                            AS lap_time_range,
  -- pace_dropoff: avg lap time in second half minus first half of session
  -- positive = slowing down, negative = improving
  AVG(l.lap_time) FILTER (WHERE l.is_valid
                             AND l.lap_number > sm.midpoint)
  - AVG(l.lap_time) FILTER (WHERE l.is_valid
                               AND l.lap_number IS NOT NULL
                               AND l.lap_number <= sm.midpoint) AS pace_dropoff,
  AVG(fl.fuel_used)                                            AS avg_fuel_per_lap,
  AVG(fl.consistency_score)                                    AS consistency_score,
  AVG(fl.smoothness_score)                                     AS smoothness_score,
  s.created_at                                                 AS session_started_at
FROM laps l
JOIN users u           ON u.id = l.user_id
JOIN sessions s        ON s.id = l.session_id
JOIN session_midpoints sm ON sm.session_id = l.session_id
LEFT JOIN fact_lap fl  ON fl.lap_id = l.id
WHERE l.lap_time IS NOT NULL
GROUP BY l.user_id, u.username, u.iracing_name, l.session_id,
         s.track_name, s.car_name, s.created_at, sm.midpoint;

COMMENT ON VIEW mart_driver_consistency IS
  'Driver consistency mart. Grain: one row per (user_id, session_id). '
  'Aggregated from laps + fact_lap. pace_dropoff > 0 means slowing down over session.';

-- ── mart_corner_time_loss ─────────────────────────────────────────────────────
-- Purpose: per lap x segment time loss vs reference.
-- Grain: one row per (lap_id, segment).
CREATE OR REPLACE VIEW mart_corner_time_loss AS
SELECT
  fls.lap_id,
  fls.segment_id,
  fls.corner_segment_id,
  COALESCE(seg.display_name, cs.name)                         AS segment_name,
  COALESCE(seg.segment_number, cs.segment_number)             AS segment_number,
  COALESCE(seg.segment_type, cs.kind)                         AS segment_type,
  fls.user_id,
  fls.session_id,
  fls.entry_speed_kph,
  fls.min_speed_kph,
  fls.apex_speed_kph,
  fls.exit_speed_kph,
  fls.time_loss_vs_ref   AS time_loss,
  fls.delta_vs_best,
  fls.brake_start_dist_pct,
  fls.throttle_pickup_dist_pct,
  fls.time_in_segment,
  fls.created_at
FROM fact_lap_segment fls
LEFT JOIN segments seg        ON seg.id = fls.segment_id
LEFT JOIN corner_segments cs  ON cs.id  = fls.corner_segment_id;

COMMENT ON VIEW mart_corner_time_loss IS
  'Corner time loss mart. Grain: one row per (lap_id, segment). '
  'Joins both segments (new) and corner_segments (legacy). '
  'Filter by session_id or lap_id for coaching overlays.';
