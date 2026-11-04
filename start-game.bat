@echo off
title FORTIVEX Server
cd /d "%~dp0"
cls
echo ====================================================
echo Starting FORTIVEX Game Server...
echo ====================================================
node server.js
if %errorlevel% neq 0 (
    echo.
    echo Node.js encountered an error.
    pause
)
