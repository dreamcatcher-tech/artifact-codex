# ADR 0002: MCP‑Invoked Agent Launch + `CODEX_HOME`

**Status:** Accepted\
**Date:** 2025-08-28

## Context

- Agents must start as a result of an MCP tool call once a Fly Machine is ready.
- A custom `config.toml` must be provided at launch time and discovered via an
  environment variable.

## Decision

- Introduce `runtime.mcp` with a
  `launch_agent(app, machine_id, agent_id, config_toml, codex_args?, env?, workdir?)`
  tool.
- Define a "Launch Sequence":
  1. Create `$CODEX_HOME` directory (per‑agent, `0700`),
  2. Write `config.toml` to `$CODEX_HOME/config.toml` (`0600`),
  3. Export `CODEX_HOME`, merge optional `env`,
  4. `exec /usr/local/bin/codex {codex_args…}`.
- Canonicalize `CODEX_HOME` as the directory that contains `config.toml`.

## Alternatives Considered

- Pass `--config` path without `CODEX_HOME`: rejected; env provides simpler
  portability and fewer call‑site branches.
- Prebake config in the image: rejected; launch‑time config is required
  per‑agent.
- Write to `/tmp`: rejected; weaker guarantees and potential leakage.

## Consequences

- Clear, auditable startup path; trivial to implement with a small launcher
  shim.
- Requires the MCP host to handle file permissions and secure piping (no logs of
  secrets).
- `CODEX_HOME` becomes part of the public contract; future changes need an ADR.

## Follow‑ups

- Harden error taxonomy for `runtime.launch_agent`.
- Decide whether to supervise `codex` with `s6/supervisord` vs simple `exec`.
- If persistence is needed, back `$CODEX_HOME` by a Fly volume and document
  rotation.
