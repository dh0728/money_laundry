@echo off
setlocal
where node >nul 2>&1
if errorlevel 1 (
  echo Install Node.js 22.12 or newer and pnpm 11.24.0.
  pause
  exit /b 1
)
node "%~dp0frontend\implementation\1.14.0\web-app\scripts\open-aml-radar.mjs"
if errorlevel 1 (
  pause
  exit /b 1
)
