# Supervisor Agent Classification

This service handles three request families on the same listener port:

- **Supervisor MCP** – external Model Context Protocol traffic routed through
  Fly.
- **Agent MCP** – internal local tools calling the MCP handler that runs inside
  the supervisor.
- **Web** – external browser/API traffic that is proxied to local ports.

Understanding how each flow is detected keeps local mocks aligned with Fly.io
behavior and prevents regressions when we extend the router.

## Classification Rules

`supervisor/app.ts` evaluates each request in three passes:

1. **Forwarded port** – we parse `Fly-Forwarded-Port` (case-insensitive),
   accepting 1–5 digit numbers between 1 and 65535. Any malformed value is
   discarded.
2. **Flows**
   - If the forwarded port equals `MCP_PORT` (default `442`), the request is
     **supervisor MCP** and goes to `agent.external`.
   - If _no_ forwarded port is present, the request targets `localhost`,
     `127.0.0.1`, or `::1`, and it includes _any_ `dc-agent-mcp` header value,
     the request is **agent MCP** and goes to `agent.internal`.
   - Everything else is **web**. We proxy to the forwarded port when provided.
     When there is no forwarded port (or it equals `443`), we resolve the
     default view by calling `agent.getDefaultViewPort()`, which calls the
     `interaction_views` tool and uses the first view’s `port`. Note that there
     may not yet be a default view instantiated, in which case an HTTPException
     will be thrown.
3. **Context** – the resulting `{ kind: ..., port? }` is stored on the Hono
   context so downstream middleware can branch without recomputing.

`agent.getDefaultViewPort()` is only reachable once the loader transitions the
agent state to `ready`. Until then, `agent.loader` captures requests and serves
a loading response.

## Why This Shape?

- **Fly compatibility** – Fly always supplies `Fly-Forwarded-Port`; comparing it
  to `MCP_PORT` reliably spots supervisor MCP calls.
- **Mock resilience** – local browsers and MCP tool calls arrive on the same
  listener port. Calling the `interaction_views` tool tells the supervisor which
  web port(s) the agent currently exposes (if any), so we route to the right
  place without relying on a hard-coded default.
- **Explicit agent intent** – requiring `dc-agent-mcp` keeps agent calls opt-in
  and stops local browser traffic (which may also originate from `localhost`)
  from tripping agent mode.

## Testing Scenarios

### Start a Local Fixture

From `supervisor/`, boot the mock with the same orchestration the Fly app uses:

```bash
deno task dev --port 8080
```

Leave this running; the logs in `/tmp/supervisor-dev.log` show request
classification and, when views spin up, the proxied port.

### Exercise MCP Flows with the CLI

Use the local CLI tool so we negotiate MCP correctly:

```bash
# Start an interaction and capture its id
deno task mcp start 'hello world'

# Await the value; structured JSON is printed on success
deno task mcp await 0

# Cancel or check status as needed
deno task mcp cancel 0
deno task mcp status 0
```

The CLI exits non-zero if the tool responded with `isError`; that makes failures
obvious inside scripts.

### Serve a View and Test the Proxy

1. Ask the agent to expose a view (the `serve` keyword is recognised by the test
   agent):

   ```bash
   deno task mcp start 'serve demo'
   ```

   Note the returned `interactionId`. The supervisor log will later show which
   backend port was published (for example
   `proxying web request for port 39675`).

2. Hit the supervisor without a forwarded port. It will resolve the default view
   via the `interaction_views` tool and proxy automatically:

   ```bash
   curl -s http://localhost:8080/
   ```

3. To mimic Fly’s forwarded-port routing, reuse the port logged in step 1:

   ```bash
   curl -s \
     -H 'Fly-Forwarded-Port: 39675' \
     http://localhost:8080/
   ```

   You should see the same JSON response, and the supervisor log will label the
   request as `web` with the provided port. If no view is active yet, the first
   `curl` returns HTTP 503 complaining that no views are available yet.

4. When finished, stop the local fixture with `Ctrl+C` (or `pkill -f deno.*dev`
   if it’s backgrounded) so follow-up runs can bind to port 8080.

## Notes for Collaborators

- Keep the classification logic single-sourced in `supervisor/app.ts`; add
  invariants/tests there if you extend headers or ports.
- If you introduce new headers for agent detection, ensure mocks and production
  both populate them or gate behavior behind environment flags.
- When testing web flows end-to-end, give Fly up to five minutes for logs to
  appear (`fly logs --config fly.supervisor.toml --no-tail`), or insert a delay
  before reading logs if you need immediate confirmation.
