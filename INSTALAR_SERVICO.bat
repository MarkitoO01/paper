@echo off
cd /d "%~dp0"
net session >nul 2>&1
if %errorlevel% neq 0 (
  echo Clique com o botao direito e escolha Executar como administrador.
  pause
  exit /b 1
)
echo Instalando dependencias do Allegra...
cd /d "%~dp0server"
call npm install --omit=dev
cd /d "%~dp0"
if errorlevel 1 (
  echo Falha ao instalar dependencias. Verifique Node.js e internet.
  pause
  exit /b 1
)
if not exist .env (
  copy .env.example .env >nul
  echo Arquivo .env criado. Edite-o antes de instalar o servico.
  notepad .env
  pause
  exit /b 1
)
node server\install-service.cjs
pause
