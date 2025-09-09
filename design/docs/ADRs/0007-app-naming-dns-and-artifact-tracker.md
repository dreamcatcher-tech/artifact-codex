# ADR 0007: App Naming, Friendly DNS, and Artifact Tracker

Status: Accepted Date: 2025-08-30

## Context

Apps need stable, human-friendly URLs and a registry mapping users to app
endpoints.

## Decision

- Use globally-unique friendly app names (two words + digits) for
  `{app}.fly.dev`.
- Provide friendly DNS aliases for bookmarks.
- Maintain an Artifact State Tracker mapping
  `user_id → {app, agent paths, aliases}`.

## Consequences

- Bookmarks survive recreate via alias repointing.
- Artifact can orchestrate maintenance mode and recreate flows.

## Follow-ups

- Add maintenance face design to `USER-FLOW.md` and `UI-STATES.md`.
