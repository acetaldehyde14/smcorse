# SM CORSE — iRacing Endurance Team Platform

Web platform for the **SM CORSE** iRacing endurance racing team. Covers live race tracking, telemetry analysis, AI coaching, deterministic lap coaching with voice cues, stint planning, and team management. Supports both iRacing and Le Mans Ultimate (LMU).

---

## Architecture

| Layer | Tech | Port |
|---|---|---|
| API server | Node.js + Express | 3000 |
| Web frontend | Next.js 14 (App Router, TypeScript, Tailwind) | 3001 |
| Database | PostgreSQL | 5432 |
| Reverse proxy | Nginx | 80 |

Nginx routes `/api/*` to Express and everything else to Next.js. Both processes are managed by PM2.

```
smcorse/
├── server.js                  # Express API entry point
├── src/
│   ├── config/                # DB pool, NVIDIA AI client
│   ├── middleware/             # Auth (session + JWT), file upload
│   ├── routes/                # telemetry, analysis, library, assistant,
│   │                          #   races, iracing, team, coaching
│   └── services/
│       ├── coaching/           # Reference builder, zone detector, lap summary,
│       │                       #   observation analyzer, voice cue catalog,
│       │                       #   voice pack builder
│       ├── tts/                # NVIDIA Magpie TTS provider wrapper
│       └── (parser, notifications, …)
├── frontend/                  # Next.js app
│   ├── app/(protected)/       # Authenticated pages
│   ├── components/            # UI + telemetry trace components
│   ├── lib/                   # API client, auth context, types
│   └── store/                 # Zustand (telemetry cursor state)
├── public/
│   ├── assistant.html         # AI Race Engineer chat (legacy HTML)
│   ├── coaching-voice/        # Pre-synthesized WAV coaching cues
│   ├── lap-analysis.html      # Standalone JWT-auth lap analysis tool
│   └── iracing-enduro-client/ # Python desktop telemetry client
├── migrations/                # Numbered SQL migrations (001–009)
├── scripts/                   # DB utilities, voice pack builder
└── uploads/                   # Telemetry files (ibt, blap, olap)
```

---

## Features

### Live Race Tracking
- Driver stint management with planned vs actual durations
- Real-time telemetry ingestion from the Python desktop client
- Telegram and Discord notifications for driver changes and low fuel
- Live race status dashboard with event log

### Telemetry Analysis
- Upload `.ibt`, `.blap`, and `.olap` files — track/car/laps parsed automatically
- Full IBT binary parser: extracts lap times, per-lap frames at native sample rate
- Track map reconstruction from `yaw_rate` + speed integration with loop-closure correction
- Lap library with filterable table of all recorded laps

### Garage61-style Lap Analysis (`/lap-analysis.html`)
- **Single lap**: speed, throttle/brake, steering, RPM/gear traces with synchronized cursor
- **Lap comparison**: overlay any two laps (from different sessions) — Lap A in blue, Lap B in orange
- **Delta time trace**: running Δt (B − A) with green/red fill showing who is faster where
- **Track map**: colour-coded (green = full throttle, red = braking) built from yaw integration
- **Drag to zoom**: click and drag on any trace to zoom into that section; double-click to reset
- JWT auth — works independently of the Next.js session

### AI Coaching
- Compare two laps and get written coaching feedback via NVIDIA NIM (GLM 5.1 / MiniMax M2.7)
- AI Race Engineer chat (`/assistant.html`) with iRacing + LMU knowledge and DuckDuckGo web search
- Model selector — switch between available NVIDIA NIM models per conversation
- Lap feature extraction: smoothness score, consistency score, brake zones, lift count

### Deterministic Coaching System
Full per-lap coaching pipeline designed for desktop client integration. All decisions are rule-based — no LLM required for real-time coaching.

**Reference laps**: upload or select any fast lap as the coaching reference for a track/car combination. One active reference per context (user + track + car + config).

**Zone detection**: the reference lap is preprocessed into up to 40 driving zones using a deterministic state machine — brake, lift, apex, throttle pickup, exit. Each zone stores:
- entry/min/exit speed targets
- brake point, peak brake, release point
- throttle reapply point and gear
- generic display text and voice cue key
- correction templates for delta-driven feedback

**Observation ingestion**: the desktop app sends per-zone observations after each lap. The backend computes deltas vs the reference and selects recommendation keys (e.g. `brake_earlier`, `more_brake`, `pick_up_throttle_earlier`).

**Lap summaries**: structured JSON summaries ranking the biggest braking, throttle, and speed opportunities by zone.

**Voice cue catalog**: 100+ pre-defined cue keys with rendered text, covering reference guidance, corrective timing, brake pressure, speed/rotation, and sector-level summaries. Parameterized cues are expanded at build time (e.g. `correction_brake_about_5_meters_earlier_here`).

**Voice pack**: pre-synthesized WAV files via NVIDIA Magpie TTS, stored in `public/coaching-voice/`. Built ahead of time — not generated at runtime. The desktop app plays cues locally using the manifest.

### Team & Planning
- Team roster management
- Stint planner with driver availability grid, Gantt chart, and AI-generated plan
- Race calendar with countdown timers
- Notification settings (Telegram chat ID, Discord webhook)

### Desktop Client (`public/iracing-enduro-client/`)
Python app that polls iRacing memory-mapped data and streams telemetry to the API:
- Driver change detection and fuel level monitoring
- Sends compressed telemetry batches at ~15 Hz
- Reads `CarIdxX`/`CarIdxY` and `YawRate` for GPS-quality track maps when available

---

## Quick Start

### Prerequisites
- Node.js 18+
- PostgreSQL 14+
- Python 3.10+ (desktop client only)
- Nginx (production)

### 1. Install dependencies

```bash
npm install
cd frontend && npm install
```

### 2. Configure environment

Create `.env`:

```env
# Server
PORT=3000
NODE_ENV=development
SESSION_SECRET=<random 64-char string>
JWT_SECRET=<random 64-char string>

# PostgreSQL
DB_HOST=localhost
DB_PORT=5432
DB_NAME=iracing_coach
DB_USER=postgres
DB_PASSWORD=<your password>

# NVIDIA NIM (AI assistant + TTS)
NVIDIA_API_KEY=<your key>
NVIDIA_NIM_BASE_URL=https://integrate.api.nvidia.com

# Coaching system
COACHING_ENABLED=true
COACHING_VOICE_PROVIDER=nvidia_magpie
COACHING_VOICE_OUTPUT_DIR=public/coaching-voice
NVIDIA_TTS_LANGUAGE=en-US
NVIDIA_TTS_VOICE=Magpie-Multilingual.EN-US.Aria
NVIDIA_TTS_SAMPLE_RATE_HZ=22050

# Notifications (optional)
TELEGRAM_BOT_TOKEN=
DISCORD_BOT_TOKEN=
DISCORD_TEAM_WEBHOOK=
DISCORD_CLIENT_ID=
```

### 3. Create database and run migrations

```bash
psql -U postgres -c "CREATE DATABASE iracing_coach;"
psql -U postgres -d iracing_coach -f iracing-coach/database/schema.sql
npm run db:migrate
```

### 4. Run in development

```bash
npm run dev                  # Express API on :3000
cd frontend && npm run dev   # Next.js on :3001
```

### 5. Run in production (PM2)

```bash
pm2 start ecosystem.config.js
cd C:\nginx && nginx
```

### 6. Build coaching voice pack (optional)

Synthesizes all coaching cue WAV files via NVIDIA Magpie TTS. Run once after setup, and again whenever the cue catalog changes.

```bash
node scripts/build-coaching-voice-pack.js
node scripts/build-coaching-voice-pack.js --force   # regenerate all
```

---

## API Reference

### Auth
| Method | Path | Description |
|---|---|---|
| POST | `/api/signup` | Create account |
| POST | `/api/login` | Session login (web) |
| POST | `/api/auth/login` | JWT login (desktop client) |
| POST | `/api/auth/validate` | Validate JWT token |
| POST | `/api/logout` | Destroy session |
| GET  | `/api/user` | Current user info |

### Telemetry
| Method | Path | Description |
|---|---|---|
| POST | `/api/telemetry/upload` | Upload `.ibt` / `.blap` / `.olap` |
| GET  | `/api/telemetry/sessions` | List sessions |
| GET  | `/api/telemetry/sessions/:id` | Session detail + laps |
| GET  | `/api/telemetry/laps/:id/telemetry` | Frame data for a lap |
| GET  | `/api/telemetry/laps/:id/features` | Computed lap features |
| GET  | `/api/telemetry/laps/:id/channels` | Available channels + stats |
| POST | `/api/telemetry/live/session/start` | Open a live session |
| POST | `/api/telemetry/live/session/end` | Close a live session |
| GET  | `/api/telemetry/live/active` | Currently active live session |

### Races
| Method | Path | Description |
|---|---|---|
| GET  | `/api/races` | List races |
| POST | `/api/races` | Create race |
| GET  | `/api/races/active` | Active race |
| POST | `/api/races/:id/start` | Start race |
| POST | `/api/races/:id/end` | End race |
| GET  | `/api/races/:id/roster` | Stint roster |
| POST | `/api/races/:id/roster` | Replace roster |
| GET  | `/api/races/:id/events` | Event log |

### iRacing (desktop client)
| Method | Path | Description |
|---|---|---|
| POST | `/api/iracing/event` | Driver change / fuel update |
| POST | `/api/iracing/telemetry` | Compressed telemetry batch |
| GET  | `/api/iracing/status` | Current driver + fuel level |

### Team
| Method | Path | Description |
|---|---|---|
| GET/POST/PUT/DELETE | `/api/team/members` | Team roster CRUD |
| GET/PATCH | `/api/team/profile` | Notification settings |
| POST | `/api/team/register-telegram` | Link Telegram |
| POST | `/api/team/register-discord` | Link Discord |

### AI Assistant
| Method | Path | Description |
|---|---|---|
| POST | `/api/assistant/chat` | Race engineer chat (NVIDIA NIM) |
| GET  | `/api/assistant/models` | List available AI models |
| GET  | `/api/assistant/search` | DuckDuckGo web search |
| GET  | `/api/assistant/health` | API availability check (cached 5 min) |
| POST | `/api/analysis/compare` | Lap comparison coaching |

### Coaching
| Method | Path | Description |
|---|---|---|
| POST | `/api/coaching/reference/:lapId/activate` | Mark a lap as active reference |
| POST | `/api/coaching/reference/:referenceId/rebuild` | Rebuild zones from telemetry |
| GET  | `/api/coaching/reference/active` | All active references for current user |
| GET  | `/api/coaching/reference/:referenceId` | Reference lap metadata |
| GET  | `/api/coaching/reference/:referenceId/zones` | Coaching zones for a reference |
| GET  | `/api/coaching/profile/active` | Active profile for desktop client (`?track_id=&car_id=`) |
| POST | `/api/coaching/observations` | Ingest per-zone lap observations |
| POST | `/api/coaching/feedback-events` | Store cue playback events |
| GET  | `/api/coaching/lap-summary` | Structured lap summary (`?session_id=&lap_number=`) |
| GET  | `/api/coaching/voice/manifest` | Latest voice cue manifest |
| GET  | `/api/coaching/voice/asset/:cueKey` | Serve coaching WAV file |

---

## Database Schema

### Core tables
| Table | Purpose |
|---|---|
| `users` | Auth + iRacing/Telegram/Discord profiles |
| `sessions` | Practice sessions (file upload or live) |
| `laps` | Individual lap records |
| `telemetry_frames` | Per-frame telemetry — canonical analytics source |
| `live_telemetry` | Raw ingest buffer (14-day retention, race only) |
| `lap_features` | Computed metrics per lap |
| `fact_lap` | Warehouse lap facts |
| `fact_lap_segment` | Per-segment warehouse facts |

### Race tables
| Table | Purpose |
|---|---|
| `races` | Endurance race events |
| `stint_roster` | Driver stint schedule per race |
| `iracing_events` | Live events from desktop client |
| `race_state` | Current driver, fuel level, position |
| `race_laps` | Individual race lap records |

### Dimension tables
| Table | Purpose |
|---|---|
| `tracks` | Normalized track records |
| `track_configs` | Per-configuration track variants |
| `cars` | Normalized car records |
| `segments` | Track segments / corners |

### Coaching tables
| Table | Purpose |
|---|---|
| `coaching_reference_laps` | User-selected reference laps per car/track context |
| `coaching_reference_points` | Resampled telemetry (500 points) for each reference lap |
| `coaching_zones` | Detected driving zones with target metrics and cue templates |
| `coaching_zone_observations` | Per-lap per-zone observations from the desktop app |
| `coaching_feedback_events` | Cue playback history per lap |
| `coaching_voice_assets` | Pre-synthesized WAV file registry |
| `coaching_voice_manifests` | Versioned cue manifest snapshots |

### Serving views
| View / Function | Purpose |
|---|---|
| `mart_live_race_state` | Current race state for the live tracker |
| `mart_lap_comparison(lap_a, lap_b, bucket)` | Bucketed lap comparison for overlays |
| `mart_driver_consistency` | Driver consistency metrics |
| `mart_corner_time_loss` | Corner-by-corner time loss ranking |
| `lap_features_v` | Merged lap features (fact_lap + legacy lap_features) |
| `lap_segment_features_v` | Merged segment features |

---

## Telemetry File Formats

### IBT (iRacing Binary Telemetry)
Full session recording. Parser extracts:
- Track name, car, session type from YAML header
- Lap times from `LapLastLapTime` channel
- Per-frame: speed, throttle, brake, steering, gear, RPM, yaw_rate, CarIdxX/Y

### BLAP / OLAP (Best / Optimal Lap)
Single-lap binary format with `BLAP` magic header. Contains driver name, car path, track fragment, and lap time.

---

## Nginx Configuration

Location: `C:\nginx\conf\nginx.conf`

```nginx
upstream nodejs_backend  { server 127.0.0.1:3000; }
upstream nextjs_frontend { server 127.0.0.1:3001; }

# /api/* → Express
# /_next/*, static assets → Next.js
# / → Next.js
```

Reload after changes: `cd C:\nginx && nginx -s reload`

---

## Development Notes

- **Dual auth**: web pages use `express-session` cookies; desktop client and `/lap-analysis.html` use JWT Bearer tokens (90-day expiry)
- **Rate limiting**: `/api/telemetry/live` and `/api/iracing/telemetry` allow 1200 req/min; all other `/api/` routes allow 300 req/min
- **File uploads**: max 50 MB, stored in `uploads/ibt/`, `uploads/blap/`, `uploads/olap/`
- **AI responses**: NVIDIA NIM (MiniMax M2.7 default) — expect 15–60 s for complex responses. `<think>` blocks are stripped before delivery.
- **Health check**: `/api/assistant/health` result is cached 5 minutes server-side to avoid rate-limit exhaustion
- **Coaching zones**: deterministic only — no LLM involved in zone detection, observation analysis, or lap summaries. LLM extension point exists in `lapSummary.js`
- **Voice assets**: WAV files are synthesized ahead of time. Do not design for per-corner runtime synthesis.
- **Track map**: built via `yaw_rate` + speed double-integration with linear loop-closure correction when GPS (`CarIdxX`/`Y`) is unavailable

---

## Utility Scripts

| Script | Purpose |
|---|---|
| `scripts/run-migrations.js` | Apply numbered migrations (001–009) |
| `scripts/build-coaching-voice-pack.js` | Synthesize all coaching WAV files via NVIDIA TTS |
| `scripts/migrate-users.js` | One-time SQLite → PostgreSQL migration |
| `scripts/cleanup-sessions.js` | Remove sessions with bad track names |
| `scripts/fix-sessions.js` | Re-parse session metadata |
| `scripts/analyze-ibt.js` | Inspect IBT file structure |
| `scripts/analyze-blap.js` | Inspect BLAP file structure |
| `scripts/register-discord-commands.js` | Register Discord slash commands |

---

Built by Max — SM CORSE iRacing Endurance Team
