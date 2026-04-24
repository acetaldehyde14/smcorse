-- =============================================================================
-- Backfill 004: Migrate lap_segment_features → fact_lap_segment
-- Purpose: Copy existing lap_segment_features rows into fact_lap_segment.
--          lap_segment_features.segment_id = corner_segments.id (legacy naming).
--          Sets corner_segment_id and segment_id FKs appropriately.
--
-- Run ONCE after backfill/002. Safe to re-run (ON CONFLICT DO NOTHING).
-- =============================================================================

INSERT INTO fact_lap_segment (
  lap_id,
  segment_id,
  corner_segment_id,
  session_id,
  user_id,
  entry_speed_kph,
  min_speed_kph,
  apex_speed_kph,
  exit_speed_kph,
  brake_start_dist_pct,
  brake_release_dist_pct,
  throttle_pickup_dist_pct,
  max_brake,
  min_throttle,
  steering_peak_deg,
  time_loss_vs_ref,
  created_at
)
SELECT
  lsf.lap_id,
  -- Attempt to resolve to normalized segments.id
  seg.id                          AS segment_id,
  -- Keep legacy corner_segments.id
  lsf.segment_id                  AS corner_segment_id,
  l.session_id,
  l.user_id,
  lsf.entry_speed_kph::DOUBLE PRECISION,
  lsf.min_speed_kph::DOUBLE PRECISION,
  lsf.apex_speed_kph::DOUBLE PRECISION,
  lsf.exit_speed_kph::DOUBLE PRECISION,
  lsf.brake_start_dist_pct::DOUBLE PRECISION,
  lsf.brake_release_dist_pct::DOUBLE PRECISION,
  lsf.throttle_pickup_dist_pct::DOUBLE PRECISION,
  lsf.max_brake::DOUBLE PRECISION,
  lsf.min_throttle::DOUBLE PRECISION,
  lsf.steering_peak_deg::DOUBLE PRECISION,
  lsf.time_loss_vs_ref::DOUBLE PRECISION,
  lsf.created_at
FROM lap_segment_features lsf
JOIN laps l ON l.id = lsf.lap_id
JOIN corner_segments cs ON cs.id = lsf.segment_id
-- Try to find a matching segments row (may be NULL if backfill/002 not yet run)
LEFT JOIN segments seg
  ON seg.track_code = cs.track_id
  AND seg.segment_number = cs.segment_number
  AND (
    seg.track_config_code = COALESCE(cs.track_config, 'default')
    OR seg.track_config_code IS NULL
  )
ON CONFLICT DO NOTHING;

-- Report
SELECT
  (SELECT COUNT(*) FROM lap_segment_features)                AS legacy_rows,
  (SELECT COUNT(*) FROM fact_lap_segment)                    AS fact_lap_segment_rows,
  (SELECT COUNT(*) FROM fact_lap_segment WHERE segment_id IS NOT NULL)     AS with_normalized_seg,
  (SELECT COUNT(*) FROM fact_lap_segment WHERE corner_segment_id IS NOT NULL) AS with_corner_seg;
