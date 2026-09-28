# Contributing

Use Node.js 22+ and Git. Run `npm ci --ignore-scripts` and `npm test` before submitting changes. Tests use temporary project directories and a mock Ollama service; they do not need model weights or a GPU. Template checks may download small npm dependencies.

Keep source separate from user data. Do not commit workspace files, prompts, credentials, models, generated projects, machine-specific paths or runtime logs. Maintain project path boundaries, read-only modes, MCP trust checks and selected-file Git behavior.

For a new model recommendation, include the official Ollama tag, current approximate size, license link, reviewed date and realistic memory assumptions. Do not equate parameter count with quality or download size with exact runtime allocation.

File small, reproducible issues. Use the private-safe diagnostic export if hardware details matter. Explain the expected result, actual result and steps to reproduce without pasting personal project contents.
