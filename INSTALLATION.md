# SM CORSE - iRacing Team Platform Installation Guide

## Overview

This platform combines team authentication with iRacing telemetry analysis and AI coaching powered by a remote Llama server.

## Prerequisites

### Required Software

1. **Node.js 18+** - https://nodejs.org/
2. **PostgreSQL 15+** - https://www.postgresql.org/download/windows/
3. **Nginx** (already installed at C:/nginx)

### Remote Services

- **LLM Server**: http://23.141.136.111:11434 (Llama 3.3 70B Instruct Q4_K_M)

## Installation Steps

### 1. Install PostgreSQL

1. Download PostgreSQL 15 or 16 from https://www.postgresql.org/download/windows/
2. Run the installer
3. Set a password for the `postgres` user (remember this!)
4. Default port: 5432

### 2. Create Database

**Option A: Using Command Line**
```bash
cd C:\Users\maxim\Documents\smcorse
setup-database.bat
```

**Option B: Using pgAdmin**
1. Open pgAdmin 4
2. Connect to your PostgreSQL server
3. Right-click "Databases" → Create → Database
4. Name: `iracing_coach`
5. Open Query Tool
6. Run the SQL from: `iracing-coach\database\schema.sql`

### 3. Configure Environment

Edit `.env` file and update:
```env
DB_PASSWORD=your_postgres_password_here
```

The file is already configured with:
- Remote Llama server: http://23.141.136.111:11434
- Model: llama3.3:70b-instruct-q4_K_M
- Session secret (change in production!)

### 4. Install Dependencies

```bash
cd C:\Users\maxim\Documents\smcorse
npm install
```

This will install:
- Express and authentication packages
- PostgreSQL client (pg)
- File upload (multer)
- AI client (axios for Ollama)
- Security packages (helmet, cors)

### 5. Migrate Existing Users (if any)

If you have existing users in users.db:

```bash
npm run migrate
```

This moves users from SQLite to PostgreSQL.

### 6. Start the Application

```bash
npm start
```

Or for development with auto-reload:

```bash
npm run dev
```

Server will start on: http://localhost:3000

### 7. Restart Nginx

Nginx configuration has been updated to support:
- 50MB file uploads (telemetry files)
- Extended timeouts for AI processing (5 minutes)

Restart Nginx:
```bash
cd C:\nginx
nginx -s reload
```

Or if Nginx isn't running:
```bash
start nginx
```

## Testing the Installation

### 1. Check Health Endpoint

Open browser to: http://localhost:3000/health

Should show:
```json
{
  "status": "healthy",
  "services": {
    "database": "connected",
    "llama": "available"
  }
}
```

### 2. Test Authentication

1. Go to http://localhost or http://smcorse.com
2. Sign up with a new account
3. Login and access dashboard

### 3. Test Telemetry (Future)

Once telemetry pages are built:
1. Upload a .ibt, .blap, or .olap file
2. View session data
3. Request AI coaching

## Project Structure

```
smcorse/
├── server.js                    # Main Express server (merged)
├── package.json                 # Dependencies
├── .env                         # Environment configuration
├── public/                      # Frontend files
│   ├── index.html              # Landing/auth page
│   └── dashboard.html          # Main dashboard
├── src/                        # Backend code (from iracing-coach)
│   ├── config/                 # Database, Llama config
│   ├── routes/                 # API routes
│   ├── services/               # Telemetry parsing, coaching
│   └── middleware/             # Auth, upload handling
├── scripts/                    # Utility scripts
│   └── migrate-users.js       # SQLite → PostgreSQL migration
├── uploads/                    # Telemetry file storage
│   ├── ibt/
│   ├── blap/
│   └── olap/
└── iracing-coach/             # Original extracted files (backup)
```

## API Endpoints

### Authentication (Session-based)
- `POST /api/signup` - Create account
- `POST /api/login` - Login
- `POST /api/logout` - Logout
- `GET /api/user` - Get current user

### Telemetry (Requires Authentication)
- `POST /api/telemetry/upload` - Upload telemetry file
- `GET /api/telemetry/sessions` - Get user sessions
- `GET /api/telemetry/laps/:id` - Get lap data

### Analysis (Requires Authentication)
- `POST /api/analysis/compare` - Compare laps & get AI coaching
- `POST /api/analysis/chat` - Chat with AI coach
- `GET /api/analysis/coaching` - Get coaching history

### Library (Requires Authentication)
- `GET /api/library/reference-laps` - Browse reference laps
- `GET /api/library/leaderboard` - Track leaderboards

## Troubleshooting

### Database Connection Failed

Check:
1. PostgreSQL is running (check Services)
2. Password in .env is correct
3. Database `iracing_coach` exists

Test connection:
```bash
psql -U postgres -d iracing_coach -c "SELECT version();"
```

### Remote Llama Server Unavailable

Check:
1. Network connection to 23.141.136.111
2. Port 11434 is accessible
3. Test endpoint:
```bash
curl http://23.141.136.111:11434/api/tags
```

### Nginx Errors

Check logs:
```bash
type C:\nginx\logs\error.log
```

Restart Nginx:
```bash
cd C:\nginx
nginx -s stop
start nginx
```

### Port 3000 Already in Use

Kill the process:
```bash
netstat -ano | findstr :3000
taskkill /PID <process_id> /F
```

## Next Steps

### Build Telemetry Pages

The dashboard now links to telemetry features, but the actual pages need to be created:

1. **telemetry.html** - Upload interface
2. **sessions.html** - Session browser
3. **coaching.html** - AI coaching interface
4. **library.html** - Reference lap library

These can be built as simple HTML pages (matching current aesthetic) or as a React app.

### Deploy to Production

1. Set `NODE_ENV=production` in .env
2. Use strong `SESSION_SECRET`
3. Configure SSL in Nginx
4. Set up PM2 for process management:
```bash
npm install -g pm2
pm2 start server.js --name smcorse
pm2 save
pm2 startup
```

## Support

For issues:
1. Check server logs (console output)
2. Check Nginx logs: `C:\nginx\logs\error.log`
3. Check database connection
4. Verify remote Llama server is accessible

## Credits

Built with:
- Node.js + Express
- PostgreSQL
- Ollama/Llama 3.3 70B
- Nginx
- iRacing Coach system integration
