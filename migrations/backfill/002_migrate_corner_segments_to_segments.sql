-- =============================================================================
-- Backfill 002: Migrate corner_segments → segments
-- Purpose: Copy existing corner_segments rows into the normalized segments
--          table, resolving track_id text to track_config_id FK where possible.
--          Sets segment FK references on fact_lap_segment rows.
--
-- Run ONCE after backfill/001. Safe to re-run (checks for existing rows).
-- =============================================================================

-- ── 1. Insert from corner_segments into segments ──────────────────────────────
-- For rows where track_id matches a known tracks.track_code, link to track_config.
-- For unresolved rows, store text fields only (track_config_id = NULL).
INSERT INTO segments (
  track_config_id,
  track_code,
  track_config_code,
  segment_number,
  segment_code,
  display_name,
  start_dist_pct,
  apex_dist_pct,
  end_dist_pct,
  segment_type,
  created_at
)
SELECT
  tc.id               AS track_config_id,
  cs.track_id         AS track_code,
  COALESCE(cs.track_config, 'default') AS track_config_code,
  cs.segment_number,
  'seg_' || cs.segment_number AS segment_code,
  COALESCE(cs.name, 'Segment ' || cs.segment_number) AS display_name,
  cs.start_dist_pct::DOUBLE PRECISION,
  cs.apex_dist_pct::DOUBLE PRECISION,
  cs.end_dist_pct::DOUBLE PRECISION,
  COALESCE(cs.kind, 'corner') AS segment_type,
  cs.created_at
FROM corner_segments cs
LEFT JOIN tracks t ON t.track_code = LOWER(TRIM(cs.track_id))
LEFT JOIN track_configs tc
  ON tc.track_id = t.id
  AND tc.config_code = COALESCE(LOWER(TRIM(cs.track_config)), 'default')
WHERE NOT EXISTS (
  -- Avoid duplicates: skip if a segments row already exists for this corner_segment's data
  SELECT 1 FROM segments s2
  WHERE s2.track_code = cs.track_id
    AND s2.segment_number = cs.segment_number
    AND (s2.track_config_code = COALESCE(cs.track_config, 'default') OR s2.track_config_code IS NULL)
);

-- ── 2. Set segment_id FK on fact_lap_segment (from corner_segment_id) ─────────
-- Map fact_lap_segment.corner_segment_id → fact_lap_segment.segment_id
UPDATE fact_lap_segment fls
SET segment_id = seg.id
FROM corner_segments cs
JOIN segments seg
  ON seg.track_code = cs.track_id
  AND seg.segment_number = cs.segment_number
  AND (
    seg.track_config_code = COALESCE(cs.track_config, 'default')
    OR seg.track_config_code IS NULL
  )
WHERE fls.corner_segment_id = cs.id
  AND fls.segment_id IS NULL;

-- ── 3. Same linkage for legacy lap_segment_features.segment_id ───────────────
-- lap_segment_features.segment_id is actually corner_segments.id (legacy naming)
-- No schema change needed; fact_lap_segment backfill in 004 handles it.

-- ── 4. Report ─────────────────────────────────────────────────────────────────
SELECT
  (SELECT COUNT(*) FROM corner_segments)              AS corner_segments_total,
  (SELECT COUNT(*) FROM segments)                     AS segments_total,
  (SELECT COUNT(*) FROM segments WHERE track_config_id IS NOT NULL) AS segments_with_config_fk,
  (SELECT COUNT(*) FROM segments WHERE track_config_id IS NULL)     AS segments_text_only,
  (SELECT COUNT(*) FROM fact_lap_segment WHERE segment_id IS NOT NULL) AS fls_with_segment_fk;
