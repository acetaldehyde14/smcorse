# Database Setup Guide

## Prerequisites

- PostgreSQL 14+ (tested on PostgreSQL 16)
- `psql` on your PATH, or the full path to `psql.exe`
- Node.js 18+ and `npm install` already run in the repo root

SQLite is **not used**. All data lives in PostgreSQL.

---

## Canonical setup (new install)

Run these commands in order. Each step must succeed before the next.

### Step 1 — Create the database

```bash
psql -U postgres -c "CREATE DATABASE iracing_coach;"
```

On Windows with a non-default install path:

```cmd
set PGPASSWORD=your_password
"C:\Program Files\PostgreSQL\16\bin\psql.exe" -U postgres -c "CREATE DATABASE iracing_coach;"
```

### Step 2 — Apply the base schema

The base schema creates the foundational tables that migrations 001-009
assume already exist: `users`, `sessions`, `laps`, `reference_laps`,
`coaching_sessions`, `tracks`, `user_preferences`, `user_progress`.

```bash
psql -U postgres -d iracing_coach -f iracing-coach/database/schema.sql
```

### Step 3 — Apply all numbered migrations

```bash
npm run db:migrate
```

This runs `scripts/run-migrations.js`, which applies migrations
`migrations/001_base_dimensions.sql` through `migrations/010_live_session_pipeline.sql`
in order, including the live-session pipeline tables (`telemetry_sessions`,
`telemetry_laps`, `telemetry_batches`). Applied migrations are tracked in the
`migrations_log` table and skipped on subsequent runs (idempotent).

### Step 4 — Optional: backfill dimension tables from existing data

Only needed if you have existing sessions/laps data predating the dimension
tables. Skip this on a fresh install with no data.

```bash
npm run db:migrate:backfill
```

---

## Upgrading an existing installation

Just run the migration runner — it will skip already-applied migrations
and only apply new ones:

```bash
npm run db:migrate
```

### Dry run (see what would apply without executing)

```bash
npm run db:migrate:dry
```

---

## Migrate users from old SQLite database

If you have a `users.db` SQLite file from a previous installation, run the
one-time migration script (requires `better-sqlite3` in devDependencies):

```bash
npm run migrate
```

This reads all users from `users.db` and inserts them into PostgreSQL.
SQLite is not used at runtime — this is only a migration utility.

---

## Configure .env

Create or update `.env` in the project root:

```env
# PostgreSQL
DB_HOST=localhost
DB_PORT=5432
DB_NAME=iracing_coach
DB_USER=postgres
DB_PASSWORD=your_actual_postgres_password

# Session + JWT
SESSION_SECRET=<random 64-char string>
JWT_SECRET=<random 64-char string>
```

---

## Verify the setup

```bash
# Start the server
npm start

# Health check
curl http://localhost:3000/api/assistant/health
```

Or in psql, check which tables exist:

```sql
SELECT table_name
FROM information_schema.tables
WHERE table_schema = 'public'
ORDER BY table_name;
```

You should see approximately 40+ tables and views including:
`users`, `sessions`, `laps`, `telemetry_frames`, `fact_lap`, `races`,
`coaching_reference_laps`, `mart_live_race_state`, `lap_features_v`, etc.

---

## Troubleshooting

### "Password authentication failed"
Make sure `DB_PASSWORD` in `.env` matches your PostgreSQL postgres user password.

### "Database already exists"
That is fine. Skip step 1 and continue from step 2.

### "relation X does not exist"
Check `SCHEMA_COMPATIBILITY.md` for which migration defines that table.
Make sure `npm run db:migrate` completed without errors and all 10 migrations
show `OK` or `SKIP`.

### "psql: error: connection to server failed"
The PostgreSQL service is not running. On Windows: open `services.msc`, find
`postgresql-x64-16`, and start it.

---

## File reference

| File | Role |
|---|---|
| `iracing-coach/database/schema.sql` | Base schema — required prerequisite for migrations |
| `migrations/001-010_*.sql` | Canonical schema additions, analytics layer, live-session pipeline |
| `scripts/migrate.sql` | **Deprecated** — fully superseded by migrations 001-010 |
| `scripts/run-migrations.js` | Migration runner (`npm run db:migrate`) |
| `scripts/migrate-users.js` | One-time SQLite to PostgreSQL user migration |
| `ARCHITECTURE_DB.md` | Full table catalog grouped by domain |
| `SCHEMA_COMPATIBILITY.md` | Audit of legacy SQL files and known schema gaps |

---

## Deprecated setup methods

The following files and methods are **deprecated** and must not be used for
new installs or schema changes:

| File | Superseded by |
|---|---|
| `setup-database.sql` | Migrations 002-004 |
| `scripts/migrate-enduro.sql` | Migration 002 |
| `iracing-enduro-server/db/migrate.sql` | Migrations 001-002 |
| `src/db/migrate-telemetry.sql` | Migrations 002, 004 |
| `scripts/add-admin-flag.sql` | Migration 001 |
| `setup-database.bat`, `setup-database.ps1` | This guide |

Each deprecated file has a comment header explaining which migration supersedes it.
