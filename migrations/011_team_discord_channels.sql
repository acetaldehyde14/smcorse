-- =============================================================================
-- Migration 011: Team Discord Channels
-- Purpose: Route Discord team alerts to per-team channels instead of a global
--          team webhook.
-- =============================================================================

ALTER TABLE teams
  ADD COLUMN IF NOT EXISTS discord_channel_id TEXT,
  ADD COLUMN IF NOT EXISTS discord_role_id    TEXT;
