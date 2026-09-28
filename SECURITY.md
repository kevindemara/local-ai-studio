# Security

Do not include credentials, private project contents, workspace.json or full runtime logs in public issues. Report a reproducible security issue privately through the repository owner's GitHub contact options or private vulnerability reporting when available.

Studio binds to loopback and requires a local session token for API changes. Built-in source operations reject traversal, symlink/junction escapes, hardlinked targets and common secret file types. These controls are not an OS sandbox. Development commands execute as the user. Trusted MCP programs can have broader OS permissions and remote tools receive their arguments.

Keep Ollama, Node.js and GPU drivers up to date through their official sources. Review project dependencies and MCP programs before running them. Do not publish committed secrets; ignored files alone do not remove a secret from existing Git history.
