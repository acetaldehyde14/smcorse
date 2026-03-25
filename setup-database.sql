-- Alternative setup script if batch file doesn't work
-- Open pgAdmin or psql and run these commands manually

-- 1. Create database
CREATE DATABASE iracing_coach;

-- 2. Connect to it: \c iracing_coach

-- 3. Then copy and paste the schema from iracing-coach\database\schema.sql
-- Or run: \i 'C:/Users/maxim/Documents/smcorse/iracing-coach/database/schema.sql'

-- ── Stint Planner Sessions (run this after initial schema setup) ──
CREATE TABLE IF NOT EXISTS stint_planner_sessions (
  id           SERIAL PRIMARY KEY,
  name         VARCHAR(255)  NOT NULL DEFAULT 'Untitled Race',
  created_by   INTEGER       REFERENCES users(id) ON DELETE SET NULL,
  config       JSONB         NOT NULL DEFAULT '{}',
  availability JSONB         NOT NULL DEFAULT '{}',
  plan         JSONB         NOT NULL DEFAULT '[]',
  created_at   TIMESTAMP     NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMP     NOT NULL DEFAULT NOW()
);
