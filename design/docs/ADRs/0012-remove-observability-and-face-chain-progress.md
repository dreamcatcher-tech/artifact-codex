# ADR 0012: Remove Observability MCP; Always-Attached Face Progress

Status: Accepted\
Date: 2025-08-31

## Context

Earlier documents referenced an `observability.mcp` (await readiness, log tail, emit events) and a
UI affordance to “show logs on error”. We are standardizing on a terminal-first UX where the browser
is always attached to a live terminal face while infrastructure is responding. Progress is conveyed
by redirecting the page to the face that is actively doing the user’s work.

## Decision

- Remove the Observability MCP and any out-of-band readiness/logtail features.
- Remove the “show logs on error” UI.
- Adopt face-chaining for progress:
  - Concierge face (interactive) → provisioning face (readonly) → base machine face zero (readonly)
    → interactive base face.
  - During initialization, faces are readonly; input is enabled only on the final interactive face.
- The browser MUST always attach to a running face when the platform is responsive (see
  `docs/PRINCIPLES.md`).

## Rationale

- Simpler system surface (fewer MCPs/services) and a consistent terminal-first mental model.
- Users see real execution, not synthesized health gates.
- Eliminates duplicated readiness logic and separate log viewers.

## Consequences

- No out-of-band health gating. The current job’s face is the source of truth; if nothing is
  responding, the page cannot attach (consistent with platform unavailability).
- Failure states render in the active face; the UI does not provide a secondary log viewer.
- MCP-SERVERS config drops the `observability` entry; Access Matrix no longer lists it.
- RUNTIME and USER-FLOW are updated to reflect face-chaining and removal of observability.

## Migration Notes

- Delete references to Observability MCP in docs; remove any “await_ready”/log tail call sites in
  examples.
- Prefer notes/echoes in the readonly faces to communicate progress and errors.

## Supersedes / Updates

- Updates ADR 0001 (MCP list), ADR 0003 (event/correlation notes), ADR 0010 (observability hooks),
  ADR 0011 (observability logging). See file headers for update notes.
