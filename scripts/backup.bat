@echo off
cd /d "%~dp0\.."
if not exist backups mkdir backups
set PGHOST=127.0.0.1
set PGPORT=5432
set PGUSER=postgres
set PGPASSWORD=postgres
set PGDATABASE=allegra
for /f "tokens=1,2 delims==" %%a in ('findstr /b "PGHOST=" .env') do set PGHOST=%%b
for /f "tokens=1,2 delims==" %%a in ('findstr /b "PGPORT=" .env') do set PGPORT=%%b
for /f "tokens=1,2 delims==" %%a in ('findstr /b "PGUSER=" .env') do set PGUSER=%%b
for /f "tokens=1,2 delims==" %%a in ('findstr /b "PGPASSWORD=" .env') do set PGPASSWORD=%%b
for /f "tokens=1,2 delims==" %%a in ('findstr /b "PGDATABASE=" .env') do set PGDATABASE=%%b

echo Exportando backup separado por entidades (JSON + CSV + ZIP) de %PGHOST%:%PGPORT%...
node scripts\backup-entidades.mjs

where pg_dump >nul 2>&1
if %errorlevel% equ 0 (
  for /f %%i in ('powershell -NoProfile -Command "Get-Date -Format yyyyMMdd-HHmmss"') do set STAMP=%%i
  pg_dump -h %PGHOST% -p %PGPORT% -U %PGUSER% -d %PGDATABASE% -Fc -f "backups\allegra-%STAMP%.dump"
  if not errorlevel 1 echo Dump PostgreSQL criado em backups\allegra-%STAMP%.dump
)
pause
