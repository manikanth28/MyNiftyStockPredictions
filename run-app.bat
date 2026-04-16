@echo off
setlocal EnableExtensions EnableDelayedExpansion

set "ROOT_DIR=%~dp0"
set "APP_URL=http://localhost:3000"
set "SERVER_TITLE=Stock Recommendation App"
cd /d "%ROOT_DIR%"

where npm >nul 2>nul
if errorlevel 1 (
  echo Node.js and npm are required to run this app.
  echo Install Node.js from https://nodejs.org/ and try again.
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
if not errorlevel 1 (
  echo The app is already running. Opening browser...
  start "" "%APP_URL%"
  exit /b 0
)

echo Starting the dashboard server in a new window...
start "%SERVER_TITLE%" cmd /k "cd /d ""%ROOT_DIR%"" && npm run dev:web"

echo Waiting for the app to become available...
set /a ATTEMPTS=0

:wait_for_server
call :is_port_listening
if not errorlevel 1 goto open_browser

set /a ATTEMPTS+=1
if !ATTEMPTS! GEQ 30 (
  echo The app did not start in time.
  echo Check the "%SERVER_TITLE%" window for errors.
  pause
  exit /b 1
)

timeout /t 2 /nobreak >nul
goto wait_for_server

:open_browser
echo Opening browser...
start "" "%APP_URL%"
exit /b 0

:is_port_listening
netstat -ano | findstr /r /c:":3000" | findstr /c:"LISTENING" >nul
exit /b %errorlevel%

