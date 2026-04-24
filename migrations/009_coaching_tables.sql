-- =============================================================================
-- Migration 009: Coaching Tables
-- Purpose: Create all tables needed for the real-time AI coaching system:
--          reference laps, resampled telemetry points, detected zones,
--          per-lap observations, feedback events, voice assets and manifests.
-- =============================================================================

-- ── coaching_reference_laps ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS coaching_reference_laps (
  id              SERIAL PRIMARY KEY,
  user_id         INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  session_id      INT REFERENCES sessions(id) ON DELETE SET NULL,
  lap_id          INT REFERENCES laps(id) ON DELETE SET NULL,
  track_id        TEXT NOT NULL,
  track_name      TEXT,
  track_config    TEXT,
  car_id          TEXT NOT NULL,
  car_name        TEXT,
  setup_hash      TEXT,
  weather_bucket  TEXT,
  source_type     TEXT NOT NULL DEFAULT 'uploaded'
                  CHECK (source_type IN ('uploaded', 'live')),
  title           TEXT,
  notes           TEXT,
  is_active       BOOLEAN NOT NULL DEFAULT FALSE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_coaching_ref_laps_user
  ON coaching_reference_laps(user_id);
CREATE INDEX IF NOT EXISTS idx_coaching_ref_laps_track_car
  ON coaching_reference_laps(track_id, car_id);
CREATE INDEX IF NOT EXISTS idx_coaching_ref_laps_active
  ON coaching_reference_laps(user_id, track_id, car_id)
  WHERE is_active = TRUE;

-- ── coaching_reference_points ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS coaching_reference_points (
  id                  BIGSERIAL PRIMARY KEY,
  reference_lap_id    INT NOT NULL
                      REFERENCES coaching_reference_laps(id) ON DELETE CASCADE,
  point_index         INT NOT NULL,
  lap_dist_pct        DOUBLE PRECISION NOT NULL,
  session_time_s      DOUBLE PRECISION,
  speed_kph           DOUBLE PRECISION,
  throttle_pct        DOUBLE PRECISION,
  brake_pct           DOUBLE PRECISION,
  gear                DOUBLE PRECISION,
  rpm                 DOUBLE PRECISION,
  lat_accel           DOUBLE PRECISION,
  long_accel          DOUBLE PRECISION,
  yaw_rate            DOUBLE PRECISION,
  curvature           DOUBLE PRECISION,
  segment_type        TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(reference_lap_id, point_index)
);

CREATE INDEX IF NOT EXISTS idx_coaching_ref_points_ref_lap
  ON coaching_reference_points(reference_lap_id, lap_dist_pct);

-- ── coaching_zones ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS coaching_zones (
  id                          SERIAL PRIMARY KEY,
  reference_lap_id            INT NOT NULL
                              REFERENCES coaching_reference_laps(id) ON DELETE CASCADE,
  zone_id                     TEXT NOT NULL,
  sequence_index              INT NOT NULL,
  name                        TEXT NOT NULL,
  segment_type                TEXT NOT NULL,
  lap_dist_start              DOUBLE PRECISION,
  lap_dist_callout            DOUBLE PRECISION,
  lap_dist_end                DOUBLE PRECISION,
  target_entry_speed_kph      DOUBLE PRECISION,
  target_min_speed_kph        DOUBLE PRECISION,
  target_exit_speed_kph       DOUBLE PRECISION,
  target_brake_initial_pct    DOUBLE PRECISION,
  target_brake_peak_pct       DOUBLE PRECISION,
  target_brake_release_pct    DOUBLE PRECISION,
  target_throttle_min_pct     DOUBLE PRECISION,
  target_throttle_reapply_pct DOUBLE PRECISION,
  target_gear                 INT,
  target_duration_s           DOUBLE PRECISION,
  priority                    INT NOT NULL DEFAULT 0,
  generic_display_text        TEXT,
  generic_voice_key           TEXT,
  correction_template_json    JSONB,
  metadata_json               JSONB,
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- zone_id is unique within a reference lap
CREATE UNIQUE INDEX IF NOT EXISTS idx_coaching_zones_ref_zone
  ON coaching_zones(reference_lap_id, zone_id);
CREATE INDEX IF NOT EXISTS idx_coaching_zones_ref_seq
  ON coaching_zones(reference_lap_id, sequence_index);

-- ── coaching_zone_observations ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS coaching_zone_observations (
  id                              BIGSERIAL PRIMARY KEY,
  session_id                      INT NOT NULL,
  lap_id                          INT,
  lap_number                      INT NOT NULL,
  zone_id                         TEXT NOT NULL,
  reference_lap_id                INT
                                  REFERENCES coaching_reference_laps(id) ON DELETE SET NULL,
  observed_brake_start_lap_dist   DOUBLE PRECISION,
  observed_brake_peak_pct         DOUBLE PRECISION,
  observed_brake_release_lap_dist DOUBLE PRECISION,
  observed_throttle_off_lap_dist  DOUBLE PRECISION,
  observed_throttle_reapply_lap_dist DOUBLE PRECISION,
  observed_entry_speed_kph        DOUBLE PRECISION,
  observed_min_speed_kph          DOUBLE PRECISION,
  observed_exit_speed_kph         DOUBLE PRECISION,
  observed_min_gear               INT,
  observed_duration_s             DOUBLE PRECISION,
  delta_brake_start_m             DOUBLE PRECISION,
  delta_peak_brake_pct            DOUBLE PRECISION,
  delta_throttle_reapply_s        DOUBLE PRECISION,
  delta_min_speed_kph             DOUBLE PRECISION,
  delta_entry_speed_kph           DOUBLE PRECISION,
  recommendation_key              TEXT,
  recommendation_payload          JSONB,
  created_at                      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_coaching_zone_obs_session_lap
  ON coaching_zone_observations(session_id, lap_number);
CREATE INDEX IF NOT EXISTS idx_coaching_zone_obs_zone
  ON coaching_zone_observations(zone_id);
CREATE INDEX IF NOT EXISTS idx_coaching_zone_obs_ref
  ON coaching_zone_observations(reference_lap_id);

-- ── coaching_feedback_events ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS coaching_feedback_events (
  id           BIGSERIAL PRIMARY KEY,
  session_id   INT NOT NULL,
  lap_number   INT NOT NULL,
  zone_id      TEXT,
  cue_key      TEXT NOT NULL,
  cue_text     TEXT,
  cue_mode     TEXT NOT NULL DEFAULT 'display'
               CHECK (cue_mode IN ('display', 'voice', 'summary')),
  payload_json JSONB,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_coaching_feedback_session_lap
  ON coaching_feedback_events(session_id, lap_number);

-- ── coaching_voice_assets ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS coaching_voice_assets (
  id              SERIAL PRIMARY KEY,
  cue_key         TEXT UNIQUE NOT NULL,
  text            TEXT,
  language_code   TEXT NOT NULL DEFAULT 'en-US',
  voice_name      TEXT,
  style_name      TEXT,
  provider        TEXT NOT NULL DEFAULT 'nvidia_magpie',
  relative_path   TEXT,
  mime_type       TEXT NOT NULL DEFAULT 'audio/wav',
  duration_ms     INT,
  sample_rate_hz  INT,
  metadata_json   JSONB,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_coaching_voice_assets_cue_key
  ON coaching_voice_assets(cue_key);

-- ── coaching_voice_manifests ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS coaching_voice_manifests (
  id               SERIAL PRIMARY KEY,
  manifest_version INT,
  language_code    TEXT,
  voice_name       TEXT,
  manifest_json    JSONB,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_coaching_voice_manifests_lang_voice
  ON coaching_voice_manifests(language_code, voice_name);
