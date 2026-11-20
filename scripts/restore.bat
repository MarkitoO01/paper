@echo off
cd /d "%~dp0\.."
set TARGET=%~1
if "%TARGET%"=="" (
  if exist "backups\ultimo-backup-entidades.json" (
    set TARGET=backups\ultimo-backup-entidades.json
    echo Nenhum arquivo informado. Selecionado o ultimo backup automatico: %TARGET%
  ) else (
    echo Uso: scripts\restore.bat backups\allegra-entidades-AAAAMMDD-HHMMSS.json
    pause
    exit /b 1
  )
)
echo ATENCAO: a restauracao atualiza/restaura os dados no banco PostgreSQL (%TARGET%).
set /p CONFIRM=Digite RESTAURAR para continuar:
if not "%CONFIRM%"=="RESTAURAR" exit /b 1

echo %TARGET% | findstr /i "\.dump$" >nul
if %errorlevel% equ 0 (
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
  pg_restore -h %PGHOST% -p %PGPORT% -U %PGUSER% -d %PGDATABASE% --clean --if-exists "%TARGET%"
) else (
  node scripts\restore-entidades.mjs "%TARGET%"
)
pause
