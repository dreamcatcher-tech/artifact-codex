# ADR 0009: One Fly App per Customer; Central Artifact App as Infra MCP Host

## Status

Accepted — 2025-08-30. Supersedes ADR 0008.

## Context

- We cannot rely on org‑per‑customer because Unified Billing currently links up
  to ~100 orgs under a single payer, which doesn’t scale for our needs.
- We want strong app‑level isolation per customer while keeping all resources
  inside a single Fly organization for operational simplicity.
- A central control plane (Artifact) should receive provisioning requests from
  any customer app and create/update Machines accordingly.

## Decision

1. Tenancy: one app per customer inside a single Fly organization.
2. Control plane: a dedicated Artifact app acts as the MCP host and
   “infrastructure app”, exposing tools to provision Machines in customer apps.
3. Secrets and tokens:
   - Artifact app holds an org‑scoped token `FLY_ORG_TOKEN` that authorizes
     managing any app within the org.
   - Customer apps do not store Fly API tokens. All infrastructure actions are
     performed via MCP calls to Artifact.
4. Frontend: a separate web app handles auth, marketing/front page, redirects,
   and embeds agent faces (TTYD iframes) from customer apps.

## Rationale

- Avoids the 100‑linked‑org limit while keeping clean per‑customer isolation at
  the app boundary.
- Centralizes infra authority and secrets in Artifact, reducing blast radius in
  customer apps.
- Keeps simple URL and DNS flows: one `{customer-app}.fly.dev` (plus friendly
  aliases) per customer.

## Consequences

- Artifact must authenticate and authorize incoming requests from customer apps
  before performing infra actions.
- Token rotation policies cover only the org token in Artifact; customer apps
  hold no Fly API tokens.
- Observability and audit should attribute infra actions to the requesting
  app/user.

## Follow-ups

- Add MCP tool contracts in RUNTIME.md for provisioning calls (create app,
  create machine, rotate secret, etc.).
- Build a token rotation job in Artifact and record last‑rotated state.

## References

- Fly Docs — Access tokens (org‑scoped, deploy tokens overview).
- Fly Docs — Machines API (auth and endpoints).
