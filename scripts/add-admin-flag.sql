-- =============================================================================
-- DEPRECATED: scripts/add-admin-flag.sql
-- =============================================================================
-- This file is superseded by migrations/001_base_dimensions.sql which adds
-- the is_admin column via: ALTER TABLE users ADD COLUMN IF NOT EXISTS is_admin
-- Do not use for new installs. Kept for git history only.
-- =============================================================================

-- Migration: Add is_admin flag to users table
-- Run once in psql: \i 'C:/Users/maxim/Documents/smcorse/scripts/add-admin-flag.sql'

ALTER TABLE users ADD COLUMN IF NOT EXISTS is_admin BOOLEAN NOT NULL DEFAULT false;

-- To make a user admin, run:
-- UPDATE users SET is_admin = true WHERE email = 'your@email.com';
