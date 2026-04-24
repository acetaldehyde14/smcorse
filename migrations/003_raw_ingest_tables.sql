-- =============================================================================
-- Migration 003: Raw Ingest Tables
-- Purpose: Formalise the raw telemetry ingest layer.
--          live_telemetry (existing) IS the raw ingest buffer — this migration
--          adds missing columns, a session_id FK, proper comments, and creates
--          live_telemetry_raw as a documented alias for new code paths.
-- Design decision: keep live_telemetry as the physical table (avoid a rename
--          that would break existing iracing.js reads on /telemetry/live).
-- =============================================================================

-- ── Ensure live_telemetry exists with all needed columns ──────────────────────
CREATE TABLE IF NOT EXISTS live_telemetry (
  id           BIGSERIAL PRIMARY KEY,
  race_id      INTEGER REFERENCES races(id)    ON DELETE SET NULL,
  session_id   INTEGER REFERENCES sessions(id) ON DELETE SET NULL,
  user_id      INTEGER REFERENCES users(id)    ON DELETE SET NULL,
  lap          INTEGER,
  samples      JSONB NOT NULL,
  sample_count INTEGER,
  received_at  TIMESTAMPTZ DEFAULT NOW()
);

-- Add session_id if table pre-existed without it
ALTER TABLE live_telemetry ADD COLUMN IF NOT EXISTS session_id INTEGER REFERENCES sessions(id) ON DELETE SET NULL;

COMMENT ON TABLE live_telemetry IS
  'Raw telemetry ingest buffer. Grain: one row per ingest batch from a desktop client. '
  'Short-retention store (default 14 days — see cleanup_live_telemetry() in 008). '
  'NOT the analysis source of truth — use telemetry_frames for replay and analytics. '
  'Role alias: live_telemetry_raw (see 007_compatibility_views.sql).';

CREATE INDEX IF NOT EXISTS idx_live_telem_race     ON live_telemetry(race_id, received_at DESC);
CREATE INDEX IF NOT EXISTS idx_live_telem_session  ON live_telemetry(session_id, received_at DESC);
CREATE INDEX IF NOT EXISTS idx_live_telem_lap      ON live_telemetry(race_id, lap);
CREATE INDEX IF NOT EXISTS idx_live_telem_received ON live_telemetry(received_at);

-- ── Document iracing_events as the operational event log ──────────────────────
-- iracing_events is kept as the physical table; fact_iracing_event is a view alias
-- in 007_compatibility_views.sql.
COMMENT ON TABLE iracing_events IS
  'Operational iRacing event log. Grain: one row per desktop client event '
  '(driver_change, fuel_update). Also serves as fact_iracing_event — '
  'see view alias in 007_compatibility_views.sql.';
