The primary reference for working with Fly is the `flyctl` command-line
documentation: https://fly.io/docs/flyctl/ which is easily accessible at any
time by running `fly --help` on the command line and learning about the commands
and syntax directly.

The spec for the modelcontextprotocol is:
https://modelcontextprotocol.io/specification/2025-06-18

Repo for the npm package @modelcontextprotocol/sdk contains many examples and
can be found at: https://github.com/modelcontextprotocol/typescript-sdk

## .refs folder

The .refs folder contains code for reference only NEVER MODIFY ANYTHING INSIDE
THIS FOLDER. If you ever want to know about the inner workings of codex, then
you can read thru the code inside `.refs/codex/codex-rs/`.

## Fly CLI usage

- All Fly automation must go through the helpers exposed in `@artifact/tasks`;
  never call the Machines API directly from application code.
- Prefer the CLI's structured output flags (`--json`, `--machine-config`, etc.)
  so we can map results deterministically without scraping human text.
- Make sure any runtime images (Docker, CI, devcontainers) install the `fly`
  binary via the official installer
  (`curl -fsSL https://fly.io/install.sh | sh`) and place it on `PATH`.
- Do not add fallback env vars or heuristics when calling Fly helpers—fail
  immediately if the expected inputs are missing or malformed.
- Flycast is Fly's private HTTP ingress. Allocate a private IPv6
  (`fly ips
  allocate-v6 --private --app <name>`) for every actor app so
  `fly-replay` headers can target it; without that address, replay-to-Flycast
  inflight routing will fail.
- `fly-replay` only works with HTTP listeners. Keep service definitions exactly
  as sourced from the template app and let provisioning add the image override
  only; avoid any auto-generated service defaults.
- When baking `flyctl` into a container, prefer the installer’s `FLYCTL_INSTALL`
  output over copying binaries by hand so the CLI stays upgradable. A minimal
  Alpine example:

  ```Dockerfile
  ENV FLYCTL_INSTALL=/usr/local
  ENV PATH="${FLYCTL_INSTALL}/bin:${PATH}"

  RUN curl -fsSL https://fly.io/install.sh | sh

  RUN flyctl settings autoupdate disable
  RUN flyctl settings analytics disable
  ```
- When adding new Fly-related features, check whether an existing wrapper in
  `tasks/fly.ts` can be reused; otherwise extend that module so the entire
  workspace benefits from a single implementation.
- When provisioning per-user apps, always pass a unique `--network` when
  calling `fly apps create` so each tenant’s machines live on an isolated
  WireGuard segment.

## Deployment to fly.io

This project contains multiple fly apps, and the config files for them are all
in the root under fly.*.toml. To deploy these apps, use:

`fly deploy --config fly.<config name>.toml`

If you have done something that might affect how the fly apps work, be sure to
deploy or build using the fly.io infrastructure, until you are satisfied things
work correctly. You are in charge of the fly installation, so use this liberally
to test and to do experiments with.

you can use the command `fly logs -c fly.<config name>.toml` to check the logs
of the app. Always wrap `fly logs` in a timeout (for example
`timeout 30s fly logs ...`) so the command cannot hang the shell.

you can ssh in or send commands in using
`fly ssh console -c fly.<config name>.toml` which enables you to execute remote
commands.

## Fly deployment tips

- Keep the single `.dockerignore` at the repo root; Fly only reads the root
  file, so move any per-app rules there and make sure heavy directories like
  `node_modules/` stay excluded.
- If the builder is still uploading massive contexts, run `du -sh * | sort -h`
  to surface directories that should be ignored before redeploying.
- `fly deploy --config fly.<name>.toml` may run longer than two minutes when
  pushing larger layers—rerun without artificial timeouts and watch the Fly
  dashboard for status.
- if you configre the line `auto_stop_machines = 'suspend'` be sure to use
  'suspend' and not stop, as this is a new feature and is preferred.

## Code rules

never git add anything unless explicitly told to.

Always value terseness and brevity over preserving legacy options in code - this
is a greenfields project so you never need to worry about legacy.

To verify the code works, run `deno task ok`.

Every deno project in the workspace must expose an `ok` task in its `deno.json`,
and that task must run `deno check`, `deno task test`, `deno fmt --check`, and
`deno lint` in that order.

Do not add environment fallbacks when resolving runtime configuration. Read the
authoritative value (for example, Fly template machine configuration) at the
point of use and fail immediately if it is missing or invalid.

Document every new environment variable by adding it to `shared/app_env.ts` and
`design/docs/app-env.md` before landing the change, and if removing or modifying
env vars, be sure to update the documentation

To fix formatting errors quickly, run `deno fmt`.

To check types quickly, run `deno check`.

To fix lint errors quickly, run `deno lint --fix`

Whenever you change code, never leave comments saying what you changed - we
don't need that, we keep track of that in git commit messages, not in the code.

this pattern is perfectly acceptable, but note that you must use the //ignore
comment or some kind of comment to avoid lint issues:

```ts
try {
  a = riskyOperation()
} catch {
  // ignore
}
```

Whenever you see a task like `deno task dev` be very careful running it since it
is designed to never exit, as it runs a web server. If you must run this command
you will need to use a timeout or something to exit it.

when installing packages on deno, always use the deno install tool, like
`deno install jsr:@std/expect` or `deno install npm:debug`.

for tests, use expect from `jsr:@std/expect` which can be imported like this:
`import { expect } from '@std/expect'`

## Deno configuration

- Keep all `imports` entries in the root `deno.json` only; project-level
  `deno.json` files should never define their own import map.
- When you need a new dependency, run `deno install <spec>` (for example
  `deno install jsr:@std/expect`) from the repo root so the root import map and
  `deno.lock` stay in sync.
- Any projects within the workspace do not need to be mentioned in the import
  map, as this is something that deno workspaces handle for us

## Avoid Async IIFEs

Do not use anonymous Immediately Invoked Function Expressions (IIFEs), including
async versions like `;(async () => { ... })()` for side‑effects. Instead, define
a clearly named function and call it by name.

Bad:

```ts
;(async () => {
  // work
})()
```

Good:

```ts
async function sendKeysViaTmux(/* args */) {
  // work
}

await sendKeysViaTmux() /* args */
```

Benefits: clearer stack traces, easier testing and reuse, and no hidden
top‑level side effects.
