# Agents: Purpose and Working Agreement

This file defines how the “doc agent” partners with you to design a system where each AI agent runs
in its own Fly.io container and users interact via SSH. Say “lock it” on any section to freeze it;
fundamental changes go through an ADR.

## Scope & Base Assumptions

- One container per AI agent (Fly.io deployment).
- Users connect to a specific agent via SSH to that container.
- The SSH session is the primary UI (terminal-first experience).

## How We Work

- Questions first: remove ambiguity with targeted questions and small decision packets.
- Options with tradeoffs: propose alternatives, call risks, recommend a default.
- Dictionary-first: settle terms in `TERMS.md` before changing other docs.
- Grounded research (search liberally): use web search proactively and often; prefer primary
  sources; record citations in `REFERENCES.md`.
- Cohesion sweeps: reconcile terminology and flows across all docs after changes.
- Decision logging: capture impactful choices as ADRs and link them where relevant.

## Document Map

- ARCHITECTURE.md — System overview, components, data/control flows.
- AGENTS.md — This agreement and how we collaborate.
- TERMS.md — Canonical dictionary and naming conventions.
- LIFECYCLE.md — Provisioning, config, updates, suspend/resume, teardown.
- RUNTIME.md — Agent process model, prompts, tools, state, policies.
- NETWORKING.md — Ports, SSH entry, egress rules, discovery.
- SECURITY.md — Identity, authN/authZ, secrets, isolation, audit.
- OPERATIONS.md — Deploy, scaling, backups, incident runbooks, SLOs.
- OBSERVABILITY.md — Logs, metrics, traces, session transcripts.
- COSTS.md — Instance sizing, quotas, idle policies, autosuspend.
- USER-FLOW.md — How users select/connect/use agents via SSH.
- ADRs/ — Architecture Decision Records (one decision per file).
- REFERENCES.md — External references and dated citations.
- UI-STATES.md — ASCII wireframes for the terminal UI.
- DIAGRAMS.md — Mermaid diagram index, conventions, and templates.

## Naming & Terminology

- Options by default: for each new concept, present 3–7 candidate names with pros/cons and prior
  art.
- Canonical dictionary: `TERMS.md` holds the chosen term, clear definition, examples, allowed
  synonyms, and status (proposed/accepted/deprecated).
- Style guide: Product/features Title Case; CLI `kebab-case`; env `UPPER_SNAKE_CASE`; IDs/hosts
  lowercase with `-`; files/dirs `kebab-case`.
- Rename control: renaming an accepted term requires an ADR plus a docs sweep plan.
- Blocker rule: unresolved term ambiguity blocks edits until `TERMS.md` is updated.

## Research & Citations

- Use web search to validate platform limits, security guidance, pricing/quotas, and best practices.
- Prefer official/primary sources; cross-check with reputable secondary sources.
- Record publication date and accessed date; add entries to `REFERENCES.md`.
- Re-check volatile topics on scheduled sweeps or when base images/templates change.

### Web Search Guidance (Search Liberally)

- Default to search: when facts could be stale, unclear, or niche, search before asserting.
- Trigger list: "latest/new/today", versions/APIs, prices/quotas/limits, security/compliance, vendor
  policies, OS/distribution specifics, performance claims, and any term you don’t fully recognize.
- Verification: for high-impact or time-sensitive topics, use at least two credible sources and
  reconcile differences.
- Source preference: prioritize official docs, standards bodies, and vendor posts; supplement with
  reputable secondary analyses.
- Citations: for each external fact used, add or update an entry in `REFERENCES.md` with title,
  publisher, publication date, URL, and accessed date.
- Volatile content: schedule re-checks after base image/template updates or quarterly sweeps; update
  `REFERENCES.md` accordingly.
- Don’t guess: if unsure after a quick scan, say so and propose a brief search plan.

## Diagrams

- ASCII UI: keep terminal layouts and states in `UI-STATES.md` (80 cols, labeled regions,
  transitions). Must align with `USER-FLOW.md` and `TERMS.md`.
- Mermaid: use in-line fenced `mermaid` blocks for architecture, flows, state/sequence diagrams;
  store shared versions in `DIAGRAMS.md`.
- Accessibility: include brief text captions and avoid color-only distinctions.
- Validation: after any edit to Markdown files, run `deno task check:mermaid`. Treat any failures as
  blockers and fix before commit/PR. Validation must pass before the task is considered done.

## Reconciliation Rules

- Single source of truth: one authoritative location per fact; others link back.
- Dictionary-first: terminology governs; `TERMS.md` leads other documents.
- Versioned decisions: significant changes go through ADRs.
- Checklists: each lifecycle phase includes an auditable checklist.
- Drift sweeps: after major changes, sweep all docs for consistency.

## Decision Backlog (track in ADRs when resolved)

- Identity & addressability
- SSH authZ/authN model
- Runtime image strategy & sizing
- State & storage (ephemeral vs volumes)
- Session UX (bash + CLI vs agent REPL) and tool guardrails
- Networking/egress and internal service access
- Security & secrets handling
- Observability (logs/metrics/traces/transcripts)
- Cost controls (TTL, quotas, autosuspend)
- Compliance/data boundaries and delivery/rollout

## Next Steps

Reply with high-level choices for: identity model, SSH auth, persistence needs, default CPU/RAM and
idle timeout, and preferred session UX. I’ll draft the next docs and ADRs accordingly and run a
consistency sweep.
