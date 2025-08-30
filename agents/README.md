% Agents MCP Server (for Artifact)

This package provides a Model Context Protocol (MCP) server that runs inside Artifact (an MCP host) and implements the system’s “start new agent” flow. It provisions and manages containerized agents (e.g., LLM workers, tools) and performs the initial bootstrap after they come online.

> In short: from Artifact you can ask this server to create a new agent container, bring it to a healthy state, run the default processes, and stream status/logs — all idempotently.

## What It Does
- Provisions containerized agents via Fly.io Machines (default backend) or a future pluggable runtime.
- Manages lifecycle: create/update, start/stop/restart, health checks, and teardown.
- Bootstraps the agent after start using a declarative `default-processes.yml`.
- Surfaces status and recent logs as MCP tool responses (without leaking secrets).

## How It Runs (Artifact)
Artifact acts as the MCP host and loads this server as an MCP provider. The server speaks MCP over stdio (no HTTP port) and exposes tools to Artifact.

Typical flow inside Artifact:
1) Artifact loads the MCP server from this folder.
2) You invoke tools like `provision`, `start_machine`, `bootstrap`, and `status` from the Artifact UI/host.
3) The server provisions a machine/container for the agent image, waits for health, runs the default processes, and streams status.

### Minimal Host Configuration
Configure Artifact to launch the MCP server using your chosen runtime for the `server/` entrypoint (implementation-dependent):

- Using Node/TypeScript (example):
  - Command: `node server/index.js`
- Using Python (example):
  - Command: `python -m server`
- Working directory: this folder
- Transport: stdio (default for MCP servers)

Pick the option matching your implementation; both layouts are supported by this repository structure guidance.

## Tools Exposed to Artifact
- `provision`: Create/scale machines and required resources (app, volumes, IPs, secrets). Accepts a desired state payload and returns the resulting state.
- `start_machine`: Start or restart a machine; waits for health checks to pass.
- `bootstrap`: Run the default post-start processes idempotently (from `default-processes.yml`).
- `status`: Report machine state and recent logs (with secret redaction).
- `destroy`: Tear down created resources (guarded/confirmable).

All tools are designed to be idempotent so they can be safely retried from Artifact.

## Quickstart: “Start New Agent”
1) Set environment in Artifact for this MCP server:
   - `FLY_API_TOKEN` (required for Fly.io backend)
   - Optional defaults: `FLY_ORG`, `FLY_REGION`, `APP_PREFIX`
2) Add or verify `default-processes.yml` in this folder to declare what should run after the agent starts (examples below).
3) From Artifact, run `provision` with a payload like:

```json
{
  "app": "artifact-agent-hello",
  "image": "ghcr.io/your-org/your-agent:latest",
  "region": "iad",
  "count": 1,
  "env": { "AGENT_NAME": "hello" },
  "secrets": ["OPENAI_API_KEY"],
  "volumes": [
    { "name": "data", "size_gb": 1, "mount": "/data" }
  ],
  "network": { "expose_http": false }
}
```

4) If not auto-started by `provision`, run `start_machine`.
5) Run `bootstrap` to execute the default processes idempotently.
6) Use `status` to watch health and recent logs; repeat as needed.

When finished, `destroy` tears everything down (with guardrails).

## Configuration
- Environment:
  - `FLY_API_TOKEN` (required)
  - `FLY_ORG`, `FLY_REGION`, `APP_PREFIX` (optional defaults)
- Default processes: declared in `default-processes.yml` and executed by `bootstrap`.
- Logging: secrets are redacted from tool outputs.

### Example `default-processes.yml`
```yaml
# Runs after the machine is healthy. Each step should be idempotent.
processes:
  - name: agent
    run: ["/usr/local/bin/agent", "--serve"]
    env:
      LOG_LEVEL: info
    health_check:
      type: tcp
      port: 8080
      grace_period: 10s
  - name: warmup
    run: ["/usr/local/bin/agent", "--warmup"]
    idempotent: true
```

## Design Notes
- Idempotency first: tools accept declarative desired state and reconcile.
- Deterministic bootstrap: no side-effects on repeated runs.
- Security: secrets loaded from environment/host stores; never printed.
- Backend-focused: Fly.io Machines by default; other runtimes can be added later.

## Non‑Goals
- Business logic of agents, CI/CD, or general-purpose orchestration beyond this server.

## Troubleshooting
- Tool not visible in Artifact: verify the command/entrypoint and working directory.
- Auth errors: ensure `FLY_API_TOKEN` is set in Artifact’s environment for this server.
- Stuck waiting for health: confirm the agent image exposes the expected port and health checks match reality.

## Repository Layout (guidance)
- `server/` – MCP server entry and transport wiring.
- `handlers/` – `provision`, `start_machine`, `bootstrap`, `status`, `destroy` implementations.
- `schemas/` – Request/response shapes for MCP tools.
- `scripts/` – Optional bootstrap scripts invoked on first start.
- `default-processes.yml` – Declarative list of post-boot processes.

---
This folder is intentionally focused: run under Artifact as an MCP server and provide a reliable, repeatable “start new agent” experience by provisioning and bootstrapping containerized agents.
