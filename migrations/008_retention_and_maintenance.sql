-- =============================================================================
-- Migration 008: Retention and Maintenance
-- Purpose: Retention cleanup functions, materialized view refresh placeholders,
--          and maintenance procedures for the analytics tables.
-- =============================================================================

-- ── Raw telemetry retention ───────────────────────────────────────────────────
-- Default: 14 days for live_telemetry (raw ingest buffer).
-- telemetry_frames (canonical) is long-term — no auto-expiry.

CREATE OR REPLACE FUNCTION cleanup_live_telemetry(
  retention_days INTEGER DEFAULT 14
) RETURNS TABLE(deleted_count BIGINT) AS $$
DECLARE
  cutoff TIMESTAMPTZ := NOW() - (retention_days || ' days')::INTERVAL;
BEGIN
  RETURN QUERY
  WITH deleted AS (
    DELETE FROM live_telemetry
    WHERE received_at < cutoff
    RETURNING id
  )
  SELECT COUNT(*) FROM deleted;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION cleanup_live_telemetry IS
  'Delete raw telemetry batches older than retention_days (default 14). '
  'Does NOT delete from telemetry_frames (long-term canonical store). '
  'Usage: SELECT * FROM cleanup_live_telemetry(14);';

-- ── Optional: archive old telemetry_frames ────────────────────────────────────
-- Only needed if disk pressure becomes an issue. Default: keep indefinitely.
-- Uncomment and schedule if required.
--
-- CREATE OR REPLACE FUNCTION archive_old_telemetry_frames(
--   retention_days INTEGER DEFAULT 365
-- ) RETURNS TABLE(deleted_count BIGINT) AS $$
-- DECLARE
--   cutoff TIMESTAMPTZ := NOW() - (retention_days || ' days')::INTERVAL;
-- BEGIN
--   RETURN QUERY
--   WITH deleted AS (
--     DELETE FROM telemetry_frames
--     WHERE created_at < cutoff
--     RETURNING id
--   )
--   SELECT COUNT(*) FROM deleted;
-- END;
-- $$ LANGUAGE plpgsql;

-- ── General maintenance procedure ────────────────────────────────────────────
-- Updates query planner statistics for main analytics tables.
-- Run weekly or after large bulk inserts.
CREATE OR REPLACE PROCEDURE run_maintenance()
LANGUAGE plpgsql AS $$
BEGIN
  ANALYZE telemetry_frames;
  ANALYZE fact_lap;
  ANALYZE fact_lap_segment;
  ANALYZE laps;
  ANALYZE sessions;
  ANALYZE races;
  ANALYZE race_state;
  ANALYZE iracing_events;
  RAISE NOTICE 'Maintenance ANALYZE complete at %', NOW();
END;
$$;

COMMENT ON PROCEDURE run_maintenance IS
  'Update query planner stats for main analytics tables. '
  'Run with: CALL run_maintenance();';

-- ── Materialized view refresh placeholder ────────────────────────────────────
-- mart_driver_consistency and mart_corner_time_loss are currently plain views.
-- If query performance becomes an issue, replace with MATERIALIZED VIEW and
-- call this procedure to refresh:
--
-- CREATE OR REPLACE PROCEDURE refresh_analytical_marts()
-- LANGUAGE plpgsql AS $$
-- BEGIN
--   REFRESH MATERIALIZED VIEW CONCURRENTLY mart_driver_consistency;
--   REFRESH MATERIALIZED VIEW CONCURRENTLY mart_corner_time_loss;
--   RAISE NOTICE 'Marts refreshed at %', NOW();
-- END;
-- $$;

-- ── Index maintenance notes ───────────────────────────────────────────────────
-- telemetry_frames grows fast. Run periodically:
--   REINDEX INDEX CONCURRENTLY idx_tf_session_ts;
--   REINDEX INDEX CONCURRENTLY idx_tf_lap_dist;
--
-- To check table/index sizes:
--   SELECT relname, pg_size_pretty(pg_total_relation_size(relid))
--   FROM pg_catalog.pg_statio_user_tables
--   ORDER BY pg_total_relation_size(relid) DESC;
--
-- VACUUM policy:
--   telemetry_frames: autovacuum handles; consider autovacuum_vacuum_scale_factor=0.01
--   live_telemetry: bulk deletes → run VACUUM ANALYZE live_telemetry after cleanup
