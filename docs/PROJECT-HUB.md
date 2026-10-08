# Project hub

Open **Project hub** in the sidebar. All project-specific changes belong to the selected project; the prompt library is shared across your local workspace. Your existing chats, folders and MCP connections are preserved.

## A useful first workflow

1. In **Knowledge**, add a project brief, brand guide or requirements document. Paste text or import a `.md`, `.txt` or `.json` document up to 50 KB. Edit it later or disable it without removing it.
2. In **Tasks**, create a card with a title, description and acceptance criteria. **Build task** creates a real chat and queues a build. Open its chat to follow the work. A finished run enters review; only **Mark done** closes the task.
3. For more control, turn on **Review edits** before building. Source changes appear as proposals with current and proposed contents. **Approve & save** applies one file with a backup. An externally changed file refuses stale approval. **Reject** retains the decision in history.
4. After applying connected files, use **Build tools → Check project** and start preview. Review mode deliberately prevents agent commands and MCP calls. Switch review off if you want the agent to verify and repair the applied files automatically.

## Context and knowledge

**Context** shows source excerpts ranked by the request's words and their full file content. It includes the excerpt's start line, matching knowledge documents, excluded files and estimated tokens. Choose a 4,000/8,000/12,000-character source budget; smaller model contexts cap that budget further. Patterns such as `generated/**` and `docs/private/**` exclude automatic context and bundle export. Explicitly attaching/reading a file is separate access.

For a long Build request, open **Project hub → Model profiles → Build → Context size**. Context is the model's working memory for one call; it does not set the total task duration. Studio now keeps building across model calls without a default round or time limit, automatically retries a bounded number of context-filled replies with a fresh context, and saves completed file actions. **Code & workflow → Run limits** lets you opt into a limit if desired. A larger context uses more RAM/VRAM and may be slower; start at 4K on a nearly full GPU, and try 8K only when resources permit. If the model repeats the same tool call without progress, Studio stops with an explanation instead of consuming unlimited compute. A stopped or incomplete run offers **Continue** from the saved project files.

Knowledge uses local keyword matching and bounded overlapping excerpts, not an embedding model. Source IDs remain stable for each document excerpt. The model can search the library with `search_project_knowledge`; supplied excerpts are shown beneath its reply. A citation identifies a referenced excerpt, but you should still check whether it supports the claim.

## Prompts and shortcuts

Use built-in `/feature`, `/accessibility`, `/test-plan` and `/explain`, or create your own lowercase slash command. Include variables such as `{{feature}}` in a template. Type a slash command by itself and press Enter, or choose **Use prompt**. Fill its variables, then **Insert into composer**. Insertion chooses the saved work mode but never submits the request automatically.

**Ctrl/Cmd K** or **Ctrl/Cmd Shift P** opens the command palette. Search tools, projects, source files and prompts. Arrow keys select an item and Enter opens it. The sidebar search still filters project/chat titles; **Search chats** searches full message bodies and jumps to a matching message.

## Models and sharing

**Model profiles** saves context size, temperature and maximum output for each of Ask, Plan and Build. With automatic routing off, the composer model remains in control. Turn routing on to let a saved role model take priority. Larger context and model sizes use more memory; check suitability on your computer.

**Compare** runs the same prompt against two installed model tags serially. Both answers, elapsed seconds, output token counts and measured generation speed remain available. It can be cancelled; loading/generation errors are shown. It does not write project files, use tools or measure correctness. Each answer has a 512-token cap.

**Sharing → Prepare file list** builds a source-only `.studio.zip` manifest. Inspect its list and source content before downloading. It excludes chats, knowledge, instructions, connections, model/dependency files and common secret-file formats. Import verifies hashes and file boundaries, creates a new managed folder, disables development commands and enables model-edit review. Source bundles are distinct from full workspace backups.
