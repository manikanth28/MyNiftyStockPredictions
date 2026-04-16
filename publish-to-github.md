# Publish to GitHub

This project already ignores `node_modules`, so it will not be pushed as long as `.gitignore` stays in place. The publish script also removes `node_modules` from Git tracking if it was accidentally tracked earlier.

## Files used

- `publish-to-github.bat` - checks changes, shows the diff, commits, and pushes
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
7. Checks for uncommitted changes
8. Shows `git status`, diff summary, and full diff
9. Asks whether to continue
10. Creates a commit if there are file changes
11. Sets the branch to `main`
12. Adds or updates the `origin` remote
13. Pushes to GitHub

## What happens each time you click it

1. It stages current changes
2. If file changes exist, it shows the diff before pushing
3. You confirm the publish
4. It commits and pushes the changes
5. If there are no file changes, it skips commit and only pushes any existing local commits

## If push fails

- If Git asks for username/email, fill `GIT_USER_NAME` and `GIT_USER_EMAIL` in the batch file
- If Git asks for authentication, sign in with your GitHub credentials or token
- If the remote already exists, the script updates it automatically
