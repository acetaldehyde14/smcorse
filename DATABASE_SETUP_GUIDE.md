# Database Setup Guide

## PostgreSQL is Installed!

✅ Found: PostgreSQL 16.11 at `C:\Program Files\PostgreSQL\16\bin`

## Choose Your Setup Method

### Option 1: PowerShell Script (Recommended)

**Run this in PowerShell:**

```powershell
cd C:\Users\maxim\Documents\smcorse
.\setup-database.ps1
```

The script will:
- Prompt for your PostgreSQL password (securely)
- Create the `iracing_coach` database
- Run the schema to create all tables
- Show detailed success/error messages

### Option 2: Batch File

**Run this:**

```cmd
cd C:\Users\maxim\Documents\smcorse
setup-database-interactive.bat
```

### Option 3: pgAdmin GUI (Visual Method)

**Steps:**

1. Open **pgAdmin 4** (should be installed with PostgreSQL)

2. Connect to your server:
   - Server: `localhost`
   - User: `postgres`
   - Password: *your postgres password*

3. **Create Database:**
   - Right-click **Databases**
   - Click **Create** → **Database**
   - Name: `iracing_coach`
   - Owner: `postgres`
   - Click **Save**

4. **Run Schema:**
   - Right-click on `iracing_coach` database
   - Click **Query Tool**
   - Click **Open File** icon
   - Navigate to: `C:\Users\maxim\Documents\smcorse\iracing-coach\database\schema.sql`
   - Click **Execute** (▶️ button)
   - Should show "Query returned successfully"

5. **Verify Tables:**
   - Expand `iracing_coach` → **Schemas** → **public** → **Tables**
   - You should see: users, sessions, laps, reference_laps, coaching_sessions, tracks, user_preferences, user_progress

### Option 4: Manual Command Line

**If you know your password:**

```bash
# Set password as environment variable (Windows CMD)
set PGPASSWORD=your_password_here

# Create database
"C:\Program Files\PostgreSQL\16\bin\psql.exe" -U postgres -c "CREATE DATABASE iracing_coach;"

# Run schema
"C:\Program Files\PostgreSQL\16\bin\psql.exe" -U postgres -d iracing_coach -f iracing-coach\database\schema.sql

# Clear password
set PGPASSWORD=
```

**Or in PowerShell:**

```powershell
$env:PGPASSWORD = "your_password_here"
& "C:\Program Files\PostgreSQL\16\bin\psql.exe" -U postgres -c "CREATE DATABASE iracing_coach;"
& "C:\Program Files\PostgreSQL\16\bin\psql.exe" -U postgres -d iracing_coach -f iracing-coach\database\schema.sql
$env:PGPASSWORD = ""
```

## After Database Setup

### 1. Update .env File

Edit `C:\Users\maxim\Documents\smcorse\.env`:

```env
DB_PASSWORD=your_actual_postgres_password
```

### 2. Migrate Existing Users (Optional)

If you have users in the old `users.db` SQLite file:

```bash
npm run migrate
```

This will copy them to PostgreSQL.

### 3. Start the Server

```bash
npm start
```

### 4. Test Database Connection

Visit: http://localhost:3000/health

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

## Troubleshooting

### "Password authentication failed"

- Make sure you're using the correct postgres password
- Try resetting it in pgAdmin or during PostgreSQL installation

### "Database already exists"

- That's fine! Just run the schema:
```bash
"C:\Program Files\PostgreSQL\16\bin\psql.exe" -U postgres -d iracing_coach -f iracing-coach\database\schema.sql
```

### "Permission denied"

- Make sure you're running as the same user who installed PostgreSQL
- Or run Command Prompt / PowerShell as Administrator

### "psql: error: connection to server failed"

- PostgreSQL service might not be running
- Open Services (Win+R, type `services.msc`)
- Find "postgresql-x64-16" and start it

## Database Schema Overview

The database includes these tables:

| Table | Purpose |
|-------|---------|
| **users** | User accounts and authentication |
| **sessions** | Practice sessions by track/car |
| **laps** | Individual lap data with telemetry |
| **reference_laps** | Coach/community reference laps |
| **coaching_sessions** | AI coaching history |
| **tracks** | Track information library |
| **user_preferences** | User settings |
| **user_progress** | Progress tracking by track/car |

## Quick Test Query

After setup, test with:

```sql
-- Connect to database
"C:\Program Files\PostgreSQL\16\bin\psql.exe" -U postgres -d iracing_coach

-- Run this query
SELECT table_name FROM information_schema.tables WHERE table_schema = 'public';

-- Should list all 8 tables
```

## Need Help?

Check:
1. PostgreSQL service is running (services.msc)
2. Password is correct
3. Port 5432 is not blocked by firewall
4. pgAdmin can connect to localhost

Still stuck? Open pgAdmin and use the GUI method - it's the most reliable!
