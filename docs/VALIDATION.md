# Validation notes

Version 0.2.2 preview, 2026-09-28.

- Automated checks cover real file boundaries, edits/reviews/undo, checkpoints, queue persistence, restart recovery, template connections, build repair, previews, process termination and selected-file Git commits.
- Public-workflow checks cover 16GB/dual-GPU/CPU/unified-memory recommendation fixtures, manifest validation, actual SDK calls to stdio and HTTP MCP servers, project trust/revocation/read-only behavior, split download progress/error/abort handling, job cancellation, usage accounting, clean-branch rules and changelog templates.
- Browser verification covers the setup stages, measured hardware display, installed-model selection, GitHub account/repository display, MCP discovery, history and responsive layout.
- Real local GPT-OSS inference passed the native-tool smoke check. A separate end-to-end website request created three connected source files, passed verification, served a working form and mobile menu, and produced recorded Ollama token metrics. This is a smoke test, not a general quality benchmark.
- The Windows PowerShell bootstrap was parsed for syntax and the launcher was exercised against the installed Node/Ollama environment. Installing prerequisites on a clean Windows VM and all GPU/driver combinations remains additional release testing.
- macOS/Linux paths are implemented; the six-job CI matrix exercises Node 22/24 on Windows, Ubuntu and macOS. CI does not validate GPU inference.
- The expanded catalog has 11 models and 25 common MCP setup flows. Tests cover server package pinning, environment-value privacy, per-project configuration, failure/cancellation cleanup and API access review. Model downloads and fit metadata are not task-quality benchmarks.
- Live Windows SDK checks discovered tools from the official Memory, Filesystem, Sequential Thinking, Playwright and Context7 packages. Memory writes survived reconnecting; Filesystem read an allowed fixture and rejected an outside path; Sequential Thinking returned a real tool result. The GUI Connect flow also discovered nine Memory tools. Playwright/Context7 discovery does not validate browser actions or remote documentation queries. GitHub and Brave account connections were not exercised without user credentials.

Never represent mocks as model quality benchmarks or estimate usage where Ollama did not provide metrics. A short native-tool/speed check is available in setup step 3; this is a smoke test, not a coding-quality comparison.

## Expanded MCP catalog checks

- All 52 automated tests pass locally, including a real SDK/HTTP fixture that verifies bearer headers while persisted metadata remains credential-free. Tests cover configuration validation, endpoint integrity, per-project OAuth cache paths, pinned runtime launchers and safe database/browser defaults.
- Live Windows tool discovery passed for Fetch (1), Time (2), Git (12), Chrome DevTools (30), Microsoft Learn (3), Cloudflare documentation (2), Hugging Face public tools (4), and the pinned mcp-remote bridge against Microsoft Learn (3). Actual local time and Git status calls passed. Git testing uses an initialized temporary fixture repository.
- Browser checks cover all 25 cards, category/search/connection-type filters, guided account-key and OAuth panels, project configuration fields and responsive layout.
- Browser OAuth provider grants and database/API-key services were not exercised without user account authorization. Bridge discovery against a public endpoint validates transport, not each provider's complete sign-in flow. Chrome DevTools discovery does not validate browser interactions.
