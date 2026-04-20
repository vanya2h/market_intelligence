Analyze the current git status, prepare a commit plan, and execute it after user approval.

## Steps

1. **Analyze git status** — Run `git status` and `git diff --stat` to get a full picture of all staged, unstaged, and untracked changes. Group changes by type (modified, new, deleted, renamed).

2. **Prepare commit plan** — Present a clear summary to the user:
   - List all files that will be committed, grouped by change type
   - Suggest logical grouping if changes span unrelated areas (e.g., "commit all trading notes together, then research notes separately") — but default to a single commit if changes are related
   - Show the exact `git add` and `git commit` commands that will be executed

3. **Ask for approval** — Use AskUserQuestion to let the user confirm or adjust the plan before executing anything.

4. **Execute** — Stage and commit the approved changes:
   - Use `git add` with specific file paths (never `git add -A` or `git add .`)
   - Commit with a short, descriptive title (no description body, no co-author)
   - Run `git status` after to confirm success
