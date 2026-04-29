@echo off
setlocal EnableExtensions EnableDelayedExpansion

set "ROOT_DIR=%~dp0"
set "APP_URL=http://localhost:3000"
set "APP_PORT=3000"
set "SERVER_TITLE=Stock App Server For Portfolio Bot"
set "BOT_TITLE=Stock Portfolio Bot"

cd /d "%ROOT_DIR%"

where npm >nul 2>nul
if errorlevel 1 (
  echo Node.js and npm are required to run the portfolio bot.
  pause
  exit /b 1
)

if not exist "%ROOT_DIR%node_modules" (
  echo Installing dependencies...
  call npm install
  if errorlevel 1 (
    echo Failed to install dependencies.
    pause
    exit /b 1
  )
)

call :is_port_listening
if errorlevel 1 (
  echo Starting the web/API server in a minimized window...
  start "%SERVER_TITLE%" /min cmd /k "cd /d ""%ROOT_DIR%"" && npm run dev:web"
  call :wait_for_server
  if errorlevel 1 (
    echo The web/API server did not start in time.
    pause
    exit /b 1
  )
) else (
  echo Web/API server is already listening on port %APP_PORT%.
)

echo Starting the portfolio bot loop in a minimized window...
start "%BOT_TITLE%" /min cmd /k "cd /d ""%ROOT_DIR%"" && npm run portfolio:bot:loop"
echo Portfolio bot started. Reports will be written under data\trading-reports.
pause
exit /b 0

:wait_for_server
set /a ATTEMPTS=0

:wait_for_server_loop
call :is_port_listening
if not errorlevel 1 exit /b 0

set /a ATTEMPTS+=1
if !ATTEMPTS! GEQ 45 exit /b 1

timeout /t 2 /nobreak >nul
goto wait_for_server_loop

:is_port_listening
netstat -ano | findstr /r /c:":%APP_PORT%" | findstr /c:"LISTENING" >nul
exit /b %errorlevel%
