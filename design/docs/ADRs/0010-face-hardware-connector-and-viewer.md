# ADR 0010: Face Hardware Connector and Face Viewer

Status: Proposed\
Date: 2025-08-30\
Update (2025-08-31): Removed observability mentions; auditing occurs within
faces; see ADR 0012.

## Context

The Face Viewer (the browser page) for an agent path must both (a) render a
single active face (terminal session) and (b) expose access to local
browser/computer capabilities (microphone, camera, screen capture, file sharing,
navigation/redirect, etc.) to the agent in a secure, auditable way. Today,
`TERMS.md` covers Faces/TTYD and Frontend/Clerk at a high level, but the
device/permission mediation and its command model are not specified.

## Decision

- Introduce the Face Viewer with three subcomponents:
  - Face Viewer: Visible terminal/face attachment for the current `face_id`
    (e.g., TTYD iframe).
  - Face Hardware Connector (Mgmt Layer): Authenticates user via Clerk, mediates
    device permissions, and executes device-like commands from the server-side
    shell to open/close/stream resources.
  - Browser Auth: Performs OAuth with Clerk and provides identity/claims to the
    Viewer and Connector.
- Define a device-like command surface (initial sketch):
  - `hardware.enumerate(kind) -> [device]`
  - `hardware.open(kind, opts) -> handle`
  - `hardware.close(handle)`
  - `hardware.subscribe(handle, events)`
  - `hardware.write(handle, chunk)` (where applicable)
  - `page.redirect(url)` (navigate to another agent/face)
- Scope all handles/streams to the active `face_id` and page/tab.
- Leave transport (WS vs WebRTC) as an implementation choice; the contract is
  the source of truth.

## Rationale

- Clean separation keeps the terminal UX independent from device mediation.
- Device-like semantics match the “I/O card / USB” mental model and make server
  tooling simpler.
- Clerk-backed identity at the page enables policy decisions server-side without
  re-prompting.

## Consequences

- Frontend must host both subcomponents and a command dispatcher.
- Agents can rely on a consistent I/O API rather than ad hoc browser glue per
  feature. (Removed centralized observability guidance; rely on face context for
  audit.)

## Alternatives Considered

- Ad hoc per-feature bridges (mic-only, camera-only): rejected due to
  fragmentation.
- Agent-initiated WebRTC without a command contract: rejected for tighter
  coupling and complexity.

## Follow-ups

- Choose canonical term (Face Hardware Connector vs alternatives) and update
  `TERMS.md` status.
- Specify JSON schemas for commands/events and map error codes.
- Document transports and backpressure strategies for streams.
- Add SECURITY notes (permissions prompts, least privilege, revocation).

## References

- `docs/TERMS.md` — Face Viewer, Face Hardware Connector (proposed)
- `docs/RUNTIME.md` — Face Hardware Connector (proposed) sequences and command
  surface
- `docs/ARCHITECTURE.md` — Component and flow diagram
