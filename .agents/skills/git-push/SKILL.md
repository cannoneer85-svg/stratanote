---
name: git-push
description: Manually push committed changes to GitHub. Activate when the user type /push, asks to push changes to GitHub, or says things like "push to remote".
---

# Git Push Manual Command

This skill allows the user to manually push their committed work to the remote repository.

## Workflow

1.  **Check current branch**: Run `git branch --show-current` to find the active branch.
2.  **Check status**: Run `git status` to see if there are any unpushed commits or uncommitted changes.
3.  **Confirm with user**: Ask the user for confirmation to push the active branch to `origin`.
4.  **Execute push**: If they approve, run:
    ```bash
    git push origin <active_branch>
    ```
5.  **Report success**: Inform the user about the successful push.
