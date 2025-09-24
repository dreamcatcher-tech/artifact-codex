# Application Environment Variables

Our Fly deployments share a runtime contract defined in `shared/env.ts`.
Application-specific expectations now live in `shared/app_env.ts`, which exports
the canonical registry (`APP_ENV_VARS`), lookup helpers such as
`APP_ENV_BY_NAME`, and utilities like `resolveNfsSource`. This document
summarizes each variable, its purpose, default, and the projects that rely on
it.

For any new app-level contract, extend `APP_ENV_VARS` so tasks, docs, and tests
remain in sync.

## Storage (NFS)

| Variable                     | Description                                                                           | Default          | Projects                                                                               |
| ---------------------------- | ------------------------------------------------------------------------------------- | ---------------- | -------------------------------------------------------------------------------------- |
| `FLY_NFS_APP`                | Fly app slug whose Flycast hostname backs the shared NFS volume.                      | —                | `tasks/mount`, `tasks/self_mount_check`, `agent-dev-suite`, `fly-auth`, `fly-computer` |
| `FLY_TEST_MACHINE_IP`        | IPv6 address provided during Fly machine checks so validation hits the check machine. | —                | `tasks/self_mount_check`, `fly-nfs/scripts`                                            |
| `FLY_NFS_MOUNT_DIR`          | Local mount point for the NFS share.                                                  | `/mnt/computers` | `tasks/mount`, `tasks/self_mount_check`, `agent-dev-suite`, `fly-auth`, `fly-computer` |
| `FLY_NFS_SUBPATH`            | Relative path under the export base where app data lives.                             | `computers`      | `tasks/mount`, `agent-dev-suite`, `fly-auth`, `fly-computer`                           |
| `FLY_NFS_MOUNT_OPTS`         | Comma-separated NFS mount options passed to `mount -o`.                               | `nfsvers=4.1`    | `tasks/mount`, `tasks/self_mount_check`, `agent-dev-suite`, `fly-auth`, `fly-computer` |
| `FLY_NFS_CHECK_DIR`          | Scratch directory used by the self-mount check when listing test files.               | —                | `tasks/self_mount_check`                                                               |
| `FLY_NFS_ENABLE_MOUNT`       | Toggles whether the agent entrypoint mounts NFS before launching.                     | `1`              | `agent-dev-suite`                                                                      |
| `FLY_NFS_RETRIES`            | Number of attempts the agent should make when mounting NFS.                           | `5`              | `agent-dev-suite`                                                                      |
| `FLY_NFS_RETRY_DELAY_SEC`    | Seconds between agent mount retries.                                                  | `3`              | `agent-dev-suite`                                                                      |
| `FLY_NFS_SELF_CHECK_SUBPATH` | Optional export subpath for Fly NFS self-check scripts.                               | —                | `fly-nfs/scripts`                                                                      |

## Fly Access & Provisioning

| Variable                    | Description                                                                             | Default        | Projects                                                             |
| --------------------------- | --------------------------------------------------------------------------------------- | -------------- | -------------------------------------------------------------------- |
| `FLY_API_TOKEN`             | Controller token with permission to manage Fly apps and machines for Artifact services. | —              | `fly-auth`, `fly-computer`, `tasks/*`, `mcp-agents`, `mcp-computers` |
| `FLY_ORG_SLUG`              | Primary Fly organization slug used when creating per-user actor apps.                   | —              | `fly-auth`                                                           |
| `FLY_AUTH_BASE_DOMAIN`      | Base domain that receives actor subdomains (e.g. `actor-*.your-domain`).                | —              | `fly-auth`                                                           |
| `FLY_COMPUTER_TEMPLATE_APP` | Fly app whose machine configuration seeds new per-user actor apps.                      | `fly-computer` | `fly-auth`                                                           |

## Fly Computer Runtime

| Variable                   | Description                                                                      | Default       | Projects                   |
| -------------------------- | -------------------------------------------------------------------------------- | ------------- | -------------------------- |
| `FLY_COMPUTER_TARGET_APP`  | Per-user Computer app slug that `fly-computer` should replay traffic to.         | —             | `fly-computer`, `fly-auth` |
| `FLY_COMPUTER_AGENT_IMAGE` | Container image reference used when launching the actor’s first agent machine.   | —             | `fly-computer`, `fly-auth` |
| `FLY_COMPUTER_REGION`      | Optional region override applied when `fly-computer` provisions actor machines.  | —             | `fly-computer`             |
| `FLY_AGENT_TEMPLATE_APP`   | Fly app whose machine config seeds new agent machines inside per-user computers. | `fly-agent-1` | `fly-computer`, `fly-auth` |

## Clerk Authentication

| Variable            | Description                                                    | Default | Projects   |
| ------------------- | -------------------------------------------------------------- | ------- | ---------- |
| `CLERK_SECRET_KEY`  | Server-side Clerk API key consumed by `fly-auth` middleware.   | —       | `fly-auth` |
| `CLERK_SIGN_IN_URL` | Clerk sign-in URL used when redirecting unauthenticated users. | —       | `fly-auth` |
| `CLERK_SIGN_UP_URL` | Clerk sign-up URL used when redirecting users to registration. | —       | `fly-auth` |

## Integration & Testing

| Variable                   | Description                                                                              | Default             | Projects   |
| -------------------------- | ---------------------------------------------------------------------------------------- | ------------------- | ---------- |
| `INTEGRATION_TEST_USER_ID` | Synthetic Clerk user id used by integration flows via the `x-artifact-test-user` header. | `integration-suite` | `fly-auth` |

## Agent Faces

| Variable   | Description                                                            | Default | Projects      |
| ---------- | ---------------------------------------------------------------------- | ------- | ------------- |
| `DC_FACES` | Comma-separated face kind identifiers that agent runtimes must enable. | —       | `agent-basic` |

## Deprecated Fallbacks

| Variable | Description | Replacement | Projects |
| -------- | ----------- | ----------- | -------- |

Code that needs a Flycast hostname should call `resolveNfsSource` rather than
reimplementing fallback logic. When you add new environment variable
expectations, update `shared/app_env.ts` and extend the tables above.
