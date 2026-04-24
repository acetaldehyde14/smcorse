-- =============================================================================
-- Migration 001: Base Dimension Tables
-- Purpose: Normalize tracks, track_configs, cars, and segments.
--          Also ensures required user columns exist.
-- Run order: after iracing-coach/database/schema.sql (users, sessions, laps
--            must already exist).
-- =============================================================================

-- ── Users: ensure all required columns exist ─────────────────────────────────
ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_url       TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_admin         BOOLEAN DEFAULT FALSE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS iracing_name     TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS iracing_id       TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS telegram_chat_id TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS discord_user_id  TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS discord_webhook  TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_active        BOOLEAN DEFAULT TRUE;

CREATE INDEX IF NOT EXISTS idx_users_iracing_name ON users(iracing_name);

COMMENT ON TABLE users IS
  'Core user identity. Dual auth: session (web) + JWT (desktop client). '
  'iracing_name used for driver-change matching from desktop client events.';

-- ── Tracks dimension ──────────────────────────────────────────────────────────
-- IMPORTANT: iracing-coach/database/schema.sql already creates a `tracks` table
-- with columns (track_id, track_name, ...). CREATE TABLE IF NOT EXISTS would
-- silently skip if that table exists, leaving the new dimension columns absent.
-- Strategy: create if absent, then ALTER to add any missing dimension columns.
-- This is safe to run on both fresh and existing databases.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'tracks'
  ) THEN
    CREATE TABLE tracks (
      id               SERIAL PRIMARY KEY,
      iracing_track_id INTEGER,
      track_code       VARCHAR(128) UNIQUE,  -- not NOT NULL yet; backfill populates it
      display_name     VARCHAR(255),
      country          VARCHAR(100),
      length_meters    DOUBLE PRECISION,
      created_at       TIMESTAMPTZ DEFAULT NOW(),
      updated_at       TIMESTAMPTZ DEFAULT NOW()
    );
  END IF;
END $$;

-- Add dimension columns to whichever tracks table exists (old or new).
-- The old table has track_id/track_name; the new design uses track_code/display_name.
-- Both coexist until backfill/001 reconciles them.
ALTER TABLE tracks ADD COLUMN IF NOT EXISTS iracing_track_id INTEGER;
ALTER TABLE tracks ADD COLUMN IF NOT EXISTS track_code       VARCHAR(128);
ALTER TABLE tracks ADD COLUMN IF NOT EXISTS display_name     VARCHAR(255);
ALTER TABLE tracks ADD COLUMN IF NOT EXISTS country          VARCHAR(100);
ALTER TABLE tracks ADD COLUMN IF NOT EXISTS length_meters    DOUBLE PRECISION;
ALTER TABLE tracks ADD COLUMN IF NOT EXISTS updated_at       TIMESTAMPTZ DEFAULT NOW();

-- Unique index on track_code (partial: only enforced once column is populated).
-- The old table already has a unique index on track_id; this adds one for track_code.
CREATE UNIQUE INDEX IF NOT EXISTS idx_tracks_code
  ON tracks(track_code)
  WHERE track_code IS NOT NULL;

COMMENT ON TABLE tracks IS
  'Track dimension. Grain: one row per physical track venue. '
  'track_code matches the track_id slug stored in sessions.track_id. '
  'Old column track_id (from schema.sql) kept for backward compat.';

-- ── Track Configs dimension ───────────────────────────────────────────────────
-- Grain: one row per track layout variant (e.g. Spa Full vs Spa Alternate).
CREATE TABLE IF NOT EXISTS track_configs (
  id                 SERIAL PRIMARY KEY,
  track_id           INTEGER NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
  config_code        VARCHAR(128) NOT NULL,
  display_name       VARCHAR(255) NOT NULL,
  configuration_name VARCHAR(255),
  length_meters      DOUBLE PRECISION,
  is_default         BOOLEAN DEFAULT FALSE,
  created_at         TIMESTAMPTZ DEFAULT NOW(),
  updated_at         TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(track_id, config_code)
);

COMMENT ON TABLE track_configs IS
  'Track layout/config dimension. Grain: one row per (track, layout variant). '
  'Used as FK from sessions.track_config_ref_id and segments.track_config_id.';

CREATE INDEX IF NOT EXISTS idx_track_configs_track ON track_configs(track_id);

-- ── Cars dimension ────────────────────────────────────────────────────────────
-- Grain: one row per car model.
-- No pre-existing cars table in any schema file — safe to CREATE.
CREATE TABLE IF NOT EXISTS cars (
  id               SERIAL PRIMARY KEY,
  iracing_car_id   INTEGER,
  car_code         VARCHAR(128) UNIQUE NOT NULL,
  display_name     VARCHAR(255) NOT NULL,
  car_class        VARCHAR(100),
  manufacturer     VARCHAR(100),
  created_at       TIMESTAMPTZ DEFAULT NOW(),
  updated_at       TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON TABLE cars IS
  'Car dimension. Grain: one row per car model. '
  'car_code matches the car_id slug stored in sessions.car_id.';

CREATE INDEX IF NOT EXISTS idx_cars_code ON cars(car_code);

-- ── Segments dimension ────────────────────────────────────────────────────────
-- Grain: one row per (track_config, segment_number).
-- Normalizes corner_segments (which used free-text track_id/track_config).
-- corner_segments physical table is preserved (has lap_segment_features FK).
-- corner_segments compat view defined in 007_compatibility_views.sql.
CREATE TABLE IF NOT EXISTS segments (
  id                BIGSERIAL PRIMARY KEY,
  track_config_id   INTEGER REFERENCES track_configs(id) ON DELETE CASCADE,
  -- Nullable text fallback used before full normalization
  track_code        VARCHAR(128),
  track_config_code VARCHAR(128),
  segment_number    INTEGER NOT NULL,
  segment_code      VARCHAR(128),
  display_name      VARCHAR(128),
  start_dist_pct    DOUBLE PRECISION NOT NULL
                      CHECK (start_dist_pct >= 0 AND start_dist_pct <= 1),
  apex_dist_pct     DOUBLE PRECISION,
  end_dist_pct      DOUBLE PRECISION NOT NULL
                      CHECK (end_dist_pct >= 0 AND end_dist_pct <= 1),
  segment_type      VARCHAR(32) DEFAULT 'corner'
                      CHECK (segment_type IN ('corner','straight','chicane','braking_zone','other')),
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  updated_at        TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON TABLE segments IS
  'Normalized track segment dimension. Grain: one row per track_config x segment_number. '
  'Replaces corner_segments for new code. '
  'Backward compat: corner_segments_normalized view defined in 007_compatibility_views.sql.';

-- Unique per config when config FK is resolved
CREATE UNIQUE INDEX IF NOT EXISTS idx_segments_config_num
  ON segments(track_config_id, segment_number)
  WHERE track_config_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_segments_track_code
  ON segments(track_code, track_config_code);

-- ── Add normalized FK columns to sessions ─────────────────────────────────────
-- Keeps existing text columns (track_id, car_id) for backward compat.
-- These FKs are populated by backfill/001_populate_tracks_cars_from_sessions.sql.
ALTER TABLE sessions
  ADD COLUMN IF NOT EXISTS track_ref_id        INTEGER REFERENCES tracks(id),
  ADD COLUMN IF NOT EXISTS track_config_ref_id INTEGER REFERENCES track_configs(id),
  ADD COLUMN IF NOT EXISTS car_ref_id          INTEGER REFERENCES cars(id);

COMMENT ON COLUMN sessions.track_ref_id IS
  'FK to tracks dimension. Nullable — populated by backfill/001 script.';
COMMENT ON COLUMN sessions.track_config_ref_id IS
  'FK to track_configs dimension. Nullable — populated by backfill/001 script.';
COMMENT ON COLUMN sessions.car_ref_id IS
  'FK to cars dimension. Nullable — populated by backfill/001 script.';
