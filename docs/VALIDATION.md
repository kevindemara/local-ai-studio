# Validation notes

Version 0.2 preview, 2026-09-28.

- Automated checks cover real file boundaries, edits/reviews/undo, checkpoints, queue persistence, restart recovery, template connections, build repair, previews, process termination and selected-file Git commits.
- Public-workflow checks cover 16GB/dual-GPU/CPU/unified-memory recommendation fixtures, manifest validation, actual SDK calls to stdio and HTTP MCP servers, project trust/revocation/read-only behavior, split download progress/error/abort handling, job cancellation, usage accounting, clean-branch rules and changelog templates.
- Browser verification covers the setup stages, measured hardware display, installed-model selection, GitHub account/repository display, MCP discovery, history and responsive layout.
- The Windows PowerShell bootstrap was parsed for syntax and the launcher was exercised against the installed Node/Ollama environment. Installing prerequisites on a clean Windows VM and all GPU/driver combinations remains additional release testing.
- macOS/Linux paths are implemented; the six-job CI matrix exercises Node 22/24 on Windows, Ubuntu and macOS. CI does not validate GPU inference.

Never represent mocks as model quality benchmarks or estimate usage where Ollama did not provide metrics. A short native-tool/speed check is available in setup step 3; this is a smoke test, not a coding-quality comparison.
