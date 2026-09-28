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

Import a JSON manifest under Plugins & MCP. Examples:

```json
{"name":"Local service","transport":"http","url":"http://127.0.0.1:8080/mcp","envNames":[]}
```

```json
{"name":"Trusted local tool","transport":"stdio","command":"node","args":["/absolute/path/server.mjs"],"envNames":["SERVICE_API_KEY"]}
```

Only environment names are stored; values are read from the Studio server environment and passed to that server. Use the bundled example to test without downloading another package. Click Trust & enable for the selected project, then Check connection & tools. Disabling a project removes its model tool access. Removing a connection closes its client session. Project assignment is not an OS filesystem sandbox.
