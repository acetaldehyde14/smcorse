@echo off
REM Setup script for iRacing Coach PostgreSQL database
REM Run this after installing PostgreSQL

echo ================================
echo iRacing Coach Database Setup
echo ================================
echo.

REM Check if PostgreSQL is installed
where psql >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
    echo ERROR: PostgreSQL not found in PATH
    echo.
    echo Please install PostgreSQL from: https://www.postgresql.org/download/windows/
    echo Or add PostgreSQL bin directory to your PATH
    echo Common location: C:\Program Files\PostgreSQL\15\bin
    echo.
    pause
    exit /b 1
)

echo PostgreSQL found! Creating database...
echo.

REM Create database
psql -U postgres -c "CREATE DATABASE iracing_coach;"
if %ERRORLEVEL% NEQ 0 (
    echo WARNING: Database might already exist or creation failed
)

echo.
echo Running schema...
psql -U postgres -d iracing_coach -f iracing-coach\database\schema.sql

if %ERRORLEVEL% EQU 0 (
    echo.
    echo ================================
    echo SUCCESS! Database setup complete
    echo ================================
) else (
    echo.
    echo ================================
    echo ERROR: Schema creation failed
    echo ================================
)

echo.
pause
