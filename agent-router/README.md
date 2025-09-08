Agent Router (Deno + Hono)

Overview

- Implements the URL routing behavior from `design/docs/URLS.md`.
- Uses Deno + Hono with simple, in-memory stubs for Registry/Artifact calls.
- Host-aware routing for the base domain vs. app subdomains.

Run

- Dev: `deno task -c universal-compute/agent-router/deno.json dev`
- Prod: `deno run -A universal-compute/agent-router/src/main.ts`

Config (env)

- `BASE_DOMAIN` (default `dreamcatcher.ai`)
- `ALLOW_ANY_APP` (default `true`)
- `DEFAULT_HOME_AGENT` (default `home-agent`)
- `ROUTER_VERSION` (string shown at `/_version`)

Auth (dev)

- Requests with header `x-user-id: <id>` are considered authed.
- Optionally set `x-home-app: <app>` to simulate a resolved home app.

Endpoints (high level)

- `/` on base domain: redirect to app home if authed+has home; else to `/<home-agent>`.
- `/<home-agent>` and `/concierge`: ensure `?face=...` then serve `public/agent.html`.
- App host `https://{app}.BASE_DOMAIN/{agent}`: ensure `?face=...` then serve `public/agent.html`.
- Unknown path on base domain → redirect to `/`.
- Health: `/_healthz`, `/_readyz`, `/_version`.
- Auth helpers: `/auth/me`, `/logout` (clears dev cookie), `/auth/callback` (stub).
- Faces index: `/{agent}/faces` returns active faces for the agent path.

Static UI

- Files under `public/` are standalone pages and modules:
  - `public/agent.html` → loads `/assets/agent.js` and reads `agentPath` from `location.pathname`
    and `face` from `?face`.
  - `public/maintenance.html` → shows maintenance message (reads subdomain from
    `location.hostname`).
- Assets are served from `/assets/*`.

Notes

- Faces are in-memory and ephemeral; this is a router skeleton for integration.
- Registry/Artifact calls are stubbed; wire to real services later.

Proxy

- `/tty[/...]` reverses to `https://codex-rs.fly.dev` (override with `TTYD_ORIGIN`).
- WebSocket upgrades on `/tty/ws` are bridged to the origin.
- Base `/concierge?face=...` and app-host attach paths redirect to `/tty/` for now.

MCP: This router no longer embeds an HTTP MCP app; we’ll run the MCP server via stdio separately.

Browser MCP Server (demo)

- Route `/mcp` serves a minimal MCP server running inside the browser using
  `@modelcontextprotocol/sdk` over a `MessageChannel`.
- The server waits for the parent window to post a `MessagePort` via
  `postMessage({ type: 'mcp:connect' }, '*', [port])`.
- Exposes simple tools: `ping` and `info`.

Parent connect example:

```
// In a parent page
const iframe = document.createElement('iframe');
iframe.src = '/mcp';
document.body.appendChild(iframe);
iframe.addEventListener('load', async () => {
  const channel = new MessageChannel();
  iframe.contentWindow.postMessage({ type: 'mcp:connect' }, '*', [channel.port1]);

  // Optional: use the SDK Client over the other port
  const { Client } = await import('https://esm.sh/@modelcontextprotocol/sdk@1.17.4/client');
  class PostMessageTransport {
    constructor(port){ this.port = port; }
    async start(){ this.port.onmessage = (e) => this.onmessage?.(e.data); this.port.start?.(); }
    async send(msg){ this.port.postMessage(msg); }
    async close(){ this.port.close?.(); this.onclose?.(); }
    onmessage; onclose; onerror; sessionId = crypto.randomUUID?.() || String(Math.random());
  }
  const client = new Client({ name: 'parent-dev', version: '0.1.0' });
  await client.connect(new PostMessageTransport(channel.port2));
  console.log('tools:', await client.listTools({}));
  console.log('ping:', await client.callTool({ name: 'ping', arguments: {} }));
});
```
