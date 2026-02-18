# PowerShell Script for Database Setup
# SM CORSE - iRacing Team Platform

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  SM CORSE - Database Setup" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

$pgPath = "C:\Program Files\PostgreSQL\16\bin"
$pgUser = "postgres"
$dbName = "iracing_coach"
$schemaFile = "iracing-coach\database\schema.sql"

# Check if PostgreSQL is installed
if (-not (Test-Path "$pgPath\psql.exe")) {
    Write-Host "ERROR: PostgreSQL not found at $pgPath" -ForegroundColor Red
    Write-Host "Please install PostgreSQL or update the path in this script" -ForegroundColor Yellow
    pause
    exit 1
}

# Check if schema file exists
if (-not (Test-Path $schemaFile)) {
    Write-Host "ERROR: Schema file not found at $schemaFile" -ForegroundColor Red
    pause
    exit 1
}

# Prompt for password securely
$securePassword = Read-Host "Enter PostgreSQL password for user '$pgUser'" -AsSecureString
$password = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($securePassword))

# Set environment variable
$env:PGPASSWORD = $password

Write-Host ""
Write-Host "Step 1: Creating database..." -ForegroundColor Yellow
Write-Host ""

# Create database
$createDbResult = & "$pgPath\psql.exe" -U $pgUser -c "CREATE DATABASE $dbName;" 2>&1

if ($LASTEXITCODE -eq 0) {
    Write-Host "✓ Database created successfully" -ForegroundColor Green
} else {
    if ($createDbResult -like "*already exists*") {
        Write-Host "✓ Database already exists (continuing...)" -ForegroundColor Yellow
    } else {
        Write-Host "✗ Failed to create database" -ForegroundColor Red
        Write-Host $createDbResult -ForegroundColor Red
    }
}

Write-Host ""
Write-Host "Step 2: Running schema..." -ForegroundColor Yellow
Write-Host ""

# Run schema
$schemaResult = & "$pgPath\psql.exe" -U $pgUser -d $dbName -f $schemaFile 2>&1

if ($LASTEXITCODE -eq 0) {
    Write-Host ""
    Write-Host "========================================" -ForegroundColor Green
    Write-Host "  SUCCESS! Database setup complete" -ForegroundColor Green
    Write-Host "========================================" -ForegroundColor Green
    Write-Host ""
    Write-Host "Database: $dbName" -ForegroundColor Cyan
    Write-Host "Tables created:" -ForegroundColor Cyan
    Write-Host "  - users" -ForegroundColor White
    Write-Host "  - sessions" -ForegroundColor White
    Write-Host "  - laps" -ForegroundColor White
    Write-Host "  - reference_laps" -ForegroundColor White
    Write-Host "  - coaching_sessions" -ForegroundColor White
    Write-Host "  - tracks" -ForegroundColor White
    Write-Host "  - user_preferences" -ForegroundColor White
    Write-Host "  - user_progress" -ForegroundColor White
    Write-Host ""
    Write-Host "Next steps:" -ForegroundColor Yellow
    Write-Host "1. Update .env file with your PostgreSQL password" -ForegroundColor White
    Write-Host "2. Run: npm run migrate (if you have existing users)" -ForegroundColor White
    Write-Host "3. Run: npm start" -ForegroundColor White
    Write-Host ""
} else {
    Write-Host ""
    Write-Host "========================================" -ForegroundColor Red
    Write-Host "  ERROR: Schema creation failed" -ForegroundColor Red
    Write-Host "========================================" -ForegroundColor Red
    Write-Host ""
    Write-Host $schemaResult -ForegroundColor Red
    Write-Host ""
    Write-Host "Please check:" -ForegroundColor Yellow
    Write-Host "1. PostgreSQL is running" -ForegroundColor White
    Write-Host "2. Password is correct" -ForegroundColor White
    Write-Host "3. No other errors above" -ForegroundColor White
    Write-Host ""
}

# Clear password
$env:PGPASSWORD = ""
$password = ""

Write-Host ""
Write-Host "Press any key to continue..."
$null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")
