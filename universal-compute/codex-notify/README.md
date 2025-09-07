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
