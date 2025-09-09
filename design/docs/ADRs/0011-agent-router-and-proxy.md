# ADR 0011: Agent Router as Terminal/Hardware Proxy

Status: Proposed\
Date: 2025-08-30 Update (2025-08-31): Observability references removed; progress
is shown via live faces per ADR 0012.

## Context

Users land on a Face Viewer page that represents a single terminal face. The
target face lives inside a specific Machine in a Fly app. Machines expose Faces
(TTYD) without authentication; therefore, a public Agent Router must
authenticate the user, resolve the correct `{app, agent_path, machine}`, and
gate access to terminal and hardware channels. The static page may be served
separately, but the Agent Router API/proxy is the authoritative gate.

## Decision

- Introduce an Agent Router that acts as:
  - Static host (optional) and/or coordinator for assets.
  - Subcomponents:
    - Terminal Proxy: routes/proxies terminal WS from the Face Viewer to Agents.
    - Hardware Bridge: exposes Hardware MCP to Agents and bridges to the Face
      Viewer’s Face Hardware Connector.
  - Routing: maps `{host, path, auth}` → `{app, agent_path, machine, face}`;
    issues 302 redirects to normalize host/path where needed.
  - Terminal Proxy: Face Viewer ↔ Agent Router ↔ Agent TTYD (WebSocket
    pass‑through).
  - Hardware MCP: Expose `hardware.*` tools and `page.redirect` to agents;
    enforce per‑user/app capability policy; proxy to the Face Viewer’s Face
    Hardware Connector.
- Single‑face per page: The page always attaches to exactly one `face_id` at a
  time.
- Artifact remains the system of record (user → app; agent name → machine).
  Front‑End consults Artifact for routing.

## Rationale

- Centralizes auth and policy enforcement; simplifies agent containers (no
  direct auth).
- Cleanly separates static hosting concerns from API/proxy behavior.
- Enables consistent hardware control as MCP tools/resources.

## Consequences

- The Agent Router must maintain reliable WS proxying and per‑session policy
  state.
- Agents must treat terminal endpoints as un-authenticated and rely on the Agent
  Router to gate access. (Removed: centralized observability logging; see ADR
  0012.)

## Alternatives Considered

- Direct browser → agent without a proxy: rejected due to lack of auth/policy
  control.
- Per‑app Agent Router instances: viable; currently we run a shared instance for
  economy.

## Follow‑ups

- Define exact MCP method/resource schemas and error codes.
- SECURITY: document trust boundaries; ensure agent TTYD is not exposed publicly
  except via the Front‑End. (Removed: Observability follow-up; progress and
  correlation are visible in faces.)

## References

- `docs/ARCHITECTURE.md` — Agent Router section and sequence
- `docs/RUNTIME.md` — Face Hardware Connector, Agent Router Proxies
- `docs/TERMS.md` — Agent Router, Hardware MCP, Page Session
