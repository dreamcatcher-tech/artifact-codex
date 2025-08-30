# ADR 0003: Session Model — Multiple Sessions per Agent Container

Status: Proposed
Date: 2025-08-30

## Context

- The Concierge chat must run as a shared agent: users do not receive a dedicated container; they
  receive a session hosted on an existing container.
- Base (per-user) agents should also support multiple concurrent sessions (e.g., multiple browser
  tabs, SSH + web, or viewers).
- The current docs define a per-agent Launch Sequence but do not specify how sessions are created,
  addressed, and resumed across web and SSH.

## Decision

- Adopt a session model where a single agent container can host many concurrent sessions.
- Introduce `session_id` as an opaque, URL-safe identifier that binds a user agent (browser tab or
  SSH connection) to a session.
- Web entry without a `sid` parameter redirects to a Session URL with `?sid={session_id}`; web
  entry with `sid` reattaches the same session.
- Implement sessions with one `tmux` server per agent and one `tmux` session per `session_id`.
- Expose `SESSION_ID` and `SESSION_KIND` (`web|ssh`) in session environments; emit observability
  events on session start/attach/detach/end.

## Consequences

- Concierge operates as a true shared service with isolation at the session level.
- Frontend links become stable by `sid`, enabling reload/resume semantics.
- Resource management must cap `max_sessions` and implement idle eviction to protect the container.
- Logs/metrics/traces can be correlated by `session_id` for support and auditing.

## Alternatives Considered

- One container per session: rejected for cost/latency; over-provisions and increases cold starts.
- MUX by pseudo-tty without `tmux`: viable but loses ergonomic reattach and multiplexing features.

## Follow-ups

- Define `max_sessions`, idle timeout, and eviction policy defaults in `RUNTIME.md`.
- Add security guidance for `sid` entropy and exposure (treat as bearer-like; require auth/ACLs).
- Extend `OBSERVABILITY.md` with session-scoped log/tracing fields.
