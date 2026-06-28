---
name: git-commit
description: Manually stage and commit workspace changes. Activate when the user type /commit, asks to commit changes, or says things like "commit our work".
---

# Git Commit Manual Command

This skill allows the user to manually stage and commit their code modifications.

## Workflow

1.  **Check status**: Run `git status` to see what files are modified or untracked.
2.  **Update project status**: **ОБЯЗАТЕЛЬНО** проанализируйте изменения кода и обновите файл `_app/project_status.md` (раздел реализованного функционала, архитектуры или локального запуска), чтобы он точно отражал текущее состояние проекта после ваших изменений.
3.  **Display status**: Present the modified files to the user (including the updated `_app/project_status.md`) and explain what changes are going to be committed.
4.  **Draft commit message**: Propose a clean Conventional Commit message in English (e.g. `feat(client): add release info tab`) with a short summary in Russian for the user.
5.  **Get confirmation**: Ask the user if they agree with the commit message and the files to be staged.
6.  **Execute commit**: If they approve, run:
    ```bash
    git add -A
    git commit -m "commit_message_here"
    ```
7.  **Report success**: Tell the user that the changes have been successfully committed and that `_app/project_status.md` has been kept up-to-date.
