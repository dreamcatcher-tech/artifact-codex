**MCP Servers Catalog**

This lists the MCP servers the concierge and base agents may call. Implementation lives in a
separate MCP host product; here we only define names and tool contracts.

—

**provisioning.mcp**

- **Purpose:** Manage Fly resources.
- **Tools:**
  - `fly_create_app(name, org, regions, tags)` → `{app_id, name}`
  - `fly_set_secrets(app, kv)` → `{applied:boolean}`
  - `fly_create_machine(app, image, cpu, memory_mb, env, services, mounts)` →
    `{machine_id, region, state}`
  - `fly_start_machine(app, machine_id)` / `fly_stop_machine(...)` → `{state}`
  - `fly_attach_volume(app, name, size_gb, region)` → `{volume_id}`
  - `fly_app_status(app)` → `{machines:[...] , healthy:boolean}`

**auth.mcp**

- **Purpose:** Identity mapping and session authorization using Clerk.
- **Tools:**
  - `user_from_clerk(token|user_id)` → `{user_id, username, status}`
  - `issue_ttyd_token(user_id, app, machine_id, ttl_s)` → `{token, expires_at}`
  - `authorize_user_on_agent(user_id, app, machine_id, role)` → `{ok:boolean}`

**registry.mcp**

- **Purpose:** Source of truth for users ↔ agents.
- **Tools:**
  - `lookup_base_agent(user_id)` → `{app, machine_id, host}|null`
  - `register_base_agent(user_id, app, machine_id, host)` → `{ok:boolean}`
  - `list_agents(user_id)` → `{agents:[...]}`

**artifact.mcp (proposed)**

- **Purpose:** Artifact State Tracker — maps Clerk users to apps, manages friendly DNS aliases, and
  coordinates maintenance mode.
- **Tools:**
  - `reserve_app_name(user_id)` → `{app}`
  - `record_user_app(user_id, app, aliases[])` → `{ok}`
  - `ensure_dns_alias(app, alias_host)` → `{ok}`
  - `set_maintenance(app, reason, eta?)` → `{status:"maintenance"}`
  - `clear_maintenance(app)` → `{status:"active"}`
  - `status(app)` → `{status, reason?, eta?, aliases[]}`

**secrets.mcp**

- **Purpose:** Manage agent secrets/config separate from app deploys.
- **Tools:**
  - `put_agent_config(app, machine_id, doc)` → `{version}`
  - `get_agent_config(app, machine_id)` → `{doc, version}`
  - `store_secret(scope, key, value|ref)` → `{ref}`

**observability.mcp**

- **Purpose:** Logs/metrics/traces wiring and health gates.
- **Tools:**
  - `await_ready(app, machine_id, timeout_s)` → `{ready:boolean}`
  - `tail_logs(app, machine_id, since)` → `{stream_url}`
  - `emit_event(scope, type, payload)` → `{event_id}`

**runtime.mcp**

- **Purpose:** Post‑boot agent launch and runtime control.
- **Tools:**
  - `launch_agent(app, machine_id, agent_id, config_toml, codex_args?, env?, workdir?)` →
    `{launch_id, pid, ssh_target}`
    - Writes `config.toml` to `$CODEX_HOME` (per RUNTIME.md “Launch Sequence”), exports
      `CODEX_HOME`, then `exec`’s `codex`.
  - `stop_agent(app, machine_id, pid|launch_id)` → `{stopped:boolean}`
  - `status_agent(app, machine_id, pid|launch_id)` → `{status, started_at}`

  - **Input Schema (`launch_agent`)**
    ```json
    {
      "type": "object",
      "required": ["app", "machine_id", "agent_id", "config_toml"],
      "properties": {
        "app": { "type": "string" },
        "machine_id": { "type": "string" },
        "agent_id": { "type": "string" },
        "config_toml": { "type": "string", "description": "Full contents of config.toml" },
        "codex_args": { "type": "array", "items": { "type": "string" } },
        "env": { "type": "object", "additionalProperties": { "type": "string" } },
        "workdir": { "type": "string" }
      }
    }
    ```

**artifacts.mcp** (optional)

- **Purpose:** Durable artifact storage for agent snapshots and related state.
- **Tools:**
  - `save_state(app, machine_id, agent_id, state_json)` → `{version, stored_at}`
  - `load_state(app, machine_id, agent_id)` → `{state_json, version, stored_at}|null`

**policy.mcp** (optional)

- **Purpose:** Central guardrails for tools, egress, and data boundaries.
- **Tools:**
  - `evaluate(request_context)` → `{allow:boolean, reason, patches?}`

—

**faces.mcp** (optional)

- **Purpose:** Manage faces (one `tmux` session per face) and viewer presence.
- **Tools:**
  - `attach(user_id, app, machine_id, face)` → `{attached:boolean}`
  - `list_viewers(app, machine_id, face)` → `{viewers:[...]}`
  - `end_face(app, machine_id, face)` → `{ok:boolean}`

**Access Matrix (Concise)**

- Frontend/concierge: provisioning, auth, registry, secrets, observability, runtime, policy,
  session.
- Base agent: registry (read-own), secrets (read scoped), observability (emit), policy (check),
  session (intra-agent), provisioning (optional: sub-agents).

**Config Example (per-agent)**

```json
{
  "mcpServers": {
    "provisioning": { "url": "mcp+http://provisioning" },
    "auth": { "url": "mcp+http://auth" },
    "registry": { "url": "mcp+http://registry" },
    "secrets": { "url": "mcp+http://secrets" },
    "observability": { "url": "mcp+http://observability" },
    "artifacts": { "url": "mcp+http://artifacts" },
    "policy": { "url": "mcp+http://policy" }
  }
}
```

**Open Questions**

- Coarse vs fine-grained tool exposure per agent?
- Where SSH CA keys live (auth.mcp vs HSM)?
- Which secrets are Fly app secrets vs external KMS refs?

