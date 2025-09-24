export type ProjectSlug =
  | 'tasks/mount'
  | 'tasks/self_mount_check'
  | 'tasks/fly'
  | 'fly-agent'
  | 'fly-auth'
  | 'fly-computer'
  | 'fly-nfs/scripts'
  | 'mcp-agents'
  | 'mcp-computers'
  | 'scripts/mount-nfs.sh'
  | 'design-docs'

export interface AppEnvVarSpec {
  readonly name: string
  readonly description: string
  readonly requiredFor: readonly ProjectSlug[]
  readonly defaultValue?: string
  readonly deprecated?: boolean
  readonly replacement?: string
}

export const APP_ENV_VARS: readonly AppEnvVarSpec[] = [
  {
    name: 'FLY_NFS_APP',
    description:
      'Fly app slug that exposes the shared NFS volume; resolved to <app>.flycast at mount time.',
    requiredFor: [
      'tasks/mount',
      'tasks/self_mount_check',
      'fly-agent',
      'fly-auth',
      'fly-computer',
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
      'fly-computer',
    ],
    defaultValue: '/mnt/computers',
  },
  {
    name: 'FLY_NFS_SUBPATH',
    description:
      'Relative path under the export base that machine-specific data should live within.',
    requiredFor: ['tasks/mount', 'fly-agent', 'fly-auth', 'fly-computer'],
    defaultValue: 'computers',
  },
  {
    name: 'FLY_NFS_MOUNT_OPTS',
    description: 'Comma-separated NFS mount options passed to mount -o.',
    requiredFor: [
      'tasks/mount',
      'tasks/self_mount_check',
      'fly-agent',
      'fly-auth',
      'fly-computer',
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
  {
    name: 'FLY_API_TOKEN',
    description:
      'Controller token with permission to manage Fly apps and machines for Artifact services.',
    requiredFor: [
      'mcp-agents',
      'mcp-computers',
      'fly-auth',
      'fly-computer',
      'tasks/mount',
      'tasks/self_mount_check',
      'tasks/fly',
    ],
  },
  {
    name: 'FLY_ORG_SLUG',
    description:
      'Primary Fly organization slug used when creating per-user actor apps.',
    requiredFor: ['fly-auth'],
  },
  {
    name: 'FLY_AUTH_BASE_DOMAIN',
    description:
      'Base domain that receives actor subdomains (for example actor-<user>.your-domain).',
    requiredFor: ['fly-auth'],
  },
  {
    name: 'FLY_COMPUTER_TEMPLATE_APP',
    description:
      'Fly app whose machine configuration seeds new per-user actor apps.',
    requiredFor: ['fly-auth'],
    defaultValue: 'fly-computer',
  },
  {
    name: 'FLY_COMPUTER_TARGET_APP',
    description:
      'Per-user Computer app slug that fly-computer should replay traffic to.',
    requiredFor: ['fly-computer', 'fly-auth'],
  },
  {
    name: 'FLY_COMPUTER_AGENT_IMAGE',
    description:
      'Container image reference used when launching the actor’s first agent machine.',
    requiredFor: ['fly-computer', 'fly-auth'],
  },
  {
    name: 'FLY_COMPUTER_REGION',
    description:
      'Optional region override applied when fly-computer provisions actor machines.',
    requiredFor: ['fly-computer'],
  },
  {
    name: 'FLY_AGENT_TEMPLATE_APP',
    description:
      'Fly app whose machine configuration is cloned to provision new agent machines.',
    requiredFor: ['fly-computer'],
    defaultValue: 'universal-compute',
  },
  {
    name: 'CLERK_SECRET_KEY',
    description: 'Server-side Clerk API key consumed by fly-auth middleware.',
    requiredFor: ['fly-auth'],
  },
  {
    name: 'CLERK_SIGN_IN_URL',
    description:
      'Clerk sign-in URL used when redirecting unauthenticated users.',
    requiredFor: ['fly-auth'],
  },
  {
    name: 'CLERK_SIGN_UP_URL',
    description:
      'Clerk sign-up URL used when redirecting users to registration.',
    requiredFor: ['fly-auth'],
  },
  {
    name: 'INTEGRATION_TEST_USER_ID',
    description:
      'Synthetic Clerk user id used by integration flows via the x-artifact-test-user header.',
    requiredFor: ['fly-auth'],
    defaultValue: 'integration-suite',
  },
]

export const APP_ENV_BY_NAME: ReadonlyMap<string, AppEnvVarSpec> = new Map(
  APP_ENV_VARS.map((spec) => [spec.name, spec]),
)

export function getAppEnvVar(name: string): AppEnvVarSpec | undefined {
  return APP_ENV_BY_NAME.get(name)
}

type ReadAppEnvOptions = {
  readonly trim?: boolean
  readonly required?: boolean
  readonly hint?: string
}

export function readAppEnv(
  name: string,
  options: ReadAppEnvOptions = {},
): string | undefined {
  const { trim = true, required = false, hint } = options
  let value: string | undefined
  try {
    value = Deno.env.get(name) ?? undefined
  } catch {
    value = undefined
  }

  if (trim) {
    value = value?.trim()
    if (value && value.length === 0) {
      value = undefined
    }
  }

  if (required && (!value || value.length === 0)) {
    const spec = getAppEnvVar(name)
    const parts = [`Missing ${name}`]
    if (hint) {
      parts.push(hint)
    } else if (spec?.description) {
      parts.push(spec.description)
    } else {
      parts.push('set it in the environment before launching the app')
    }
    throw new Error(parts.join('; '))
  }

  return value
}

export function readRequiredAppEnv(
  name: string,
  options: Omit<ReadAppEnvOptions, 'required'> = {},
): string {
  const value = readAppEnv(name, { ...options, required: true })
  return value ?? ''
}

export interface ResolveNfsSourceOptions {
  readonly source?: string
}

export type NfsSourceEnv = Partial<Record<'FLY_NFS_APP', string>>

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
  const source = firstNonEmpty(overrides.source)
  if (source) return source

  const app = env.FLY_NFS_APP?.trim()
  if (app) return `${app}.flycast`

  throw new Error('Missing FLY_NFS_APP environment variable')
}
