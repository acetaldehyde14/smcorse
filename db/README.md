# Database — Canonical Migration Chain

## Overview

All schema definitions for the SM CORSE platform live in **`migrations/`** at the
repository root. This `db/` directory exists only as an entry point for
orientation — it does not duplicate any SQL.

## Canonical migration chain

| File | Purpose |
|---|---|
| `migrations/001_base_dimensions.sql` | Dimension tables: `tracks`, `track_configs`, `cars`, `segments`; extends `users` |
| `migrations/002_operational_tables.sql` | Operational tables: `races`, `stint_roster`, `iracing_events`, `race_state`, `race_events`, `teams`, `team_members`, `race_laps`, `stint_planner_sessions` |
| `migrations/003_raw_ingest_tables.sql` | Raw ingest buffer: `live_telemetry` (14-day retention) |
| `migrations/004_telemetry_fact_tables.sql` | Canonical telemetry fact: `telemetry_frames`; legacy tables: `corner_segments`, `lap_features`, `lap_segment_features` |
| `migrations/005_derived_fact_tables.sql` | Warehouse facts: `fact_lap`, `fact_lap_segment`, `fact_stint` |
| `migrations/006_serving_marts.sql` | Read views and functions: `mart_live_race_state`, `mart_lap_comparison()`, `mart_driver_consistency`, `mart_corner_time_loss`; dimension views `dim_*` |
| `migrations/007_compatibility_views.sql` | Backward-compat views: `live_telemetry_raw`, `fact_iracing_event`, `corner_segments_normalized`, `lap_features_v`, `lap_segment_features_v` |
| `migrations/008_retention_and_maintenance.sql` | `cleanup_live_telemetry()` function, `run_maintenance()` procedure |
| `migrations/009_coaching_tables.sql` | Coaching system: `coaching_reference_laps`, `coaching_reference_points`, `coaching_zones`, `coaching_zone_observations`, `coaching_feedback_events`, `coaching_voice_assets`, `coaching_voice_manifests` |

Backfill scripts (run once after 001-009 on existing databases):

| File | Purpose |
|---|---|
| `migrations/backfill/001_populate_tracks_cars_from_sessions.sql` | Populate `tracks`/`cars` dimension from existing sessions |
| `migrations/backfill/002_migrate_corner_segments_to_segments.sql` | Copy `corner_segments` rows into normalized `segments` table |
| `migrations/backfill/003_migrate_lap_features_to_fact_lap.sql` | Copy `lap_features` rows into `fact_lap` |
| `migrations/backfill/004_migrate_lap_segment_features_to_fact_lap_segment.sql` | Copy `lap_segment_features` rows into `fact_lap_segment` |

## How to apply migrations

### New installation (clean database)

```bash
# 1. Create the database
psql -U postgres -c "CREATE DATABASE iracing_coach;"

# 2. Apply base schema (users, sessions, laps, reference_laps, coaching_sessions,
#    tracks, user_preferences, user_progress)
psql -U postgres -d iracing_coach -f iracing-coach/database/schema.sql

# 3. Apply all numbered migrations (001–009)
npm run db:migrate

# 4. Optional: seed dimension tables from existing data
#    (skip on a truly fresh database — no data to backfill)
# npm run db:migrate:backfill
```

### Existing installation (upgrading)

```bash
# Just apply any unapplied migrations — the runner is idempotent
npm run db:migrate
```

The runner (`scripts/run-migrations.js`) tracks applied migrations in the
`migrations_log` table. Already-applied migrations are skipped automatically.

### Dry run (see what would be applied without executing)

```bash
npm run db:migrate:dry
```

## Three-layer architecture

```
Layer 1 — OLTP / Operational
  users, sessions, laps, races, stint_roster, iracing_events, race_state,
  race_events, race_laps, teams, team_members, stint_planner_sessions

Layer 2 — Raw Ingest Buffer
  live_telemetry           (14-day rolling retention; race telemetry only)
  telemetry_frames         (canonical long-term store — use this for analytics)

Layer 3 — Analytics / Warehouse
  fact_lap, fact_lap_segment, fact_stint
  Mart views: mart_live_race_state, mart_lap_comparison(),
              mart_driver_consistency, mart_corner_time_loss
  Dimension views: dim_user, dim_track, dim_track_config, dim_car,
                   dim_session, dim_lap, dim_segment
```

**Rule**: always read from `telemetry_frames` for replay, coaching, and AI
analysis. Never query `live_telemetry` for analytics.

## Known gaps (see SCHEMA_COMPATIBILITY.md for details)

The tables `telemetry_sessions`, `telemetry_laps`, and `telemetry_batches`
are used by the live-session endpoints in `src/routes/telemetry.js` but are
**not** created by migrations 001-009. They exist only in the legacy
`scripts/migrate.sql` file. If those endpoints are active in your environment,
run `scripts/migrate.sql` manually or apply a future migration 010 that
formalizes them.

The tables `reference_laps` and `coaching_sessions` are defined in
`iracing-coach/database/schema.sql` and used by `src/routes/analysis.js` and
`src/routes/library.js`. They are NOT in migrations 001-009. Ensure
`iracing-coach/database/schema.sql` is applied before running the migrations.
