# Changelog

## 0.6.4 — 2026-10-08

- File-list tool responses now rank source paths against the current request so relevant files appear before unrelated folders in large projects. Added a regression check for focused listings.

## 0.6.3 — 2026-10-08

- Removed the default 40-round Build cutoff. Runs now continue across productive model calls until completion or cancellation, with optional per-project round/time limits.
- When a Build reply fills its context, Studio retries up to three times with compacted context in the same run. Small-context Qwen builds skip extended reasoning so more tokens remain for file actions.
- Bounded file listings, code maps and Build file reads to prevent large tool responses from crowding out the next action. Checkpoints preserve a recent tool excerpt, and repeated identical tool calls stop with a specific no-progress error.
- Added a direct Build context settings button beside incomplete replies and clarified long-task controls in Project hub.

## 0.6.2 — 2026-10-07

- Added a persistent Build activity strip showing the current stage, elapsed time and last model activity. Loading, reasoning and answer streaming now have distinct labels.
- Reserved more room for model output in small contexts and retried once with less source context when a model reached its context limit before answering.
- Context-limited runs are marked incomplete with a clear explanation instead of appearing finished with a blank reply. Previous affected runs are corrected when Studio restarts.

## 0.6.1 — 2026-10-07

- Fixed Build mode rejecting a normal project because a nested folder exceeded an overly shallow checkpoint scan. Checkpoints still enforce file-count and 128 MB limits.
- Trimmed automatic project context to fit the selected model's role context, keeping the latest request available on larger projects.
- Build setup errors now show a failed phase instead of remaining labeled “Queued.”
- Restored WAV assets as binary data when rolling a project back to a checkpoint.

## 0.6.0 — 2026-10-03

- Added optional local audio generation for game sound effects, music and spoken voice using MOSS SoundEffect v2, ACE-Step 1.5 and Qwen3-TTS VoiceDesign. The Sound panel saves WAV clips into the selected project and plays them back; Build mode can create audio assets through a project tool.
- Added a Windows NVIDIA audio installer that keeps model weights and isolated Python environments outside the release checkout. Audio jobs unload Ollama chat models, run one at a time, and preserve previous project files for undo.
- Added audio file browsing and playback, bounded generation inputs and regression checks. Model weights are never included in the repository or release archive.

## 0.5.3 — 2026-09-29

- Fixed Qwen continuations after large project reads: file excerpts are bounded, context checkpoints now follow the selected model's context size, and the latest user request remains the final message sent to Ollama.
- Checkpoints retain a short read excerpt and the next line number so an interrupted build can continue from saved files without repeatedly rereading the same large source.

## 0.5.2 — 2026-09-29

- Replaced the separate Windows folder dialog with an in-app folder browser, so project folder selection cannot leave Choose disabled behind a hidden native window. Includes home/drive shortcuts, parent navigation, direct paths, cancellation and recoverable loading errors; works on Windows, macOS and Linux.

## 0.5.1 — 2026-09-28

- Model removal now waits for the recorded job result and refreshes installed model choices on success, so a removed tag is not left in the chat selector. Failures remain visible.

## 0.5.0 — 2026-09-28

- Added Code & workflow with a searchable source symbol/import map, reverse dependencies, source-line navigation and a read-only code-map tool for the agent.
- Added agent edit boundaries with allowed/protected path patterns, enforced on writes, edits, moves and trash; bypass-capable agent tools and automatic checks/preview are disabled while scoped.
- Added ordered existing package-script quality gates, real saved output, cancellation and integration with agent verification/repair, plus a TODO/FIXME navigator that creates task cards.
- Added reviewed multi-file literal replacement with counts, original/proposed content, stale-file preflight, tracked backups and recovery for partial failures where safe.
- Added installed model metadata/storage management with exact-tag removal confirmation, and Eco/Balanced/Warm memory plus Auto/CPU request settings.
- Added reviewed Plan-to-Build handoff with approved-plan provenance, chat pins/tags/archive/restore and configurable wall-clock/model-round limits with saved-work recovery.
- Documented another twenty researched candidates, the ten shipped additions and practical limits. Existing defaults, user projects and chats are preserved. No additional models or runtime dependencies are installed.

## 0.4.0 — 2026-09-28

- Added Project hub with a local text/Markdown/JSON knowledge library, bounded keyword retrieval, stable reference IDs and visible source excerpts.
- Added full-content context ranking, an excerpt inspector, source budgets, glob exclusions and estimated context usage.
- Added persisted review-before-save model proposals with original/proposed contents, individual approvals/rejections and stale-file protection. Agent commands, MCP, scaffolding and image generation are disabled while review is enabled.
- Added reusable prompts with variables and slash commands, separate Ask/Plan/Build model profiles and optional routing, and serial two-model response/speed comparisons with cancellation and error history.
- Added source-only project ZIP bundles with file-list review, checksums, bounded extraction, new-folder import and cautious imported-project defaults.
- Added full conversation-content search, a keyboard command palette and a task board with acceptance criteria, durable build/run links and human-reviewed completion.
- Documented twenty researched candidates, selected ten implementations and their practical limits. No additional model downloads or runtime dependencies are required.

## 0.3.0 — 2026-09-28

- Added a unified build workspace with keyboard-resizable file/chat panels, inline editing, optional idle autosave, stale-save protection, live preview and task output.
- Added a guided project kickoff wizard with editable goals/pages/style plans, connected starters and an explicit Build this plan action.
- Added progress stages based on recorded file/check/preview results, a collapsed setup activity drawer and actionable failed-build recovery.
- Added automatic GitHub release checks, Preview/Stable channels, digest-verified side-by-side release installation, idle activation and fallback to the previous app if startup fails. Git checkouts remain under Git control.
- Added local workspace backups and checksum-verified recovery into separate project folders; existing projects and credential stores remain intact.

- Applied the Local Core identity to the app, browser icons, Windows setup and shortcuts, and README. Added outlined SVG and transparent PNG brand assets with light, dark, and monochrome variants.

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
