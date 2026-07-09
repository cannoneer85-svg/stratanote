---
name: release
description: Prepare a new release of StrataNote. Activate when the user types /release or asks to "оформить релиз" or "подготовить релиз".
---

# Release Preparation Workflows

This skill automates the release process for StrataNote.

## Workflow

1.  **Analyze changes**:
    - Find the last Git tag: `git describe --tags --abbrev=0` (handle fallback if no tags exist).
    - Get commits since the last tag: `git log <last_tag>..HEAD --oneline` (or all commits if no tags exist).
    - Read `package.json` to get the current version.
2.  **Determine SemVer increment**:
    - Parse commit messages to recommend:
      - `MAJOR` if there are breaking changes (e.g. `feat!:` or `BREAKING CHANGE:`).
      - `MINOR` if there are feature commits (e.g. `feat:`).
      - `PATCH` if there are only bugfixes/chores/docs (e.g. `fix:`, `docs:`, `chore:`).
3.  **Collect Bilingual Keynotes**:
    - Summarize the commits since the last release into bullet points in both English and Russian.
4.  **Review and Update Documentation**:
    - Analyze if the release commits contain changes affecting the repository structure, project stack, local sync configuration, APIs, or installation flow.
    - If so, the agent **MUST** proactively update both `README.md` (English) and `README.ru.md` (Russian) to match the new architecture before proceeding.
5.  **Propose release package**:
    - Show the recommended new version (e.g. `1.5.0`), titles, keynotes for both languages, and any proposed README modifications.
    - Ask the user to confirm.
6.  **Run release script**:
    - If approved, run the release script to update `package.json` files, `releases.json`, and `CHANGELOG.md` with bilingual details:
      ```bash
      node _app/scripts/prepare-release.js <new_version> <date> --title_en "<title_en>" --title_ru "<title_ru>" --keynotes_en "EN Keynote 1" "EN Keynote 2" --keynotes_ru "RU Keynote 1" "RU Keynote 2"
      ```
7.  **Create release commit, tag, and push**:
    - Present the file modifications.
    - Ask confirmation to commit, tag, and push to both private (origin) and public (open) remotes.
    - **Crucial Security Rule:** To prevent pushing private development history and drafts to the public repository, the push to `open` remote MUST be done as a flat squashed release commit using a temporary orphan branch.
    - Run the following commands:
      ```bash
      # 1. Сделать коммит локальных изменений версий
      git add -A
      git commit -m "chore(release): v<new_version>"
      
      # 2. Создать тег локально
      git tag v<new_version>
      
      # 3. Отправить полную историю коммитов и тег в приватный репозиторий:
      git push origin master --tags
      
      # 4. Отправить чистый «плоский» коммит релиза и тег в публичный репозиторий:
      git checkout --orphan temp-open-release
      git add -A
      git commit -m "release: v<new_version>"
      git tag -f v<new_version>
      git push open temp-open-release:master --force --tags
      
      # 5. Вернуться обратно в master и удалить временную ветку:
      git checkout master
      git branch -D temp-open-release
      ```
8.  **Publish to GitHub Releases**:
    - Run the API release publication script:
      ```bash
      node _app/scripts/prepare-release.js --publish <new_version>
      ```
