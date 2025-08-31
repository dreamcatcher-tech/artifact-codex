# Diagrams: Mermaid Index & Templates

Use Mermaid to visualize architecture, flows, and behaviors. Keep diagrams close to the docs they
explain; add shared or canonical versions here.

## Conventions

- Place diagrams inline in `ARCHITECTURE.md`, `USER-FLOW.md`, etc.; cross-link canonical copies
  here.
- Prefer: `flowchart`, `stateDiagram-v2`, `sequenceDiagram`.
- Include a short caption and a one-line text summary below each diagram.
- Avoid color-only distinctions; label edges and nodes clearly.

## Architecture (template)

```mermaid
flowchart LR
  User[SSH Client] -->|ssh| Fly[Fly.io Edge]
  Fly -->|tcp 22| Agent[(Agent Container)]
  Agent -->|stdout| Logs[(Observability)]
  Agent --> Secrets{{Secrets}}
  Agent --> Model>Model Gateway]
  subgraph Fly.io
    Agent
  end
```

Summary: SSH path from user to agent; supporting services.

## UI State Machine (template)

```mermaid
stateDiagram-v2
  [*] --> WelcomeBanner
  WelcomeBanner --> AgentShell: first prompt
  AgentShell --> HelpOverlay: help
  AgentShell --> ToolProgress: run tool
  ToolProgress --> AgentShell: success
  ToolProgress --> Error: failure
  Error --> AgentShell: acknowledge
  AgentShell --> SessionSummary: exit/logout
  SessionSummary --> [*]
```

Summary: High-level SSH TUI states; must match `UI-STATES.md`.

## SSH Login Sequence (template)

```mermaid
sequenceDiagram
  autonumber
  actor U as User
  participant E as Fly Edge
  participant H as SSHD (container)
  participant A as Agent Process
  participant O as Observability
  U->>E: TCP 22 connect
  E->>H: Forward SSH
  U->>H: Key auth / handshake
  H-->>U: MOTD/banner
  H->>A: Start face env
  A-->>U: Prompt appears
  A->>O: Face start event
```

Summary: Authentication and session start handshake.

## App Provisioning with Friendly DNS (proposed)

```mermaid
sequenceDiagram
  autonumber
  actor U as User (Clerk)
  participant F as Frontend
  participant A as artifact.mcp
  participant P as provisioning.mcp
  participant D as DNS Provider
  U->>F: First login
  F->>A: reserve_app_name(user_id)
  A-->>F: {app}
  F->>P: fly_create_app(name=app, ...)
  P-->>F: {app, machine_id}
  F->>D: ensure CNAME alias → {app}.fly.dev
  F->>A: record_user_app(user_id, app, aliases)
  A-->>F: {ok}
```

Summary: First login reserves a random app name, creates the app, maps a friendly DNS alias, and
records the mapping in Artifact.

## Launch Sequence (canonical)

Status: accepted/locked 2025-08-28; authoritative for invocation.

```mermaid
sequenceDiagram
  autonumber
  participant M as MCP Host
  participant R as runtime.mcp (container)
  participant F as FS ($CODEX_HOME)
  participant X as codex (executable)
  participant O as Observability

  M->>O: await_ready(app, machine_id, timeout)
  O-->>M: {ready:true}
  M->>R: launch_agent(app, machine_id, agent_id, config_toml, env, args)
  R->>F: mkdir -m 700 $CODEX_HOME
  R->>F: write -m 600 config.toml
  R->>R: export CODEX_HOME
  R->>X: exec /usr/local/bin/codex args
  X->>O: emit logs / events
  R-->>M: {launch_id, pid, ssh_target}
```

Summary: Post-boot MCP call writes config.toml, sets CODEX_HOME, and execs codex.

## Agent Runtime States (canonical)

```mermaid
stateDiagram-v2
  [*] --> MachineBoot
  MachineBoot --> Ready: health checks pass
  Ready --> LaunchSequence: runtime.launch_agent
  LaunchSequence --> Running: exec codex
  LaunchSequence --> Error: write/export failure
  Running --> Error: codex spawn failure
  Error --> [*]
```

Summary: Container lifecycle from boot to codex running, highlighting the Launch Sequence.

## Faces & Sessions (proposed)

```mermaid
flowchart TB
  subgraph Interface[Single Agent Path Interface]
    A[Agent Shell UI]
    A -->|switch| F1[Face: Chat]
    A -->|switch| F2[Face: Logs]
    A -->|switch| F3[Face: Editor]
  end
  FS[(Shared Workspace FS)] --- P1
  FS --- P2
  FS --- P3
```

Summary: One interface presents multiple faces (sessions) that share the same mutable filesystem.

## Face Viewer + Router (canonical)

```mermaid
flowchart LR
  DEV["Mic / Camera / Screen / Files / Clipboard"]
  subgraph Browser Face Viewer
    FV["Face View (ttyd iframe)"]
    FH["Face Hardware Connector"]
    BA[Browser Auth]
  end
  subgraph Face Router
    FVR[Face View Router]
    FR[Face Hardware Router]
  end
  AG["Agent Container"]
  CL["Clerk (external oauth)"]

  DEV <--> FH
  FV -->|WS| FVR
  FVR -->|WS| AG
  FH <-->|MCP| FR
  FR <-->|MCP| AG
  BA -->|OAuth| CL
```

Summary: Canonical split: Face Viewer (view + hardware + auth) and Face Router (view WS proxy +
hardware MCP proxy).

## Face View Router (proposed)

```mermaid
sequenceDiagram
  autonumber
  participant U as Face Viewer
  participant FVR as Face View Router
  participant A as Agent (TTYD)
  participant R as Artifact (Registry)
  U->>FVR: GET wss://{host}/{agent_path}?face={id}
  FVR->>R: resolve(host,path,user)
  R-->>FVR: {app, machine_id, agent_path}
  FVR->>A: WS attach TTYD (machine_id)
  A-->>FVR: PTY stream
  FVR-->>U: PTY stream
```

Summary: The Face View Router resolves the mapping and proxies the terminal stream.
