# Deno + Hono Port Param Proxy

A tiny Deno project that uses Hono (from JSR) to proxy requests to a local port selected by a `port` query parameter. The proxy strips the `port` parameter before forwarding so the upstream never sees it.

- HTTP pass‑through with streaming bodies
- Optional WebSocket bridge
- Tests use Hono’s in‑process `app.request(...)` (no real network ports)

## Run

```bash
# Start the proxy on :8080
deno run -A src/main.ts
# Or set a listen port
PORT=8787 deno run -A src/main.ts
```

Request format:

```
GET http://localhost:8080/anything?port=23423&x=1
# Proxies to http://127.0.0.1:23423/anything?x=1
# Sets Host: 127.0.0.1:23423 and X-Forwarded-* headers
```

## Test

```bash
deno test -A
```

## Notes
- The proxy strips hop‑by‑hop headers (Connection, TE, Upgrade, etc.).
- For WebSockets, upgrade is handled and bridged to `ws://127.0.0.1:<port>...`.
- In production you’ll use real ports; in tests we inject a resolver that maps port numbers to in‑memory Hono apps.
