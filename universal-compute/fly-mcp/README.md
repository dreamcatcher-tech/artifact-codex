This is a Stdio MCP server that interacts with Fly.io and exposes a domain model
tailored to our language:

- Computer: a Fly.io app
- Agent: a Fly.io machine
- Agent Image: a Fly.io Docker image used by an Agent

## Tools

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
- `list_computers`: Lists Computers (Fly apps) in the organization inferred from
  the current app (`FLY_APP_NAME`). The server calls `GET /v1/apps/{name}` to
  obtain the organization slug and then lists apps for that organization.
- `computer_exists`: Given a `userId`, checks if the Computer named
  `computer-user-<userId>` exists.
- `create_computer`: Creates a new Computer by copying config from the current
  Computer and launching its first Agent using `FLY_IMAGE_REF`. The first agent
  name follows the same suffixing rule (base `agent`, so usually `agent-0`). The
  Computer name is `computer-user-<userId>`.
- `destroy_agent`: Destroys an Agent (machine) in the current Computer. Accepts
  an `id` or a `name` and optionally `force`.
- `destroy_computer`: Destroys a Computer (Fly app) by deleting the app
  directly. Refuses to delete the current Computer (returns "I cannot self
  terminate"). Accepts `name` (defaults to `FLY_APP_NAME`) and optionally
  `force`.

The previous demo tools (`echo`, `add`) have been removed.

API helpers

- `listMachines(appName, token)`: returns array of Agent summaries.
- `createMachine({ appName, token, name, config, region? })`: creates an Agent.
- `listFlyApps({ token, orgSlug })`: lists Computers (Fly apps).
- `createFlyApp({ token, appName, orgSlug })`: creates a Computer (Fly app).
- `appExists({ token, appName })`: boolean existence check for a Computer.

## Environment Variables

Exactly one environment variable is used per purpose. Names match the variables
that Fly.io injects into a Machine’s runtime environment, with one explicit
exception noted below. See “The Machine Runtime Environment” in the Fly docs for
authoritative definitions.

- FLY_APP_NAME: Computer (Fly app) name. Used to scope API requests for listing
  and creating Agents.
- FLY_IMAGE_REF: Docker image reference for the current Machine. Used by
  `create_agent` as the image to launch for the new Agent (i.e., to clone the
  current agent image).
- FLY_REGION: Current region of this Machine. If set, `create_agent` uses this
  as the region for the new Agent; otherwise region is omitted and Fly schedules
  per its defaults.
- FLY_API_TOKEN: API access token. Required to call the Machines API. This is
  not injected by Fly; set it yourself (for example with `fly secrets set` or
  via your process environment) for the MCP server process.

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
