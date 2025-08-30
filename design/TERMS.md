**Canonical Terms**

- **Frontend (proposed):** Web application that handles Clerk OAuth, session management
  (tabs/viewers), and embeds agent terminals via TTYD iframes.
- **Concierge Agent (proposed):** Shared control-plane agent callable by the frontend to handle
  identity mapping, provisioning, and routing to a dedicated base agent.
- **Base Agent (proposed):** Per-user agent running in its own Fly app + Machine. Primary long-lived
  workspace for the user.
- **Agent (proposed):** Logical AI runtime exposed over SSH/TTYD. Backed by one container (Fly
  Machine) per agent, but capable of hosting multiple concurrent sessions.
- **MCP Server (proposed):** Tool endpoint implementing Model Context Protocol, exposing callable
  tools (e.g., provisioning, auth). Implemented by a separate MCP host product.
- **Fly App (proposed):** Fly.io application that contains one or more Machines; we create one per
  user.
- **Machine (proposed):** Fly.io VM instance within an app that runs the agent container.
- **Agent Image (proposed):** Standard container image used to launch base agents; configured at
  boot.
- **Handoff (proposed):** Routing the frontend iframe to the per-user agent’s TTYD endpoint.
- **TTYD (proposed):** WebSocket terminal server exposed by each agent for browser access.
- **Viewer (proposed):** Additional user permitted to observe/attach to an active `tmux` session.
- **Registry (proposed):** System of record mapping user → app → machine → hostname.
- **Ephemeral SSH Cert (proposed):** Short‑lived client cert minted per session for SSH
  authorization.
- **Suspend/Resume (proposed):** Policy to stop idle Machines and wake them on demand.

- **Session (proposed):** An interactive execution context hosted by an agent and addressed by a
  unique `session_id`. One agent container may host many sessions concurrently (e.g., concierge chat
  sessions), each with isolated terminal state (typically one `tmux` server per agent with one
  `tmux` session per `session_id`).
- **Session ID (proposed):** Opaque identifier (URL-safe, 128-bit entropy recommended) that binds a
  browser tab or SSH connection to a specific session. In the web flow it appears as a query param
  `?sid={session_id}`; with SSH it is logged and propagated via env (e.g., `SESSION_ID`).
- **Session URL (proposed):** Canonical web URL that includes `?sid={session_id}`. Landing on a
  sessionless page triggers creation of a session and a redirect to the Session URL.

- **CODEX_HOME (accepted):** Environment variable pointing to the per‑agent directory that contains
  `config.toml` and any state files. Example: `/var/lib/codex/agents/{agent_id}`. Required for
  launching `codex`.
- **config.toml (accepted):** Agent configuration file written to `$CODEX_HOME/config.toml` just
  before process start. Originates from the `runtime.launch_agent` MCP tool `config_toml` argument.
- **Launch Sequence (accepted):** The post‑boot, pre‑interaction steps that write `config.toml`,
  export `CODEX_HOME`, and invoke the `codex` executable. Allowed synonyms: Invocation Handshake,
  Agent Startup, Boot‑to‑Agent, Invocation Pipeline. Locked 2025-08-28; changes require ADR.

Status legend: proposed → accepted → deprecated. Rename or status changes require an ADR and a
sweep.
