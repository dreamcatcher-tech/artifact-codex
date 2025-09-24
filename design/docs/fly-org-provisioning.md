# Fly Org Provisioning Workflow

## Goal
Create a repeatable Deno-based workflow that provisions a fresh Fly.io organization (test or prod), deploys all platform apps using their existing `fly.*.toml` configs, and verifies the resulting machines in one execution.

## Approach Overview
1. Reuse Fly helpers from `tasks/fly.ts` so orchestration never shells out directly to Fly APIs.
2. Implement a new procman-driven entry point (`tasks/provision-org.ts`) that sequences org creation, network setup, Flycast allocation, app deployments, and health verification.
3. Drive the workflow from a manifest describing environment-specific details (org slug, WireGuard network suffix, Fly config filenames, image tags, etc.).
4. Surface a consolidated JSON report summarizing org, app, machine, and IPv6 state for downstream automation.

## Detailed Plan
- **Inventory Helpers**: Review `tasks/fly.ts` to confirm available wrappers for org/app operations. Extend it if creation/listing or IPv6 allocation helpers are missing.
- **Manifest Schema**: Define a typed manifest module (e.g. `tasks/provision-org.config.ts`) expressing:
  - `environment`: `"test" | "prod"`.
  - `org`: slug, human name, and any metadata required by Fly.
  - `network`: unique `--network` value per environment.
  - `apps`: array mapping each Fly app to its `fly.<name>.toml`, desired machines count, optional image override.
- **Procman Workflow** (`tasks/provision-org.ts`):
  1. Parse manifest and enforce required fields; support `--dry-run` for validation without API calls.
  2. Create or look up the Fly org via helper; fail fast if missing credentials.
  3. For each app:
     - Ensure the org-specific network exists (create if needed).
     - Allocate private IPv6 via Flycast.
     - Invoke `fly deploy --config <toml> --json` using procman steps.
     - Confirm service definitions stay aligned with template expectations (HTTP listeners, no extra defaults).
  4. After deployment, run verification subtasks:
     - `fly orgs list --json` confirms org presence.
     - `fly apps list --org <slug> --json` verifies apps exist.
     - `fly machines list --app <name> --json` ensures machines running with state `started`.
     - On failures, capture `timeout 30s fly logs -c <toml>` for diagnostics.
- **Reporting**: Aggregate verification results into a structured JSON payload (org ID, app IDs, machine states, IPv6 assignments) and print to stdout; optionally persist to `tmp/` when requested.
- **Tasks & Docs**:
  - Add a Deno task in `deno.json`: `"provision:fly": "deno run -A tasks/provision-org.ts"`.
  - Ensure `deno task ok` still runs `check`, `test`, `fmt --check`, `lint` in order.
  - Document any new environment variables in `shared/app_env.ts` and `design/docs/app-env.md`.

## Verification Strategy
- Treat every Fly CLI call as a procman step with structured output (`--json`, `--machine-config`).
- Fail immediately when expected resources are missing; do not insert silent fallbacks.
- Provide clear console output and final JSON status for CI/human consumption.
- Encourage running the task against disposable orgs before promoting changes to prod.

## Follow-Up Actions
1. Review `tasks/fly.ts` capabilities and design the manifest format.
2. Implement `tasks/provision-org.ts` with procman steps and reporting.
3. Update documentation (`shared/app_env.ts`, `design/docs/app-env.md`) and add the new Deno task.
4. Run `deno task ok` and exercise the new provision flow end-to-end.
