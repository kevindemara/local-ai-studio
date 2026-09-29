# Another twenty useful features

Researched 2026-09-28. These are **additional** candidates beyond the first twenty in [FEATURE-RESEARCH.md](FEATURE-RESEARCH.md). The first ten are implemented in **0.5.0**. Selection favoured concrete coding value, beginner-friendly controls, modest resources and reuse of the existing local architecture. Research informed the direction; the ranking and UI decisions are our own.

## Primary sources

- [Aider repository maps](https://aider.chat/docs/repomap.html) explain compact source maps containing important symbols and relationships. Studio uses a simpler bounded text scan, not Aider's parser or graph ranking.
- [Aider linting and testing](https://aider.chat/docs/usage/lint-test.html) describe running checks after changes and using failures to repair edits. Studio adds an ordered package-script sequence to its existing verification loop.
- [Aider chat modes](https://aider.chat/docs/usage/modes.html) describe planning and editor-model workflows. Studio requires a user-reviewed plan before starting the separate Build chat.
- [Open WebUI history and search](https://docs.openwebui.com/features/chat-conversations/chat-features/history-search/) document pins, tags and archiving. Studio preserves archived messages in full-history search and offers restore controls.
- [Ollama's API reference](https://github.com/ollama/ollama/blob/main/docs/api.md), [API types](https://github.com/ollama/ollama/blob/main/api/types.go) and [memory FAQ](https://docs.ollama.com/faq#how-do-i-keep-a-model-loaded-in-memory-or-make-it-unload-immediately) support local inventory/details/removal, runtime options and keep-alive controls.
- [Ollama structured outputs](https://docs.ollama.com/capabilities/structured-outputs) provide a basis for the later schema playground.
- [Aider scripting](https://aider.chat/docs/scripting.html) motivates a future stable headless integration.
- [GitHub merge conflict guidance](https://docs.github.com/en/pull-requests/how-tos/merge-and-close-pull-requests/resolving-a-merge-conflict-using-the-command-line) and [release management](https://docs.github.com/en/repositories/releasing-projects-on-github/managing-releases-in-a-repository) informed the future Git workflows.
- [MCP tool specification](https://modelcontextprotocol.io/specification/2025-06-18/server/tools) describes tool schemas and annotations, a basis for finer per-tool controls. Annotations alone are not a trust boundary.

No third-party source was copied. No additional runtime dependencies or model downloads were introduced.

| Rank | Addition | Why it helps | Status |
|---|---|---|---|
| 1 | Source symbols and dependency map | See connected files and give the agent a structured overview. | Shipped: searchable map, reverse dependencies, symbol/line navigation and read-only model tool. |
| 2 | Agent edit boundaries | Focus a model on selected files while protecting unrelated code. | Shipped: allowed/protected globs enforced before write, edit, move and trash; bypass-capable agent tools disabled. |
| 3 | Ordered quality gates | Define what must pass for this project. | Shipped: existing npm scripts, stop at first script failure, persistent output, cancellation and agent verification integration. |
| 4 | TODO/FIXME navigator | Turn unfinished source work into actionable tasks. | Shipped: markers with file/line links and task-card creation. |
| 5 | Reviewed multi-file literal replacement | Keep names and wording consistent without repeated manual edits. | Shipped: counts, original/proposed contents, revision preflight, backups and rollback on partial failures where safe. |
| 6 | Installed model storage manager | Understand installed tags and remove unwanted copies deliberately. | Shipped: actual sizes, quantization, capabilities/context metadata and exact-tag confirmation for removal. |
| 7 | Memory/compute presets | Choose responsiveness versus freeing memory; request CPU when appropriate. | Shipped: Eco/Balanced/Warm keep-alive, Auto/CPU options passed to normal replies, tests and comparisons. |
| 8 | Reviewed AI plan-to-build handoff | Separate planning from implementation and preserve the agreed plan. | Shipped: editable Plan reply, approval checkbox, new Build chat/run and source-plan provenance. |
| 9 | Chat pins, tags and archive | Keep a growing workspace navigable. | Shipped: pinned order, tag filtering, archive/restore and preserved full-history search. |
| 10 | Run time and model-round budgets | Stop long agent loops while retaining completed work. | Shipped: per-project deadlines, 2/10/20/40/80 round limits, displayed usage and Continue recovery. |
| 11 | JSON-schema response playground | Develop reliable structured extraction for apps. | Later: needs schema validation, model compatibility checks and reusable fixtures. |
| 12 | Saved web research with provenance | Keep selected web sources and retrieval dates alongside a project. | Later: requires bounded fetching, source ownership and network-address controls. |
| 13 | Prompt/coding regression suites | Compare model or prompt changes against repeatable expectations. | Later: needs fixtures, scoring and resource-aware serial execution; distinct from one-prompt comparison. |
| 14 | Dependency vulnerability and licence reports | Understand dependencies before shipping an app. | Later: requires package metadata, network freshness and clear remediation controls. |
| 15 | Visual Git conflict resolution | Help users reconcile both versions and validate the merged files. | Later: requires conflict-state handling and a three-pane editor. |
| 16 | Project release wizard | Version, describe and publish a built project's release. | Later: distinct from repository creation/push; requires artifact selection and publication review. |
| 17 | Stable headless API/SDK | Integrate Studio builds into personal development workflows. | Later: existing internal API is not a supported external contract; needs authentication/versioning/docs. |
| 18 | Run evidence reports | Export a reviewed record of files, actual checks and outcomes. | Later: requires content selection/redaction and clear provenance; source bundles do not include this. |
| 19 | Per-tool MCP controls and context allowances | Permit specific tools from a connection and bound tool output. | Later: current trust is connection/project scoped; finer controls need enforcement throughout discovery/calls. |
| 20 | External file-change timeline | Explain edits made outside Studio and locate affected work. | Later: requires reliable cross-platform watching, storage bounds and reconciliation with editor drafts. |

## Scope and limits

The code map is heuristic, scanning at most 200 readable files with bounded symbols/imports/markers. It may miss dynamic references, aliases or language semantics. It honours automatic context exclusions, but those exclusions do not deny explicit file-tool reads.

Edit boundaries control the **agent's tools**, not the operating system. While enabled, agent commands, MCP, image generation, scaffolding, API calls and automatic verification/preview are unavailable. Manual editor saves, replacement and quality checks are explicit user actions and remain available. Review-before-save still applies to in-scope agent edits.

Replacement is literal and case-sensitive, capped at 30 files and 2,000 matches. Previews expire after ten minutes. Changed files are rejected before the batch starts. Writes have backups; a partial failure restores earlier writes only when they still match Studio's replacement, preserving external changes. It is not an OS transaction or semantic rename.

Model tag sizes may share underlying layers; summing them overstates unique disk usage. Removal only targets an exact currently installed local tag, never auto-deletes models and preserves chat history. CPU requests use zero GPU layers; compatibility/performance depend on the installed Ollama runner. Eco unloads after each model request, which may reload between agent rounds. Comparisons always unload serially.

Quality gates are trusted project package scripts executed as the user, not sandboxed commands. Defaults remain compatible with existing projects. Run deadlines include model loading/tool work once execution starts, not time waiting in the queue; process cleanup may take additional time. A model round can request multiple tools. Continue starts a fresh budget and retains previous files.
