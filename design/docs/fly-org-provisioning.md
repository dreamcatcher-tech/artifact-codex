# Fly Org Provisioning (Shared-Org Model)

## Purpose

Stand up a fresh Fly.io organization that can host the Artifact stack under the
new shared-org, app-per-customer architecture. The workflow must reliably create
baseline infrastructure (NFS, router, exec, worker pool), publish agent images,
inject required secrets, and hand back machine/app state so downstream
automation can start onboarding customers.

## Platform Topology (Required Baseline)

| Component                          | Role                                                                     | Deployment Notes                                                                                                                                       | Reference                        |
| ---------------------------------- | ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------- |
| `org<id>-nfs`                      | Shared NFS export for router, exec, and agent images                     | Set the `app` field in `fly.nfs.toml` before deploy; must mount a volume named `nfsdata`. Health gate relies on `fly-nfs/scripts/self-mount-check.sh`. | `fly.nfs.toml`, `fly-nfs/`       |
| `org<id>-fly-router`               | Public ingress, Clerk auth, host/agent routing                           | Requires `DC_DOMAIN`, `DC_NFS`, `DC_EXEC`, `DC_WORKER_POOL_APP` env vars. Behavior stays aligned with `fly-router/AGENTS.md`.                          | `fly.router.toml`, `fly-router/` |
| `org<id>-fly-exec`                 | Machines reconciler + replay bridge                                      | Reads `/data/computers` on NFS, provisions Machines into the worker pool. Honors sequencing described in `fly-exec/AGENTS.md`.                         | `fly.exec.toml`, `fly-exec/`     |
| `org<id>-worker-pool`              | Empty Fly app that owns customer Machines                                | Create via CLI, keep `auto_stop_machines = 'suspend'` so idle Machines hibernate.                                                                      | `fly.worker-pool.toml`           |
| `fly-host-basic`, `fly-host-coder` | Baseline agent images with release scripts publishing metadata to NFS    | Run release commands so `fly-exec` can locate images when creating Machines.                                                                           | `host-*/release.ts`              |
| Artifact control plane (MCP host)  | Holds `FLY_ORG_TOKEN`, exposes `infra.*` tools described in `RUNTIME.md` | Not a Fly app in this repo; provision secret storage + MCP endpoints before onboarding customers.                                                      | `design/docs/RUNTIME.md`         |

Naming: use a short org identifier (e.g. `org1`) for app prefixes. Update
`fly.nfs.toml`, `fly.router.toml`, and `fly.exec.toml` so every app resolves via
`<app>.flycast`. Router/exec env vars (`DC_*`) must reference the final names,
and the worker pool app should reuse the prefix.

## Provisioning Phases

### Phase 0 -- Tooling & Access

- Install the latest `flyctl` ("fly") and authenticate with the organization
  owner account (see
  [Fly Docs: Install flyctl](https://www.fly.io/docs/getting-started/launch-demo/#1-install-flyctl)).
- Ensure Deno, Docker, and repo tasks are available (`deno task ok`).
- Confirm you can reach Clerk management to populate `CLERK_*` env vars
  referenced by router and frontend apps.

### Phase 1 -- Create/Label the Organization

1. Create the org and capture the slug for subsequent commands (see
   [Fly Docs: fly orgs create](https://fly.io/docs/flyctl/orgs-create/)):
   ```bash
   fly orgs create org1
   ```

2. Record org metadata (slug, billing account, created_at) in the infra
   registry.
3. Generate an org-scoped machine/deploy token for Artifact (see
   [Fly Docs: fly tokens create org](https://fly.io/docs/flyctl/tokens-create-org/)):
   ```bash
   fly tokens create org --org org1 --name artifact-infra --json > secrets/org1-token.json
   ```
   Store the token inside Artifact (never in per-customer apps).

### Phase 2 -- Bootstrap Shared Storage (NFS)

1. Update `fly.nfs.toml` so `app = 'org1-nfs'` (or your prefix) and keep the
   mount pointed at `nfsdata`.

2. Create the backing volume in the target primary region (see
   [Fly Docs: fly volumes create](https://fly.io/docs/flyctl/volumes-create/)):
   ```bash
   fly volumes create nfsdata --app org1-nfs --region syd --size 10
   ```

3. Deploy the NFS machine using the updated config, ensuring the volume mount is
   retained:
   ```bash
   fly deploy --config fly.nfs.toml
   ```
   (Adjust `primary_region` if needed.)
4. Verify the machine and health check (see
   [Fly Docs: fly machine list](https://fly.io/docs/flyctl/machine-list/) and
   [Fly Docs: fly logs](https://fly.io/docs/flyctl/logs/)):
   ```bash
   fly machine list --config fly.nfs.toml --json
   fly logs --config fly.nfs.toml --no-tail
   ```
   The self-mount check must succeed before proceeding.

### Phase 3 -- Provision Core Apps

1. Update `fly.router.toml` and `fly.exec.toml` with the org prefix, domain, and
   Clerk URLs. Confirm `DC_NFS`, `DC_ROUTER`, `DC_EXEC`, and
   `DC_WORKER_POOL_APP` point at the new app names so the behavior described in
   `fly-router/AGENTS.md` and `fly-exec/AGENTS.md` holds.
2. Deploy router then exec (order matters so router can proxy to exec once it
   boots):
   ```bash
   fly deploy --config fly.router.toml
   fly deploy --config fly.exec.toml
   ```
   Both services mount NFS at boot via `@artifact/fly-nfs` helpers; confirm logs
   show successful mount and registry connections.
3. Create the worker pool app (no machines yet) (see
   [Fly Docs: fly apps create](https://fly.io/docs/flyctl/apps-create/)):
   ```bash
   fly apps create org1-worker-pool -o org1
   ```

4. Deploy `fly.worker-pool.toml` to enforce service defaults (keep
   `auto_stop_machines = 'suspend'`) and verify the app resolves through
   `.flycast` before handing control to `fly-exec`:
   ```bash
   fly deploy --config fly.worker-pool.toml
   ```

### Phase 4 -- Publish Agent Images & Metadata

1. Deploy agent images to refresh release metadata on NFS:
   ```bash
   deno task deploy
   ```

The release commands in `fly.host-basic.toml` and `fly.host-coder.toml` write
`computers/images/*.json` so `fly-exec` tracks available bundles. 2. Confirm
image manifests exist on the NFS mount via
`fly ssh console --config
   fly.nfs.toml` (readonly) or by mounting the volume
locally.

### Phase 5 -- Wire Secrets & Runtime Configuration

- Set Clerk and domain secrets on router:
  ```bash
  fly secrets set --config fly.router.toml \
    CLERK_PUBLISHABLE_KEY=... \
    CLERK_SECRET_KEY=...
  ```
- Provide exec with the worker-pool deploy token if it needs to create machines
  directly; otherwise rely on Artifact's MCP tools.
- Inject `FLY_ORG_TOKEN` into the Artifact control plane and confirm `infra.*`
  MCP tools can call `fly` APIs on behalf of customer apps (see `RUNTIME.md`).

### Phase 6 -- Control-Plane Validation

1. Call `infra.ensure_app` to assert each baseline app exists (Artifact should
   be the sole caller of Fly APIs).
2. Run `infra.list_machines` against `org1-worker-pool` to ensure it is empty at
   bootstrap.
3. Execute a dry-run provisioning request for a synthetic customer app to verify
   token scoping and NFS visibility.

### Phase 7 -- Reporting & Handover

- Export a manifest capturing:
  - Org slug, numeric ID, deploy token metadata.
  - App IDs, primary regions, most recent image digests.
  - Machine IDs for router/exec/nfs with state timestamps.
  - Volume IDs and zones for `nfsdata`.
- Store manifest under `artifacts/provisioning/org1-<timestamp>.json` for audit.
- Provide `fly logs --no-tail` snapshots for router and exec to confirm clean
  boot (see [Fly Docs: fly logs](https://fly.io/docs/flyctl/logs/)).

## Automation Plan (Deno + MCP)

1. **Manifest Schema** -- Define `design/manifests/org.ts` describing org slug,
   domain, primary region, volume size, and app names. Include Clerk env keys
   and Artifact secrets.
2. **Provisioning Script** -- Implement `tasks/provision-org.ts` that:
   - Loads manifest and resolves secrets from the Artifact control plane.
   - Invokes Fly CLI commands via a procman wrapper to capture JSON output
     without leaking secrets.
   - Registers results in an in-memory state graph, emitting a final manifest.
   - Offers `--dry-run` (schema validation + idempotency checks) and `--apply`.
3. **MCP Integration** -- Expose the script via an `infra.provision_org` tool so
   approved agents can request org bootstrap while Artifact enforces policy.
4. **Verification Hooks** -- Add steps that parse `fly machine list --json` and
   `fly volumes list --json` outputs to ensure resources exist, retry with
   exponential backoff, and surface structured errors.
5. **Regression Tests** -- Write unit tests that stub Fly CLI responses and
   ensure failure paths (e.g., missing volume) halt the workflow. Integrate with
   `deno task ok`.

## Failure Handling & Teardown

- If NFS fails health check, block router/exec deploys until resolved. Use
  `fly machine restart` on the NFS machine after verifying the volume.
- For partial deploys, rerun `fly deploy` with the same configs; Fly Machines
  will reconcile images in place.
- Teardown order: destroy worker machines (if any), remove router/exec machines,
  destroy the NFS machine, delete the volume, revoke tokens, then delete apps or
  the org (`fly orgs delete`).

## References

- `fly-router/AGENTS.md`, `fly-exec/AGENTS.md` -- canonical behavior for traffic
  and machine reconciliation.
- `design/docs/RUNTIME.md` -- MCP tool contracts (`infra.*`) and launch
  sequence.
- Fly CLI docs for orgs, volumes, machines, logs, and tokens (see citations
  inline).
