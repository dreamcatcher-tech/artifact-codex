This is a Stdio MCP server that interacts with Fly.io and exposes a domain model
tailored to our language:

- Computer: a Fly.io app
- Agent: a Fly.io machine
- Agent Image: a Fly.io Docker image used by an Agent

## Tools

- `read_agent`: Returns structured info for an Agent (Fly Machine) by a provided
  `id` string, where the id is the Machine name. The tool looks up the machine
  by name within the current app and returns full details including `metadata`
  (from the machine config). If no machine is found, it returns
  `{ exists: false }`.
- `list_agents`: Lists Agents (machines) for the current Computer (Fly app).
  Returns id, name, state, region, image, ip, createdAt, and each agent's
  `metadata` (from its config).
- `create_agent`: Creates a new Agent (machine) for the current Computer. The
  Agent is created in the `worker` process group via metadata
  (`fly_process_group=worker`). Names are automatically suffixed with an
  incrementing index: given a requested base name `foo`, the server lists
  existing agents and chooses `foo-<n>` where `n` is one greater than the
  largest existing numeric suffix for `foo` (starting at `0`). If you pass a
  name that already ends with `-<number>`, the server uses the base before the
  numeric suffix (e.g., `foo-9` still produces `foo-10`).
- `destroy_agent`: Destroys an Agent (machine) in the current Computer. Accepts
  an `id` or a `name` and optionally `force`.

The previous demo tools (`echo`, `add`) have been removed.

CLI helpers

- `flyCliListMachines({ appName, token })`: returns array of Agent summaries
  using the Fly CLI.
- `flyCliCreateMachine({ appName, token, name, config, region? })`: creates an
  Agent via the Fly CLI wrappers.

## Environment Variables

Exactly one environment variable is used per purpose. Names match the variables
that Fly.io injects into a Machine’s runtime environment, with one explicit
exception noted below. See “The Machine Runtime Environment” in the Fly docs for
authoritative definitions.

- FLY_APP_NAME: Computer (Fly app) name. Used to scope CLI requests for reading
  and listing/creating Agents.
- FLY_IMAGE_REF: Docker image reference for the current Machine. Used by
  `create_agent` as the image to launch for the new Agent (i.e., to clone the
  current agent image).
- FLY_REGION: Current region of this Machine. If set, `create_agent` uses this
  as the region for the new Agent; otherwise region is omitted and Fly schedules
  per its defaults.
- FLY_API_TOKEN: Token used by the Fly CLI. Set it yourself (for example with
  `fly secrets set` or via your process environment) so the MCP server can
  authenticate.

No fallbacks are used (for example, `FLY_APP`, `FLY_ACCESS_TOKEN`,
`AGENT_IMAGE`, `FLY_IMAGE` have been removed). If a required variable is
missing, the tool returns a clear error in the result content.

Run with Deno permissions `--allow-env --allow-net`.

## Agent Task Commands (reserved)

- `invoke`
- `cancel`
- `resume`

## View Commands (reserved)

- `handoff`

## Tests

- Unit tests for Fly Machines helpers and naming live in `shared`:
  - `shared/fly.test.ts`
  - `shared/naming.test.ts`
- This package contains integration tests for the MCP server (`main.test.ts`).
- Run tests locally with `deno task ok` from this directory.
