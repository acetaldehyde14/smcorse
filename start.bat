@echo off
echo ========================================
echo   MAX Authentication Platform
echo ========================================
echo.

:: Check if node_modules exists
if not exist "node_modules\" (
    echo Installing dependencies...
    call npm install
    echo.
)

:: Check if .env exists, if not create from template
if not exist ".env" (
    echo Creating .env file...
    echo PORT=3000 > .env
    echo SESSION_SECRET=change-this-to-a-random-secret-key-in-production >> .env
    echo NODE_ENV=development >> .env
    echo.
    echo WARNING: Please edit .env and change SESSION_SECRET before deploying!
    echo.
)

echo Starting server...
echo.
echo Application will be available at: http://localhost:3000
echo Press Ctrl+C to stop the server
echo.

npm start
