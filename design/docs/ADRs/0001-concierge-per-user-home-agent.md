# ADR 0001: Concierge Entry + Per‑User Home Agent

**Status:** Proposed\
**Date:** 2025-08-28\
Update (2025-08-31): Removed Observability MCP; progress shown via faces (ADR
0012).

## Context

- We want a clear first‑run experience: users authenticate via Clerk in a
  frontend web app.
- Each user should have an isolated Home Agent in its own Fly app and Machine.
- Provisioning and routing should be automated and abstracted behind MCP
  servers.

## Decision

- Use a web `Frontend` with Clerk for auth; it embeds an iframe that points to
  each agent’s TTYD endpoint.
- On first login, Frontend/concierge provisions a per‑user Fly app + Machine
  using the standard agent image, then routes the iframe to the Home Agent.
- Concierge/Home Agents call MCP servers (provisioning, auth, registry, secrets;
  optional policy/session). Observability MCP removed.

## Consequences

- Simpler onboarding; clear isolation per user.
- Requires robust identity mapping with Clerk and a registry to find/route
  users.
- Adds dependency on MCP host reliability and Fly provisioning quotas.
- “Handoff” is iframe routing; no SSH client hops are required.

## Open Points

- App naming: Clerk `username`; Org: default; Region: nearest to user.
- Sizing: 1 shared vCPU, 1GB RAM; Storage: no volumes.
- Idle: suspend/autostop on idle; autostart on HTTP/WebSocket traffic.
- Exact MCP tool inputs/outputs and error taxonomy.
