-- =============================================================================
-- DEPRECATED: iracing-coach/database/schema.sql
-- =============================================================================
-- This file is superseded by the canonical migration chain in migrations/001-009.
-- Do NOT use this file to make schema changes or add new tables.
--
-- However, this file IS still required as a prerequisite for new installations:
-- it creates the base tables (users, sessions, laps, reference_laps,
-- coaching_sessions, tracks, user_preferences, user_progress) that migrations
-- 001-009 assume already exist.
--
-- Correct new-install order:
--   1. psql -U postgres -c "CREATE DATABASE iracing_coach;"
--   2. psql -U postgres -d iracing_coach -f iracing-coach/database/schema.sql
--   3. npm run db:migrate
--
-- Tables NOT covered by migrations 001-009 (defined here only):
--   reference_laps, coaching_sessions, user_preferences, user_progress
--   (reference_laps and coaching_sessions are runtime-critical)
-- =============================================================================

-- iRacing Coach Database Schema

-- Users table
CREATE TABLE users (
    id SERIAL PRIMARY KEY,
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    username VARCHAR(100) NOT NULL,
    iracing_id VARCHAR(50),
    iracing_rating INTEGER,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    last_login TIMESTAMP
);

CREATE INDEX idx_users_email ON users(email);

-- Sessions table
CREATE TABLE sessions (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    track_id VARCHAR(100) NOT NULL,
    track_name VARCHAR(255) NOT NULL,
    car_id VARCHAR(100) NOT NULL,
    car_name VARCHAR(255) NOT NULL,
    session_type VARCHAR(50), -- 'practice', 'qualifying', 'race'
    weather_conditions JSONB,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_sessions_user ON sessions(user_id);
CREATE INDEX idx_sessions_track ON sessions(track_id);

-- Laps table
CREATE TABLE laps (
    id SERIAL PRIMARY KEY,
    session_id INTEGER REFERENCES sessions(id) ON DELETE CASCADE,
    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    
    -- Lap info
    lap_number INTEGER,
    lap_time FLOAT NOT NULL,
    is_valid BOOLEAN DEFAULT true,
    
    -- Sector times
    sector1_time FLOAT,
    sector2_time FLOAT,
    sector3_time FLOAT,
    
    -- File paths
    ibt_file_path VARCHAR(500),
    blap_file_path VARCHAR(500),
    olap_file_path VARCHAR(500),
    
    -- Telemetry summary (for quick access)
    telemetry_summary JSONB, -- {avg_speed, max_speed, corners: [{...}]}
    
    -- Analysis results (cached)
    analysis_cache JSONB,
    
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_laps_session ON laps(session_id);
CREATE INDEX idx_laps_user ON laps(user_id);
CREATE INDEX idx_laps_time ON laps(lap_time);

-- Reference Laps table (coach laps, community best laps)
CREATE TABLE reference_laps (
    id SERIAL PRIMARY KEY,
    track_id VARCHAR(100) NOT NULL,
    track_name VARCHAR(255) NOT NULL,
    car_id VARCHAR(100) NOT NULL,
    car_name VARCHAR(255) NOT NULL,
    
    -- Lap info
    lap_time FLOAT NOT NULL,
    sector1_time FLOAT,
    sector2_time FLOAT,
    sector3_time FLOAT,
    
    -- File paths
    ibt_file_path VARCHAR(500),
    blap_file_path VARCHAR(500),
    olap_file_path VARCHAR(500),
    
    -- Reference info
    driver_name VARCHAR(255),
    driver_rating INTEGER,
    reference_type VARCHAR(50), -- 'coach', 'alien', 'community_best', 'optimal'
    is_public BOOLEAN DEFAULT true,
    
    -- Telemetry data
    telemetry_data JSONB,
    
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    created_by INTEGER REFERENCES users(id)
);

CREATE INDEX idx_reference_track_car ON reference_laps(track_id, car_id);
CREATE INDEX idx_reference_type ON reference_laps(reference_type);
CREATE INDEX idx_reference_public ON reference_laps(is_public);

-- Coaching Sessions table (AI coaching history)
CREATE TABLE coaching_sessions (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    lap_id INTEGER REFERENCES laps(id) ON DELETE CASCADE,
    reference_lap_id INTEGER REFERENCES reference_laps(id),
    
    -- Analysis results
    time_delta FLOAT,
    corner_analysis JSONB,
    input_comparison JSONB,
    
    -- AI coaching
    coaching_text TEXT,
    coaching_summary JSONB, -- {priorities: [], drills: [], focus_areas: []}
    
    -- User feedback
    user_rating INTEGER, -- 1-5 stars
    user_feedback TEXT,
    
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_coaching_user ON coaching_sessions(user_id);
CREATE INDEX idx_coaching_lap ON coaching_sessions(lap_id);

-- Track Library table
CREATE TABLE tracks (
    id SERIAL PRIMARY KEY,
    track_id VARCHAR(100) UNIQUE NOT NULL,
    track_name VARCHAR(255) NOT NULL,
    layout_name VARCHAR(255),
    length_km FLOAT,
    num_corners INTEGER,
    track_data JSONB, -- {corners: [{name, type, entry_speed, ...}], sections: [...]}
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_tracks_id ON tracks(track_id);

-- User Preferences table
CREATE TABLE user_preferences (
    user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    preferred_units VARCHAR(10) DEFAULT 'metric', -- 'metric' or 'imperial'
    coaching_style VARCHAR(50) DEFAULT 'balanced', -- 'technical', 'motivational', 'balanced'
    notification_settings JSONB,
    ui_preferences JSONB,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- User Progress Tracking
CREATE TABLE user_progress (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    track_id VARCHAR(100) NOT NULL,
    car_id VARCHAR(100) NOT NULL,
    
    -- Best times
    best_lap_time FLOAT,
    best_sector1 FLOAT,
    best_sector2 FLOAT,
    best_sector3 FLOAT,
    
    -- Progress metrics
    total_laps INTEGER DEFAULT 0,
    improvement_rate FLOAT, -- seconds per session
    consistency_score FLOAT, -- 0-100
    
    -- Weak areas
    weak_corners JSONB, -- [corner_id, corner_id, ...]
    
    last_session_date TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    UNIQUE(user_id, track_id, car_id)
);

CREATE INDEX idx_progress_user ON user_progress(user_id);

-- Create views for common queries
CREATE VIEW user_session_summary AS
SELECT 
    u.id as user_id,
    u.username,
    s.track_name,
    s.car_name,
    COUNT(l.id) as total_laps,
    MIN(l.lap_time) as best_lap,
    AVG(l.lap_time) as avg_lap,
    s.created_at as session_date
FROM users u
JOIN sessions s ON u.id = s.user_id
JOIN laps l ON s.id = l.session_id
WHERE l.is_valid = true
GROUP BY u.id, u.username, s.id, s.track_name, s.car_name, s.created_at;

CREATE VIEW track_leaderboard AS
SELECT 
    rl.track_name,
    rl.car_name,
    rl.driver_name,
    rl.lap_time,
    rl.reference_type,
    rl.driver_rating,
    rl.created_at
FROM reference_laps rl
WHERE rl.is_public = true
ORDER BY rl.track_id, rl.car_id, rl.lap_time ASC;
