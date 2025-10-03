# End-to-End Validation (Shared-Org Stack)

## Purpose

Exercise the Artifact stack from router ingress through worker Machines using
the new shared Fly organization model. The guide defines repeatable flows that
validate app health, unhappy paths, and MCP-driven automation without impacting
production tenants. It assumes the baseline provisioning in
`design/docs/fly-org-provisioning.md` has completed successfully.

## Stack Under Test

| Component                          | Behavior to Observe                                       | Primary Checks                                                                                           | References                                |
| ---------------------------------- | --------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- | ----------------------------------------- |
| `org<id>-nfs`                      | Shared volume export consumed by router, exec, and agents | Volume mounts healthy, self-mount script reports success, volume contents mutate during scenarios.       | `fly.nfs.toml`, `fly-nfs/`                |
| `org<id>-fly-router`               | Public ingress, Clerk auth, actor/agent routing           | Clerk redirects, machine notifications, adherence to routing rules in `fly-router/AGENTS.md`.            | `fly.router.toml`, `fly-router/AGENTS.md` |
| `org<id>-fly-exec`                 | Filesystem reconciler and replay bridge                   | Picks up NFS state writes, provisions Machines in worker pool, handles replays per `fly-exec/AGENTS.md`. | `fly.exec.toml`, `fly-exec/AGENTS.md`     |
| `org<id>-worker-pool`              | Empty app that owns customer Machines                     | Machines created on demand via exec, hibernates when idle (`auto_stop_machines = 'suspend'`).            | `fly.worker-pool.toml`                    |
| `fly-host-basic`, `fly-host-coder` | Baseline agent bundles staged on NFS                      | Release manifests published to `computers/images/*.json`, agents connect to router.                      | `host-*/release.ts`                       |
| Artifact control plane (MCP host)  | Issues `infra.*` tools and stores org token               | Provides `infra.ensure_app`, `infra.list_machines`, `infra.provision_org` hooks.                         | `design/docs/RUNTIME.md`                  |

## Environment Strategies

| Strategy                | Description                                                                                             | Fit                                       | Tear-down Notes                                                                                                                           |
| ----------------------- | ------------------------------------------------------------------------------------------------------- | ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| **Ephemeral org slice** | Append `-e2e-<runid>` suffixes to the org prefix and deploy fresh NFS/router/exec/agents per suite run. | Highest isolation, parallel friendly.     | Destroy with `fly apps destroy` and delete volumes/tokens when manifests confirm success.                                                 |
| **Shared staging org**  | Reuse a long-lived shared org and recycle Machines between runs.                                        | Lower cost, sequential runs.              | Reset worker Machines with `fly machine list --config fly.worker-pool.toml --json` + targeted restarts; rotate secrets before next suite. |
| **Hybrid fixture pool** | Keep NFS/router/exec warm; create per-scenario worker Machines and agents.                              | Fast validation of routing/exec behavior. | Track fixture manifests and clean orphan Machines via `infra.list_machines`.                                                              |

## Prerequisites and Access

- Install the latest `flyctl` and authenticate (`fly auth login`). See
  `fly --help` or [Fly Docs: flyctl](https://fly.io/docs/flyctl/).
- Ensure Deno, Docker, and repo tooling are available (`deno task ok`).
- Ensure Clerk keys and shared secrets are staged in the Artifact control plane
  so routers boot cleanly.
- Fetch the org-scoped API token and scope it to `machines:write`, `apps:deploy`
  for automation. Store in MCP secret storage.
- Clone this repo and open the `design/docs` materials alongside app runbooks.

## End-to-End Phases

### Phase 0 -- Baseline Health Check

1. Confirm NFS state:
   ```bash
   fly machine list --config fly.nfs.toml --json
   fly logs --config fly.nfs.toml --no-tail
   ```
   The self-mount check must show `mount ok`. (See
   [Fly Docs: fly machine list](https://fly.io/docs/flyctl/machine-list/) and
   [Fly Docs: fly logs](https://fly.io/docs/flyctl/logs/).)
2. Verify router/exec deploys are current:
   ```bash
   fly status --config fly.router.toml
   fly status --config fly.exec.toml
   ```
   Confirm environment variables match the target org prefix and domains.

### Phase 1 -- Scenario Staging

1. Decide scenario identifiers (e.g. `ROUTER-INGRESS`, `EXEC-RECONCILE`).
2. Prepare manifests in `artifacts/e2e/<timestamp>.json` describing inputs:
   - Org slug, app names, worker machine targets.
   - Expected agent bundle digests from NFS.
3. Use `infra.ensure_app` to ensure apps exist before mutating state.

### Phase 2 -- Deploy or Mutate Apps

- For app redeploys, invoke:
  ```bash
  fly deploy --config fly.router.toml --image <tag>
  fly deploy --config fly.exec.toml --image <tag>
  ```
  Adjust image tags per scenario; use `--app` if testing alternate prefixes (see
  [Fly Docs: fly deploy](https://fly.io/docs/flyctl/deploy/)).
- For agent bundles, run `deno task deploy` to refresh release manifests.
- To create temporary Machines, use `fly machine run` with scenario-specific
  metadata and the worker pool app.

### Phase 3 -- Assertions and Observability

- Pull logs without streaming unless debugging:
  ```bash
  fly logs --config fly.router.toml --no-tail --machine <machine-id>
  ```
- Inspect Machine inventory:
  ```bash
  fly machine list --config fly.worker-pool.toml --json
  ```
- Exercise MCP tools (`infra.list_machines`, `infra.router_trace`, etc.) to
  capture structured evidence.
- Run HTTP probes through the router base domain and agent domains defined in
  `fly-router/AGENTS.md`.

### Phase 4 -- Fault Injection and Recovery

- Suspend/restore Machines with:
  ```bash
  fly machine stop --config fly.worker-pool.toml --machine <id>
  fly machine start --config fly.worker-pool.toml --machine <id>
  ```
  (See [Fly Docs: fly machine](https://fly.io/docs/flyctl/machine/).)
- Flip secrets via `fly secrets set --config ...` to validate Clerk failure
  handling; revert in cleanup.
- Trigger exec replay by editing instance files on NFS (per
  `fly-exec/AGENTS.md`).

### Phase 5 -- Cleanup and Reporting

- Destroy scenario Machines and volumes in reverse creation order.
- Revoke tokens used in automation.
- Archive manifests, log excerpts, and MCP transcripts under
  `artifacts/e2e/<timestamp>/`.
- File follow-up issues for regression coverage.

## Observability Playbook

- Prefer `fly logs --no-tail` and `--machine` filters to capture bounded output.
- Use `fly machine list --json` snapshots before and after exec actions to
  detect reconciliation drift.
- Route HTTP probes through the router to validate Clerk flows, agent mapping,
  and replay headers (see `fly-router/AGENTS.md`).
- Capture MCP tool output alongside Fly CLI results for a full audit trail.
- When investigating Machines, use `fly ssh console --config fly.exec.toml` to
  inspect `/data/computers/<id>` state.

## Scenario Matrix (Illustrative)

| ID            | Purpose                            | Happy Path                                                                               | Unhappy Variant                                                                         |
| ------------- | ---------------------------------- | ---------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| `ROUTER-001`  | Router ingress and Clerk handshake | Auth flow reroutes unauthenticated users, router creates actor computer and lands agent. | Remove Clerk secret, expect 401s and router to log auth failures while exec stays idle. |
| `EXEC-010`    | Exec reconciliation loop           | Write `queued` instance file and observe Machine creation in worker pool.                | Kill machine mid-boot; expect exec to mark `starting`->`queued` and retry.              |
| `WORKER-020`  | Worker pool hibernation            | Machines auto-suspend after idle period, restart on demand.                              | Force stop Machine; ensure exec rehydrates instance on next router signal.              |
| `AGENT-030`   | Agent bundle availability          | Router routes to new agent release from NFS manifest.                                    | Publish malformed manifest; exec should reject and log parse error.                     |
| `CONTROL-040` | MCP orchestration                  | `infra.provision_org` and `infra.list_machines` emit expected manifest + state.          | Revoke token; expect MCP tool failure and alert.                                        |
| `FAULT-050`   | NFS outage drill                   | Suspend NFS machine; router and exec detect mount failure and back off.                  | Leave NFS down longer than grace period; verify alerts and recovery once restarted.     |

## Fault Injection Techniques

- **Machine lifecycle**: `fly machine stop/start/restart` to test exec
  resilience.
- **Secrets rotation**: Temporarily set invalid Clerk secrets; confirm router
  returns 401 and recovers once reverted.
- **Filesystem drift**: Remove or alter `computers/<id>/exec/*.json` entries to
  force reconciliation.
- **Network perturbation**: Launch sidecar Machines to add latency or packet
  loss for router->exec traffic; monitor retry behavior.
- **Token expiry**: Rotate org token in Artifact control plane and rerun MCP
  workflows to verify failure signals.

## Automation Hooks

- `tasks/e2e.ts` (to be written) should accept `--scenario`, load manifests, and
  call MCP tools for orchestration.
- Extend `deno task ok` to add smoke suites that run `ROUTER-001` and `EXEC-010`
  nightly.
- Store structured results in `artifacts/e2e/` and surface summaries to CI via
  workflow artifacts or dashboards.
- Guard Fly CLI execution behind MCP tools (`fly.run`, `fly.logs`, etc.) to keep
  agent actions auditable and scoped.

## Next Steps

1. Implement the `tasks/e2e.ts` orchestrator and supporting manifest schema.
2. Add regression tests that mock Fly CLI responses for failure coverage.
3. Stand up a nightly GitHub Actions job that executes the smoke matrix against
   a dedicated staging org slice.
4. Keep this document synchronized with `fly-router/AGENTS.md`,
   `fly-exec/AGENTS.md`, and provisioning guidance as the stack evolves.
