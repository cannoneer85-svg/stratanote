# Changelog

## [1.14.0] - 2026-07-19
### Tags Sidebar, Templates Security and I18n Auto-Generation

- Tags Explorer & Sidebar: Added a new Tags tab to sidebar, inline preview chips for tags in document viewer, strict tag search API, and dynamic relationships mapping on the interactive graph.
- Access Control & Security for Templates: Enforced strict templates access boundaries on backend endpoints (read, update, comments, versions). Non-admin users are restricted to their own subfolders (Templates/<username>/).
- Templates I18n Auto-Generation: Refactored templates initialization into a standalone module and added default language adaptivity (generating English or Russian defaults based on system settings).
- SQLite Defaults Constraint Fix: Resolved FOREIGN KEY SQLite constraints on global defaults (user_id = 0) by seeding a dedicated system user record.
- Superadmin Protection & Delete Lock: Restricted deletion of the primary superadministrator account (admin).
- Graph Enhancements: Restored uniform pastel purple document node coloring and added an animated loading spinner during graph data fetching.

## [1.13.7] - 2026-07-18
### Comprehensive API Reference Documentation and Expanded User Guides

- Add comprehensive JSDoc comments to all React components and utility functions.
- Restructure the API Reference section into clean logical categories (Core, Components, Date Utilities, translations).
- Add auto-generated descriptions and clean sidebar navigation names (sidebarTitle frontmatter) for all API modules.
- Implement breadcrumb back-navigation to parent module indexes across all technical detail pages.
- Overhaul the documentation welcome homepage layout with local neon logo illustration.
- Expand user guides covering installation instructions, CodeMirror 6 markdown editor, connection graph, backups, and web administration dashboards.

# Changelog

## [1.13.6] - 2026-07-18
### Mintlify Integration and Media Panel Enhancements

- Integrate automated formatting and copying of CHANGELOG.md for Mintlify docs.
- Add configuration for Mintlify AI Agent rules (.mintlify/AGENTS.md) to protect API references.
- Support sorting and pagination for media files inside the settings panel.
- Add horizontal mouse wheel scroll for tabs and support Escape key to close settings.
- Optimize self-hosted runner CI workflow using hard resets for fast deployments.

# Changelog

## [1.13.5] - 2026-07-18
### User Guides SEO and Description Enhancements

- Integrate and merge SEO improvements for MDX documentation pages.
- Expand page descriptions in user guides to optimize search relevance.

## [1.13.4] - 17.07.2026
### Mintlify Auto-Documentation and CRLF Sync Normalization

- Automated Mintlify documentation setup integration with dynamic API references.
- Dynamically resolved GitHub repository source links inside API documents.
- Corrected relative link resolving and stripped .md extensions for clean navigation.
- Translated technical guides and navigation structure to English.
- Fixed raw file hash validation and CRLF line ending differences to prevent false 409 Conflicts.
- Optimized watcher file content comparison to prevent duplicate External System versions.

## [1.13.3] - 2026-07-16
### Search Bugfixes and Automated Mintlify Documentation Integration

- Fixed search duplication and escaped HTML entities in snippets.
- Added server-side folder filter support in watcher.
- Integrated automated technical API reference generation using TypeDoc.
- Created comprehensive user guides on Mintlify with visual placeholder cards.
- Configured GitHub Actions workflow for automatic documentation deployments.

## [1.13.3] - 2026-07-16
### Search Reliability and Folder Filtering

- Fixed search results duplication in SQLite FTS5 index caused by auto-save updates.
- Added HTML-escaping to search snippets to prevent interface distortion from special characters.
- Implemented server-side folder filtering to prevent valid results from being cut off by the search limit.
- Synchronized manual database reindexing to rebuild both full-text and semantic indexes.

## [1.13.2] - 2026-07-15
### Code Style and Formatting Cleanup in Editor

- Cleaned up code formatting and layout alignment inside the client Editor.tsx component.

## [1.13.1] - 2026-07-14
### Support Configurable External Vault Folder

- Added support for loading the VAULT_PATH environment variable from .env at startup.
- Configured relative paths to resolve relative to the repository root directory.
- Untracked config.json in the sync agent directory from Git and added config.template.json.
- Updated README.md and README.ru.md with detailed instructions.

## [1.13.0] - 2026-07-12
### Global Full-Text and Semantic Search with Directory Filtering

- Implemented global full-text search (SQLite FTS5) with search term highlighting and snippets rendering.
- Implemented AI-based semantic search using local paraphrase-multilingual-MiniLM-L12-v2 model with cosine similarity matching.
- Added folder filtering dropdown allowing users to dynamically exclude root directories (including root-level files) from search results.
- Preserved sidebar explorer folder expansion state when local folder search query is entered and cleared.
- Added AI search reindexing dashboard with WebSocket-based real-time progress indicators in the synchronization settings.

## [1.12.1] - 2026-07-12
### Static Update Indicator

- Removed the pulsing animation from the sidebar's update indicator for a cleaner and less distracting user interface.

## [1.12.0] - 2026-07-12
### GitHub Update Checker and Advanced Commenting

- Integrated an automatic and manual update checker querying the GitHub API for new releases of StrataNote.
- Implemented background checking, local caching (1-hour TTL), and an API endpoint /api/version/check to check for updates.
- Added UI indicators: a pulsing update warning badge in the sidebar footer, a download alert banner in the About dialog, and a manual update checker box in the Settings panel (under the \
- System\ tab).
- Preserved native browser text selection when clicking \
- Comment\ by memoizing the preview container.
- Added commenting support to CodeMirror Edit mode and Suggestion original/suggested diff views.
- Cleaned up the release workflow to only push to the public GitHub repository.

## [1.11.1] - 2026-07-11
### Preserve Selection and All-Views Commenting

- Preserved native browser text selection highlighting when the 'Comment' tooltip is shown by memoizing the HTML preview container.
- Added text selection commenting support to Edit mode (CodeMirror) and Suggestion original/suggested view modes.

# Changelog

## [1.11.0] - 2026-07-11
### v1.11.0 - Collaborative Comments & Moderation

- Implement document commenting system with root comments and nested replies
- Implement comment moderation workflow with Admin and Owner approval
- Add real-time notifications read and dismiss tracking
- Implement automatic reopening of resolved comment threads when a new reply is posted
- Add automatic cascade resolution of nested replies when resolving parent comment
- Cascade deletion of comment replies in database using SQLite foreign keys
- Dynamic counter badge on toolbar (purple for active unresolved comments, grey for resolved archive comments)
- Fix timestamp timezone offsets between SQLite (UTC) and browser timezone
- Fix toolbar button layout to prevent badge clipping due to horizontal scrolling

## [1.10.0] - 2026-07-11
### Dynamic Sync & Media Management Polish

- Dynamic sync mode and conflict strategy switching from the Admin UI
- Disk hash caching to accelerate initial repository scanning to under 100ms
- Bulk media deletion, inline preview deletion, and orphaned file filters
- Interactive magnifier zoom effect on image preview hover
- Access control restrictions on external/admin documents for editor roles
- Robust binary validation preventing file corruption in conflict resolution
- Informative socket registration logs with delayed disconnection

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
