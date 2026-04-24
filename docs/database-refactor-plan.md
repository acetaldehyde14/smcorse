# Database Refactor Plan

## Current Schema (pre-refactor)

The database evolved organically through five separate SQL files with no formal runner:

| File | Purpose |
|---|---|
| `iracing-coach/database/schema.sql` | Base coaching tables (users, sessions, laps, reference_laps, coaching_sessions, tracks, user_preferences, user_progress) |
| `scripts/migrate-enduro.sql` | Endurance racing tables (races, stint_roster, iracing_events, race_state) + ALTER TABLE users |
| `src/db/migrate-telemetry.sql` | Telemetry pipeline (extended sessions/laps, telemetry_frames, lap_features) |
| `setup-database.sql` | Supplementary tables (race_events, stint_planner_sessions, live_telemetry, corner_segments, lap_segment_features) |
| `scripts/add-admin-flag.sql` | users.is_admin column |

## Current Problems

### Missing table definitions (code used them, no CREATE TABLE existed)
- `teams` — referenced by `/api/team/members` and `/api/teams`
- `team_members` — same routes
- `race_laps` — referenced by `iracing.js` `handlePositionUpdate`

### Missing columns (code SET them, column not defined)
- `users.avatar_url` — set in team.js PATCH route
- `users.is_admin` — only in add-admin-flag.sql (not always run)

### Buggy telemetry insert
- `iracing.js` inserted `x_pos`, `y_pos` into `telemetry_frames`, but neither column existed in any schema file → silently failed or errored

### Schema-code mismatches
- `telemetry_frames.session_time` typed as `NUMERIC(10,4)` in one file, `NUMERIC(10,3)` in another
- `lap_features.brake_peak` typed as `NUMERIC(6,3)` in one file, `NUMERIC(6,4)` in another
- Mixed use of `TIMESTAMP` vs `TIMESTAMPTZ` across schema files

### Architecture confusion
- `live_telemetry` was used for both raw ingest AND analytics reads — no clear role separation
- No documented canonical source of truth for telemetry replay

### No migration runner
- No tool to apply files in order or track which had been applied
- Fresh setup required manually running 5+ SQL files in undocumented order

## Migration Strategy

Replace the fragmented multi-file setup with a canonical numbered migration chain in `migrations/`:

```
001_base_dimensions.sql       — tracks, track_configs, cars, segments (normalize dimensions)
002_operational_tables.sql    — missing tables: teams, team_members, race_laps; fix race_state cols
003_raw_ingest_tables.sql     — formalise live_telemetry as raw ingest buffer
004_telemetry_fact_tables.sql — telemetry_frames as canonical fact; add missing x_pos/y_pos
005_derived_fact_tables.sql   — fact_lap, fact_lap_segment, fact_stint
006_serving_marts.sql         — dim_* views, mart_* views, mart_lap_comparison function
007_compatibility_views.sql   — backward-compat aliases for old table names
008_retention_and_maintenance.sql — cleanup functions, maintenance procedures
```

Backfill scripts (run once on existing databases, after migrations):
```
backfill/001 — populate tracks/cars from sessions.track_id text
backfill/002 — migrate corner_segments → segments
backfill/003 — migrate lap_features → fact_lap
backfill/004 — migrate lap_segment_features → fact_lap_segment
```

## Compatibility Plan

| Old name / pattern | New name / pattern | Strategy |
|---|---|---|
| `live_telemetry` (raw JSON batches) | `live_telemetry` (same) | Keep physical table; add `session_id` FK; document role; `live_telemetry_raw` alias view added |
| `lap_features` | `fact_lap` | Keep `lap_features` physical; new writes go to `fact_lap`; `lap_features_v` view merges both |
| `lap_segment_features` | `fact_lap_segment` | Same strategy as lap_features |
| `corner_segments` | `segments` | Keep `corner_segments` physical (has FK); new code uses `segments`; `corner_segments_normalized` view provided |
| `race_state` | `race_state` (unchanged) | `mart_live_race_state` view added on top |
| `iracing_events` | `iracing_events` (unchanged) | `fact_iracing_event` view alias added |
| `sessions.track_id` (text) | `sessions.track_ref_id` (FK) | Both kept; FK populated by backfill/001 |

## Rollback Plan

All migrations use `IF NOT EXISTS` / `ADD COLUMN IF NOT EXISTS` / `ON CONFLICT DO NOTHING` — they are non-destructive additions. No existing table is dropped or renamed. Rollback = drop the newly created tables/views if needed.

## Timeline

1. Run `node scripts/run-migrations.js` on a test database
2. Run `node scripts/run-migrations.js --backfill` to populate dimension data
3. Verify with `SELECT * FROM mart_live_race_state` and `SELECT * FROM lap_features_v LIMIT 10`
4. Deploy to production
5. Update application code progressively to use new table names
