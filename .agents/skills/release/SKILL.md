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
3.  **Collect Russian Keynotes**:
    - Summarize the commits since the last release into bullet points in Russian (Keynotes).
4.  **Propose release package**:
    - Show the recommended new version (e.g. `1.3.0`), title, and list of Keynotes.
    - Ask the user to confirm.
5.  **Run release script**:
    - If approved, run the release script to update `package.json` files, `releases.json`, and `CHANGELOG.md`:
      ```bash
      node _app/scripts/prepare-release.js <new_version> <date> <title> "Фича 1" "Фикс 2" ...
      ```
6.  **Create release commit, tag, and push**:
    - Present the file modifications.
    - Ask confirmation to commit, tag, and push to both private (origin) and public (open) remotes:
      ```bash
      git add -A
      git commit -m "chore(release): v<new_version>"
      git tag v<new_version>
      git push origin master --tags
      git push open master --tags
      ```
7.  **Publish to GitHub Releases**:
    - Run the API release publication script:
      ```bash
      node _app/scripts/prepare-release.js --publish <new_version>
      ```
