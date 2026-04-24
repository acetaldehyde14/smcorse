# Database Architecture

PostgreSQL database: `iracing_coach`. Schema managed by numbered migrations in
`migrations/` applied via `npm run db:migrate`.

---

## Three-layer architecture

```
┌─────────────────────────────────────────────────────────┐
│  Layer 1 — OLTP / Operational                           │
│  users  sessions  laps  races  stint_roster             │
│  iracing_events  race_state  race_laps  race_events     │
│  teams  team_members  stint_planner_sessions            │
│  reference_laps  coaching_sessions                      │
│  user_preferences  user_progress                        │
├─────────────────────────────────────────────────────────┤
│  Layer 2 — Raw Ingest Buffer                            │
│  live_telemetry     (14-day rolling window)             │
│  telemetry_frames   (long-term canonical store)         │
│  telemetry_sessions / telemetry_laps / telemetry_batches│
├─────────────────────────────────────────────────────────┤
│  Layer 3 — Analytics / Warehouse                        │
│  Dimensions: tracks  track_configs  cars  segments      │
│  Facts:      fact_lap  fact_lap_segment  fact_stint     │
│  Legacy:     lap_features  lap_segment_features         │
│              corner_segments                            │
│  Marts:      mart_live_race_state                       │
│              mart_lap_comparison() [function]           │
│              mart_driver_consistency                    │
│              mart_corner_time_loss                      │
│  Compat views: lap_features_v  lap_segment_features_v  │
│                live_telemetry_raw  fact_iracing_event   │
│                corner_segments_normalized               │
└─────────────────────────────────────────────────────────┘
```

**Canonical read rule**: use `telemetry_frames` for all replay, lap overlay,
delta time, coaching feature extraction, and AI analysis queries. Never use
`live_telemetry` for analytics.

---

## Domain 1 — Authentication and Users

### `users`
Source: `iracing-coach/database/schema.sql` (base) + migration 001 (extensions)

| Column | Type | Notes |
|---|---|---|
| `id` | SERIAL PK | |
| `email` | VARCHAR(255) UNIQUE NOT NULL | |
| `password_hash` | VARCHAR(255) NOT NULL | bcryptjs 10 rounds |
| `username` | VARCHAR(100) NOT NULL | |
| `iracing_id` | VARCHAR(50) / TEXT | |
| `iracing_rating` | INTEGER | schema.sql only; not used at runtime |
| `created_at` | TIMESTAMP / TIMESTAMPTZ | |
| `last_login` | TIMESTAMP | schema.sql only |
| `avatar_url` | TEXT | migration 001 |
| `is_admin` | BOOLEAN DEFAULT FALSE | migration 001 |
| `iracing_name` | TEXT | migration 001 (also in migrate-enduro) |
| `telegram_chat_id` | TEXT | migration 001 |
| `discord_user_id` | TEXT | migration 001 |
| `discord_webhook` | TEXT | migration 001 |
| `is_active` | BOOLEAN DEFAULT TRUE | migration 001 |

Key indexes: `idx_users_email`, `idx_users_iracing_name`

### `user_preferences`
Source: `iracing-coach/database/schema.sql` only (not in migrations 001-009)

Stores per-user UI preferences (units, coaching style, notifications). No
current route references this table.

### `user_progress`
Source: `iracing-coach/database/schema.sql` only (not in migrations 001-009)

Tracks best lap times and consistency scores per user/track/car. No current
route references this table.

---

## Domain 2 — Practice Sessions and Laps

### `sessions`
Source: `iracing-coach/database/schema.sql` (base) + migration 002 (extensions)
+ migration 001 adds FK columns

| Column | Type | Notes |
|---|---|---|
| `id` | SERIAL PK | |
| `user_id` | INTEGER FK → users | |
| `track_id` | VARCHAR(100/128) | raw text slug |
| `track_name` | VARCHAR(255/256) | |
| `car_id` | VARCHAR(100/128) | raw text slug |
| `car_name` | VARCHAR(255/256) | |
| `session_type` | VARCHAR(50/32) | 'practice', 'qualifying', 'race' |
| `weather_conditions` | JSONB | |
| `created_at` | TIMESTAMP / TIMESTAMPTZ | |
| `sim_session_uid` | VARCHAR(64) | migration 002 |
| `sub_session_id` | INTEGER | migration 002 |
| `iracing_driver_id` | INTEGER | migration 002 |
| `ingest_mode` | VARCHAR(16) DEFAULT 'file' | migration 002 |
| `status` | VARCHAR(16) DEFAULT 'open' | migration 002 |
| `ended_at` | TIMESTAMPTZ | migration 002 |
| `track_ref_id` | INTEGER FK → tracks | migration 001 (nullable) |
| `track_config_ref_id` | INTEGER FK → track_configs | migration 001 (nullable) |
| `car_ref_id` | INTEGER FK → cars | migration 001 (nullable) |

Key indexes: `idx_sessions_user`, `idx_sessions_track`, `idx_sessions_user_id`, `idx_sessions_status`

### `laps`
Source: `iracing-coach/database/schema.sql` (base) + migration 002 (extensions)

| Column | Type | Notes |
|---|---|---|
| `id` | SERIAL PK | |
| `session_id` | INTEGER FK → sessions | |
| `user_id` | INTEGER FK → users | |
| `lap_number` | INTEGER | |
| `lap_time` | FLOAT / NUMERIC(10,3) | |
| `is_valid` | BOOLEAN DEFAULT TRUE | |
| `sector1_time`, `sector2_time`, `sector3_time` | FLOAT | |
| `ibt_file_path` | VARCHAR(500) / TEXT | |
| `blap_file_path` | VARCHAR(500) / TEXT | |
| `olap_file_path` | VARCHAR(500) / TEXT | |
| `telemetry_summary` | JSONB | |
| `analysis_cache` | JSONB | schema.sql only |
| `created_at` | TIMESTAMP / TIMESTAMPTZ | migration 002 adds IF NOT EXISTS |

Key indexes: `idx_laps_session`, `idx_laps_user`, `idx_laps_time`, `idx_laps_session_id`

### `reference_laps`
Source: `iracing-coach/database/schema.sql` only (not in migrations 001-009)

Community/coach reference laps. Used by `src/routes/library.js` (browse, leaderboard)
and `src/routes/analysis.js` (coaching history). Required at runtime.

### `coaching_sessions`
Source: `iracing-coach/database/schema.sql` only (not in migrations 001-009)

AI coaching session history linking a user lap to a reference lap with
AI coaching text. Used by `src/routes/analysis.js`. Required at runtime.

---

## Domain 3 — Endurance Race Operations

### `races`
Source: migration 002 (`CREATE TABLE IF NOT EXISTS`)

| Column | Type | Notes |
|---|---|---|
| `id` | SERIAL PK | |
| `name` | TEXT NOT NULL | |
| `track` | TEXT | |
| `started_at` | TIMESTAMPTZ | |
| `ended_at` | TIMESTAMPTZ | |
| `is_active` | BOOLEAN DEFAULT FALSE | |
| `created_at` | TIMESTAMPTZ | |
| `active_stint_session_id` | INTEGER FK → stint_planner_sessions | migration 002 |

### `race_state`
Source: migration 002

One row per race (PK = race_id). Live mutable state written by desktop client events.

| Column | Type | Notes |
|---|---|---|
| `race_id` | INTEGER PK FK → races | |
| `current_driver_name` | TEXT | |
| `last_fuel_level` | DOUBLE PRECISION | |
| `low_fuel_notified` | BOOLEAN | |
| `last_event_at` | TIMESTAMPTZ | |
| `current_stint_index` | INTEGER | migration 002 extension |
| `stint_started_at` | TIMESTAMPTZ | migration 002 extension |
| `position`, `class_position` | INTEGER | migration 002 extension |
| `gap_to_leader`, `gap_ahead`, `gap_behind` | DOUBLE PRECISION | migration 002 extension |
| `laps_completed` | INTEGER | migration 002 extension |
| `last_lap_time`, `best_lap_time` | DOUBLE PRECISION | migration 002 extension |
| `nearby_cars` | JSONB | migration 002 extension |

### `stint_roster`
Source: migration 002

Driver stint schedule per race. One row per planned stint.

### `iracing_events`
Source: migration 002. Physical table; view alias `fact_iracing_event` in migration 007.

One row per desktop client event (driver_change, fuel_update).

### `race_events`
Source: migration 002

Race calendar entries (distinct from live `races`). One row per scheduled event.

### `race_laps`
Source: migration 002 (was missing from all prior schema files)

One row per lap completed during a live race. Written by `iracing.js` when
`last_lap_time` changes in position updates.

### `teams` and `team_members`
Source: migration 002 (were missing from all prior schema files)

Team entity and membership. Used by `src/routes/team.js`.

### `stint_planner_sessions`
Source: migration 002

Collaborative race planning sessions. One row per plan. Stores `config`,
`availability`, and `plan` as JSONB.

---

## Domain 4 — Live Telemetry Ingest (Layer 2)

### `live_telemetry`
Source: migration 003. Physical table; view alias `live_telemetry_raw` in migration 007.

**Raw ingest buffer** — 14-day retention (see `cleanup_live_telemetry()` in
migration 008). One row per ingest batch from the desktop client. NOT for
analytics reads — use `telemetry_frames` instead.

Key indexes: `idx_live_telem_race`, `idx_live_telem_session`, `idx_live_telem_received`

### `telemetry_frames`
Source: migration 004 (`CREATE TABLE IF NOT EXISTS` + column backfill via ALTER)

**Canonical telemetry fact.** One row per sample point. Read path for:
- Replay
- Lap overlay charts
- Delta time traces
- Corner/segment metrics
- AI coaching feature extraction

Do NOT use `live_telemetry` for any of the above.

| Key columns | Notes |
|---|---|
| `session_id`, `lap_id`, `user_id` | FKs |
| `ts` | TIMESTAMPTZ — wall clock |
| `session_time` | DOUBLE PRECISION — seconds since session start |
| `lap_dist_pct` | 0.0 – 1.0 |
| `speed_kph`, `throttle`, `brake`, `clutch`, `steering_deg`, `gear`, `rpm` | Motion channels |
| `lat_accel`, `long_accel`, `yaw_rate`, `steer_torque` | Dynamics |
| `x_pos`, `y_pos` | World position for track map (added in migration 004) |
| `lat`, `lon` | GPS coordinates |
| `fuel_level` | Added in migration 004 |
| `source` | 'live' or 'ibt' |

Primary indexes: `idx_tf_session_ts`, `idx_tf_lap_dist`, `idx_tf_session_lap_dist`, `idx_tf_user_ts`

### `telemetry_sessions`, `telemetry_laps`, `telemetry_batches`
Source: migration 010 (`010_live_session_pipeline.sql`)

Used by live-session API endpoints in `src/routes/telemetry.js`:
- `POST /api/telemetry/live/session/start`
- `POST /api/telemetry/live/session/end`
- `POST /api/telemetry/live/batch`
- `POST /api/telemetry/live/lap-complete`
- `GET  /api/telemetry/live/active`

---

## Domain 5 — Analytics / Warehouse (Layer 3)

### Dimension tables

| Table | Migration | Grain |
|---|---|---|
| `tracks` | 001 (extended) | One row per physical track venue |
| `track_configs` | 001 | One row per track layout variant |
| `cars` | 001 | One row per car model |
| `segments` | 001 | One row per (track_config, segment_number) |

### Legacy segment/feature tables (kept for FK integrity and backward compat)

| Table | Migration | Notes |
|---|---|---|
| `corner_segments` | 004 | Legacy free-text track segment definitions. `lap_segment_features` FKs here. New code uses `segments`. |
| `lap_features` | 004 | Legacy per-lap analytics. New writes go to `fact_lap`. Read via `lap_features_v`. |
| `lap_segment_features` | 004 | Legacy per-lap per-corner analytics. New writes go to `fact_lap_segment`. Read via `lap_segment_features_v`. |

### Warehouse fact tables

| Table | Migration | Grain |
|---|---|---|
| `fact_lap` | 005 | One row per lap — computed from `telemetry_frames` |
| `fact_lap_segment` | 005 | One row per (lap_id, segment_id) |
| `fact_stint` | 005 | One row per driver stint in a race |

### Serving marts (views and functions)

| Name | Migration | Type | Purpose |
|---|---|---|---|
| `mart_live_race_state` | 006 | VIEW | Live race dashboard — joins `race_state` + `races` |
| `mart_lap_comparison(ref, cmp, bucket)` | 006 | FUNCTION | Bucketed lap overlay — speed/throttle/brake at matching distance |
| `mart_driver_consistency` | 006 | VIEW | Per (user, session) consistency metrics |
| `mart_corner_time_loss` | 006 | VIEW | Per (lap, segment) time loss vs reference |

### Dimension views

| View | Migration | Source |
|---|---|---|
| `dim_user` | 006 | `users` |
| `dim_track` | 006 | `tracks` (coalesces new and legacy columns) |
| `dim_track_config` | 006 | `track_configs` |
| `dim_car` | 006 | `cars` |
| `dim_session` | 006 | `sessions` |
| `dim_lap` | 006 | `laps` |
| `dim_segment` | 006 | `segments` |

### Compatibility views

| View | Migration | Maps |
|---|---|---|
| `live_telemetry_raw` | 007 | `live_telemetry` physical table (read-only alias) |
| `fact_iracing_event` | 007 | `iracing_events` physical table |
| `corner_segments_normalized` | 007 | `segments` exposed with `corner_segments` column names |
| `lap_features_v` | 007 | UNION of `fact_lap` + `lap_features` (excludes dupes) |
| `lap_segment_features_v` | 007 | UNION of `fact_lap_segment` + `lap_segment_features` |

---

## Domain 6 — Deterministic Coaching System

All created by migration 009.

| Table | Grain | Notes |
|---|---|---|
| `coaching_reference_laps` | One per user/track/car active reference | `is_active` flag; one active per context |
| `coaching_reference_points` | 500 points per reference lap | Resampled telemetry for zone detection |
| `coaching_zones` | One per detected driving zone per reference lap | Contains targets and correction templates |
| `coaching_zone_observations` | One per (session, lap, zone) | Deltas vs reference, recommendation keys |
| `coaching_feedback_events` | One per cue playback | Tracks which cues were shown/spoken |
| `coaching_voice_assets` | One per cue key | WAV file registry (pre-synthesized) |
| `coaching_voice_manifests` | One per manifest version | Snapshot of cue catalog for desktop client |

---

## Maintenance functions

| Name | Migration | Usage |
|---|---|---|
| `cleanup_live_telemetry(days)` | 008 | `SELECT * FROM cleanup_live_telemetry(14);` — deletes raw telemetry older than N days |
| `run_maintenance()` | 008 | `CALL run_maintenance();` — ANALYZE on all main analytics tables |

---

## Key foreign key chains

```
users
  └── sessions (user_id)
        └── laps (session_id)
              ├── lap_features (lap_id PK)
              ├── fact_lap (lap_id PK)
              ├── lap_segment_features (lap_id)
              │     └── corner_segments (segment_id)
              ├── fact_lap_segment (lap_id)
              │     ├── segments (segment_id, nullable)
              │     └── corner_segments (corner_segment_id, nullable)
              └── telemetry_frames (lap_id, nullable)

races
  ├── race_state (race_id PK)
  ├── stint_roster (race_id)
  ├── iracing_events (race_id)
  ├── race_laps (race_id)
  ├── fact_stint (race_id)
  └── live_telemetry (race_id)

tracks
  └── track_configs (track_id)
        └── sessions (track_config_ref_id, nullable)
        └── segments (track_config_id, nullable)
        └── fact_lap (track_config_id, nullable)

coaching_reference_laps (user_id → users, lap_id → laps)
  ├── coaching_reference_points (reference_lap_id)
  ├── coaching_zones (reference_lap_id)
  └── coaching_zone_observations (reference_lap_id, nullable)
```
