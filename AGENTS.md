# Repository Guidelines

## Project Overview
SM CORSE is an iRacing endurance racing team platform with telemetry upload/parsing, AI coaching, AI race engineer chat, team management, lap libraries, session tracking, live endurance race tracking, stint planning, and Telegram/Discord notifications. The backend is a Node.js/Express API with PostgreSQL. The frontend is a Next.js 14 App Router app, with some static and legacy assets still served from `public/`.

The system supports iRacing and Le Mans Ultimate context. Endurance racing concepts matter here: stints, driver swaps, fuel strategy, tire strategy, fixed/open setups, and multi-driver race operations.

If anything needs to be known about the frontend app, use https://github.com/acetaldehyde14/endurotool as the reference.

## Project Structure & Module Organization
`server.js` is the Express entry point for the API on port `3000` and listens on `0.0.0.0` for LAN access. Backend code lives in `src/`: `routes/` for HTTP endpoints, `services/` for telemetry, coaching, notifications, TTS, and parsing logic, `middleware/` for auth and uploads, and `config/` for database and model clients.

The Next.js app lives in `frontend/` and runs on port `3001`. App Router pages are under `frontend/app/`, shared UI in `frontend/components/`, and client helpers in `frontend/lib/` and `frontend/store/`. Static and legacy HTML assets live in `public/`, including logos, avatars, coaching voice assets, and the `public/iracing-enduro-client/` desktop client.

SQL migrations are in `migrations/`, backfills are in `migrations/backfill/`, supporting scripts are in `scripts/`, and architecture notes are in `docs/`.

## Build, Test, and Development Commands
Install dependencies with `npm install` and `cd frontend && npm install`.

Run the backend with:
```bash
npm run dev
```

Run the frontend with:
```bash
cd frontend && npm run dev
```

Build and start production-style servers with:
```bash
cd frontend && npm run build
npm start
cd frontend && npm run start
```

Apply database changes with:
```bash
npm run db:migrate
npm run db:migrate:dry
npm run db:migrate:backfill
```

`npm run migrate` runs the one-time SQLite-to-PostgreSQL user migration via `scripts/migrate-users.js`.

## Database Architecture
PostgreSQL is the canonical database. Use parameterized queries with `$1`, `$2`, etc. Prefer the helpers in `src/config/database.js`: `query()` for simple queries and `transaction()` for multi-step operations.

The database has three major layers:

- Operational tables: `users`, `sessions`, `laps`, `races`, `race_state`, `teams`, `team_members`, stint planning, auth, and notification state.
- Raw ingest buffer: `live_telemetry`, retained for short-lived live race data.
- Analytics/warehouse tables: `telemetry_frames`, `fact_lap`, `fact_lap_segment`, dimension tables, marts, and compatibility views.

`telemetry_frames` is the canonical source for replay, coaching, AI analysis, and historical telemetry reads. Do not use `live_telemetry` for analytics. `live_telemetry` is only the short-retention raw ingest buffer for live race telemetry.

See `docs/database-architecture.md`, `docs/telemetry-pipeline.md`, and `docs/migrations.md` before changing schema, telemetry persistence, or analytics read paths.

## Authentication & API Patterns
The app uses dual authentication:

- Session-based auth for web UI flows.
- JWT Bearer tokens for the desktop client.

`requireAuth` in `server.js` protects session-only page routes. `authenticateToken` in `src/middleware/auth.js` protects API routes by checking session auth first and then JWT Bearer auth. It sets `req.user = { id, username }`.

Keep route handlers thin. Put business logic for telemetry, coaching, notifications, parsing, and AI workflows in `src/services/`. Review changes touching `src/middleware/`, `src/routes/auth.js`, `src/routes/iracing.js`, uploads, and telemetry ingestion carefully.

## Telemetry & Coaching
Telemetry uploads support iRacing `.ibt`, `.blap`, and `.olap` files. Parser logic lives in `src/services/parser.js`; route ingestion and live-session writes are mainly in `src/routes/telemetry.js` and `src/routes/iracing.js`.

IBT files contain session-wide binary telemetry with session YAML, variable headers, and data records. BLAP/OLAP files are single-lap best/optimal lap recordings with compact binary metadata. Prefer extending existing parser helpers instead of adding ad hoc binary parsing in routes.

AI coaching and assistant code use NVIDIA NIM through `src/config/llama.js` and related route/service modules. Current model selection supports registry keys such as `glm-5.1` and `minimax-m2`; preserve the existing caller interfaces when changing model behavior.

Voice pack assets are generated ahead of time into `public/coaching-voice/`; do not assume they are generated at runtime.

## Frontend Guidelines
Follow the existing Next.js/Tailwind structure in `frontend/`. Keep UI changes consistent with the SM CORSE professional racing tool aesthetic: blue/white base, restrained operational layouts, clear telemetry and race-management workflows, and practical density over marketing-style pages.

Legacy files in `public/` may still be used by older flows. Do not remove or replace them unless the calling routes and links have been checked.

Run `cd frontend && npm run lint` before submitting frontend changes.

## Coding Style & Naming Conventions
Use 2-space indentation in JavaScript and TypeScript, semicolons, and CommonJS on the backend. Use `camelCase` for variables and functions, `PascalCase` for React components, and lowercase numbered migration filenames such as `010_live_session_pipeline.sql`.

Prefer existing services, helpers, and local patterns over new abstractions. Keep database operations parameterized. Keep generated assets, uploads, and secrets out of commits.

## Testing Guidelines
There is no single automated test suite configured yet. Use targeted validation:

- `cd frontend && npm run lint` for the Next.js app.
- `npm run db:migrate:dry` for migration safety.
- Parser probes such as `node scripts/test-parser.js` when touching telemetry parsing.
- Focused route or service probes when touching coaching, voice packs, notifications, or live telemetry.

Name any new test scripts after the feature they verify, for example `scripts/test-coaching-zones.js`.

## Commit & Pull Request Guidelines
Recent history uses short Conventional Commit-style subjects like `feat: add live telemetry pipeline`. Keep commits focused and imperative; prefer prefixes such as `feat:`, `fix:`, and `docs:`.

Pull requests should describe the user-visible change, list database or environment updates, link related issues, and include screenshots for UI work in `frontend/` or `public/`.

## Security & Configuration Tips
Secrets belong in `.env`; use `.env.example` as the template and never commit real credentials. Required/important variables include `SESSION_SECRET`, `JWT_SECRET`, PostgreSQL settings, `NVIDIA_API_KEY`, `NVIDIA_MODEL`, notification bot tokens, `MAX_FILE_SIZE`, and `ALLOWED_ORIGINS`.

Passwords are hashed with bcryptjs. Auth errors should avoid user enumeration. Upload limits and long-running AI/telemetry endpoints may also need matching proxy timeout and body-size settings.
