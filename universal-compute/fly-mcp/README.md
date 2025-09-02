This is a Stdio MCP server that provides tools to interact with Fly.io Machines
for agent lifecycle operations.

## Tools

- `list_agents`: Lists Machines for the current Fly app.
- `create_agent`: Creates a new Machine (agent) for the current Fly app.

The previous demo tools (`echo`, `add`) have been removed.

## Environment Variables

Exactly one environment variable is used per purpose. Names match the variables
that Fly.io injects into a Machine’s runtime environment, with one explicit
exception noted below. See “The Machine Runtime Environment” in the Fly docs for
authoritative definitions.

- FLY_APP_NAME: App name. Used to scope API requests for listing and creating
  Machines.
- FLY_IMAGE_REF: Docker image reference for the current Machine. Used by
  `create_agent` as the image to launch for the new Machine (i.e., to clone the
  current agent image).
- FLY_REGION: Current region of this Machine. If set, `create_agent` uses this
  as the region for the new Machine; otherwise region is omitted and Fly
  schedules per its defaults.
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
