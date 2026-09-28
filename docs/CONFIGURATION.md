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

## Plugins

### Common servers

Plugins & MCP includes a searchable catalog. Select a project, click **Connect**, review the server's access, check the trust box and choose **Connect to project**. A background job downloads a pinned npm package where needed and discovers its tools. Failed/cancelled connections are disabled. Reconnect retries the same project connection instead of adding duplicates.

| Server | Prerequisites and behavior |
| --- | --- |
| Project files | Node/npm. Restricted to the selected folder by the server. Direct edits bypass Studio's file filters, change review and checkpoints; use Studio's built-in file tools when those protections are needed. |
| Persistent memory | Node/npm. Separate `mcp-memory/<project-id>.jsonl` in the Studio data directory for each project. Include this directory in backups. |
| Sequential thinking | Node/npm. Processes plan text locally; thought logging is disabled. |
| Playwright browser | Node/npm and installed Google Chrome. Uses a headless, temporary isolated profile. Discovery does not validate browser actions or provide OS/network isolation. |
| Context7 | Node/npm and internet. Optional `CONTEXT7_API_KEY`. Sends documentation queries to Context7. |
| GitHub repository tools | Running Docker plus `GITHUB_PERSONAL_ACCESS_TOKEN`. Official pinned container, read-only repos/issues/pull-request tools. Token permissions control accessible repositories, not the assigned project. GitHub CLI login does not supply this token. |
| Brave web search | Node/npm, internet plus `BRAVE_API_KEY`. Queries are sent to Brave; provider terms and limits apply. |

For account keys, set the named variable in your user environment. On Windows: Start → Edit environment variables for your account → New, then click Recheck requirements. Catalog connections read these explicitly named Windows user variables again when connecting; no browser/server restart is required. On macOS/Linux, restart the Studio server from an environment containing the variable (closing only the browser does not stop a background server). Never paste keys into chats or manifests. Environment variables are not an encrypted credential vault. Only the necessary environment names are stored and only their referenced values are passed to the selected server. The catalog's Node/npm launcher also passes normal process-launch environment values and non-secret runtime settings; npm lifecycle scripts are disabled.

Catalog configurations belong to one project and cannot be reassigned to a different folder. Connect a separate instance for another project. Other local programs may still access files as your user: project assignment is not an OS sandbox. Packages are downloaded from npm on first connection and can require internet; their dependency graph is not a fully reproducible lockfile.

### Custom servers

Import a JSON manifest under Plugins & MCP. Examples:

```json
{"name":"Local service","transport":"http","url":"http://127.0.0.1:8080/mcp","envNames":[]}
```

```json
{"name":"Trusted local tool","transport":"stdio","command":"node","args":["/absolute/path/server.mjs"],"envNames":["SERVICE_API_KEY"]}
```

Only environment names are stored; values are read from the Studio server environment and passed to that server. Use the bundled example to test without downloading another package. Click Trust & enable for the selected project, then Check connection & tools. Disabling a project removes its model tool access. Removing a connection closes its client session. Project assignment is not an OS filesystem sandbox.
