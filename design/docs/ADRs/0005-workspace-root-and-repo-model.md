# ADR 0005: Workspace Root and Repo Model

Status: Accepted Date: 2025-08-30

## Context

Agents require a predictable filesystem layout for repos and scratch space, with quotas and GC.

## Decision

- Workspace root is `/workspace`.
- Repos are checked out under `/workspace/{name}`.
- Scratch repos live under `/workspace/.scratch/{id}` with TTL and GC.
- A manifest file `$HOME/workspace.toml` declares repos and quotas.

## Rationale

- Consistent paths simplify tooling and face sharing.
- Manifest enables declarative setup and enforcement.

## Consequences

- Launch must ensure `/workspace` exists and materialize repos before accepting faces.
- Git operations must lock per path to avoid corruption.

## Alternatives Considered

- Per-face directories: rejected due to shared state model.

## Follow-ups

- Add enforcement hooks in runtime for quotas/GC.
