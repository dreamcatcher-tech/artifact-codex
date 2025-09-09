# ADR 0004: Agent Concurrency Modes and Face Model (renamed from Page)

Status: Proposed Date: 2025-08-30

## Context

- We need to define how multiple faces (sessions) share a single agent container
  and how the UI routes between them.

## Decision

- Two modes: `single-face` and `multi-face`.
- Default is `multi-face`; landing without a `?face` param creates a new face
  and redirects to its URL.
- A single interface renders; users switch faces via a switcher overlay or
  command.

## Consequences

- Clear concurrency semantics and limits via config.
- Stable Face URLs enable bookmarking and resumption.

## Alternatives Considered

- Multiple UI routes bound to separate processes: rejected; over-complex and
  breaks shared workspace guarantees.

## Follow-ups

- Finalize defaults in `RUNTIME.md` and update `USER-FLOW.md` and
  `UI-STATES.md`.
