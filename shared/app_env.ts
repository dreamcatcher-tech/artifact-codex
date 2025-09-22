export type ProjectSlug =
  | 'tasks/mount'
  | 'tasks/self_mount_check'
  | 'fly-agent'
  | 'fly-auth'
  | 'fly-nfs/scripts'
  | 'scripts/mount-nfs.sh'
  | 'design-docs'

export interface AppEnvVarSpec {
  readonly name: string
  readonly description: string
  readonly requiredFor: readonly ProjectSlug[]
  readonly defaultValue?: string
}

export const DEFAULT_NFS_FLYCAST_HOST = 'nfs-proto.flycast'

export const APP_ENV_VARS: readonly AppEnvVarSpec[] = [
  {
    name: 'FLY_NFS_APP',
    description:
      'Fly app slug that exposes the NFS volume; resolved as <app>.flycast when HOST/SOURCE are absent.',
    requiredFor: [
      'tasks/mount',
      'tasks/self_mount_check',
      'fly-agent',
      'fly-auth',
    ],
  },
  {
    name: 'FLY_NFS_HOST',
    description:
      'Direct hostname or IP override for the NFS endpoint, bypassing automatic <app>.flycast resolution.',
    requiredFor: [
      'tasks/mount',
      'tasks/self_mount_check',
      'fly-agent',
      'fly-auth',
    ],
  },
  {
    name: 'FLY_NFS_SOURCE',
    description:
      'Fully qualified hostname used when mounting the NFS export (without :/path). Highest-precedence override.',
    requiredFor: [
      'tasks/mount',
      'tasks/self_mount_check',
      'fly-agent',
      'fly-auth',
    ],
  },
  {
    name: 'FLY_TEST_MACHINE_IP',
    description:
      'IPv6 address provided by Fly during machine checks so validation targets the check machine.',
    requiredFor: ['tasks/self_mount_check', 'fly-nfs/scripts'],
  },
  {
    name: 'FLY_NFS_MOUNT_DIR',
    description: 'Local directory where the NFS share is mounted.',
    requiredFor: [
      'tasks/mount',
      'tasks/self_mount_check',
      'fly-agent',
      'fly-auth',
    ],
    defaultValue: '/mnt/fly-nfs',
  },
  {
    name: 'FLY_NFS_SUBPATH',
    description:
      'Relative path under the export base that machine-specific data should live within.',
    requiredFor: ['tasks/mount', 'fly-agent', 'fly-auth'],
  },
  {
    name: 'FLY_NFS_MOUNT_OPTS',
    description: 'Comma-separated NFS mount options passed to mount -o.',
    requiredFor: [
      'tasks/mount',
      'tasks/self_mount_check',
      'fly-agent',
      'fly-auth',
    ],
    defaultValue: 'nfsvers=4.1',
  },
  {
    name: 'FLY_NFS_CHECK_DIR',
    description:
      'Scratch directory used by the self-mount check to verify the mount contents.',
    requiredFor: ['tasks/self_mount_check'],
  },
  {
    name: 'FLY_NFS_ENABLE_MOUNT',
    description:
      'When set to 1, the fly-agent entrypoint performs the NFS mount before launching.',
    requiredFor: ['fly-agent'],
    defaultValue: '1',
  },
  {
    name: 'FLY_NFS_RETRIES',
    description: 'Number of attempts the agent should make when mounting NFS.',
    requiredFor: ['fly-agent'],
    defaultValue: '5',
  },
  {
    name: 'FLY_NFS_RETRY_DELAY_SEC',
    description: 'Seconds to wait between agent mount retries.',
    requiredFor: ['fly-agent'],
    defaultValue: '3',
  },
  {
    name: 'FLY_NFS_SELF_CHECK_SUBPATH',
    description:
      'Optional export subpath used by the fly-nfs self-check scripts when validating mounts.',
    requiredFor: ['fly-nfs/scripts'],
  },
]

export interface ResolveNfsSourceOptions {
  readonly source?: string
  readonly host?: string
  readonly app?: string
  readonly fallback?: string
}

export type NfsSourceEnv = Partial<
  Record<
    'FLY_NFS_SOURCE' | 'FLY_NFS_HOST' | 'FLY_NFS_APP' | 'FLY_TEST_MACHINE_IP',
    string
  >
>

function firstNonEmpty(
  ...values: Array<string | undefined>
): string | undefined {
  for (const value of values) {
    const trimmed = value?.trim()
    if (trimmed) return trimmed
  }
  return undefined
}

export function resolveNfsSource(
  env: NfsSourceEnv,
  overrides: ResolveNfsSourceOptions = {},
): string {
  const fallback = overrides.fallback?.trim() || DEFAULT_NFS_FLYCAST_HOST

  const source = firstNonEmpty(overrides.source, env.FLY_NFS_SOURCE)
  if (source) return source

  const host = firstNonEmpty(overrides.host, env.FLY_NFS_HOST)
  if (host) return host

  const app = firstNonEmpty(overrides.app, env.FLY_NFS_APP)
  if (app) return `${app}.flycast`

  const machineIp = firstNonEmpty(env.FLY_TEST_MACHINE_IP)
  if (machineIp) return machineIp

  return fallback
}
