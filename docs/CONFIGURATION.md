# Configuration, models and backups

## Runtime settings

| Environment variable | Purpose | Default |
| --- | --- | --- |
| LOCAL_AI_PORT | Studio's loopback port | 3211 |
| LOCAL_AI_OLLAMA_PORT | Local Ollama port | 11434 |
| LOCAL_AI_DATA_DIR | Workspace database, backups, checkpoints and managed project folders | OS user data directory / LocalAIStudio |
| LOCAL_AI_IMAGE_ROOT | Optional installed stable-diffusion.cpp image engine directory | image-gen next to the app source root |

The setup wizard offers 4K, 8K, 16K and 32K context settings. Start at 8K; longer contexts consume more memory. Unknown adapters can use verified dedicated VRAM entered in Advanced memory settings. This does not force GPU compatibility or turn shared RAM into dedicated VRAM.

Model downloads use Ollama's normal model directory. If you set `OLLAMA_MODELS` for Ollama, ensure that disk has enough free space. The wizard's disk display refers to the Studio workspace disk and cannot discover a separately configured daemon's environment reliably.

The catalog is `app/model-catalog.json`, reviewed with linked official model pages. It is bundled with a release rather than silently changed by a third-party feed. Existing local Ollama chat models are discovered automatically. Cloud-tagged and common embedding models are excluded from the chat selector. An arbitrary installed model can still lack native tool support; choose one of the reviewed tool-capable models for Build mode.

## Start and stop

`Launch.cmd` or `npm run launch` starts Studio in the background. `npm start` keeps it attached to a terminal; Ctrl+C stops that process. Port 3211 avoids the common 3210 port used by other local apps. Preview servers use separate loopback ports. Do not expose Studio directly to the internet.

For a clean background stop, issue the authenticated local `/api/server-stop` action (or stop the recorded server PID). Stop active runs before closing the server. Running jobs become interrupted on restart and can be retried.

## Backups

### Workspace recovery

In **Updates & backups**, Create workspace backup saves source files from managed and linked projects, chats, plans, settings, change backups and checkpoints under `LOCAL_AI_DATA_DIR/snapshots`. Each completed snapshot has a manifest with SHA-256 checksums. The current limits are 20,000 files, 2 GB total and 100 MB per file. Git repositories, dependencies and common build caches are excluded; symlinks/junctions are skipped and reported. Backups may include project secrets such as `.env` files; they stay local and are not encrypted. OAuth and GitHub credential stores and Ollama weights are not copied.

Recovery creates a backup of the current workspace, verifies every selected snapshot file, and restores projects under new `recovered` folders. It switches project metadata to those copies and leaves existing project folders intact. Queued/running requests become interrupted, and MCP connections must be re-enabled after reviewing access to the recovered folders. Dependencies need reinstalling and previews need restarting. Studio never overwrites a linked repository as part of recovery. Failed or cancelled snapshots are not listed as complete recovery points.

### Application updates

Preview includes prereleases; Stable excludes them. Automatic checks contact the official GitHub releases API at startup and every six hours and can be disabled. Installation is an explicit idle action. It checks the release digest, rejects escaped/oversized archive paths, creates a workspace backup and prepares dependencies using `npm ci --ignore-scripts` in a separate `app-releases` folder. Release ZIPs are not publisher-signed packages.

Extracted installs can restart into the prepared release. The launcher records the active version separately in user data and follows it on the next launch. A failed startup health check relaunches the previous app; workspace recovery points remain available if a newer version changed metadata. The previous source folder is retained, so it can also be launched manually. Developer Git checkouts do not follow this pointer or switch themselves; use Git to update source or launch a prepared release separately.

### Full manual backup

Stop Studio and copy its entire data directory to a trusted local backup location. This includes workspace.json, generated managed projects, change backups and checkpoints. **Linked external project folders must be backed up separately.** Restart with the original data directory, or set LOCAL_AI_DATA_DIR to the restored copy.

Workspace data includes prompts and file/tool output. Diagnostic exports intentionally omit chats, project names, source paths, auth tokens and server arguments. Do not upload workspace.json or runtime logs as a routine bug report.

## Optional image engine

The image integration accepts a separately installed [stable-diffusion.cpp](https://github.com/leejet/stable-diffusion.cpp) runtime with Z-Image model assets under LOCAL_AI_IMAGE_ROOT:

```
runtime/sd-cli.exe         # Windows; sd-cli on other platforms
models/z-image-Q8_0.gguf
models/Qwen3-4B-Instruct-2507-Q8_0.gguf
models/ae.safetensors
outputs/
```

These large assets are not installed by Setup.cmd and are not included in releases. Check their upstream model licenses and the runtime's hardware support. The Images panel reports whether the required files exist; generation unloads chat models first. Other image services may be connected through trusted MCP tools, subject to their server's behavior and terms.

## Optional audio engines

On Windows with NVIDIA CUDA, run `scripts/install-audio.ps1` from the repository after installing official Python 3.12, Git and uv. It creates `%LOCALAPPDATA%\LocalAIStudioAudio` with separate environments for ACE-Step music, MOSS SoundEffect v2 and Qwen3-TTS VoiceDesign. This location survives Studio release updates. Set `LOCAL_AI_AUDIO_ROOT` before starting Studio if you keep that folder elsewhere. Studio checks for each model's weights independently; the Sound panel enables only installed modes. Weights and generated outputs are not bundled in releases or workspace backups. Each generation runs as a short-lived Python process, unloads the Ollama chat model first and saves a WAV in the selected project with a recoverable previous version. Checkpoint size limits still apply to large audio files.

## Plugins

### Common servers

Plugins & MCP includes a searchable catalog. Select a project, click **Connect**, review the server's access, check the trust box and choose **Connect to project**. Filter the 25 entries by category, name or connection type. A background job prepares the appropriate runtime or remote endpoint and discovers its tools. Browser sign-in entries show **Connect & sign in**. Failed/cancelled connections are disabled. Reconnect retries the same project connection instead of adding duplicates.

| Server | Prerequisites and behavior |
| --- | --- |
| Project files | Node/npm. Restricted to the selected folder by the server. Direct edits bypass Studio's file filters, change review and checkpoints; use Studio's built-in file tools when those protections are needed. |
| Persistent memory | Node/npm. Separate `mcp-memory/<project-id>.jsonl` in the Studio data directory for each project. Include this directory in backups. |
| Sequential thinking | Node/npm. Processes plan text locally; thought logging is disabled. |
| Playwright browser | Node/npm and installed Google Chrome. Uses a headless, temporary isolated profile. Discovery does not validate browser actions or provide OS/network isolation. |
| Context7 | Node/npm and internet. Optional `CONTEXT7_API_KEY`. Sends documentation queries to Context7. |
| GitHub repository tools | Running Docker plus `GITHUB_PERSONAL_ACCESS_TOKEN`. Official pinned container, read-only repos/issues/pull-request tools. Token permissions control accessible repositories, not the assigned project. GitHub CLI login does not supply this token. |
| Web page fetch | uv/Python, no account. Converts pages to text; can reach local/internal addresses as well as public websites. |
| Local Git tools | uv/Python and Git; initialize the selected project repository under GitHub & repos first. Can stage, commit and change branches directly. |
| Time and time zones | uv/Python, no account. Local time and timezone conversion. |
| Chrome DevTools | Node/npm and Chrome. Isolated headless profile; usage statistics, CrUX and update checks disabled. Discovery does not test browser actions. |
| Tavily research | Node/npm and `TAVILY_API_KEY`; provider research/search/extraction requests. |
| Firecrawl web extraction | Node/npm and `FIRECRAWL_API_KEY`; provider page extraction and crawling. |
| MongoDB | Node/npm and `MDB_MCP_CONNECTION_STRING`; read-only mode, telemetry disabled. Use a read-only database role. |
| PostgreSQL diagnostics | Community Crystal DBA server. uv/Python and `DATABASE_URI`; restricted read-only transactions. Also use a read-only database role. |
| Supabase | `SUPABASE_ACCESS_TOKEN` plus required project reference. Hosted endpoint, project-scoped, read-only, database/docs feature groups. Use a narrowly scoped token. |
| Notion | Node/npm, browser OAuth and a Notion account. Can read/write authorized workspace content. |
| Figma | Node/npm, browser OAuth and a Figma account; provider plan/access limits apply. |
| Linear | Node/npm, browser OAuth and a Linear account. Can read/write authorized work items. |
| Sentry | Node/npm and browser OAuth. Optional organization/project slugs scope the endpoint; project requires organization. |
| Jira & Confluence | Node/npm and browser OAuth; current Atlassian v2 endpoint. Organization administrators may need to allow the client. |
| Neon Postgres | Node/npm and browser OAuth. Resource management tools can change projects/databases/branches and incur charges. |
| Microsoft Learn | Public hosted endpoint; no account or extra runtime. Documentation and code samples. |
| Cloudflare documentation | Public hosted endpoint; no account. Documentation access only, not account administration. |
| Hugging Face Hub | Hosted endpoint with public tools; optional `HF_TOKEN` for account settings and configured Spaces. Review enabled tools at Hugging Face. |
| Brave web search | Node/npm, internet plus `BRAVE_API_KEY`. Queries are sent to Brave; provider terms and limits apply. |

For account keys, set the named variable in your user environment. On Windows: Start → Edit environment variables for your account → New, then click Recheck requirements. Catalog connections read these explicitly named Windows user variables again when connecting; no browser/server restart is required. On macOS/Linux, restart the Studio server from an environment containing the variable (closing only the browser does not stop a background server). Never paste keys into chats or manifests. Environment variables are not an encrypted credential vault. Only the necessary environment names are stored and only their referenced values are passed to the selected server. The catalog's Node/npm launcher also passes normal process-launch environment values and non-secret runtime settings; npm lifecycle scripts are disabled.

Catalog configurations belong to one project and cannot be reassigned to a different folder. Connect a separate instance for another project. Other local programs may still access files as your user: project assignment is not an OS sandbox. Packages are downloaded from npm on first connection and can require internet; their dependency graph is not a fully reproducible lockfile.

### Python tools and browser sign-in

Python entries run pinned PyPI packages in isolated environments using `uv tool run`. The MCP Python SDK is constrained to its compatible 1.x line. Windows setup offers **Install uv for Python tools** through the official WinGet package `astral-sh.uv`; Studio detects its installed location without requiring a terminal restart. On other systems use the linked [official uv installation guide](https://docs.astral.sh/uv/getting-started/installation/). Initial Python downloads may take five minutes.

Browser sign-in uses the third-party [mcp-remote bridge](https://github.com/punkpeye/mcp-remote), pinned to 0.14.3. Complete the provider's browser authorization within five minutes; Cancel ends the connection attempt. Tokens and registration data are cached in `mcp-auth/<project-id>/<server-id>` inside Studio's private user data directory. This is a file cache, not an encrypted vault. Protect that directory and backups; never publish them. Disable/Remove closes Studio's client and removes tool access but does not revoke the provider grant or erase its credential cache. Revoke authorization at the provider to end that grant. Account keys are resolved at connection time; remote bearer values are sent in HTTP headers, never persisted in URLs, command arguments or connection metadata.

Supabase project references and Sentry slugs are non-secret configuration fields. To change them, disable the existing connection, then reconnect with new settings. Existing connections to other projects remain separate. Cloud tool access is determined by provider authorization; assigning a Studio project does not narrow a cloud account unless the connector explicitly implements provider-side scoping. Provider limits, paid plans and usage charges can apply.

### Custom servers

Import a JSON manifest under Plugins & MCP. Examples:

```json
{"name":"Local service","transport":"http","url":"http://127.0.0.1:8080/mcp","envNames":[]}
```

```json
{"name":"Trusted local tool","transport":"stdio","command":"node","args":["/absolute/path/server.mjs"],"envNames":["SERVICE_API_KEY"]}
```

Only environment names are stored; values are read from the Studio server environment and passed to that server. Use the bundled example to test without downloading another package. Click Trust & enable for the selected project, then Check connection & tools. Disabling a project removes its model tool access. Removing a connection closes its client session. Project assignment is not an OS filesystem sandbox.
