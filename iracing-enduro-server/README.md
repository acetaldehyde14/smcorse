# iRacing Enduro — Server

Node.js / Express backend for the iRacing Endurance team monitor.

## Setup

### 1. Install dependencies
```bash
npm install
```

### 2. Configure environment
```bash
cp .env.example .env
# Edit .env with your values
```

Required values in `.env`:
| Variable | Description |
|---|---|
| `DATABASE_URL` | PostgreSQL connection string |
| `JWT_SECRET` | Long random string for signing tokens |
| `TELEGRAM_BOT_TOKEN` | From @BotFather on Telegram |
| `DISCORD_BOT_TOKEN` | From discord.com/developers |
| `DISCORD_TEAM_WEBHOOK` | Discord channel webhook URL |

### 3. Run database migration
```bash
psql $DATABASE_URL -f db/migrate.sql
```

### 4. Start the server
```bash
# Production
npm start

# Development (auto-restart)
npm run dev
```

## Telegram Bot Setup
1. DM `@BotFather` on Telegram → `/newbot` → follow prompts → copy token to `.env`
2. Each team member DMs your bot `/start` to link their account

## Discord Bot Setup
1. Go to https://discord.com/developers/applications → New Application
2. Go to Bot → Add Bot → copy token to `DISCORD_BOT_TOKEN` in `.env`
3. Under Bot → Privileged Gateway Intents → enable **Message Content Intent**
4. Invite bot to your server using OAuth2 URL Generator:
   - Scope: `bot`, `applications.commands`
   - Permissions: `Send Messages`, `Use Slash Commands`
5. Register the `/register` slash command (run `node scripts/register-discord-commands.js`)
6. Each team member runs `/register` in your Discord server

## Discord Webhook Setup (Team Channel)
1. In Discord: right-click your team channel → Edit Channel → Integrations → Webhooks → New Webhook
2. Copy the webhook URL → paste into `DISCORD_TEAM_WEBHOOK` in `.env`

## API Endpoints

### Auth
- `POST /api/auth/register` — create account `{ username, password, iracing_name }`
- `POST /api/auth/login` — login `{ username, password }` → `{ token }`
- `POST /api/auth/validate` — verify token (Bearer auth)

### Users
- `GET  /api/users/me` — get own profile
- `PATCH /api/users/me` — update profile `{ iracing_name, iracing_id, discord_webhook }`
- `GET  /api/users/team` — list team members

### Races
- `GET  /api/races` — list races
- `GET  /api/races/active` — get active race
- `POST /api/races` — create race `{ name, track }`
- `POST /api/races/:id/start` — activate race
- `POST /api/races/:id/end` — end race
- `GET  /api/races/:id/roster` — get stint roster
- `POST /api/races/:id/roster` — set stint roster `{ roster: [{ driver_user_id, stint_order, planned_duration_mins }] }`
- `GET  /api/races/:id/events` — get telemetry events

### iRacing
- `POST /api/iracing/event` — receive telemetry event from desktop client
- `GET  /api/iracing/status` — current race status

## Deploying
Works on any VPS (Ubuntu recommended). Use PM2 to keep it running:
```bash
npm install -g pm2
pm2 start index.js --name iracing-enduro
pm2 save
pm2 startup
```
