# iRacing Telemetry Coaching System - Setup Guide

## Prerequisites

### Required Software

1. **Node.js 18+** - https://nodejs.org/
2. **PostgreSQL 15+** - https://www.postgresql.org/download/windows/
3. **Nginx for Windows** - http://nginx.org/en/download.html
4. **Ollama** - https://ollama.com/download/windows
5. **Git** (optional) - https://git-scm.com/downloads

## Installation Steps

### 1. Install PostgreSQL

1. Download and install PostgreSQL for Windows
2. Remember the password you set for the `postgres` user
3. PostgreSQL should be running on port 5432

**Create Database:**
```sql
-- Open pgAdmin or psql command line
CREATE DATABASE iracing_coach;
```

**Run Schema:**
```bash
# Navigate to project directory
cd C:\iracing-coach

# Run schema file
psql -U postgres -d iracing_coach -f database\schema.sql
```

### 2. Install Ollama and Llama 3.3

1. Download Ollama for Windows from https://ollama.com/download/windows
2. Install and start Ollama
3. Open PowerShell and run:
```powershell
ollama pull llama3.3:70b
```

This will download Llama 3.3 70B (~40GB). Make sure you have enough disk space and RAM (at least 64GB RAM recommended).

**Test Ollama:**
```powershell
ollama run llama3.3:70b "Hello, I need racing coaching advice"
```

### 3. Setup Backend

```bash
cd C:\iracing-coach\backend

# Install dependencies
npm install

# Copy environment file
copy .env.example .env

# Edit .env file with your settings
notepad .env
```

**Configure .env:**
```env
NODE_ENV=production
PORT=3000
HOST=localhost

DB_HOST=localhost
DB_PORT=5432
DB_NAME=iracing_coach
DB_USER=postgres
DB_PASSWORD=your_postgres_password_here

JWT_SECRET=change_this_to_a_random_long_string

OLLAMA_HOST=http://localhost:11434
OLLAMA_MODEL=llama3.3:70b

MAX_FILE_SIZE=52428800
```

**Start Backend:**
```bash
npm start
```

Or for development with auto-reload:
```bash
npm run dev
```

The backend should now be running on http://localhost:3000

**Test Backend:**
Open browser to http://localhost:3000/health

### 4. Setup Frontend

```bash
cd C:\iracing-coach\frontend

# Install dependencies
npm install

# Build production version
npm run build
```

This creates an optimized build in `frontend/build/`

### 5. Setup Nginx

1. Download Nginx for Windows
2. Extract to `C:\nginx`
3. Copy the config file:

```bash
copy C:\iracing-coach\nginx\iracing-coach.conf C:\nginx\conf\iracing-coach.conf
```

4. Edit `C:\nginx\conf\nginx.conf` and add this line inside the `http {}` block:
```nginx
include iracing-coach.conf;
```

5. Update paths in `iracing-coach.conf`:
   - Change `root C:/iracing-coach/frontend/build;` to your actual path

**Start Nginx:**
```bash
cd C:\nginx
start nginx
```

**Stop Nginx:**
```bash
nginx -s stop
```

**Reload config:**
```bash
nginx -s reload
```

### 6. Test Complete System

1. Open browser to http://localhost
2. You should see the login/signup page
3. Create an account
4. Upload a telemetry file (.ibt, .blap, or .olap)
5. View analysis and coaching

## Running the System

### Start All Services

Create a batch file `start-services.bat`:

```batch
@echo off
echo Starting iRacing Coach services...

REM Start PostgreSQL (if not auto-starting)
net start postgresql-x64-15

REM Start Ollama (if not running)
start "" "C:\Users\%USERNAME%\AppData\Local\Programs\Ollama\ollama app.exe"

REM Wait for Ollama to start
timeout /t 5

REM Start Backend
echo Starting Backend...
cd C:\iracing-coach\backend
start "Backend" cmd /k npm start

REM Start Nginx
echo Starting Nginx...
cd C:\nginx
start nginx

echo.
echo All services started!
echo Backend: http://localhost:3000
echo Frontend: http://localhost
echo.
pause
```

### Stop All Services

Create `stop-services.bat`:

```batch
@echo off
echo Stopping iRacing Coach services...

REM Stop Nginx
cd C:\nginx
nginx -s stop

REM Stop Backend (close the window or Ctrl+C)
echo Backend stopped

echo.
echo Services stopped!
pause
```

## Using PM2 for Process Management (Recommended)

Install PM2 globally:
```bash
npm install -g pm2-windows-service
npm install -g pm2
```

Start backend with PM2:
```bash
cd C:\iracing-coach\backend
pm2 start src\server.js --name iracing-coach-backend
pm2 save
```

PM2 commands:
```bash
pm2 status          # Check status
pm2 logs            # View logs
pm2 restart all     # Restart
pm2 stop all        # Stop
pm2 startup         # Configure auto-start on Windows boot
```

## Troubleshooting

### Backend won't start
- Check PostgreSQL is running: `psql -U postgres -c "SELECT version()"`
- Check .env file is configured correctly
- Check port 3000 is not in use: `netstat -ano | findstr :3000`

### Ollama not responding
- Check Ollama is running: Task Manager → Ollama
- Test: `ollama list` should show llama3.3:70b
- Restart Ollama if needed

### Nginx error
- Check config syntax: `nginx -t`
- Check logs: `C:\nginx\logs\error.log`
- Make sure port 80 is not in use

### File upload fails
- Check `uploads/` directories exist
- Check file size < 50MB
- Check disk space

### AI coaching slow
- Llama 3.3 70B requires powerful GPU
- First response may be slow (model loading)
- Check system RAM (needs 64GB+ for 70B)
- Consider using smaller model: `ollama pull llama3.3:8b`

## Development Mode

For development with hot reload:

**Backend:**
```bash
cd backend
npm run dev  # Uses nodemon
```

**Frontend:**
```bash
cd frontend
npm start    # React development server on port 3001
```

Update Nginx config to proxy to React dev server for development.

## Production Deployment

For production:

1. Use proper domain name
2. Setup SSL certificates (Let's Encrypt)
3. Use PM2 for backend process management
4. Setup database backups
5. Configure firewall rules
6. Set NODE_ENV=production
7. Use strong JWT_SECRET

## Updating the System

```bash
# Backup database first
pg_dump -U postgres iracing_coach > backup.sql

# Pull latest code
git pull

# Update backend dependencies
cd backend
npm install

# Rebuild frontend
cd ../frontend
npm install
npm run build

# Restart services
pm2 restart all
nginx -s reload
```

## Support

For issues:
1. Check logs: `backend/logs/` and `C:\nginx\logs\`
2. Check PM2 logs: `pm2 logs`
3. Verify all services are running
4. Check system requirements (RAM, disk space)

## Next Steps

1. Upload your first telemetry file
2. Compare against reference laps
3. Get AI coaching
4. Track your progress over time
5. Share your best laps with the community

Enjoy your racing improvements!
