-- Migration: Add is_admin flag to users table
-- Run once in psql: \i 'C:/Users/maxim/Documents/smcorse/scripts/add-admin-flag.sql'

ALTER TABLE users ADD COLUMN IF NOT EXISTS is_admin BOOLEAN NOT NULL DEFAULT false;

-- To make a user admin, run:
-- UPDATE users SET is_admin = true WHERE email = 'your@email.com';
