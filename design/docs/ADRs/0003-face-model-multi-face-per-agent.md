# ADR 0003: Face Model — Multiple Faces per Agent Container (renamed from Session Model)

Status: Proposed Date: 2025-08-30 Update (2025-08-31): Observability
event/correlation notes superseded by ADR 0012; progress is shown via live
faces.

## Context

- The Concierge chat runs as a shared agent: users do not receive a dedicated
  container; they receive a face hosted on an existing container.
- Base (per-user) agents should also support multiple concurrent faces (e.g.,
  multiple browser tabs, SSH + web, or viewers).
- The current docs define a per-agent Launch Sequence but do not specify how
  sessions are created, addressed, and resumed across web and SSH.

## Decision

- Adopt a face model where a single agent container can host many concurrent
  faces.
- Introduce `face_id` as a monotonic, URL-safe identifier that binds a user
  agent (browser tab or SSH connection) to a face.
- Web entry without a `face` parameter redirects to a Face URL with
  `?face={face_id}`; web entry with `face` reattaches the same face.
- Implement faces with one `tmux` server per agent and one `tmux` session per
  `face_id`.
- Expose `FACE_ID` and `FACE_KIND` (`web|ssh`) in environments. Eventing is
  implicit in terminals; progress/correlation are visible via live faces (no
  Observability MCP).

## Consequences

- Concierge operates as a true shared service with isolation at the face level.
- Frontend links become stable by `face`, enabling reload/resume semantics.
- Resource management must cap `max_faces` and implement idle eviction to
  protect the container.
- Correlate by `face_id` within faces and UI context.

## Alternatives Considered

- One container per face: rejected for cost/latency; over-provisions and
  increases cold starts.
- MUX by pseudo-tty without `tmux`: viable but loses ergonomic reattach and
  multiplexing features.

## Follow-ups

- Define `max_faces`, idle timeout, and eviction policy defaults in
  `RUNTIME.md`.
- Add guidance for monotonic `face_id`s with Artifact-enforced auth. Remove
  Observability docs; see ADR 0012.
