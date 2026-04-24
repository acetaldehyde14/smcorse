-- =============================================================================
-- Backfill 003: Migrate lap_features → fact_lap
-- Purpose: Copy existing lap_features rows into fact_lap.
--          After migration, new features are written to fact_lap directly.
--          lap_features physical table is kept; lap_features_v view merges both.
--
-- Run ONCE after migrations 001-008. Safe to re-run (ON CONFLICT DO NOTHING).
-- =============================================================================

INSERT INTO fact_lap (
  lap_id,
  session_id,
  user_id,
  lap_number,
  lap_time,
  is_valid,
  max_speed_kph,
  avg_speed_kph,
  min_speed_kph,
  throttle_full_pct,
  brake_peak,
  brake_zone_count,
  steering_variance,
  entry_speed_avg,
  apex_speed_avg,
  exit_speed_avg,
  lift_count,
  wheelspin_events,
  lockup_events,
  consistency_score,
  smoothness_score,
  feature_version,
  created_at
)
SELECT
  lf.lap_id,
  lf.session_id,
  lf.user_id,
  l.lap_number,
  lf.lap_time::DOUBLE PRECISION,
  COALESCE(l.is_valid, TRUE),
  lf.max_speed_kph::DOUBLE PRECISION,
  lf.avg_speed_kph::DOUBLE PRECISION,
  lf.min_speed_kph::DOUBLE PRECISION,
  lf.throttle_full_pct::DOUBLE PRECISION,
  lf.brake_peak::DOUBLE PRECISION,
  lf.brake_zone_count,
  lf.steering_variance::DOUBLE PRECISION,
  lf.entry_speed_avg::DOUBLE PRECISION,
  lf.apex_speed_avg::DOUBLE PRECISION,
  lf.exit_speed_avg::DOUBLE PRECISION,
  lf.lift_count,
  lf.wheelspin_events,
  lf.lockup_events,
  lf.consistency_score::DOUBLE PRECISION,
  lf.smoothness_score::DOUBLE PRECISION,
  lf.feature_version,
  lf.created_at
FROM lap_features lf
JOIN laps l ON l.id = lf.lap_id
ON CONFLICT (lap_id) DO NOTHING;

-- Report
SELECT
  (SELECT COUNT(*) FROM lap_features) AS legacy_rows,
  (SELECT COUNT(*) FROM fact_lap)     AS fact_lap_rows,
  (SELECT COUNT(*) FROM lap_features lf WHERE NOT EXISTS (
    SELECT 1 FROM fact_lap fl WHERE fl.lap_id = lf.lap_id
  ))                                  AS unmigrated_rows;
