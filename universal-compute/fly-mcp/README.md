this is a stdio mcp server that goes with every agent that is used to provide
interactions with the agent infrastructure.

## agent commands:

- create_agent
- destroy_agent
- list_agents

`list_agents` lists Fly Machines for the current app. It reads `FLY_APP_NAME`
(or `FLY_APP`) and `FLY_API_TOKEN` from the environment. No input params are
required. Run with Deno permissions `--allow-env --allow-net`.

Then there are commands for managing the view:

## view commands

- handoff
