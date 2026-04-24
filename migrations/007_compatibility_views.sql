-- =============================================================================
-- Migration 007: Compatibility Views
-- Purpose: Ensure existing app code that queries old table names continues to
--          work after the refactor. Physical tables are kept where they already
--          exist with data; views are aliases mapping old names to new roles.
-- =============================================================================

-- ── live_telemetry_raw → live_telemetry (alias view) ─────────────────────────
-- Physical table: live_telemetry
-- New code should reference live_telemetry_raw conceptually; this view makes
-- that name queryable. Not writable — inserts must still go to live_telemetry.
CREATE OR REPLACE VIEW live_telemetry_raw AS
SELECT
  id,
  race_id,
  session_id,
  user_id,
  NULL::INTEGER    AS lap,  -- use live_telemetry.lap for lap-specific reads
  samples,
  sample_count,
  received_at      AS created_at
FROM live_telemetry;

COMMENT ON VIEW live_telemetry_raw IS
  'Alias view over live_telemetry for new architecture naming convention. '
  'Read-only. Insert via live_telemetry physical table.';

-- ── fact_iracing_event → iracing_events (alias view) ─────────────────────────
-- Physical table: iracing_events
-- New analytics code should use fact_iracing_event name.
CREATE OR REPLACE VIEW fact_iracing_event AS
SELECT
  id,
  race_id,
  driver_user_id    AS user_id,
  reported_by_user_id,
  event_type,
  NULL::TEXT        AS event_subtype,
  driver_name,
  fuel_level,
  fuel_pct,
  mins_remaining,
  session_time,
  created_at        AS event_ts,
  created_at
FROM iracing_events;

COMMENT ON VIEW fact_iracing_event IS
  'Fact alias view for iracing_events. Grain: one row per iRacing event. '
  'Physical table: iracing_events (preserved for app writes).';

-- ── corner_segments compat view over segments ─────────────────────────────────
-- Physical table: corner_segments (preserved — has lap_segment_features FK)
-- New code should use segments table directly.
-- This view exposes segments rows with corner_segments column names.
CREATE OR REPLACE VIEW corner_segments_normalized AS
SELECT
  seg.id,
  COALESCE(seg.track_code, '')        AS track_id,
  COALESCE(seg.track_config_code, '') AS track_config,
  seg.segment_number,
  seg.display_name                    AS name,
  seg.start_dist_pct,
  seg.apex_dist_pct,
  seg.end_dist_pct,
  seg.segment_type                    AS kind,
  seg.created_at
FROM segments seg;

COMMENT ON VIEW corner_segments_normalized IS
  'Backward-compat view of segments table with corner_segments column names. '
  'Used to query segments using legacy column names. '
  'Physical corner_segments table kept for lap_segment_features FK.';

-- ── lap_features → fact_lap (alias view) ──────────────────────────────────────
-- Physical table: lap_features (preserved for existing data and writes)
-- fact_lap is the new write destination for feature computation.
-- This view merges both tables so existing queries work.
CREATE OR REPLACE VIEW lap_features_v AS
SELECT
  fl.lap_id,
  fl.session_id,
  fl.user_id,
  fl.lap_time,
  fl.max_speed_kph,
  fl.avg_speed_kph,
  fl.min_speed_kph,
  fl.throttle_full_pct,
  fl.brake_peak,
  fl.brake_zone_count,
  fl.steering_variance,
  fl.entry_speed_avg,
  fl.apex_speed_avg,
  fl.exit_speed_avg,
  fl.lift_count,
  fl.wheelspin_events,
  fl.lockup_events,
  fl.consistency_score,
  fl.smoothness_score,
  fl.feature_version,
  fl.created_at
FROM fact_lap fl
UNION ALL
-- Include rows from legacy lap_features not yet migrated to fact_lap
SELECT
  lf.lap_id,
  lf.session_id,
  lf.user_id,
  lf.lap_time,
  lf.max_speed_kph,
  lf.avg_speed_kph,
  lf.min_speed_kph,
  lf.throttle_full_pct,
  lf.brake_peak::DOUBLE PRECISION,
  lf.brake_zone_count,
  lf.steering_variance::DOUBLE PRECISION,
  lf.entry_speed_avg,
  lf.apex_speed_avg,
  lf.exit_speed_avg,
  lf.lift_count,
  lf.wheelspin_events,
  lf.lockup_events,
  lf.consistency_score::DOUBLE PRECISION,
  lf.smoothness_score::DOUBLE PRECISION,
  NULL::TEXT AS feature_version,
  lf.created_at
FROM lap_features lf
WHERE NOT EXISTS (SELECT 1 FROM fact_lap fl2 WHERE fl2.lap_id = lf.lap_id);

COMMENT ON VIEW lap_features_v IS
  'Merged lap features view. Returns fact_lap rows first, then legacy '
  'lap_features rows not yet migrated. Query this for coaching/analysis reads.';

-- ── lap_segment_features → fact_lap_segment (alias view) ─────────────────────
-- Physical table: lap_segment_features (preserved for existing data and writes)
-- fact_lap_segment is the new write destination.
CREATE OR REPLACE VIEW lap_segment_features_v AS
SELECT
  fls.id,
  fls.lap_id,
  fls.segment_id       AS segment_id,
  fls.corner_segment_id,
  fls.session_id,
  fls.user_id,
  fls.entry_speed_kph,
  fls.apex_speed_kph,
  fls.exit_speed_kph,
  fls.min_speed_kph,
  fls.brake_start_dist_pct,
  fls.brake_release_dist_pct,
  fls.throttle_pickup_dist_pct,
  fls.max_brake,
  fls.min_throttle,
  fls.steering_peak_deg,
  fls.time_loss_vs_ref,
  fls.created_at
FROM fact_lap_segment fls
UNION ALL
SELECT
  lsf.id,
  lsf.lap_id,
  lsf.segment_id       AS segment_id,  -- this is corner_segments.id
  lsf.segment_id       AS corner_segment_id,
  NULL::INTEGER        AS session_id,
  NULL::INTEGER        AS user_id,
  lsf.entry_speed_kph,
  lsf.apex_speed_kph,
  lsf.exit_speed_kph,
  lsf.min_speed_kph,
  lsf.brake_start_dist_pct,
  lsf.brake_release_dist_pct,
  lsf.throttle_pickup_dist_pct,
  lsf.max_brake,
  lsf.min_throttle,
  lsf.steering_peak_deg,
  lsf.time_loss_vs_ref,
  lsf.created_at
FROM lap_segment_features lsf
WHERE NOT EXISTS (
  SELECT 1 FROM fact_lap_segment fls2
  WHERE fls2.lap_id = lsf.lap_id
    AND fls2.corner_segment_id = lsf.segment_id
);

COMMENT ON VIEW lap_segment_features_v IS
  'Merged lap segment features view. Returns fact_lap_segment rows first, '
  'then legacy lap_segment_features rows not yet migrated.';
