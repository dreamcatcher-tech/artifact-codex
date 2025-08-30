# Agents (MCP Server for Fly.io)

This folder is for building a Model Context Protocol (MCP) server that provisions and manages Fly.io infrastructure for this project and bootstraps the machine after it comes online.

## Purpose
- Provision Fly.io resources (apps/machines), attach networking, IPs, volumes, and secrets.
- Manage machine lifecycle (create/update, start/stop/restart, health checks).
- After a machine starts, run the default processes required by this project (e.g., bootstrap scripts, services, containers) in an idempotent way.

## Scope
- Infrastructure orchestration via Fly.io API/`flyctl`.
- Deterministic, repeatable bootstrap of default processes once the machine is available.
- Status and logs surfaced through MCP tools.

Non-goals: application business logic, CI/CD pipelines, or general-purpose agent frameworks beyond the MCP server itself.

## Expected MCP Tools (baseline)
- `provision`: Create/scale machines and required resources.
- `start_machine`: Start or restart a machine and wait for health.
- `bootstrap`: Run the default post-start processes idempotently.
- `status`: Report machine state and recent logs.
- `destroy`: Tear down created resources (guarded).

## Configuration
- Environment: `FLY_API_TOKEN` (required), default org/region, app name/prefix.
- Default processes: defined in a simple config (e.g., `default-processes.(yml|json)`), executed by `bootstrap`.
- Logging: avoid printing secrets; prefer redaction.

## Implementation Notes
- Favor idempotency so commands can be safely retried.
- Prefer declarative inputs (desired state) over imperative steps.
- Keep Fly.io credentials out of the repo; load from env/secret store.

## Suggested Layout (guidance)
- `server/` – MCP server entry and transport wiring.
- `handlers/` – Implementations of `provision`, `start_machine`, `bootstrap`, etc.
- `schemas/` – Request/response shapes for MCP tools.
- `scripts/` – Optional bootstrap scripts invoked on first start.
- `default-processes.yml` – Declarative list of processes to start post-boot.

This document is intentionally brief: it defines what belongs here and how the MCP server should behave while leaving language/runtime choices to the implementation.

