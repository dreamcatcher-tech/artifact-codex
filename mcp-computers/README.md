This is a Stdio MCP server focused on Computer management in Fly.io.

- Computer: a Fly.io app
- Agent: a Fly.io machine

## Tools

- `list_computers`: Lists Computers (Fly apps) in the organization inferred from
  the current app (`FLY_APP_NAME`).
- `read_computer`: Given a `userId`, reads the Computer named
  `computer-user-<userId>`. Returns
  `{ exists: true, computer: { id, name, organizationSlug, createdAt } }` if
  found, otherwise `{ exists: false }`.
- `create_computer`: Creates a new Computer by copying config from the current
  Computer and launching its first Agent using `FLY_IMAGE_REF`. The first agent
  name follows an incrementing suffix (base `agent`, e.g. `agent-0`). The
  Computer name is `computer-user-<userId>`.
- `destroy_computer`: Destroys a Computer (Fly app) by deleting the app
  directly. Refuses to delete the current Computer (returns "I cannot self
  terminate"). Accepts `name` (defaults to `FLY_APP_NAME`) and optionally
  `force`.

### CLI helpers

- `flyCliAppsList({ token, orgSlug })`: lists Computers (Fly apps).
- `flyCliAppsCreate({ token, appName, orgSlug })`: creates a Computer (Fly app).
- `flyCliAppsInfo({ token, appName })`: fetch info about a specific Computer.
- `flyCliAppsDestroy({ token, appName, force? })`: destroy a Computer via the
  Fly CLI.
- `flyCliListMachines({ appName, token })`: list Agents for a Computer.
- `flyCliCreateMachine({ appName, token, name, config, region? })`: create an
  Agent.

## Environment Variables

- `FLY_APP_NAME`: Current app name (used to infer organization).
- `FLY_IMAGE_REF`: Docker image for the current Agent; used to seed the first
  Agent in a newly created Computer.
- `FLY_REGION`: Region for Machine operations when applicable.
- `FLY_API_TOKEN`: Fly API access token.

Run with Deno permissions `--allow-env --allow-net`.

## Tests

- Unit tests for the shared Fly Machines helpers and naming live in `shared`:
  - `shared/fly.test.ts`
  - `shared/naming.test.ts`
- This package contains integration tests for the MCP server (`main.test.ts`).
- Run tests locally with `deno task ok` from this directory.
