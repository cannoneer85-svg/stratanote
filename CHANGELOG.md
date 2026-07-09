# Changelog

## [1.9.0] - 2026-07-09
### Media chunked uploads, collision prompt and localized history UI

- Chunked Media Upload: Implemented chunked binary uploads (5MB blocks) to bypass payload limits for files larger than 300MB.
- Conflict-Aware Media Uploads: Added file existence check and confirmation dialog to overwrite, rename (with safe _1 suffixes to prevent markdown links breakage), or cancel.
- Dynamic Image Previews: Automatically request resized 800px image thumbnails in preview mode to optimize network loading.
- Note Trash Bin: Deleted notes are archived in the SQLite trash database, preserving content and full revision history for recovery.
- Owner and Revision Synchronization: Sync owner metadata and full revision history between local sync agent and server.
- Version History UI: Enabled local version numbering (Version #1, #2, etc.) per note, highlighted the current version, and hid the redundant restore button for the active version.

## [1.8.0] - 2026-07-09
### Metadata and Version History Sync

- Two-way note owner (created_by, last_edited_by) and SQLite version history synchronization.
- Fixed race condition with watcher due to missing basename import in the /api/sync/push endpoint.
- Auto-installation of sqlite3 dependency when starting the local sync agent.

## [1.7.0] - 2026-07-09
### Full localization, media optimization, and hotkeys

- Added full English and Russian localization for all settings panel tabs and notifications popover
- Implemented on-the-fly image thumbnail generation and caching using the sharp library
- Added lazy client-side video frame capture using IntersectionObserver and HTML5 Canvas
- Implemented responsive layout, visual hover auto-playback, and play button badge overlays for videos
- Added Ctrl+S (Cmd+S) keyboard shortcut to save document edits immediately in any layout
- Added document icon styling and nesting depth support for markdown list items

## [1.6.0] - 2026-07-06
### Bilingual Support (RU/EN) and Centralized Localization System

- Added full interface translation support for Russian and English languages.
- Introduced a centralized type-safe translations dictionary (translations.ts) for easy integration of future languages.
- Updated repository documentation with a comprehensive English README.md including Mermaid architecture diagrams.
- Added a language selector dropdown inside the settings panel.
- Handled dynamic translation of external system authors and localized CRUD operation warnings.

## [1.5.0] - 2026-07-06
### API Token Generator and WebSocket Security Updates

- Added custom API token generator with selectable lifespan (from 1 day to 10 years) in sync settings.
- Extended default user session lifetime from 24 hours to 7 days.
- Implemented strict JWT verification for local sync agent connections via WebSockets.
- Added instant real-time device status updates using Socket.io broadcasting.
- Fixed a bug where device status was not updated to 'offline' when socket disconnected.

## [1.4.1] - 2026-07-04
### Fix repository path in auto-publish script

- Fixed GitHub API release publication URL parsing by stripping trailing slashes.

## [1.4.0] - 2026-07-04
### MCP Integration, Local Graph, Review Mode, and Secure Sync

- Full Model Context Protocol (MCP) server in _sync_mcp folder for local file integration and two-way sync.
- Interactive real-time progress bar and manual sync execution logs in administration panel.
- Windows file path normalization for 100% compatibility with Linux server.
- Strict directory exclusions (_sync_mcp, node_modules, .agents) for synchronization and ZIP export.
- Review Mode (Suggest Mode) with roles authorization and real-time notifications.
- Responsive mobile UI layout and smooth sidebar resizing (Ghost Line).
- Graph semantic connections optimization with KNN Top-3 filter and default 85% similarity threshold.
- Fixed race condition in local file edits to preserve correct user authorship.
- Auto-indexing vector embeddings on startup if database is empty.

## [1.3.0] - 2026-07-01
### Local Semantic Connections, Interactive Mermaid Diagrams, and UX Improvements

- Local semantic similarity calculation using vector embeddings (Transformers.js) without external APIs.
- Interactive graph with logarithmic node scaling, camera focus stability, counter badges, and folder tree filter.
- Interactive Mermaid diagram viewer modal with full pan & zoom support.
- Automatic editorial scroll synchronization in editor mode.
- Quick action button to download current note as Markdown.
- ZIP archive export with Moscow time zone (UTC+3) file metadata timestamps.
- Fixed blockquote rendering, Mermaid sequence diagrams, and subgraph ID escaping.

## [1.2.1] - 2026-06-29
### StrataNote Rebranding and GitHub Release Automation

- Completed full project rebranding to StrataNote across codebase, configs, and UI.
- Added new purple logo and high-quality transparent icon.
- Configured automated release publishing on GitHub API with secure token loading.

## [1.2.0] - 2026-06-28
### Media File Filtering and New Build Rules

- Added quick category filters (All, Images, Videos, Others) in administrative media manager.
- Implemented automatic item count calculation for each media category.
- Introduced mandatory AI auto-build guidelines to keep local dev builds up-to-date.
- Cleaned up .gitignore rules to prevent committing personal config files.

## [1.1.0] - 2026-06-28
### Repository Optimization and Dynamic Environment

- Repository structure optimization: moved scripts to _app/scripts/ and cleaned up root.
- Deployment automation: postinstall hook in package.json to build subfolders on CI/CD platforms.
- Fixed production build by ensuring client devDependencies are installed for TypeScript compiler (tsc).
- Dynamic server runtime environment determination (Production / Development) based on server NODE_ENV.
- Added deployment guidelines and DATABASE_PATH configure instructions in README.md.
- Configured project-scoped status reading guidelines for AI agents in AGENTS.md.

## [1.0.0] - 2026-06-28
### First Stable Release

- CodeMirror 6 based Markdown editor with wikilinks syntax highlighting.
- Canvas-based interactive 2D graph of note connections using D3.js.
- Real-time user presence sync and document lock conflict prevention via WebSockets.
- Chunked ZIP archive exports supporting 300MB+ vault downloads with flexible configurations.
- User administration panel (approvals, role management) and physical media assets deletion.
- Obsidian Callouts rendering (note, tip, warning, important, caution) and Mermaid diagrams.
