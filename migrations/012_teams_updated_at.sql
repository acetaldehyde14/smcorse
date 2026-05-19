-- =============================================================================
-- Migration 012: Teams updated_at Backfill
-- Purpose: Existing databases may have created teams before migration 002 added
--          updated_at to the CREATE TABLE definition.
-- =============================================================================

ALTER TABLE teams
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();
