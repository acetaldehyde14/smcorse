# Repository Guidelines

## Project Structure & Module Organization
`server.js` is the Express entry point for the API on port `3000`. Backend code lives in `src/`: `routes/` for HTTP endpoints, `services/` for telemetry, coaching, notifications, and parsing logic, `middleware/` for auth and uploads, and `config/` for database and model clients. The Next.js app lives in `frontend/` with App Router pages under `frontend/app/`, shared UI in `frontend/components/`, and client helpers in `frontend/lib/` and `frontend/store/`. Static and legacy HTML assets live in `public/`. SQL migrations are in `migrations/`, supporting scripts in `scripts/`, and architecture notes in `docs/`.

## Build, Test, and Development Commands
Install dependencies with `npm install` and `cd frontend && npm install`. Run the backend with `npm run dev` and the frontend with `cd frontend && npm run dev`. Build the frontend with `cd frontend && npm run build`, and start production-style servers with `npm start` and `cd frontend && npm run start`. Apply database changes with `npm run db:migrate`; preview pending SQL with `npm run db:migrate:dry`; run backfills with `npm run db:migrate:backfill`.

## Coding Style & Naming Conventions
Follow the existing style: 2-space indentation in JavaScript and TypeScript, semicolons enabled, and CommonJS on the backend. Use `camelCase` for variables and functions, `PascalCase` for React components, and lowercase numbered filenames for migrations such as `010_live_session_pipeline.sql`. Keep route handlers thin and move telemetry or coaching logic into `src/services/`. Run `cd frontend && npm run lint` before submitting frontend changes.

## Testing Guidelines
There is no single automated test suite configured yet. Use targeted validation: `cd frontend && npm run lint` for the Next.js app, `npm run db:migrate:dry` for migration safety, and the existing script probes in `scripts/` such as `node scripts/test-parser.js` when touching telemetry parsing. Name any new test scripts after the feature they verify, for example `scripts/test-coaching-zones.js`.

## Commit & Pull Request Guidelines
Recent history uses short Conventional Commit-style subjects like `feat: add live telemetry pipeline`. Keep commits focused and imperative; prefer prefixes such as `feat:`, `fix:`, and `docs:`. Pull requests should describe the user-visible change, list database or env updates, link related issues, and include screenshots for UI work in `frontend/` or `public/`.

## Security & Configuration Tips
Secrets belong in `.env`; use `.env.example` as the template and never commit real credentials. Review changes touching auth, uploads, or telemetry ingestion carefully, especially files under `src/middleware/`, `src/routes/auth.js`, and `src/routes/iracing.js`.
