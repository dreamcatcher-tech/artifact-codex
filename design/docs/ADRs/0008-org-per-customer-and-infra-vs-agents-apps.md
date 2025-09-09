# ADR 0008: One Fly Organization per Customer; Infra App controls provisioning; Agents App hosts agents

## Status

Superseded by ADR 0009 on 2025-08-30. Note: customer app deploy tokens described
here are obsolete and not used in the current design.

## Context

- We want strong tenant isolation, clean billing, and a simple way to expose
  billing to customers.
- Fly.io bills per organization and supports Unified Billing to consolidate
  charges from many orgs under a single "Billing Organization". Linked
  Organizations are isolated networks by default and can be cross-connected via
  Flycast when needed. Billing Organizations can have up to 100 Linked
  Organizations. See references.
- Agents need to programmatically create/update Machines. The safest pattern is
  to use scoped tokens: org-scoped for infrastructure automation within a
  customer’s org; app-scoped for an individual app to manage itself.

## Decision

1. Organization per customer
   - Create one Fly organization for each customer ("Customer Org").
   - Option A (customer-pays): Make the customer an admin/owner of their org so
     they can view invoices directly in Fly’s billing UI (Stripe portal) for
     that org.
   - Option B (you-pay): Use Fly Unified Billing to link each Customer Org to
     your central Billing Organization to receive one consolidated invoice
     across up to 100 linked orgs.

2. Two apps per Customer Org
   - Infra App: a private control-plane app that holds the provisioning service.
     It owns an org-scoped token (secret) to manage apps/Machines within the
     Customer Org.
   - Agents App: the data-plane app that runs agent Machines. Each Agents App
     stores an app-scoped deploy token (secret) so its Machines can call the
     Machines API to introspect/update themselves when appropriate.

3. Tokens and secrets
   - Org token (for Infra App):
     `fly tokens create org --name infra@<customer> --expiry <dur>`; store as
     `FLY_ORG_TOKEN` in the Infra App.
   - App token (for Agents App):
     `fly tokens create deploy -a <agents-app> --name agents@<customer> --expiry <dur>`;
     store as `FLY_API_TOKEN` in the Agents App.
   - Use the token with `Authorization: Bearer $TOKEN` against
     `https://api.machines.dev` (or `_api.internal:4280` from inside the private
     network).

4. Networking
   - Keep Customer Orgs isolated by default. When the Infra App needs to be
     reached from other orgs or control planes, expose it via Flycast with
     explicit cross-org addresses.

## Rationale

- Clear tenant boundaries map to Fly organizations, aligning isolation, access
  control, and billing.
- Customers who should see/pay their own bills can do so at the org level
  without custom billing work.
- Centralized payor model is possible via Unified Billing, while retaining
  org-level isolation.
- Scoped tokens reduce blast radius versus personal auth tokens.

## Consequences

- Provisioning flow must create or resolve a Customer Org, then create Infra and
  Agents apps inside it.
- Token lifecycle is per app/org. We need rotation and revocation procedures.
- If you expect more than 100 orgs under one consolidated invoice, create
  multiple Billing Organizations and shard Linked Organizations across them, or
  let customers pay for their own orgs.

## Follow-ups

- Add automation to rotate `FLY_ORG_TOKEN` and `FLY_API_TOKEN` on a schedule;
  record last-rotated in Artifact state.
- Document teardown: revoke tokens, delete Machines, remove Flycast addresses,
  and optionally unlink from Unified Billing.
- Evaluate SSO to customer orgs (invite flow and roles) for support access.

## References

- Fly Docs — Billing, invoices, Unified Billing (limits, cross-org notes).
- Fly Docs — Access tokens (org-scoped, app-scoped deploy, SSH, machine-exec).
- Fly Docs — Machines API auth and endpoints.
- Fly Docs — Flycast (cross-organization/private networking routing).
