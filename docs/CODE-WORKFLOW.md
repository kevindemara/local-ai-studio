# Code & workflow

Open **Code & workflow** in the sidebar, or search for a tool with **Ctrl/Cmd K**. Installed model management and runtime preferences are also linked from **Setup & models**.

## Understand the project

**Code map** lists symbols, explicit local imports and files that depend on each other. Search by file, symbol or import. Select a file or symbol to open it in the inline editor at that line. The agent can request the same bounded map with `project_code_map` in Ask, Plan or Build. This is a text scan, not a full language parser.

**TODO navigator** lists TODO/FIXME/HACK/XXX markers with source locations. **Add to task board** creates a card in Project hub with a description and acceptance criteria; it does not start a build. Review the card before running it.

## Control edits and verification

In **Edit boundaries**, enable the boundary and enter allowed patterns such as `src/**`, `*.html` or `README.md`. Add protected patterns that take priority. The backend checks both paths of a move. Agent commands, MCP, scaffolding, images, API calls, automatic checks and previews are disabled while enabled, because those tools could write beyond the selected scope. Explicit manual editor/replacement/quality actions remain available. This is not OS isolation. Review-before-save can be used at the same time.

In **Quality checks**, enter existing package script names in order, one per line, then save. For example: `lint`, `typecheck`, `build`, `test`. JSON and local references are checked first. Configured scripts replace the default build/test sequence and stop on the first script failure. **Run checks now** starts a cancellable local job with saved output/results. The agent's `verify_project` uses the same sequence in its repair loop when agent checks are available. Project development commands must be enabled. Leave the sequence empty to keep default checks.

**Find & replace** performs case-sensitive literal replacement in readable source files. Enter find/replacement text and an optional path substring, preview every original/proposed file, then select **Apply reviewed replacements**. Empty replacement removes the match. Previews expire after ten minutes, capped at 30 files / 2,000 matches. A stale preview is rejected. Each saved file appears in Changes with a backup; partial failures restore earlier writes where safe. Save/discard inline editor drafts before applying. This does not rename symbols semantically.

## Plan, build and organise

Ask for a plan in **Plan** mode. A finished reply has **Review & build plan**. Select it, revise the plan, check **I reviewed this plan and want it implemented**, then **Approve & start build**. Studio creates a separate Build chat and durable queued run, records the approved plan and its source reply, and follows the project's Build profile/review/boundary/limit settings. The original planning chat remains intact. A reply that reached its output limit is labelled so you can complete it before approving.

**Organize chats** supports pins, up to eight tags, and archive/restore. Pins sort first in the sidebar, and sidebar search also matches tags. Archived chats are hidden from the normal list except a currently selected archived chat; full-history search still finds their messages. Stop queued/running requests before changing archive state.

**Run limits** optionally applies a time limit of 5/15/30/60 minutes or a maximum of 2/10/20/40/80 model rounds. Neither limit applies by default. Loading and tool execution count toward elapsed time once a queued run starts. A round means one model request, possibly several tools. Messages show rounds used. Repeated identical tool calls without progress still stop with an explanation; the user can cancel a run at any time. Saved files remain available after any stop, and Continue starts another run.

## Manage local resources

**Model library** uses Ollama's actual local inventory. Inspect model capabilities, quantization and model metadata; native context limits are model metadata, not the active context allocation. Tag sizes may share layers and should not be summed as unique disk usage. **Remove tag…** requires typing the exact installed tag and waiting for active/queued work to finish. History remains; select another model in profiles/chats that referenced the removed tag. No installed models are removed automatically.

**Memory & compute** offers **Eco** (unload after each response), **Balanced** (two minutes) and **Warm** (ten minutes). Auto lets Ollama place the model; CPU requests zero GPU layers and can be slower. Normal replies and model tests honour these preferences. Comparisons honour compute selection but always unload between models. Eco can reload between agent rounds. These are request-level options, not changes to Docker, GPU drivers or Ollama's system configuration.

For the complete ranked feature research and deferred ideas, read [FEATURE-RESEARCH-02.md](FEATURE-RESEARCH-02.md).
