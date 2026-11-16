@echo off
rem Arranca el escaner en local (Windows): doble clic en este archivo.
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo Falta Node.js. Instala la version LTS desde https://nodejs.org y vuelve a abrir este archivo.
  pause
  exit /b 1
)

rem Dependencias del analizador (solo la primera vez)
if not exist "worker\node_modules" (
  echo Instalando dependencias, tarda un minuto la primera vez...
  pushd worker
  call npm install
  popd
)

rem Ventana 1: analizador en http://localhost:8787
start "Analizador (no cerrar)" cmd /k "cd /d "%~dp0worker" && npx wrangler dev --port 8787"

rem Ventana 2: web en http://localhost:8080
start "Web (no cerrar)" cmd /k "cd /d "%~dp0" && npx -y http-server -p 8080 -c-1"

echo Esperando a que arranque...
timeout /t 10 /nobreak >nul
start "" "http://localhost:8080/escaner/"
echo.
echo Listo. Para parar, cierra las dos ventanas negras.
timeout /t 5 >nul
