@echo off
REM Interactive PostgreSQL Database Setup for SM CORSE
REM This will prompt for your PostgreSQL password

echo ========================================
echo SM CORSE - Database Setup
echo ========================================
echo.

SET PGPATH="C:\Program Files\PostgreSQL\16\bin"
SET PGUSER=postgres
SET DBNAME=iracing_coach
SET SCHEMA_FILE=iracing-coach\database\schema.sql

echo PostgreSQL Path: %PGPATH%
echo User: %PGUSER%
echo Database: %DBNAME%
echo.

REM Prompt for password
set /p PGPASSWORD="Enter PostgreSQL password for user 'postgres': "
echo.

echo Step 1: Creating database...
echo.

REM Set password environment variable
set PGPASSWORD=%PGPASSWORD%

REM Create database
%PGPATH%\psql.exe -U %PGUSER% -c "CREATE DATABASE %DBNAME%;"

if %ERRORLEVEL% NEQ 0 (
    echo.
    echo NOTE: If you see "database already exists" error, that's okay!
    echo       We'll continue with the schema setup.
    echo.
    pause
)

echo.
echo Step 2: Running schema...
echo.

REM Run schema file
%PGPATH%\psql.exe -U %PGUSER% -d %DBNAME% -f %SCHEMA_FILE%

if %ERRORLEVEL% EQU 0 (
    echo.
    echo ========================================
    echo SUCCESS! Database setup complete
    echo ========================================
    echo.
    echo Database: %DBNAME%
    echo Tables created: users, sessions, laps, reference_laps,
    echo                 coaching_sessions, tracks, user_preferences,
    echo                 user_progress
    echo.
    echo Next steps:
    echo 1. Update .env file with your PostgreSQL password
    echo 2. Run: npm run migrate (if you have existing users)
    echo 3. Run: npm start
    echo.
) else (
    echo.
    echo ========================================
    echo ERROR: Schema creation failed
    echo ========================================
    echo.
    echo Please check:
    echo 1. PostgreSQL is running
    echo 2. Password is correct
    echo 3. Schema file exists at: %SCHEMA_FILE%
    echo.
)

REM Clear password from environment
set PGPASSWORD=

pause
