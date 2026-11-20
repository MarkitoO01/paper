@echo off
cd /d "%~dp0"
net session >nul 2>&1
if %errorlevel% neq 0 (
  echo Execute como administrador.
  pause
  exit /b 1
)
node server\uninstall-service.cjs
pause
