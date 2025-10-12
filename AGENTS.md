to learn how to run the fly cli command, use `fly --help`

if you want to read the logs of any deployed app, use:
`fly logs --config <filename>.toml --no-tail`

logs can be targetted to a specific machine too:
`fly logs --config <filename>.toml --no-tail --machine <machine-id>`

any time you need to specify a config, you can also specify the app name: ``fly
logs --app <app-name> --no-tail`

logs can sometimes be delayed by up to 5 minutes, so if you are not seeing the
logs you expect, use a delay command to burn some time before you check again.

You can test the deployed applications using curl to trigger responses.

Any time you are contemplating some way of interacting with the fly.io
infrastructure, or attempting something new in deno, use the net to search for
the latest information, since both the deno project and the fly.io platform
change frequently - you need the latest information to use these things
effectively.

## Purpose and References

- Primary flyctl CLI reference: https://fly.io/docs/flyctl/ (also available via
  `fly --help`)
- Model Context Protocol specification (2025-06-18):
  https://modelcontextprotocol.io/specification/2025-06-18
- @modelcontextprotocol/sdk examples:
  https://github.com/modelcontextprotocol/typescript-sdk

## App-Specific Responsibilities

This document captures shared guidance. The canonical runbooks for individual
Fly apps live alongside each app and must take precedence:

- `fly-router/AGENTS.md` defines how the router handles base-domain, computer
  domain, and agent domain requests, provisions actor computers and landing
  agents, and coordinates updates with the exec service.
- `fly-exec/AGENTS.md` defines how the exec service reconciles filesystem state
  with Fly Machines, manages hardware faults, and replays requests that failed
  mid-flight.

If any guidance here appears to diverge from those files, defer to the canonical
app documents and update this file to stay in alignment rather than altering the
app-level references.

## .refs Folder

Do not modify files under `.refs/`. They exist only as read-only implementation
references (for example `.refs/codex/codex-rs/`).

## Authentication and Test Hooks

- Clerk is the authoritative auth layer. Unauthenticated interactive requests
  are redirected to `CLERK_SIGN_IN_URL`/`CLERK_SIGN_UP_URL`; JSON callers
  receive `401` with `{ "error": "unauthenticated" }`.
- The integration bypass accepts
  `x-artifact-test-user: <INTEGRATION_TEST_USER_ID>` (default
  `integration-suite`). Only that value is honored; all other headers fall back
  to Clerk.
- `DELETE /integration/actor` tears down the integration actor app and its
  storage. Use it only when no tests are running; coordination is informal and
  currently limited to our internal team.

## Operational Guidelines

### Deployment to Fly.io

- Each Fly app has a root-level `fly.<name>.toml`. Deploy with
  `fly deploy --config fly.<name>.toml`.
- After changes that impact Fly behavior, redeploy or run builds through Fly’s
  infrastructure to validate.
- Remote command execution is available via
  `fly ssh console --config fly.<name>.toml`.
- Use `auto_stop_machines = 'suspend'` (not `stop`) when configuring services so
  machines hibernate correctly.

### Code Rules

- Never run `git add` unless explicitly instructed.
- Favor concise implementations; no need to preserve legacy switches.
- Every project must expose an `ok` task in its `deno.json` that runs
  `deno check`, `deno task test`, `deno fmt --check`, then `deno lint` in that
  order.
- Validate your changes with `deno task ok`.
- Compliance is manual for now: reviewers watch for repos that miss the `ok`
  task and request fixes when they spot gaps.
- Use `deno fmt`, `deno check`, and `deno lint --fix` to resolve formatting,
  type, and lint issues quickly.
- Avoid leaving “what changed” comments in code; rely on version control.
- When intentionally swallowing errors, add a lint hint such as `// ignore`.
- tests are to be named <filename>.test.<ext> and live right next to the file
  they exercise, which would be named <filename>.<ext>
- you never need to make lines like
  `"dev": "deno run --config ../deno.json --allow-net --allow-env main.ts"`
  since the `--config ../deno.json` is always added by deno automatically.

### Deno Configuration

- Keep import map entries in the root `deno.json`; project-level files must not
  define their own maps.
- Install new dependencies via `deno install <spec>` from the repo root so
  `deno.lock` stays accurate.
- Tests should use `expect` from `jsr:@std/expect`.
- Avoid async IIFEs; prefer named async functions and call them explicitly.
