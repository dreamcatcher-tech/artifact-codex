# ADR 0006: Agent State Persistence and Face Snapshots (renamed from Session)

Status: Proposed Date: 2025-08-30

## Context

Faces are ephemeral by default; we sometimes need snapshot/restore of overall
agent state.

## Decision

- On persistence events, optionally write a freeform Agent State Object to the
  Artifact Storage Layer.
- Optionally restore on next start; faces may be rehydrated but remain inert
  until attached.

## Consequences

- Enables basic resilience without heavy per-turn persistence.
- Requires careful redaction and encryption at rest.

## MCP Interfaces (sketch)

- `artifacts.save_state(app, machine_id, agent_id, state_json)` →
  `{version, stored_at}`
- `artifacts.load_state(app, machine_id, agent_id)` →
  `{state_json, version, stored_at}|null`

## Security

- Avoid logging full payloads; apply redaction policies.

## Follow-ups

- Add size limits and pruning guidance in `RUNTIME.md`.
