@echo off
rem Double-click to start CC Watcher: installs Node.js and the two libraries on first run, then opens the dashboard.
setlocal
cd /d "%~dp0"
title CC Watcher
if not defined PORT set PORT=4790
set "URL=http://localhost:%PORT%"

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is not installed. Installing it now with winget - Windows may ask for permission...
  winget install -e --id OpenJS.NodeJS.LTS --accept-source-agreements --accept-package-agreements
  set "PATH=%PATH%;%ProgramFiles%\nodejs"
)
where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo Could not install Node.js automatically. Opening nodejs.org - install the LTS version, then double-click start.bat again.
  start "" https://nodejs.org
  pause
  exit /b 1
)

curl -s -o nul "%URL%/manifest.webmanifest" 2>nul && (
  echo CC Watcher is already running. Opening %URL%
  start "" "%URL%"
  exit /b 0
)

if not exist "node_modules\ws\" (
  echo Installing libraries - first run only...
  call npm install --omit=dev --no-audit --no-fund
  if errorlevel 1 ( echo npm install failed. & pause & exit /b 1 )
)

start "" /b powershell -NoProfile -WindowStyle Hidden -Command "Start-Sleep 2; Start-Process '%URL%'"
echo.
echo CC Watcher is running at %URL%  -  keep this window open. Close it to stop.
echo.
node server.js
pause
