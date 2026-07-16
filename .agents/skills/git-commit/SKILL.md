---
name: git-commit
description: Manually stage and commit workspace changes. Activate when the user type /commit, asks to commit changes, or says things like "commit our work".
---

# Git Commit Manual Command

This skill allows the user to manually stage and commit their code modifications.

## Workflow

1.  **Check status**: Run `git status` to see what files are modified or untracked.
2.  **Update project status**: **ОБЯЗАТЕЛЬНО** проанализируйте изменения кода и обновите файл `_app/project_status.md` (раздел реализованного функционала, архитектуры или локального запуска), чтобы он точно отражал текущее состояние проекта после ваших изменений. **Важно:** даже если вы уже обновляли этот файл в процессе диалога, непосредственно перед коммитом вы обязаны заново проверить `git diff` и убедиться, что абсолютно все последние изменения (включая правки, сделанные в ходе обсуждений) полностью отражены в `project_status.md`.
3.  **Display status**: Present the modified files to the user (including the updated `_app/project_status.md`) and explain what changes are going to be committed.
4.  **Draft commit message**: Propose a clean Conventional Commit message in English with a short summary in Russian for the user.
    *   **Выбор правильного типа (tweak vs feat)**:
        *   Предлагайте `tweak(scope): ...` для мелких доработок, оптимизаций, донастройки UI или небольших изменений бизнес-логики существующих функций (например: `tweak(auth): restrict direct editing of external files`, `tweak(client): show app version on login screen`).
        *   Предлагайте `feat(scope): ...` **строго и только** для добавления полноценных новых крупных модулей или абсолютно нового функционала (например: `feat(trash): implement note trash bin with version recovery`).
        *   Предлагайте `fix(scope): ...` для исправления багов.
5.  **Get confirmation**: Ask the user if they agree with the commit message and the files to be staged.
6.  **Execute commit**: If they approve, run:
    ```bash
    git add -A
    git commit -m "commit_message_here"
    ```
7.  **Report success**: Tell the user that the changes have been successfully committed and that `_app/project_status.md` has been kept up-to-date.
