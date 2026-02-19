# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Website and interactive tool for the **SM CORSE iRacing endurance racing team**. Built as a Node.js application with a blue/white professional design aesthetic. Implements authentication, telemetry upload/parsing, AI-powered coaching and assistant, team management, lap library, session tracking, and **live endurance race tracking** with driver stint management and Telegram/Discord notifications. Also supports **Le Mans Ultimate (LMU)** alongside iRacing.

**Tech Stack:** Single-file Express server with PostgreSQL database. Dual authentication: session-based for web UI, JWT Bearer tokens for desktop client. Server listens on `0.0.0.0` for LAN access.

## Development Commands

```bash
npm start          # Start production server
npm run dev        # Start with nodemon (auto-reload on file changes)
npm run migrate    # Migrate users from SQLite to PostgreSQL (one-time)
```

The server runs on port 3000 by default (configurable via PORT environment variable). Accessible on local network at `http://<LAN_IP>:3000`.

**Database Setup:**
```bash
setup-database.bat  # Create PostgreSQL database and run schema
```

**Nginx:**
```bash
cd C:\nginx
nginx -s reload     # Reload configuration
nginx -s stop       # Stop server
start nginx         # Start server
```

## Architecture

### Merged Codebase Structure
The server combines three systems into one:
1. **Original auth system** - Session-based authentication with simple HTML pages
2. **iRacing Coach backend** - Telemetry upload, analysis, AI coaching, AI assistant routes
3. **Enduro race tracking** - Live race monitoring, stint roster, driver change/fuel notifications

All backend logic is in `server.js`. Additional modules in `src/`:
- `src/config/` - Database and Llama client configuration
- `src/routes/` - Telemetry, analysis, library, assistant, races, iracing, and team API routes
- `src/services/` - Telemetry parsing (IBT + BLAP formats), lap comparison, AI coaching logic, notifications (Telegram + Discord)
- `src/middleware/` - File upload handling and dual auth (session + JWT)

### Authentication Flow
- **Dual auth**: session-based for web users, JWT Bearer tokens for desktop client
- Passwords hashed with bcryptjs (10 salt rounds)
- Sessions stored in memory (not persistent across restarts)
- `requireAuth` middleware protects server.js page routes (session-only, redirects to `/`)
- `authenticateToken` middleware (src/middleware/auth.js) protects API routes - tries session first, falls back to JWT Bearer token. Sets `req.user = { id, username }`
- `POST /api/auth/login` — username+password login returns JWT token (90-day expiry) for desktop client
- `POST /api/auth/validate` — desktop client verifies stored token on startup
- All telemetry/assistant/race routes use the unified `authenticateToken` middleware

### Database - PostgreSQL
- **PostgreSQL** (not SQLite anymore) via `pg` connection pool
- Main tables:
  - `users` - Authentication and user profiles
  - `sessions` - Practice sessions by track/car
  - `laps` - Individual lap data with telemetry file paths
  - `reference_laps` - Coach/community reference laps
  - `coaching_sessions` - AI coaching history
  - `tracks`, `user_progress`, `user_preferences` - Supporting data
- Uses parameterized queries ($1, $2) for SQL injection safety
- Helper functions: `query()` for simple queries, `transaction()` for multi-step operations

### Frontend
Static files in `public/`:
- `index.html` - Landing page with signup/login forms and partners section
- `dashboard.html` - Protected dashboard with feature cards linking to all tools
- `sessions.html` - Telemetry session list with upload functionality
- `session-details.html` - Individual session view with lap times table
- `coaching.html` - AI coaching interface for lap comparison
- `assistant.html` - AI Race Engineer chat interface (iRacing + LMU)
- `library.html` - Reference lap library and leaderboards
- `team.html` - Team roster management and stint rotation planning
- `race.html` - Live race tracker: race management, stint roster, real-time status, event log, notification settings
- `public/logos/` - Partner logos (Swift Display, SimTeam, RaceData, RaceData.AI)
- `public/iracing-enduro-client/` - Python desktop client for polling iRacing telemetry

All HTML files contain inline CSS and JavaScript. No build process needed.

**Design Theme:** Blue/white professional (#0066cc primary, #00aaff accent, #0a0f1c dark). Montserrat (headings) + Rajdhani (body) fonts.

## API Routes

### Authentication Routes (in server.js)
- `POST /api/signup` - Create account (auto-login after signup)
- `POST /api/login` - Authenticate user
- `POST /api/logout` - Destroy session
- `GET /api/user` - Get current user info (requires auth)
- `GET /` - Landing page (redirects to dashboard if logged in)
- `GET /dashboard` - Protected dashboard (requires auth)

### Telemetry Routes (from src/routes/telemetry.js)
All require authentication via session middleware.
- `POST /api/telemetry/upload` - Upload .ibt, .blap, or .olap file (auto-parses track/car/laps)
- `GET /api/telemetry/sessions` - Get user's practice sessions with lap counts and best laps
- `GET /api/telemetry/sessions/:id` - Get session details with all laps
- `GET /api/telemetry/laps/:id/telemetry` - Get detailed lap telemetry data

### Analysis Routes (from src/routes/analysis.js)
- `POST /api/analysis/compare` - Compare two laps, get AI coaching
- `POST /api/analysis/chat` - Chat with AI coach about performance
- `GET /api/analysis/history` - Get coaching history

### Library Routes (from src/routes/library.js)
- `GET /api/library/reference-laps` - Browse reference laps by track/car
- `GET /api/library/leaderboard` - Track/car leaderboards

### Assistant Routes (from src/routes/assistant.js)
- `POST /api/assistant/chat` - Chat with AI Race Engineer (iRacing + LMU expert)
- `GET /api/assistant/search` - Web search via DuckDuckGo (no API key needed)
- `GET /api/assistant/health` - Check Llama server availability

### Race Routes (from src/routes/races.js)
- `GET /api/races` - List all races
- `POST /api/races` - Create a new race
- `GET /api/races/active` - Get currently active race
- `POST /api/races/:id/start` - Start race (deactivates others, inits race state)
- `POST /api/races/:id/end` - End a race
- `GET /api/races/:id/roster` - Get stint roster with driver info
- `POST /api/races/:id/roster` - Replace full stint roster (transaction)
- `GET /api/races/:id/events` - Get recent telemetry events

### iRacing Routes (from src/routes/iracing.js)
- `POST /api/iracing/event` - Receive driver_change/fuel_update from desktop clients
- `GET /api/iracing/status` - Current race status (active driver, fuel level)

### Team Routes - Extended (from src/routes/team.js)
- `GET /api/team/members` - List team members
- `POST/PUT/DELETE /api/team/members` - CRUD team members
- `GET /api/team/profile` - User's notification settings
- `PATCH /api/team/profile` - Update iracing_name, discord_webhook
- `POST /api/team/register-telegram` - Link Telegram chat ID
- `POST /api/team/register-discord` - Link Discord user ID
- `GET /api/team/drivers` - Active users list (for stint roster dropdowns)

## Telemetry Parser (src/services/parser.js)

### IBT Format (iRacing Binary Telemetry)
Full session recordings with multiple laps and telemetry channels.
- **Header** (0x00-0x34): Version, tick rate, offsets to session info and variable headers
- **Session Info** (at SessionInfoOffset): YAML text with track, car, driver info
- **Variable Headers** (at VarHeaderOffset): 144 bytes each, describe telemetry channels (Speed, Throttle, Brake, Steering, RPM, Gear, LapDist, Lap, LapLastLapTime, etc.)
- **Data Records** (at DataOffset): Fixed-size records at TickRate Hz

Extracts: track name, car name, session type, individual lap times, best lap, downsampled telemetry (1 Hz).

### BLAP/OLAP Format (Best Lap / Optimal Lap)
Single-lap recordings with "BLAP" magic header.
- **0x00**: Magic "BLAP" (4 bytes)
- **0x04**: Version (int32, typically 3)
- **0x0C**: iRacing Customer ID (int32)
- **0x10**: Driver name (124 bytes, null-terminated)
- **0x8C**: Car ID (int32)
- **0x90**: Car path (64 bytes, e.g. "porsche992rgt3")
- **~0x53E**: Track path fragment (e.g. "spa\up")
- **~0x5B4**: Lap time (float, seconds)

Track and car paths are mapped to display names via `matchTrackPath()` and `mapCarPath()` methods. Track detection scans first 4KB of buffer for known track path strings.

## Security Patterns

- Password validation: minimum 8 characters
- Email format validation with regex
- Duplicate email check before signup
- Generic error messages for invalid credentials (prevents user enumeration)
- Session cookie maxAge: 24 hours
- `secure: false` cookie flag (set to true when using HTTPS)

## Environment Variables

Required in `.env`:
- `SESSION_SECRET` - Session encryption key
- `PORT` - Server port (defaults to 3000)
- `NODE_ENV` - Environment (development/production)

**PostgreSQL:**
- `DB_HOST` - Database host (localhost)
- `DB_PORT` - Database port (5432)
- `DB_NAME` - Database name (iracing_coach)
- `DB_USER` - Database user (postgres)
- `DB_PASSWORD` - Database password (REQUIRED)

**Remote AI Server:**
- `OLLAMA_HOST` - Remote Llama server URL (http://23.141.136.111:11434)
- `OLLAMA_MODEL` - Model name (llama3.3:70b-instruct-q4_K_M)

**JWT (Desktop Client):**
- `JWT_SECRET` - Secret for signing JWT tokens (REQUIRED for desktop client auth)

**Notification Bots (optional):**
- `TELEGRAM_BOT_TOKEN` - Telegram bot API key
- `DISCORD_BOT_TOKEN` - Discord bot API key
- `DISCORD_TEAM_WEBHOOK` - Discord team channel webhook URL
- `DISCORD_CLIENT_ID` - Discord application ID

**File Uploads:**
- `MAX_FILE_SIZE` - Max upload size in bytes (default: 52428800 = 50MB)
- `ALLOWED_ORIGINS` - CORS origins (optional)

## Database Operations

PostgreSQL via connection pool (asynchronous):
- `pool.query(sql, params)` - Direct pool query
- `query(sql, params)` - Helper with logging (from src/config/database.js)
- `transaction(callback)` - Multi-step transaction helper
- All queries use parameterized syntax: `$1`, `$2`, etc.

**Schema Management:**
- Schema defined in `iracing-coach/database/schema.sql`
- Run once during setup (not auto-applied on startup)
- No automatic migrations system yet

**User Migration:**
- `scripts/migrate-users.js` - One-time migration from SQLite users.db to PostgreSQL
- Preserves passwords (already bcrypt hashed)
- Run with: `npm run migrate`

## Current State vs. Planned Features

**Currently Implemented:**
- User authentication system (signup/login/logout) with dual auth (session + JWT)
- Session management with LAN access (0.0.0.0)
- Dashboard with feature card navigation
- Telemetry upload and parsing (.ibt, .blap, .olap)
- Session list and session detail views with lap times
- AI Race Engineer assistant (chat interface, iRacing + LMU knowledge)
- AI coaching interface (lap comparison)
- Team management page (roster, rotation planning)
- Lap library and leaderboard pages
- Partners section on landing page (Swift Display, SimTeam, RaceData, RaceData.AI)
- Live endurance race tracking (race CRUD, stint roster, real-time status)
- Desktop client event ingestion (driver changes, fuel updates)
- Telegram + Discord notification bots (driver change alerts, low fuel warnings)
- Notification settings UI (iRacing name, Telegram, Discord webhook)

**Planned Features:**
- Race calendar and event planning
- Fuel and tire strategy calculators
- Team communication and announcements
- Race results and statistics tracking
- Practice session coordination
- Telemetry visualization charts

When implementing new features, maintain the existing design theme (blue/white color scheme with #0066cc primary, Montserrat/Rajdhani fonts).

## iRacing Context

This is for **endurance racing** - multi-hour races (6h, 12h, 24h) requiring multiple drivers per car. Key concepts:
- **Stint:** A single driver's continuous driving period (typically 1-2 hours)
- **Driver swap:** Mandatory pit stop where drivers change
- **Fuel strategy:** Calculating fuel loads and refuel requirements
- **Tire strategy:** Managing tire wear and pit stop timing
- **Fixed setup vs. Open setup:** iRacing race formats

## AI Integration

### AI Coaching (src/services/coaching.js + src/routes/analysis.js)
Uses remote Llama server for lap comparison coaching.

### AI Assistant (src/routes/assistant.js)
General-purpose race engineer chat with iRacing + LMU expertise. Includes DuckDuckGo web search for current information.

**Remote Llama Server:**
- Server: http://23.141.136.111:11434
- Model: Llama 3.3 70B Instruct (quantized Q4_K_M)
- Client code: `src/config/llama.js`

**LlamaClient methods:**
- `isAvailable()` - Check if remote server is accessible
- `generate(prompt, options)` - Generate text from prompt
- `chat(messages, options)` - Chat conversation format
- `generateCoaching(lapAnalysis, referenceData, userContext)` - Specialized coaching prompt

Responses can take 10-30 seconds for complex analysis.

## File Uploads

Telemetry files stored in `uploads/` directory:
- `uploads/ibt/` - iRacing .ibt files (binary telemetry)
- `uploads/blap/` - Best lap files
- `uploads/olap/` - Optimal lap files

File upload limits:
- Max size: 50MB (configurable via MAX_FILE_SIZE env var)
- Nginx client_max_body_size: 50M
- Extended timeouts on /api/telemetry and /api/analysis endpoints (5 minutes)

## Nginx Configuration

Location: `C:/nginx/conf/nginx.conf`

Key settings:
- Proxies all requests to Node.js on localhost:3000
- 50MB upload limit for telemetry files
- Extended timeouts (300s) for AI endpoints
- Rate limiting on auth endpoints
- Gzip compression enabled

Reload after changes:
```bash
cd C:\nginx
nginx -s reload
```

## Utility Scripts

- `scripts/migrate-users.js` - One-time SQLite to PostgreSQL migration
- `scripts/cleanup-sessions.js` - Remove sessions with bad track names
- `scripts/fix-sessions.js` - Re-parse and fix existing session metadata
- `scripts/analyze-ibt.js` - Debug tool to inspect IBT file structure
- `scripts/analyze-blap.js` / `analyze-blap2.js` - Debug tools to inspect BLAP file structure
- `scripts/test-blap-parser.js` - Test BLAP parser against uploaded files

## Deployment

See INSTALLATION.md for complete setup instructions.
See DEPLOYMENT.md for production deployment (PM2, SSL, etc.)
