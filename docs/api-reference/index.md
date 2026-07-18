---
title: "API Reference Index"
sidebarTitle: "API Index"
description: "Technical API reference documentation for the StrataNote client-side modules, core React components, and utility functions."
---

Welcome to the technical API reference index for the **StrataNote** client. This section contains automatically generated documentation extracted from the codebase's JSDoc/TSDoc type signatures and documentation comments.

---

## Core Application Components

* **[App](/api-reference/App/index)** — Root container module for the StrataNote application. Orchestrates user authentication, WebSockets, navigation routing, locks broadcast, and dialogs.
* **[main](/api-reference/main/index)** — Client application entry point module. Mounts the React component tree inside the HTML root element.

---
## React Interface Components

* **[components/AboutModal](/api-reference/components/AboutModal/index)** — Diagnostic about modal module showing current build tags, license info, and update history details.
* **[components/Auth](/api-reference/components/Auth/index)** — Authentication and signup module handling forms submission and sessions checking.
* **[components/CommentsPanel](/api-reference/components/CommentsPanel/index)** — Comments side popover manager module handling replies, quotes, and approvals.
* **[components/DiffViewer](/api-reference/components/DiffViewer/index)** — Note versions diff visual comparison module highlighting added/removed lines.
* **[components/Editor](/api-reference/components/Editor/index)** — Markdown visual editor module powered by CodeMirror 6 with custom syntax plugins and scroll sync.
* **[components/ExportModal](/api-reference/components/ExportModal/index)** — Workspace backups exporter wizard module preparing zip archives.
* **[components/GraphView](/api-reference/components/GraphView/index)** — D3.js force connections 2D canvas visualization module.
* **[components/SearchModal](/api-reference/components/SearchModal/index)** — Unified full-text FTS5, conceptual semantic AI and title search overlay component module.
* **[components/SettingsPanel](/api-reference/components/SettingsPanel/index)** — Bilingual administration dashboards module covering registrations, trash, and MCP local sync configurations.
* **[components/Sidebar](/api-reference/components/Sidebar/index)** — Folders navigation tree explorer sidebar module containing workspace tools.
* **[components/TemplateModal](/api-reference/components/TemplateModal/index)** — Technical API reference for components/TemplateModal module.

---
## System Utilities & Core Functions

* **[utils/date](/api-reference/utils/date/index)** — Bilingual date formatting utilities mapping standard database UTC timestamps to Moscow timezone strings.
* **[utils/translations](/api-reference/utils/translations/index)** — Bilingual dictionaries and translations module enabling on-the-fly English/Russian switches.
