**New User Bootstrap Flow**

- **Entry Point:** User opens the Frontend Web App, authenticates with Clerk, and lands on the
  workspace page. The terminal UI is an iframe rendering a TTYD endpoint.
- **Goal:** If first-time, provision a dedicated “base agent” on Fly.io and point the iframe at that
  agent’s terminal; otherwise, attach to the user’s existing base agent session.

**Assumptions**

- **Per-user app:** One Fly app per user; exactly one Machine (base agent) inside it.
- **Standard image:** Base agent uses a common image configured at boot (no volumes).
- **MCP-backed ops:** Frontend/concierge calls MCP servers for provisioning, auth/registry, secrets,
  observability, and runtime.
- **Terminal transport:** Browser → Frontend page → iframe → agent’s TTYD (WebSocket). Sessions
  inside the agent are managed with `tmux`.

**User Journey — Landing (Guest Chat)**

```mermaid
journey
  title Landing — Concierge Chat (Guest)
  section Landing (Guest)
    Load page: 4: User, Frontend
    Greet and offer chat: 4: Concierge Agent
    Chat in guest mode (limited context): 3: User, Concierge Agent
    Explain benefits of sign-in (persistence, private agent, tools): 3: Concierge Agent
    Prompt to sign in: 4: Frontend, Concierge Agent
    Choose Sign In: 5: User
```

Caption: Pre-auth landing flow where the Concierge chats in guest mode and nudges sign-in for full
features.

**User Journey — First Login**

```mermaid
journey
  title First Login — Bootstrap
  section First Login (New User)
    Open frontend (Clerk sign-in): 4: User
    Provision base app (slug, region): 2: Provisioning MCP
    Store initial config and secrets: 3: Secrets MCP
    Create machine (1 shared vCPU / 1GB): 3: Provisioning MCP
    Await ready: 3: Observability MCP
    Launch agent (write config and exec codex): 3: Runtime MCP
    Attach iframe to TTYD: 4: Frontend, User
    tmux session attached: 5: Agent, User
```

Caption: First-time user bootstrap phases, actors, and experience ratings.

**User Journey — Returning Login**

```mermaid
journey
  title Returning Login — Attach
  section Returning Login
    Lookup endpoint: 4: Registry MCP
    Start machine if autostopped: 3: Provisioning MCP
    Await ready: 3: Observability MCP
    Ensure agent running: 3: Runtime MCP
    Attach terminal: 5: Frontend, User
```

Caption: Returning user attach flow with health gates and ratings.

**Happy Path (First Login)**

- **U1. Sign-in:** User authenticates with Clerk in the frontend.
- **U2. Identify:** Frontend resolves `user_id` and `username` via Clerk; Registry MCP lookup for
  existing base agent.
- **U3. Provision App:** If missing, Provisioning MCP creates Fly app named from the Clerk
  `username` (slug-safe), using the default Fly org and a region nearest to the user.
- **U4. Config/Secrets:** Secrets MCP stores initial agent config and MCP endpoints.
- **U5. Launch Machine:** Provisioning MCP creates one Machine with the standard image, CPU/RAM:
  `1 shared vCPU, 1GB RAM`; no volumes.
- **U6. Health Gate:** Observability MCP waits for container readiness.
- **U7. Launch Agent:** Call `runtime.mcp.launch_agent` (see RUNTIME “Launch Sequence”) to write
  `config.toml`, set `CODEX_HOME`, and exec `codex`.
- **U8. Attach:** Frontend sets the iframe `src` to the agent’s TTYD endpoint; the agent
  starts/attaches a `tmux` session for the user.

**Repeat Login (Existing User)**

- **R1. Lookup:** Frontend/Registry MCP finds the base agent endpoint.
- **R2. Ensure Up:** If autostopped/suspended, Provisioning MCP (or Fly Proxy autostart) brings it
  up; Observability MCP gates on health.
- **R2a. Ensure Agent:** If `codex` is not running, call `runtime.mcp.launch_agent`.
- **R3. Attach:** Frontend points the iframe to the TTYD URL and reattaches the user’s `tmux`
  session.

**Failure Handling (Sketch)**

- **F1. Provision error:** Show concise error + incident code; offer retry or support link.
- **F2. Health timeout:** Offer logs tail from Observability MCP; keep user on the frontend page.
- **F3. Auth mismatch:** Deny with clear message; session remains on frontend.

**Notes on “Handoff”**

- In this model, “handoff” simply means routing the iframe to the per-user agent’s TTYD URL. No SSH
  jump or client command is involved.

**Artifacts Produced**

- Per-user Fly app and Machine
- Stored config/secrets for the agent
- Registry entry linking user → app → machine → hostname
- Observability streams wired (logs/metrics)

**Defaults and Policies**

- **App name:** derived from Clerk `username` (slug-safe).
- **Org:** Fly default org.
- **Region:** nearest Fly region to user at first provision.
- **Sizing:** 1 shared vCPU, 1GB RAM.
- **Storage:** no volumes.
- **Idle policy:** suspend/stop on idle via Fly Proxy autostop; autostart on new HTTP/WebSocket
  traffic.
- **Sessions:** managed via `tmux`; multiple viewers may attach when allowed by frontend.

**Open Items**

- Region selection method: compute nearest Fly region from request IP, or show a picker with a
  sensible default.

---

**Web Session Routing (proposed)**

- **Default page → Session URL:** Landing on a page without a `sid` param creates a new session on
  the target agent (Concierge or Base) and redirects to the Session URL including `?sid={session_id}`.
- **Resume with sid:** Landing with a valid `sid` reattaches to that session; invalid/expired `sid`
  yields a friendly error and an option to start a new session.
- **No per-user container for Concierge:** Concierge operates as a shared agent container hosting
  many sessions; users get sessions, not containers.
- **Multiple tabs:** Each browser tab has its own `sid`; viewers may attach to the same `sid` when
  authorized.

```mermaid
sequenceDiagram
  autonumber
  participant U as User (Browser)
  participant F as Frontend
  participant C as Concierge Agent
  participant R as Registry/Session Store
  U->>F: GET /concierge (no sid)
  F->>R: create_session(agent=concierge)
  R-->>F: {sid}
  F-->>U: 302 Location /concierge?sid={sid}
  U->>F: GET /concierge?sid={sid}
  F->>C: attach(sid) via TTYD
  C-->>U: terminal connected
```

Caption: Default concierge page redirects to a Session URL and attaches that session.

```mermaid
sequenceDiagram
  autonumber
  participant U as User (Browser)
  participant F as Frontend
  participant B as Base Agent
  participant R as Registry/Session Store
  U->>F: GET /a/{user} (no sid)
  F->>R: ensure_base_agent(user)
  R-->>F: {endpoint}
  F->>R: create_session(agent=base@{user})
  R-->>F: {sid}
  F-->>U: 302 Location /a/{user}?sid={sid}
  U->>F: GET /a/{user}?sid={sid}
  F->>B: attach(sid) via TTYD
  B-->>U: terminal connected
```

Caption: Base agent page ensures agent exists, then creates and attaches a session.
