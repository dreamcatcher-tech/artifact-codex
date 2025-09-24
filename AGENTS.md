# Agents Platform Guide

## Purpose and References

- Primary flyctl CLI reference: https://fly.io/docs/flyctl/ (also available via
  `fly --help`)
- Model Context Protocol specification (2025-06-18):
  https://modelcontextprotocol.io/specification/2025-06-18
- @modelcontextprotocol/sdk examples:
  https://github.com/modelcontextprotocol/typescript-sdk

## .refs Folder

Do not modify files under `.refs/`. They exist only as read-only implementation
references (for example `.refs/codex/codex-rs/`).

## Architecture Overview

- **fly-auth** — public edge app handling Clerk authentication, per-user actor
  app provisioning, and the first `fly-replay`.
- **Actor apps** — one Fly app per authenticated user (named `actor-<slug>`).
  Each is cloned from the `fly-computer` template, inherits the full 3000–30000
  port range, and stores its registry on the shared NFS mount.
- **fly-computer** — canonical template whose configuration, secrets, and
  machine metadata expectations are copied into every actor app; it also runs as
  its own app for integration flows.
- **Agent machines** — Fly Machines launched inside each actor app using the
  `fly-agent` (`universal-compute`) image. They execute Codex agents and expose
  HTTP endpoints on any published port.
- **Shared storage** — NFS volume mounted at `/mnt/computers`, holding per-actor
  state, agent registries, and machine metadata.

## Request Lifecycle

The platform intentionally performs two consecutive `fly-replay` hops so the
correct component owns each decision.

### Stage 1 – fly-auth front door

1. Incoming HTTPS request terminates at `fly-auth`.
2. Clerk middleware authenticates the session unless the `x-artifact-test-user`
   override header (for integration tests) is present.
3. The user ID is normalized into an actor app slug (`actor-…`) and the service
   ensures:
   - the NFS mount is online (`ensureComputersMounted`);
   - the per-user folder exists (missing folders are rebuilt, folders without a
     corresponding Fly app are treated as stale and removed);
   - a matching Fly app exists by cloning the `fly-computer` template, copying
     the image, and ensuring at least one private IPv6 (Flycast needs a private
     address for replay; extra allocations are acceptable);
   - controller secrets (`FLY_API_TOKEN`, `FLY_COMPUTER_TARGET_APP`,
     `FLY_COMPUTER_AGENT_IMAGE`) are present.
4. If the request arrived on the wrong host, the service issues a 302 redirect
   to `https://actor-<user>.<FLY_AUTH_BASE_DOMAIN>` while preserving the path,
   query, and choosing the scheme from `fly-forwarded-proto` when available.
5. When the request is on the actor host, `fly-auth` returns `204 No Content`
   with `fly-replay: app=<actor-app>`. **Never append `fly_force_instance` or
   other replay directives at this stage; the actor app owns machine
   selection.**

### Stage 2 – actor app (fly-computer runtime)

1. The replayed request now hits the per-user actor app (which runs the
   `fly-computer` codebase).
2. The app decodes the host into a `computer` slug and optional nested agent
   path segments (subdomains joined with `--`).
3. Landing hosts (no agent path) create a fresh agent record, reconcile
   machines, and redirect to the agent-specific host
   (`302 Location: https://<agent-path>--<computer>.<base>`). Idle machines are
   either destroyed or returned to a warm pool so future agents can reuse them
   without a cold boot.
4. Hosts targeting an existing agent load or bootstrap a Fly Machine:
   - template configuration from `FLY_AGENT_TEMPLATE_APP` seeds memory, volumes,
     and networking. This template diverges from
     `FLY_COMPUTER_TARGET_APP`: the latter runs the baseline process management
     stack, while the former bakes in the tool-heavy agent image used at runtime;
   - machines are started on demand.
5. The actor app finally emits
   `fly-replay: app=<actor-app>;fly_force_instance=<machine-id>`, pinning the
   request to the ready machine. Fly preserves the method, path, query, headers,
   body, and original external port across this replay.

### Stage 3 – agent machine

1. The replay reaches the Fly Machine running the `fly-agent` image.
2. The entrypoint mounts the shared NFS and launches
   `/agent/web-server/main.ts`, which serves the actual Codex agent runtime.
   This path is the canonical entrypoint; when we migrate the web-server project
   fully into the `fly-agent` repo, keep the same single-entry contract.
3. Agents may open additional listeners within 3000–30000; because every Fly app
   advertises that full range, follow-up `fly-replay` calls succeed for
   non-default ports and paths. Monitoring for stray listeners stays the
   responsibility of each agent runtime.

## Replay and Redirect Rules

- Do not bypass the staged flow: front doors (`fly-auth`, future edge services)
  must only set `fly-replay: app=<actor-app>`.
- Only the actor app may add `fly_force_instance=<machine-id>` after it has
  proven the target machine is healthy.
- `fly-replay` works solely for HTTP/TLS listeners. Ensure every service
  definition carries `handlers = ["tls", "http"]` across the full 3000–30000
  range.
- Preserve the original request semantics. Never mutate method, path, query,
  headers, or body during redirects or replay hand-offs.
- For redirects, always drop the port (Fly injects the correct published
  listener) and prefer `fly-forwarded-proto`/`x-forwarded-proto` to maintain
  HTTPS.

## Hostnames, Ports, and Paths

- `FLY_AUTH_BASE_DOMAIN` is the canonical suffix (for example
  `agentic.dreamcatcher.land`). Every actor host is
  `<agent-subdomain>.<base-domain>`.
- Subdomains encode agent paths with `--` separators
  (`agent--child--computer.base`). Use `agentToSubdomain`/`subdomainToAgent`
  helpers instead of manual string munging.
- All Fly apps in this stack declare `[[services.ports]]` with
  `start_port = 3000` and `end_port = 30000`. This catches WebSocket upgrades,
  dev tunnels, and future sidecars without config drift.
- Redirect helpers strip any explicit port so that Fly’s edge selects the
  published listener automatically. Path and query segments are always retained.
- When mirroring configuration into new actor apps, never tighten the port
  range, drop HTTP handlers, or add custom load balancers—doing so breaks replay
  for agents that bind outside the default web port.

## Storage and Provisioning

- Shared state lives on the Fly NFS export (`NFS_EXPORT_BASE`) mounted at
  `/mnt/computers`. Each actor app owns a folder named after its Fly app.
- `ensureActorApp` removes the folder if the Fly app vanished, keeping storage
  in sync with infrastructure.
- Private IPv6 allocation (`fly ips allocate-v6 --private`) is mandatory. Actor
  apps must have at least one private IPv6 so Flycast routing succeeds; public
  IPs are revoked automatically, and any surplus private allocations are
  harmless.
- Per-actor provisioning copies the template app’s machine config, swaps in the
  template image, and deploys with `fly deploy`. Failed deploys trigger cleanup
  via `fly apps destroy --force`.
- Registry data under `/mnt/computers/<actor-app>/agents` tracks machine IDs and
  metadata used by `fly-computer` to resume agents after restarts.
- Registry data under `/mnt/computers/<actor-app>/machines` tracks the machines
  that are running and if they are running an agent, which agent they are
  running by the agent id. Each registry entry is written as a single file, and
  we currently rely on that write completing cleanly instead of layering extra
  torn-write protections.

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

### Fly CLI Usage

- Automate Fly interactions via `@artifact/tasks`; never call the Fly Machines
  API directly from application code.
- Extend `tasks/fly.ts` when new helpers are required so the whole workspace
  reuses a single implementation.
- Always provision apps on Fly’s default network; do not pass `--network` or
  rely on tenant-specific networks. Isolation comes from the application layer
  and Flycast.
- You may run the `fly` CLI locally for experiments, deploys, and diagnostics.
- Prefer structured outputs (`--json`, `--machine-config`) to avoid parsing
  human text.
- Install `flyctl` through the official installer, set `FLYCTL_INSTALL` (for
  example `/usr/local`), and add `${FLYCTL_INSTALL}/bin` to `PATH`.
- In local development we keep Fly's defaults so engineers can use the CLI for
  provisioning and diagnostics; in container builds we explicitly disable
  autoupdate/analytics to prevent background processes.
- Do not introduce environment fallbacks—missing or malformed inputs should fail
  fast.
- Flycast is Fly’s private HTTP ingress; ensure every actor app keeps the single
  private IPv6 allocated for it to avoid replay failures.
- When replaying actor traffic from `fly-auth`, emit only
  `fly-replay: app=<actor-app>`; allow the actor app to select the machine.
- Keep HTTP service definitions identical to the template; avoid auto-generated
  defaults when provisioning.

### Deployment to Fly.io

- Each Fly app has a root-level `fly.<name>.toml`. Deploy with
  `fly deploy --config fly.<name>.toml`.
- After changes that impact Fly behavior, redeploy or run builds through Fly’s
  infrastructure to validate.
- Inspect logs with `timeout 30s fly logs -c fly.<name>.toml` to avoid hanging
  processes.
- Remote debugging is available via `fly ssh console -c fly.<name>.toml`.

### Fly Deployment Tips

- Maintain a single root `.dockerignore`; ensure heavyweight directories (e.g.
  `node_modules/`) stay excluded.
- If deploys upload large contexts, run `du -sh * | sort -h` to spot directories
  to ignore.
- Long pushes are normal; rerun `fly deploy` without artificial timeouts and
  monitor the Fly dashboard.
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
- Resolve configuration directly from the authoritative source (for example Fly
  machine config); abort on missing data instead of adding fallbacks.
- Document any new or changed environment variables in `shared/app_env.ts` and
  `design/docs/app-env.md`.
- Use `deno fmt`, `deno check`, and `deno lint --fix` to resolve formatting,
  type, and lint issues quickly.
- Avoid leaving “what changed” comments in code; rely on version control.
- When intentionally swallowing errors, add a lint hint such as `// ignore`.
- Be cautious with long-running tasks like `deno task dev`; wrap them with a
  timeout when necessary.

### Deno Configuration

- Keep import map entries in the root `deno.json`; project-level files must not
  define their own maps.
- Install new dependencies via `deno install <spec>` from the repo root so
  `deno.lock` stays accurate.
- Tests should use `expect` from `jsr:@std/expect`.
- Avoid async IIFEs; prefer named async functions and call them explicitly.
