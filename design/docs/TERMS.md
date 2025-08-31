**Canonical Terms**

- **Frontend (proposed):** Web application that serves agent faces, manages viewer attachments, and
  embeds agent terminals via TTYD iframes. In open mode, it may operate without auth; in private
  mode, it integrates with an IdP (e.g., Clerk).
- **App Host (alias):** Synonym for Frontend in diagrams.
- **Face Viewer (proposed):** The browser page that renders exactly one face at a time and presents
  the terminal UI (typically via a TTYD iframe). The Face Viewer also hosts the Face Hardware
  Connector for local capabilities.
- **Face Hardware Connector (proposed):** Frontend management layer inside the Face Viewer that
  authenticates the user (Clerk), mediates device/resource access (microphone, camera, screen,
  files, clipboard, navigation/redirect), and executes device-like commands from the agent so the
  browser/computer behaves like controllable hardware.
  - Allowed synonyms: Hardware Connector, Hardware Access Manager, Device Bridge.
  - Discouraged alias: Browser I/O Bridge (legacy wording).
  - Status: proposed (canonical name chosen; ADR 0010 records rationale).
- **Browser Auth (proposed):** The authentication component running in the Face Viewer that performs
  OAuth with Clerk and provides identity/claims to the Face Hardware Connector and Face Router
  flows.
- **Concierge Agent (proposed):** Shared control-plane agent callable by the frontend to handle
  identity mapping, provisioning, and routing to a dedicated base agent.
- **Base Agent (proposed):** Per-user agent running in its own Fly app + Machine. Primary long-lived
  workspace for the user.
- **Agent (proposed):** Logical AI runtime exposed over SSH/TTYD. Backed by one container (Fly
  Machine) per agent, but capable of hosting multiple concurrent sessions.
- **MCP Server (proposed):** Tool endpoint implementing Model Context Protocol, exposing callable
  tools (e.g., provisioning, auth). Implemented by a separate MCP host product.
- **Fly App (proposed):** Fly.io application that contains one or more Machines; we create one per
  customer.
- **Machine (proposed):** Fly.io VM instance within an app that runs the agent container.
- **Agent Image (proposed):** Standard container image used to launch base agents; configured at
  boot.
- **Handoff (proposed):** Routing the Face Viewer to the per-user agent’s TTYD endpoint.
- **TTYD (proposed):** WebSocket terminal server exposed by each agent for browser access.
- **Viewer (proposed):** Additional user permitted to observe/attach to an active `tmux` session.
- **Registry (proposed):** System of record mapping user → app → machine → hostname.
- **Ephemeral SSH Cert (proposed):** Short‑lived client cert minted per session for SSH
  authorization.
- **Suspend/Resume (proposed):** Policy to stop idle Machines and wake them on demand.

- **Face Router (proposed):** Public web/API entrypoint that (a) serves or coordinates the static
  page, (b) authenticates users (Clerk), (c) routes the Face Viewer to the correct agent face based
  on host/path/auth, and (d) proxies both terminal WS and hardware control streams between the Face
  Viewer and the agent.
  - Subcomponents:
    - **Face View Router (proposed):** Routes and proxies terminal WebSocket sessions from the Face
      Viewer to the target Agent (TTYD/PTTY).
    - **Face Hardware Router (proposed):** Exposes Hardware MCP to Agents and bridges hardware and
      navigation commands to/from the Face Viewer’s Face Hardware Connector.
  - Routing keys:
    - Subdomain → Fly app that hosts the user’s agent containers.
    - Path → Agent path hierarchy (e.g., a proc tree-like structure).
    - Query `?face=` → Face ID for the target terminal session.
  - Canonical name: Face Router. Synonyms: Front‑End Server, Terminal Router, Session Router.
  - Modes: Static-only host for assets plus API/proxy; or unified server serving both.
  - Policy: Enforces which hardware capabilities the agent may access for a given user/app/path.

- **Hardware MCP (proposed):** MCP surface exposed by the Face Hardware Router to Agents to control
  browser/computer hardware via the Face Hardware Connector. Tools: `hardware.enumerate`,
  `hardware.open`, `hardware.subscribe`, `hardware.close`, `hardware.write`, and `page.redirect`.

- **Page Session (proposed):** The Face Viewer page/tab attachment context; always exactly one
  active `face_id` per page. Hardware handles and permissions are bound to the Page Session.

- **Read‑Only Face (proposed):** A face that displays progress/output and accepts no user input.
  Used during provisioning and boot until the interactive face is ready.
- **Face Zero (proposed):** The initial readonly face presented by a newly created base machine to
  show boot/provisioning progress before the agent’s interactive face is ready.

—

**Principles**

- **Always‑Attached Face (accepted):** When infrastructure is responsive, the browser is always
  attached to a running face. Progress is shown by redirecting across faces; no separate “show logs”
  UI. See `PRINCIPLES.md` and ADR 0012.

- **Artifact Storage Layer (proposed):** External service used by agents to store and retrieve
  durable artifacts (e.g., overall state snapshots).
- **Agent State Object (proposed):** Freeform JSON representing overall agent state. A multi-face
  agent MAY include per-face metadata and optional face state in this object.
- **Persistence Event (proposed):** A trigger when the container “persists itself” (e.g.,
  autosuspend, upgrade, manual snapshot). On this event, the agent MAY save an Agent State Object to
  the Artifact Storage Layer.
- **Face Snapshot (proposed):** Optional per-face portion of the Agent State Object. Presence
  enables rehydration of faces after restart; absence implies faces are lost on restart.

- **Face (proposed):** An interactive execution context (formerly “session”) hosted by an agent and
  addressed by a unique `face_id`. One agent container may host many faces concurrently (e.g.,
  concierge chat faces), each with isolated terminal state (typically one `tmux` session per
  `face_id`).
- **Face ID (proposed):** Monotonic, URL-safe identifier that binds a browser tab or SSH attach to a
  specific face. In the web flow it appears as a query param `?face={face_id}`; with SSH it is
  logged and propagated via env (e.g., `FACE_ID`). Authorization is enforced by Artifact; IDs need
  not be secret.
- **Face URL (proposed):** Canonical web URL that includes `?face={face_id}`. Landing without a
  `face` param creates a new face and redirects to the Face URL.

- **Agent Controller (proposed):** The long‑lived control process inside an agent container that
  manages faces, policies, and persistence to Artifact, and receives MCP calls from Artifact.
  - Canonical name: Agent Controller. Synonyms: Agent Supervisor (legacy), Conductor, Face Manager,
    Runtime Supervisor, Agent Orchestrator.
  - Responsibilities: manage tmux sessions (faces), persist/restore state, expose agent‑local tools,
    call out to Artifact MCP for lifecycle (spawn/destroy peers/children, self‑destroy).

---

- **Agent Concurrency Mode (proposed):** The agent’s capability for parallel conversational/UI
  contexts (faces). Two modes:
  - **Single‑Face Agent (proposed):** One active face per agent; new work replaces the current face.
    Attempts to open another face are rejected or queued by policy.
  - **Multi‑Face Agent (proposed, default):** Multiple faces per agent. Faces can present different
    information concurrently (e.g., chat, logs, editor) while sharing the same mutable workspace
    filesystem and process space. Allowed synonyms: multi‑page, multi‑session, session‑aware,
    single‑/multi‑threaded, single‑/multi‑context, single‑/multi‑view. “Face” is canonical;
    “session” is legacy.

- **Face UI (proposed):** Each face renders within the same single interface. Examples: Chat, Logs,
  Editor, Help. Faces share agent memory and the same working directory and filesystem.

- **Face ID (proposed):** Monotonic, URL-safe identifier for a face in the web UI; generated by the
  agent and scoped to the agent container.

- **Face Switcher (proposed):** Overlay/command palette to list/create/switch/close faces within an
  agent path. Example triggers: `/faces` (alias: `/sessions`), `Ctrl+Tab`.

- **Shared Workspace Filesystem (proposed):** The per‑agent mutable filesystem view (typically
  `$CODEX_HOME` plus working directory) that is shared by all faces within an agent container.

- **Agent Mutability Boundary (proposed):** An “agent” (container) is the unit of mutability,
  transience, and pooling. All faces/sessions within an agent share the same mutable filesystem and
  resource limits. To change mutability/isolation guarantees, launch a new agent instance.

---

- **Agent Workspace (proposed):** The working directory tree available to the agent at `/workspace`.
  Contains one or more Git repositories plus scratch repos used for temporary work. Shared by all
  faces/sessions of the agent. Subject to quotas and cleanup policies.

- **Workspace Root (proposed):** Absolute path `/workspace`. Must exist before agent launch. MAY be
  a mounted volume for persistence.

- **Workspace Repo (proposed):** A Git checkout under `/workspace/{name}` originating from a
  configured remote (`url`, `ref`, optional `sparse`). Read/write by default.

- **Workspace Manifest (proposed):** Declarative list of repos to ensure present at launch.
  Location: `$HOME/workspace.toml`. Controls clone/fetch/update behavior and points to `codex.toml`.

- **Codex Config (proposed):** File `~/codex.toml` containing codex runtime settings. The manifest
  references this via `codex_config_path`.

- **Scratch Repo (proposed):** Ephemeral Git repo created under `/workspace/.scratch/{id}` for
  experiments and temporary work. Default TTL applies; content may be GC’d. No remote by default.

- **Workspace Quotas (proposed):** Policy limits on total size, repo count, and scratch TTL.

---

- **App Name (proposed):** A globally unique, friendly Fly.io app slug generated at provision time
  (two words + hyphen + 3–5 digits, e.g., `calm-meadow-4821`). Serves `{app}.fly.dev` and is stable
  across orgs.

- **Friendly DNS Alias (proposed):** One or more human-friendly hostnames CNAME’d/Alias’d to the app
  host (e.g., `{user}.agents.example.com`). Managed by the platform; zero-downtime re-pointing
  during maintenance/recreate.

- **Artifact State Tracker (proposed):** System of record that maps Clerk `user_id` →
  `{app name,
  agent paths, dns aliases, status}`. Used to resolve user logins to their app and to
  orchestrate maintenance/recreation.

- **Maintenance Mode (proposed):** An app state where normal faces are paused; the platform serves a
  full but read-only maintenance face showing progress while the underlying app is being recreated
  or upgraded.

- **App URL (proposed):** Canonical host for a user’s app, e.g., `{app}.fly.dev`.
- **Agent Path (proposed):** Hierarchical subpath identifying an agent within the app, e.g.,
  `/agent1/child-agent-2/`. Full form with face: `{app}.fly.dev/{agent_path}/?face={face_id}`.

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

---

**Tenancy (accepted)**

- **Shared Organization (accepted):** A single Fly.io Organization that owns all customer apps.
- Status: accepted 2025-08-30 (ADR 0009). The former org‑per‑customer model is deprecated (ADR 0008,
  superseded).

**Apps**

- **Artifact App (accepted):** Central control-plane application (MCP host) that provisions and
  manages Machines across customer apps. Holds an org‑scoped token (`FLY_ORG_TOKEN`). Synonyms:
  Infrastructure App, Infra MCP.
- **Customer App (accepted):** Per‑customer application that hosts agent Machines and faces. Stores
  no Fly API tokens.

**Tokens**

- **Org Token (accepted):** Organization‑scoped access token granting API access across apps in the
  org. Created with `fly tokens create org`; injected as secret `FLY_ORG_TOKEN` into the Artifact
  App. Customer apps do not hold this.
- **Deploy Token (note):** App‑scoped access token limited to one app. Not used in this design for
  customer apps; referenced for completeness.
