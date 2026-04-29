@echo off
setlocal EnableExtensions EnableDelayedExpansion

set "ROOT_DIR=%~dp0"
set "SERVER_TITLE=Stock Monitoring Test Server"
if not defined APP_URL set "APP_URL=http://localhost:3000"
if not defined APP_PORT set "APP_PORT=3000"
set "RUN_SCHEDULER=0"
set "OPEN_MONITORING=0"

:parse_args
if "%~1"=="" goto args_done
if /I "%~1"=="--scheduler" set "RUN_SCHEDULER=1"
if /I "%~1"=="/scheduler" set "RUN_SCHEDULER=1"
if /I "%~1"=="--open" set "OPEN_MONITORING=1"
if /I "%~1"=="/open" set "OPEN_MONITORING=1"
if /I "%~1"=="--help" goto help
if /I "%~1"=="/?" goto help
shift
goto parse_args

:args_done
cd /d "%ROOT_DIR%"

echo.
echo === Stock monitoring smoke test ===
echo App URL: %APP_URL%
echo.

where npm >nul 2>nul
if errorlevel 1 (
  echo Node.js and npm are required.
  echo Install Node.js from https://nodejs.org/ and try again.
  goto fail
)

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is required.
  goto fail
)

if not exist "%ROOT_DIR%node_modules" (
  echo Installing dependencies...
  call npm install
  if errorlevel 1 goto fail
)

echo.
echo [1/6] Running web typecheck...
call npm run test:web
if errorlevel 1 goto fail

echo.
echo [2/6] Running API tests...
where python >nul 2>nul
if errorlevel 1 (
  echo Python is required for API tests.
  goto fail
)
call npm run test:api
if errorlevel 1 goto fail

echo.
echo [3/6] Checking scheduler script syntax...
call node --check scripts\refresh-market-data.mjs
if errorlevel 1 goto fail

echo.
echo [4/6] Ensuring web app is running...
call :is_port_listening
if errorlevel 1 (
  echo Starting the web app in a new window...
  start "%SERVER_TITLE%" /min cmd /k "cd /d ""%ROOT_DIR%"" && npm run dev:web"
  call :wait_for_server
  if errorlevel 1 goto fail
) else (
  echo Web app is already listening on port %APP_PORT%.
)

echo.
echo [5/6] Checking monitoring page and APIs...
call :check_monitoring_page
if errorlevel 1 goto fail
call :check_monitoring_api
if errorlevel 1 goto fail
call :check_refresh_status
if errorlevel 1 goto fail
call :check_health
if errorlevel 1 goto fail

echo.
echo [6/6] Scheduler POST smoke test...
if "%RUN_SCHEDULER%"=="1" (
  echo Running npm run daily:market-scan.
  echo Note: if the market is open and the saved batch is stale, this may run a real refresh.
  call npm run daily:market-scan
  if errorlevel 1 goto fail
) else (
  echo Skipped by default. Re-run with --scheduler to include it.
)

if "%OPEN_MONITORING%"=="1" (
  echo Opening monitoring page...
  start "" "%APP_URL%/monitoring"
)

echo.
echo Monitoring smoke test passed.
echo View the dashboard at %APP_URL%/monitoring
pause
exit /b 0

:check_health
echo.
echo GET /api/healthz
powershell -NoProfile -ExecutionPolicy Bypass -Command "$ErrorActionPreference='Stop'; $payload=Invoke-RestMethod -Uri '%APP_URL%/api/healthz' -TimeoutSec 30; $payload | ConvertTo-Json -Depth 5"
exit /b %errorlevel%

:check_monitoring_page
echo.
echo GET /monitoring
powershell -NoProfile -ExecutionPolicy Bypass -Command "$ErrorActionPreference='Stop'; $response=Invoke-WebRequest -UseBasicParsing -Uri '%APP_URL%/monitoring' -TimeoutSec 60; if ($response.StatusCode -lt 200 -or $response.StatusCode -ge 300) { throw \"Monitoring page returned HTTP $($response.StatusCode).\" }; [pscustomobject]@{ statusCode=$response.StatusCode; bytes=$response.Content.Length } | Format-List"
exit /b %errorlevel%

:check_monitoring_api
echo.
echo GET /api/monitoring
powershell -NoProfile -ExecutionPolicy Bypass -Command "$ErrorActionPreference='Stop'; $payload=Invoke-RestMethod -Uri '%APP_URL%/api/monitoring' -TimeoutSec 60; [pscustomobject]@{ status=$payload.status; currentBatch=$payload.freshness.currentBatchDate; expectedBatch=$payload.freshness.expectedBatchDate; alerts=@($payload.alerts).Count; sourceLayers=@($payload.sourceHealth).Count; events=@($payload.events).Count } | Format-List"
exit /b %errorlevel%

:check_refresh_status
echo.
echo GET /api/refresh-market-data
powershell -NoProfile -ExecutionPolicy Bypass -Command "$ErrorActionPreference='Stop'; $payload=Invoke-RestMethod -Uri '%APP_URL%/api/refresh-market-data' -TimeoutSec 60; [pscustomobject]@{ state=$payload.state; phase=$payload.phase; shouldRefresh=$payload.readiness.shouldRefresh; expectedBatch=$payload.readiness.expectedBatchDate; latestBatch=$payload.readiness.latestBatchDate; recentRuns=@($payload.automationRuns).Count } | Format-List"
exit /b %errorlevel%

:wait_for_server
set /a ATTEMPTS=0

:wait_for_server_loop
call :is_port_listening
if not errorlevel 1 exit /b 0

set /a ATTEMPTS+=1
if !ATTEMPTS! GEQ 45 (
  echo The app did not start in time.
  echo Check the "%SERVER_TITLE%" window for errors.
  exit /b 1
)

timeout /t 2 /nobreak >nul
goto wait_for_server_loop

:is_port_listening
netstat -ano | findstr /r /c:":%APP_PORT%" | findstr /c:"LISTENING" >nul
exit /b %errorlevel%

:help
echo.
echo Usage:
echo   test-monitoring.bat [--scheduler] [--open]
echo.
echo Options:
echo   --scheduler   Also run npm run daily:market-scan. This may trigger a real market refresh if due.
echo   --open        Open %APP_URL%/monitoring after tests pass.
echo.
echo Environment:
echo   APP_URL       Override app URL. Default: http://localhost:3000
echo   APP_PORT      Override port readiness check. Default: 3000
exit /b 0

:fail
echo.
echo Monitoring smoke test failed.
pause
exit /b 1
