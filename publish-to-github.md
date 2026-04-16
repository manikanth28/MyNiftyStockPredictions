# Publish to GitHub

This project already ignores `node_modules`, so it will not be pushed as long as `.gitignore` stays in place.

## Files used

- `publish-to-github.bat` - runs the git setup and push
- `.gitignore` - already excludes `node_modules`, `.next`, `.env`, and other local/generated files

## What to edit before running

Open `publish-to-github.bat` and update these lines near the top:

1. `REMOTE_URL` - your GitHub repository URL
2. `BRANCH_NAME` - usually `main`
3. `COMMIT_MESSAGE` - your commit message
4. `GIT_USER_NAME` - only if Git is not already configured on your machine
5. `GIT_USER_EMAIL` - only if Git is not already configured on your machine

Current default repo:

```bat
https://github.com/manikanth28/MyNiftyStockPredictions.git
```

## How to run

From `C:\copilot`, do one of these:

1. Double-click `publish-to-github.bat`
2. Or open Command Prompt and run:

```bat
cd C:\copilot
publish-to-github.bat
```

## What the script does

1. Checks that Git is installed
2. Checks that `.gitignore` exists
3. Initializes Git if this folder is not already a repository
4. Sets local Git name/email if you filled them in
5. Runs `git add .`
6. Removes `node_modules` from the Git index if needed
7. Creates a commit
8. Sets the branch to `main`
9. Adds or updates the `origin` remote
10. Pushes to GitHub

## If push fails

- If Git asks for username/email, fill `GIT_USER_NAME` and `GIT_USER_EMAIL` in the batch file
- If Git asks for authentication, sign in with your GitHub credentials or token
- If the remote already exists, the script updates it automatically
