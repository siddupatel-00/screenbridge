@echo off
cd /d "%~dp0"
echo ========================================
echo  Starting ScreenBridge for Windows
echo ========================================

where node >nul 2>nul
if %errorlevel% neq 0 (
    echo Node.js not found. Please install Node.js from https://nodejs.org/
    pause
    exit /b 1
)

if not exist "web\dist" (
    echo Building web interface...
    call npm run build
)

echo Starting ScreenBridge Server and Agent...
start http://localhost:8787
call npm run start:all
