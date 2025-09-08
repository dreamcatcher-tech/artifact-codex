# face-codex

Lightweight Deno library that starts a simple in-memory "face" and returns an
object with:

- `interaction(input: string) -> { id: string, value: string }`
- `close(): Promise<void>`
- `status(): Promise<{ startedAt: string, closed: boolean, interactions: number, lastInteractionId?: string }>`

Usage:

```ts
import { startFaceCodex } from './main.ts'

const face = startFaceCodex()
const res = face.interaction('hello')
console.log(res) // { id: 'fcx_...', value: 'hello' }
await face.close()
```

## Launch Codex CLI with directories

You can have this face manage a Codex CLI process for you. Provide a private
"Codex home" directory (used for config/cache/scratch) and a separate workspace
directory (used as the CLI working directory). When `launch: true` is set, the
face will:

- Create the private directory (default: `~/.codex-home` if not provided).
- Write `codex.config.toml` into that directory (based on the bundled template
  with absolute MCP server command paths).
- Start `npx -y openai/codex` with `CODEX_HOME` set to the private directory and
  the workspace directory as the process CWD.

Example:

```ts
import { startFaceCodex } from './main.ts'

const face = startFaceCodex({
  launch: true,
  codexHome: '/tmp/my-codex-home', // private app dir (config/cache/scratch)
  workspaceDir: '/work/my-project', // CLI working dir (files, editing, etc.)
})

console.log(await face.status())
// { startedAt, closed: false, interactions: 0, pid, codexHome, workspaceDir }

// ... later when done
await face.close() // terminates the Codex CLI process
```

# codex-notify

Small Deno utility that can be used with Codex CLI’s `notify` config option to
receive notification payloads. It validates the JSON with Zod, then echoes the
raw payload to stdout.

## Usage

- Make the script executable and call it directly (relies on the shebang):

  - config.toml:

    notify = ["/absolute/path/to/universal-compute/codex-notify/main.ts"]

- Or invoke via `deno run` explicitly:

  - config.toml:

    notify = ["deno", "run",
    "/absolute/path/to/universal-compute/codex-notify/main.ts"]

The Codex CLI will pass a single argument containing a JSON string. This tool
validates and then logs that string to stdout.

### Validation

Expected shape (Zod):

```json
{
  "type": "agent-turn-complete",
  "turn-id": "...",
  "input-messages": ["..."],
  "last-assistant-message": "..."
}
```

If validation fails or the input isn’t valid JSON, an error is written to stderr
and the process exits with code 2.

## Local development

- Run tests: `deno task test`
- Format/lint: `deno task fmt` / `deno task lint`
