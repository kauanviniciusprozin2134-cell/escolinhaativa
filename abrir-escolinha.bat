@echo off
rem Inicia o EscolinhaAtiva e abre o navegador.
setlocal
cd /d "%~dp0"

set NODE="C:\Program Files\nodejs\node.exe"
if not exist %NODE% set NODE=node

rem Se o servidor ja estiver no ar, so abre o navegador.
powershell -NoProfile -Command "try { (Invoke-WebRequest -UseBasicParsing http://localhost:4173/ -TimeoutSec 2) | Out-Null; exit 0 } catch { exit 1 }" >nul 2>&1
if %errorlevel%==0 (
  start "" http://localhost:4173/
  exit /b 0
)

start "EscolinhaAtiva" /min cmd /c "%NODE% server.js"
timeout /t 2 /nobreak >nul
start "" http://localhost:4173/
exit /b 0
