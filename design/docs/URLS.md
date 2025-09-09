This is a list of all the URLs we expect to handle and in all the possible
system states. Some of these would do redirects, and some would be the final
resolved target.

1. `https://dreamcatcher.ai`
   - with auth
     - has home
       - redirect to `https://your-app.dreamcatcher.ai`
     - no home / home being constructed
       - trigger idempotent mcp call that returns a view to watch progress
   - without auth
     - redirect to `https://dreamcatcher.ai/home-agent`
2. `https://dreamcatcher.ai/home-agent`
3. `https://dreamcatcher.ai/some-garbage`
   - redirect to `https://dreamcatcher.ai` - standard agent not found path
4. `https://your-app.dreamcatcher.ai`

- is valid app
  - is public or is authed
    - redirect to `https://your-app.dreamcatcher.ai/home-agent`
  - invalid app
    - redirect to `https://dreamcatcher.ai`

5. `https://your-app.dreamcatcher.ai/home-agent/nested-agent`
6. `https://your-app.dreamcatcher.ai/other-agent`
7. `https://your-app.dreamcatcher.ai/other-agent?face=0`
   - if valid app and is authed or is public
     - return base system view
8. `https://your-app.dreamcatcher.ai/other-agent?face=1`
   - if valid app, is authed, or is public
   - if face not found - start a new face - standard face not found path

---

**Visualization (proposed)**

Goal: Show every URL pattern, how it resolves across Fly apps, and which
component is responsible at each hop — without duplicating common steps.

- Canonical flow: one URL-resolution flowchart with subgraphs per Fly app.
- Phases: a single sequence diagram with named phases (Resolve Hostname, Route
  Agent Path, Ensure Face, Attach Terminal Session, Interactive Face) that
  define the shared steps (resolve, route, ensure face, attach).
- Per-URL journeys: short sequences that run just until they reach a phase
  label, then hand off by reference (e.g., “Continue at Ensure Face”).

### URL Resolution Map (canonical)

```mermaid
flowchart LR
  subgraph BrowserLayer
    U["Browser"]
  end
  subgraph DNSLayer
    DNS["DNS Alias"]
  end
  subgraph FlyEdgeLayer
    EDGE["Fly Edge"]
  end
  subgraph AgentRouterLayer
    ARNODE["Agent Router"]
    HBRIDGE["Hardware Bridge"]
    AUTH["Clerk Auth"]
  end
  subgraph ArtifactLayer
    REG["Registry MCP"]
    AR["Artifact MCP"]
  end
  subgraph ConciergeLayer
    CON["Concierge Agent TTYD"]
  end
  subgraph CustomerAppLayer
    HOME["Home Agent TTYD"]
  end

  U --> DNS
  DNS --> EDGE
  EDGE --> ARNODE
  ARNODE --> REG
  ARNODE --> AR
  ARNODE --> CON
  ARNODE --> HOME
  HBRIDGE -. "Hardware MCP" .- U
```

Caption: Subgraphs represent Fly apps. The Agent Router authenticates and routes
requests; Registry and Artifact provide mapping and control; target Agents
expose TTYD behind the Router.

### Common Phases (shared sequence)

```mermaid
sequenceDiagram
  autonumber
  participant U as Browser
  participant R as Agent Router
  participant A as Artifact MCP
  participant G as Registry MCP
  participant T as Target Agent (TTyD)

  Note over U,R: Resolve Hostname
  U->>R: GET {host}{path}{?face}
  R->>A: resolve_alias(host)
  A-->>R: {app, status}

  Note over R,G: Route Agent Path
  R->>G: lookup_target(host, path, user)
  G-->>R: {agent_path, machine}

  alt No face param
    Note over R,T: Ensure Face (create or reuse)
    R->>T: create_face(agent_path)
    T-->>R: {face}
    R-->>U: 302 add ?face={face}
  else Has face
    Note over R,T: Attach Terminal Session
    R->>T: attach(face)
    T-->>U: WS terminal via Agent Router
  end

  Note over U,T: Interactive Face (read/write)
```

Caption: Reusable phases. Per-URL journeys may stop once they reach “Ensure
Face” or “Attach Terminal Session” and reference this sequence instead of
duplicating.

### Per-URL Journey Templates

Root domain (concierge or handoff to home):

```mermaid
sequenceDiagram
  autonumber
  participant U as Browser
  participant R as Agent Router
  participant A as Artifact MCP

  U->>R: GET https://dreamcatcher.ai/
  alt Authed and has Home
    R->>A: resolve_user_home()
    A-->>R: {host: your-app.dreamcatcher.ai}
    R-->>U: 302 https://your-app.dreamcatcher.ai/home-agent
    Note over U,R: Continue at Ensure Face (create or reuse)
  else Guest or no Home yet
    R-->>U: 302 https://dreamcatcher.ai/concierge
    Note over U,R: Continue at Ensure Face (create or reuse)
  end
```

App host and agent path:

```mermaid
sequenceDiagram
  autonumber
  participant U as Browser
  participant R as Agent Router
  U->>R: GET https://your-app.dreamcatcher.ai/other-agent
  Note over U,R: Continue at Ensure Face (see Common Phases)
```

Maintenance mode (read-only face):

```mermaid
sequenceDiagram
  autonumber
  participant U as Browser
  participant R as Agent Router
  participant A as Artifact MCP
  U->>R: GET https://your-app.dreamcatcher.ai/any
  R->>A: status(app)
  A-->>R: {status: maintenance}
  R-->>U: 200 Maintenance Face (readonly)
```

Notes

- One face per page: landing without `?face` triggers Ensure Face and 302 to add
  `?face={id}`.
- Per-URL diagrams should end at Ensure Face or Attach Terminal Session and
  reference the Common Phases to avoid duplication.
- Subgraphs name Fly apps explicitly: Agent Router, Artifact, Concierge,
  Customer App.

### URL Patterns (reference)

- Root: `https://dreamcatcher.ai/` → concierge or handoff.
- Concierge: `https://dreamcatcher.ai/concierge[?face=…]`.
- App alias: `https://your-app.dreamcatcher.ai/{agent_path}/[?face=…]`.
- App fallback: `https://{app}.fly.dev/{agent_path}/[?face=…]` (may normalize to
  alias).
- Faces index: `/{agent_path}/faces` (alias `/sessions`).
- Auth callbacks: `/auth/callback`, `/logout`, `/me` on Router host.
- Health: `/_healthz`, `/_readyz`, `/_version` on Router (and optionally
  agents).
