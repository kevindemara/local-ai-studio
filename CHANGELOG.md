# Changelog

## 0.2.2 — 2026-09-28

- Expanded the MCP catalog from 7 to 25 servers across productivity, design, monitoring, databases, documentation, web research and AI resources.
- Added connection-type filtering, guided browser sign-in through a pinned bridge, and isolated Python server setup with a Windows uv installer.
- Added Supabase project scoping/read-only defaults, optional Sentry organization/project scopes, read-only MongoDB/PostgreSQL defaults and isolated Chrome DevTools.
- Account keys remain environment references; bearer values are sent only to reviewed endpoints. OAuth caches live outside project folders in private user data.
- Added configuration/authentication regression checks and live discovery checks; provider account authorization still requires the user's own sign-in.

## 0.2.1 — 2026-09-28

- Expanded the reviewed model catalog from 5 to 11 options, with search, memory-fit and installed filters.
- Added a searchable seven-server MCP catalog and guided Connect buttons with prerequisites, access review, live tool discovery and per-project configurations.
- Added separate persistent-memory files per project, isolated Playwright browser sessions and read-only GitHub server defaults.
- Failed or cancelled catalog connections remain disabled; npm server versions are pinned and account key values are never saved in manifests.


## 0.2.0 — 2026-09-28

- Added a separate public source distribution and graphical Windows setup entry point.
- Added hardware-aware model guidance, prerequisite installation and streaming local-model downloads.
- Added account/repository onboarding, branches, sync, publishing and customizable changelog entries.
- Added trusted per-project MCP tools using the official client SDK and a bundled example server.
- Added measured token graphs, project overviews, filtered run history and private-safe diagnostics.
- Preserved connected builds, verification/repair, previews, selected-file commits, checkpoints and durable run recovery.
