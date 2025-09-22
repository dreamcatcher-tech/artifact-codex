# Application Environment Variables

Our Fly deployments share a runtime contract defined in `shared/env.ts`.
Application-specific expectations now live in `shared/app_env.ts`, which exports
the canonical list (`APP_ENV_VARS`) and helpers such as `resolveNfsSource`. The
table below summarizes each variable, its purpose, default, and which projects
rely on it.

| Variable                     | Description                                                                                                  | Default        | Projects                                                         |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------ | -------------- | ---------------------------------------------------------------- |
| `FLY_NFS_APP`                | Fly app slug that exposes the NFS volume; resolves to `<app>.flycast` when host/source overrides are absent. | —              | `tasks/mount`, `tasks/self_mount_check`, `fly-agent`, `fly-auth` |
| `FLY_NFS_HOST`               | Direct hostname or IP override for the NFS endpoint, bypassing automatic Flycast resolution.                 | —              | `tasks/mount`, `tasks/self_mount_check`, `fly-agent`, `fly-auth` |
| `FLY_NFS_SOURCE`             | Fully qualified hostname used when mounting NFS (highest precedence).                                        | —              | `tasks/mount`, `tasks/self_mount_check`, `fly-agent`, `fly-auth` |
| `FLY_TEST_MACHINE_IP`        | IPv6 address provided during Fly machine checks so validation hits the check machine.                        | —              | `tasks/self_mount_check`, `fly-nfs/scripts`                      |
| `FLY_NFS_MOUNT_DIR`          | Local mount point for the NFS share.                                                                         | `/mnt/fly-nfs` | `tasks/mount`, `tasks/self_mount_check`, `fly-agent`, `fly-auth` |
| `FLY_NFS_SUBPATH`            | Relative path under the export base where app data lives.                                                    | —              | `tasks/mount`, `fly-agent`, `fly-auth`                           |
| `FLY_NFS_MOUNT_OPTS`         | Comma-separated NFS mount options passed to `mount -o`.                                                      | `nfsvers=4.1`  | `tasks/mount`, `tasks/self_mount_check`, `fly-agent`, `fly-auth` |
| `FLY_NFS_CHECK_DIR`          | Scratch directory used by the self-mount check when listing test files.                                      | —              | `tasks/self_mount_check`                                         |
| `FLY_NFS_ENABLE_MOUNT`       | Toggles whether the agent entrypoint mounts NFS before launching.                                            | `1`            | `fly-agent`                                                      |
| `FLY_NFS_RETRIES`            | Number of attempts the agent should make when mounting NFS.                                                  | `5`            | `fly-agent`                                                      |
| `FLY_NFS_RETRY_DELAY_SEC`    | Seconds between agent mount retries.                                                                         | `3`            | `fly-agent`                                                      |
| `FLY_NFS_SELF_CHECK_SUBPATH` | Optional export subpath for Fly NFS self-check scripts.                                                      | —              | `fly-nfs/scripts`                                                |

For any new app-level environment contract, extend `APP_ENV_VARS` so tests,
tasks, and docs stay in sync. Code that needs a Flycast hostname should call
`resolveNfsSource` rather than reimplementing fallback logic.
