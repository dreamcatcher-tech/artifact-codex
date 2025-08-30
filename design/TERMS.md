**Canonical Terms**

- **Frontend (proposed):** Web application that handles Clerk OAuth, session management (tabs/viewers), and embeds agent terminals via TTYD iframes.
- **Concierge Agent (proposed):** Shared control-plane agent callable by the frontend to handle identity mapping, provisioning, and routing to a dedicated base agent.
- **Base Agent (proposed):** Per-user agent running in its own Fly app + Machine. Primary long-lived workspace for the user.
- **MCP Server (proposed):** Tool endpoint implementing Model Context Protocol, exposing callable tools (e.g., provisioning, auth). Implemented by a separate MCP host product.
- **Fly App (proposed):** Fly.io application that contains one or more Machines; we create one per user.
- **Machine (proposed):** Fly.io VM instance within an app that runs the agent container.
- **Agent Image (proposed):** Standard container image used to launch base agents; configured at boot.
- **Handoff (proposed):** Routing the frontend iframe to the per-user agent’s TTYD endpoint.
- **TTYD (proposed):** WebSocket terminal server exposed by each agent for browser access.
- **Viewer (proposed):** Additional user permitted to observe/attach to an active `tmux` session.
- **Registry (proposed):** System of record mapping user → app → machine → hostname.
- **Ephemeral SSH Cert (proposed):** Short‑lived client cert minted per session for SSH authorization.
- **Suspend/Resume (proposed):** Policy to stop idle Machines and wake them on demand.

- **CODEX_HOME (accepted):** Environment variable pointing to the per‑agent directory that contains `config.toml` and any state files. Example: `/var/lib/codex/agents/{agent_id}`. Required for launching `codex`.
- **config.toml (accepted):** Agent configuration file written to `$CODEX_HOME/config.toml` just before process start. Originates from the `runtime.launch_agent` MCP tool `config_toml` argument.
- **Launch Sequence (accepted):** The post‑boot, pre‑interaction steps that write `config.toml`, export `CODEX_HOME`, and invoke the `codex` executable. Allowed synonyms: Invocation Handshake, Agent Startup, Boot‑to‑Agent, Invocation Pipeline. Locked 2025-08-28; changes require ADR.

Status legend: proposed → accepted → deprecated. Rename or status changes require an ADR and a sweep.
