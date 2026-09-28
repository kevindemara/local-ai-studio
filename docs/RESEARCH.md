# Local AI GUI research

Reviewed **2026-09-28**, using official project documentation. Features evolve quickly; these are observations, not a ranking or claims of equivalence.

| Tool | Useful existing patterns | Idea for Studio |
| --- | --- | --- |
| [Open WebUI](https://docs.openwebui.com/features/) | Knowledge/document chat, image integrations, voice, memory and extensible tools; [native HTTP MCP and stdio adapters](https://docs.openwebui.com/features/extensibility/mcp/) | Workspace knowledge, searchable history and permission-aware integrations |
| [LM Studio](https://lmstudio.ai/docs/app/mcp) | Local model workflows and MCP server connections | Make model/tool compatibility visible; test a server before exposing it to a model |
| [Jan](https://www.jan.ai/docs/desktop/manage-models) | Hardware-aware model hub with fit categories and local GGUF workflows | Explain memory suitability in plain language, including slower fallback options |
| [AnythingLLM](https://docs.anythingllm.com/setup/llm-configuration/overview) | Model choice per workspace; [document retrieval](https://docs.anythingllm.com/chatting-with-documents/introduction); [MCP compatibility](https://docs.anythingllm.com/mcp-compatibility/overview) | Workspace knowledge, durable project conventions and tailored tool access |

## What this preview adds

The reviewed patterns informed the new setup wizard, dated model catalog, explicit memory-fit labels, project-scoped MCP connections and history dashboard. Studio also keeps its existing development workflows: connected file edits, verification/repair, previews, checkpoints and Git review.

## Valuable missing ideas

These are proposed product directions, not implemented capabilities:

1. **Document knowledge with citations:** attach PDFs/notes, retrieve relevant passages and show exactly where an answer came from.
2. **Measured model comparison:** the same coding task on installed models, reporting speed, memory, tool success and task quality. Fit estimates alone cannot select the best model for every task.
3. **Portable project bundles:** export/import chats, instructions and source files with an explicit secret review. Offer scheduled local backups and a restore wizard.
4. **Permission profiles and execution isolation:** a simple read-only profile, a trusted development profile and container/OS sandbox options for untrusted code.
5. **Browser verification:** screenshots, layout checks, accessibility checks and working-flow tests after building a website.
6. **Better context management:** an indexed project map, relevant-file selection, context budget display and user-visible summaries for long projects.
7. **Task-specific routing:** choose a fast model for questions and a capable model for builds, with explicit fallback rules and actual quality measurements.
8. **Accessible onboarding:** keyboard-first controls, screen reader testing, plain-language errors, reduced motion, light/high-contrast themes and translated onboarding.
9. **Reproducible environments:** project dependency profiles, health checks, saved run commands and clear environment repair actions.
10. **Extension discovery and updates:** curated plugin manifests, visible capabilities, version checks, provenance and per-project disable/revoke controls.

Document knowledge, isolated execution and browser verification are the most useful next investments for complete app-building workflows. They are larger engineering projects and should be validated before being advertised as available.

## Model catalog evidence

| Local tag | Approximate download | Model license shown by Ollama | Initial role |
| --- | --- | --- | --- |
| [gemma4:12b](https://ollama.com/library/gemma4:12b) | 7.6 GB | Apache-2.0 | Balanced current model with headroom on 16GB GPUs |
| [qwen3.5:9b](https://ollama.com/library/qwen3.5:9b) | 6.6 GB | Apache-2.0 | Balanced coding/general tasks |
| [gpt-oss:20b](https://ollama.com/library/gpt-oss:20b) | 14 GB | Apache-2.0 | Reasoning; tight memory fit on 16GB GPUs |
| [qwen3:1.7b](https://ollama.com/library/qwen3:1.7b) | 1.4 GB | Apache-2.0 | Small-PC fallback |
| [qwen3.8:27b](https://ollama.com/library/qwen3.8:27b) | 18 GB | Apache-2.0 | Larger coding/reasoning, requiring more VRAM or offloading |
| [qwen3.5:4b](https://ollama.com/library/qwen3.5:4b) | 3.4 GB | Apache-2.0 | Smaller coding/general choice |
| [qwen3.5:2b](https://ollama.com/library/qwen3.5:2b) | 2.7 GB | Apache-2.0 | Simple tasks; default Q8 weights |
| [qwen3.5:0.8b](https://ollama.com/library/qwen3.5:0.8b) | 1.0 GB | Apache-2.0 | Very small fallback |
| [gemma4:e2b](https://ollama.com/library/gemma4:e2b) | 7.2 GB | Apache-2.0 | Efficient Gemma alternative, including multimodal assets |
| [gemma4:e4b](https://ollama.com/library/gemma4:e4b) | 9.6 GB | Apache-2.0 | Larger efficient Gemma alternative |
| [ministral-3:8b](https://ollama.com/library/ministral-3:8b) | 6.0 GB | Apache-2.0 | Mistral-family tool-capable alternative |

Tags are mutable. Catalog estimates are expressed in decimal download GB and binary working-memory GiB in the UI. Runtime/KV overhead is estimated conservatively at modest context; it is not an exact allocation prediction. Separate GPUs are not summed into a fictional single card. Apple unified memory reserves additional room for the OS. Unknown dedicated VRAM is not inferred from Windows' unreliable 32-bit AdapterRAM field.

Hardware compatibility reference: [Ollama GPU support](https://docs.ollama.com/gpu). Integration references: [Ollama chat API](https://docs.ollama.com/api/chat), [streaming model pull API](https://docs.ollama.com/api/pull), [MCP official TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk), [GitHub authentication](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/about-authentication-to-github).

## Common MCP catalog sources

Reviewed 2026-09-28 using the publisher repositories and npm metadata. The catalog pins direct server versions, explains local/external access and checks required environment variables without exposing their values.

- [MCP reference servers](https://github.com/modelcontextprotocol/servers): filesystem, memory and sequential-thinking packages, version 2026.8.31.
- [Microsoft Playwright MCP](https://github.com/microsoft/playwright-mcp): package 0.0.82, isolated/headless Chrome configuration.
- [Upstash Context7](https://github.com/upstash/context7): package 4.1.1, optional environment API key.
- [GitHub MCP server](https://github.com/github/github-mcp-server): official v1.12.2 Docker image, read-only repository/issue/pull-request tools and environment token.
- [Brave Search MCP server](https://github.com/brave/brave-search-mcp-server): official package 2.1.4, stdio and environment API key.
