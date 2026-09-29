# Twenty additions for a local coding workspace

Research reviewed on 2026-09-28. The first ten shipped in **0.4.0**; the remaining ten are candidates, not implemented features. Selection favoured everyday coding value, clear controls for beginners, offline usefulness and modest GPU/RAM overhead. These are product decisions, not a claim that every referenced app implements every idea below.

## Inspiration

- [Open WebUI workspace documentation](https://docs.openwebui.com/features/workspace/) describes reusable model presets, document knowledge and prompt templates with variables and slash commands. This informed knowledge, prompts, context visibility and model profiles.
- [AnythingLLM's official repository](https://github.com/Mintplex-Labs/anything-llm) documents model routing, document ingestion/citations, memories, scheduled jobs, multimodal models and speech options. This informed routing and several later candidates.
- [Codex's official repository](https://github.com/openai/codex) and [CLI documentation](https://learn.chatgpt.com/docs/codex/cli) informed the local coding workflow, returning to saved conversations and visual-context candidates. Studio's proposal review and command palette are our own UI choices for that workflow.
- [OpenHands' official repository](https://github.com/OpenHands/OpenHands) currently describes Agent Canvas, a developer control centre with local/container/remote backends and automations. This informed the task-board direction and later isolation/automation candidates.

No third-party source code was copied. These features use Studio's existing Node/Ollama/file-tool architecture. No new runtime dependencies or large model downloads are required.

## Ranked selection

| # | Feature | Benefit | Status / reason |
|---|---|---|---|
| 1 | Project knowledge library with reference excerpts | Keep briefs and documentation separate from chats; retrieve relevant material locally. | Shipped: text/Markdown/JSON import, editing, enable/disable, local keyword retrieval, source IDs and a search tool. |
| 2 | Context inspector and exclusions | See what automatic source selection supplies and reduce irrelevant context. | Shipped: full-content relevance ranking, excerpts with line numbers, source budgets, glob exclusions and honest token estimates. |
| 3 | Review model edits before saving | Inspect proposed source files before the model overwrites anything. | Shipped: persisted proposals, per-file approve/reject, original/proposed contents, stale-file protection and decision history. |
| 4 | Reusable prompts and slash commands | Avoid rewriting the same instructions. | Shipped: built-ins, custom templates, variables, Ask/Plan/Build modes and explicit insertion into the composer. |
| 5 | Per-mode model profiles | Use suitable settings and optionally different models for advice, planning and coding. | Shipped: installed model choice, context, temperature and output limits; opt-in routing. |
| 6 | Serial model comparisons | Compare actual local responses and measured speed without loading both models together. | Shipped: two-model prompt runs, answers, elapsed time, output tokens, throughput, cancellation and visible failures. |
| 7 | Portable project bundles | Share a working source project without copying the whole private workspace. | Shipped: reviewed ZIP file list, checksum manifest, new-folder import and cautious imported-project defaults. |
| 8 | Search full conversation contents | Find an earlier decision or code explanation even when the chat title is unrelated. | Shipped: all-project/project scope, result snippets and navigation to the matching message. |
| 9 | Keyboard command palette | Reach a tool, file, project or prompt without hunting through menus. | Shipped: Ctrl/Cmd K or Ctrl/Cmd Shift P, search, arrow navigation and direct actions. |
| 10 | Project task board | Turn a backlog into concrete build requests with acceptance criteria. | Shipped: editable cards, queued real builds, run/chat links, stop controls and human-reviewed completion. |
| 11 | Isolated container execution | Keep generated dependency/code execution separate from the host. | Later: requires a real sandbox, Docker availability and resource controls. Review mode is not an OS sandbox. |
| 12 | Automatic browser interaction checks | Exercise forms, navigation and mobile layouts after a build. | Later: browser MCP exists; an integrated unattended verifier needs policy and result handling. |
| 13 | Screenshot and vision attachments | Give a vision-capable model design references and error screenshots. | Later: requires model capability detection and explicit image handling. |
| 14 | Semantic document search and PDF/DOCX ingestion | Retrieve meaning rather than only matching keywords across richer documents. | Later: requires parsers, embeddings, storage and additional model resources. |
| 15 | Offline voice input and spoken responses | Make prompting and reading results more accessible. | Later: requires local speech models and microphone controls. |
| 16 | Durable conversation summaries | Carry decisions forward when long chats exceed context. | Later: existing history trimming/checkpoints remain; summaries need provenance and correction controls. |
| 17 | Scheduled local build/check tasks | Re-run selected maintenance prompts or checks at chosen times. | Later: needs durable scheduling, missed-run handling and clear execution permissions. |
| 18 | Extension marketplace with provenance | Discover, version, update and audit plugins beyond the curated MCP list. | Later: requires manifest validation, signing/provenance and update policies. |
| 19 | Environment profiles and offline dependency cache | Reproduce a project's tool versions and build while disconnected. | Later: requires dependency/runtime management across operating systems. |
| 20 | High-contrast/light themes and localization | Make the workspace easier to use for a wider audience. | Later: needs a full accessibility and translation pass, not only a colour toggle. |

## Practical limits

Knowledge retrieval is lexical, not embedding-based RAG. Reference excerpts supplied to the model are visible; they do not guarantee that an answer used them correctly. Context token estimates use a character heuristic rather than each model's tokenizer. Automatic exclusions do not deny explicitly requested file-tool access.

Review mode limits the **agent's** tools to read operations, plans and proposed text edits. It disables agent commands, MCP calls, image generation, scaffolding and automatic checks/previews. Manual editor and build tools remain available. Approvals protect the original file revision; a run finishing with proposals is labelled review, not a tested/saved build. Approve connected files, then run checks manually or switch review off and ask the agent to verify them.

Model comparison uses 4K context and a 512-token output cap, with one model at a time. It is a response/speed comparison, not an accuracy benchmark or native-tool certification. Some aliases refer to the same underlying weights. Larger models can still exhaust memory or fail to load; errors are retained.

Bundles contain supported source/image files, at most 600 files / 25 MB expanded, and imports accept up to 10 MB compressed. They exclude common secret-file formats, dependencies and private Studio metadata. Review source content before sharing: no filename filter can discover every secret embedded in source. Imported projects start with development commands disabled and review mode enabled.
