@echo off
title Barricade Server
cd /d "%~dp0"
cls
echo ====================================================
echo Starting Barricade Game Server...
echo ====================================================
node server.js
if %errorlevel% neq 0 (
    echo.
    echo Node.js encountered an error.
    pause
)
