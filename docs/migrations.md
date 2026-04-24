# Database Migrations

## Bootstrap: Fresh Database Setup

### 1. Create the database

```bash
psql -U postgres -c "CREATE DATABASE iracing_coach;"
```

Or use pgAdmin / the existing `setup-database.bat`.

### 2. Run the base coaching schema

```bash
psql -U postgres -d iracing_coach -f iracing-coach/database/schema.sql
```

### 3. Run legacy enduro migrations (if not already applied)

```bash
psql -U postgres -d iracing_coach -f scripts/migrate-enduro.sql
```

### 4. Run the canonical migration chain

```bash
npm run db:migrate
```

This runs all files in `migrations/001_*.sql` through `migrations/008_*.sql` in order, tracking each in the `migrations_log` table so re-runs are safe.

### 5. (Existing databases only) Run backfill scripts

```bash
npm run db:migrate:backfill
```

This populates dimension tables from existing session data and migrates legacy feature tables to the new fact tables. Safe to re-run.

### Complete fresh-start command sequence

```bash
psql -U postgres -c "CREATE DATABASE iracing_coach;"
psql -U postgres -d iracing_coach -f iracing-coach/database/schema.sql
psql -U postgres -d iracing_coach -f scripts/migrate-enduro.sql
npm run db:migrate
```

## Migration Files Reference

| File | Purpose | Key tables created/modified |
|---|---|---|
| `001_base_dimensions.sql` | Normalize dimensions | `tracks`, `track_configs`, `cars`, `segments`; adds FK columns to `sessions`; adds `avatar_url`/`is_admin` to `users` |
| `002_operational_tables.sql` | Fix missing operational tables | `teams`, `team_members`, `race_laps`, `race_events`, `stint_planner_sessions`; extends `race_state` |
| `003_raw_ingest_tables.sql` | Formalise raw ingest layer | `live_telemetry` column additions; adds `session_id` FK |
| `004_telemetry_fact_tables.sql` | Canonical telemetry fact | `telemetry_frames` column additions (`x_pos`, `y_pos`, `fuel_level`, etc.); all analytics indexes |
| `005_derived_fact_tables.sql` | Warehouse fact tables | `fact_lap`, `fact_lap_segment`, `fact_stint` |
| `006_serving_marts.sql` | App read optimisation | `dim_*` views, `mart_live_race_state`, `mart_driver_consistency`, `mart_corner_time_loss`, `mart_lap_comparison()` function |
| `007_compatibility_views.sql` | Backward compat aliases | `live_telemetry_raw`, `fact_iracing_event`, `corner_segments_normalized`, `lap_features_v`, `lap_segment_features_v` |
| `008_retention_and_maintenance.sql` | Cleanup and maintenance | `cleanup_live_telemetry()`, `run_maintenance()` |

## Backfill Scripts Reference

| File | Purpose | When to run |
|---|---|---|
| `backfill/001_populate_tracks_cars_from_sessions.sql` | Seed `tracks`, `track_configs`, `cars` from `sessions.track_id` text values | After 001–008 on existing DB |
| `backfill/002_migrate_corner_segments_to_segments.sql` | Copy `corner_segments` rows into normalized `segments` | After backfill/001 |
| `backfill/003_migrate_lap_features_to_fact_lap.sql` | Copy `lap_features` rows into `fact_lap` | After 001–008 |
| `backfill/004_migrate_lap_segment_features_to_fact_lap_segment.sql` | Copy `lap_segment_features` rows into `fact_lap_segment` | After backfill/002 and 003 |

## Migration Runner

`scripts/run-migrations.js` is a simple Node.js runner that:

- Reads all `.sql` files from `migrations/` in alphabetical order
- Tracks applied migrations in the `migrations_log` table
- Skips already-applied migrations on re-runs
- Wraps each migration in a transaction (rolls back on error)

### Commands

```bash
npm run db:migrate            # Apply all pending migrations
npm run db:migrate:dry        # Preview what would run (no changes)
npm run db:migrate:backfill   # Apply migrations + backfill scripts
```

### Manual psql execution (alternative)

```bash
psql -U postgres -d iracing_coach -f migrations/001_base_dimensions.sql
psql -U postgres -d iracing_coach -f migrations/002_operational_tables.sql
# ... and so on
```

## Checking Migration Status

```sql
SELECT filename, applied_at, duration_ms
FROM migrations_log
ORDER BY applied_at;
```

## Adding a New Migration

1. Create `migrations/009_your_description.sql`
2. Use `IF NOT EXISTS` / `ADD COLUMN IF NOT EXISTS` for idempotency
3. Run `npm run db:migrate`
4. Commit the file to git

## Rolling Back

Migrations are additive-only (no `DROP TABLE` in numbered files). To undo:

1. Connect to the database manually
2. Drop/alter the specific objects created
3. Delete the row from `migrations_log` for that file
4. Fix the migration file
5. Re-run `npm run db:migrate`

## Deprecation: Old Schema Files

The following files predate the migration chain and should NOT be used for new changes:

- `setup-database.sql` — superseded; now has deprecation notice
- `scripts/migrate-enduro.sql` — still needed for fresh setup step 3 (creates base enduro tables)
- `src/db/migrate-telemetry.sql` — superseded by migrations 003–005
- `scripts/add-admin-flag.sql` — superseded by migration 001
