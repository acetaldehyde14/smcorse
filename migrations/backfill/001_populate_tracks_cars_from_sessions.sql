-- =============================================================================
-- Backfill 001: Populate tracks, track_configs, and cars from sessions
-- Purpose: Seed dimension tables from the free-text track_id/car_id values
--          stored in sessions.
--
-- Handles two cases for the tracks table:
--   A) tracks pre-existed from iracing-coach/database/schema.sql with columns
--      track_id (UNIQUE NOT NULL) and track_name. Migration 001 added track_code
--      and display_name columns. This script populates those from track_id/track_name.
--   B) tracks was created fresh by migration 001 with track_code/display_name.
--
-- Run ONCE after migrations 001–008. Safe to re-run (ON CONFLICT DO NOTHING /
-- WHERE NULL guards prevent double-writes).
-- =============================================================================

-- ── 1. Reconcile tracks: populate track_code/display_name from legacy columns ──
-- For the old schema where track_id (VARCHAR UNIQUE) and track_name exist
-- but the new track_code / display_name columns are NULL.
UPDATE tracks
SET
  track_code   = LOWER(TRIM(track_id)),
  display_name = COALESCE(NULLIF(TRIM(track_name), ''), LOWER(TRIM(track_id)))
WHERE track_code IS NULL
  AND track_id IS NOT NULL;  -- track_id is the old column from schema.sql

-- ── 2. Insert new tracks from sessions (any track not already in the table) ───
INSERT INTO tracks (track_code, display_name)
SELECT DISTINCT
  LOWER(TRIM(s.track_id))  AS track_code,
  COALESCE(NULLIF(TRIM(s.track_name), ''), LOWER(TRIM(s.track_id))) AS display_name
FROM sessions s
WHERE s.track_id IS NOT NULL
  AND TRIM(s.track_id) <> ''
  AND NOT EXISTS (
    SELECT 1 FROM tracks t WHERE t.track_code = LOWER(TRIM(s.track_id))
  );

-- ── 3. Populate default track_configs (one per track) ────────────────────────
INSERT INTO track_configs (track_id, config_code, display_name, is_default)
SELECT
  t.id,
  'default'      AS config_code,
  t.display_name AS display_name,
  TRUE
FROM tracks t
WHERE t.track_code IS NOT NULL
ON CONFLICT (track_id, config_code) DO NOTHING;

-- ── 4. Populate cars from sessions ────────────────────────────────────────────
INSERT INTO cars (car_code, display_name)
SELECT DISTINCT
  LOWER(TRIM(s.car_id))   AS car_code,
  COALESCE(NULLIF(TRIM(s.car_name), ''), LOWER(TRIM(s.car_id))) AS display_name
FROM sessions s
WHERE s.car_id IS NOT NULL
  AND TRIM(s.car_id) <> ''
ON CONFLICT (car_code) DO NOTHING;

-- ── 5. Set track_ref_id on sessions ──────────────────────────────────────────
UPDATE sessions s
SET track_ref_id = t.id
FROM tracks t
WHERE LOWER(TRIM(s.track_id)) = t.track_code
  AND s.track_ref_id IS NULL;

-- ── 6. Set track_config_ref_id on sessions (default config) ──────────────────
UPDATE sessions s
SET track_config_ref_id = tc.id
FROM track_configs tc
WHERE tc.track_id = s.track_ref_id
  AND tc.is_default = TRUE
  AND s.track_config_ref_id IS NULL;

-- ── 7. Set car_ref_id on sessions ────────────────────────────────────────────
UPDATE sessions s
SET car_ref_id = c.id
FROM cars c
WHERE LOWER(TRIM(s.car_id)) = c.car_code
  AND s.car_ref_id IS NULL;

-- ── 8. Coverage report ───────────────────────────────────────────────────────
SELECT
  COUNT(*)                                              AS total_sessions,
  COUNT(*) FILTER (WHERE track_ref_id IS NOT NULL)     AS sessions_with_track_ref,
  COUNT(*) FILTER (WHERE car_ref_id IS NOT NULL)       AS sessions_with_car_ref,
  COUNT(*) FILTER (WHERE track_ref_id IS NULL)         AS sessions_missing_track,
  COUNT(*) FILTER (WHERE car_ref_id IS NULL)           AS sessions_missing_car
FROM sessions;
