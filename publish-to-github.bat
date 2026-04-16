@echo off
setlocal

REM ==================================================
REM EDIT ONLY THESE VALUES BEFORE RUNNING THIS FILE
set "REMOTE_URL=https://github.com/manikanth28/MyNiftyStockPredictions.git"
set "BRANCH_NAME=main"
set "COMMIT_MESSAGE=Initial project import"
set "GIT_USER_NAME=manikanth"
set "GIT_USER_EMAIL=manikanthchitturi@gmail.com"
REM Leave GIT_USER_NAME and GIT_USER_EMAIL blank if you
REM already configured them globally in Git.
REM ==================================================

cd /d "%~dp0"

where git >nul 2>&1
if errorlevel 1 (
  echo [ERROR] Git is not installed or not available in PATH.
  pause
  exit /b 1
)

if not exist ".gitignore" (
  echo [ERROR] .gitignore not found in %CD%.
  echo Create it before running this script so node_modules, .next, and secrets are not committed.
  pause
  exit /b 1
)

git rev-parse --is-inside-work-tree >nul 2>&1
if errorlevel 1 (
  echo [INFO] Initializing repository...
  git init
  if errorlevel 1 goto :fail
) else (
  echo [INFO] Git repository already exists.
)

if defined GIT_USER_NAME (
  echo [INFO] Setting local git user.name...
  git config user.name "%GIT_USER_NAME%"
  if errorlevel 1 goto :fail
)

if defined GIT_USER_EMAIL (
  echo [INFO] Setting local git user.email...
  git config user.email "%GIT_USER_EMAIL%"
  if errorlevel 1 goto :fail
)

echo [INFO] Staging files...
git add .
if errorlevel 1 goto :fail

echo [INFO] Ensuring node_modules is not tracked...
git rm -r --cached --ignore-unmatch node_modules >nul 2>&1
if errorlevel 1 goto :fail

echo [INFO] Checking for uncommitted changes...
git diff --cached --quiet >nul 2>&1
if errorlevel 1 (
  echo.
  echo [INFO] Uncommitted changes found:
  git --no-pager status --short
  if errorlevel 1 goto :fail

  echo.
  echo [INFO] Diff summary:
  git --no-pager diff --cached --stat
  if errorlevel 1 goto :fail

  echo.
  echo [INFO] Full diff:
  git --no-pager diff --cached
  if errorlevel 1 goto :fail

  echo.
  choice /M "Continue with commit and push"
  if errorlevel 2 (
    echo [INFO] Publish cancelled by user.
    pause
    exit /b 0
  )

  echo [INFO] Creating commit...
  git commit -m "%COMMIT_MESSAGE%"
  if errorlevel 1 (
    echo [ERROR] Commit failed. Fill GIT_USER_NAME and GIT_USER_EMAIL above if Git asks for identity.
    pause
    exit /b 1
  )
) else (
  echo [INFO] No uncommitted file changes found. Continuing with push.
)

echo [INFO] Setting branch name to %BRANCH_NAME%...
git branch -M %BRANCH_NAME%
if errorlevel 1 goto :fail

git remote get-url origin >nul 2>&1
if errorlevel 1 (
  echo [INFO] Adding origin remote...
  git remote add origin "%REMOTE_URL%"
  if errorlevel 1 goto :fail
) else (
  echo [INFO] Updating origin remote...
  git remote set-url origin "%REMOTE_URL%"
  if errorlevel 1 goto :fail
)

echo [INFO] Pushing to GitHub...
git push -u origin %BRANCH_NAME%
if errorlevel 1 (
  echo [ERROR] Push failed. Make sure GitHub authentication is set up and you have access to %REMOTE_URL%.
  pause
  exit /b 1
)

echo [DONE] Project is mapped and pushed to %REMOTE_URL%.
pause
exit /b 0

:fail
echo [ERROR] A git command failed. Fix the message above and run the script again.
pause
exit /b 1
