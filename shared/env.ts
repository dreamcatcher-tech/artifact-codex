import { load } from '@std/dotenv'

// Loads environment variables from the shared .env file that is
// written by shared/pre.ts. Safe if the file is missing.
// When exportToEnv is true, values are exported to Deno.env (without
// overriding existing variables), matching std/dotenv semantics.
export async function loadEnvFromShared(
  opts: { exportToEnv?: boolean; path?: string | URL } = {},
): Promise<Record<string, string>> {
  const exportToEnv = opts.exportToEnv ?? true
  const envPath = (() => {
    if (opts.path) {
      return typeof opts.path === 'string' ? opts.path : opts.path.pathname
    }
    // Default to the .env next to this file (i.e., shared/.env)
    return new URL('./.env', import.meta.url).pathname
  })()

  try {
    const env = await load({ envPath, export: exportToEnv })
    return env
  } catch (_err) {
    // If missing or unreadable, act as a no-op
    return {}
  }
}

export type FlyMachineRuntimeEnv = {
  /** Unique Fly app name used for identification and 6PN internal DNS (e.g. syd.$FLY_APP_NAME.internal). */
  FLY_APP_NAME: string
  /** Machine identifier used by flyctl, the Machines API, and visible in machine logs. */
  FLY_MACHINE_ID: string
  /** Allocation identifier; identical to the machine's FLY_MACHINE_ID value. */
  FLY_ALLOC_ID: string
  /** Three-letter region code where the Machine runs (for example: ams); not the Fly-Region HTTP header. */
  FLY_REGION: string
  /** Outbound IPv6 public address assigned to the Machine by Fly networking. */
  FLY_PUBLIC_IP: string
  /** Docker image reference used when creating the Machine, such as registry.fly.io/your-app:tag. */
  FLY_IMAGE_REF: string
  /** Version identifier for the Machine configuration; updates when the config or image changes. */
  FLY_MACHINE_VERSION: string
  /** IPv6 address on Fly's 6PN private network for this Machine. */
  FLY_PRIVATE_IP: string
  /** Fly Launch process group associated with the Machine when configured. */
  FLY_PROCESS_GROUP: string
  /** Memory allocated to the Machine in megabytes, matching dashboard and fly machine status output. */
  FLY_VM_MEMORY_MB: string
  /** Primary region configured through fly.toml or deployment flags for this app. */
  PRIMARY_REGION: string
}

export function readFlyMachineRuntimeEnv(): FlyMachineRuntimeEnv {
  const get = (name: keyof FlyMachineRuntimeEnv) => {
    const value = (Deno.env.get(name) ?? '').trim()
    if (value.length === 0) {
      throw new Error(`Missing ${name} in environment`)
    }
    return value
  }
  return {
    FLY_APP_NAME: get('FLY_APP_NAME'),
    FLY_MACHINE_ID: get('FLY_MACHINE_ID'),
    FLY_ALLOC_ID: get('FLY_ALLOC_ID'),
    FLY_REGION: get('FLY_REGION'),
    FLY_PUBLIC_IP: get('FLY_PUBLIC_IP'),
    FLY_IMAGE_REF: get('FLY_IMAGE_REF'),
    FLY_MACHINE_VERSION: get('FLY_MACHINE_VERSION'),
    FLY_PRIVATE_IP: get('FLY_PRIVATE_IP'),
    FLY_PROCESS_GROUP: get('FLY_PROCESS_GROUP'),
    FLY_VM_MEMORY_MB: get('FLY_VM_MEMORY_MB'),
    PRIMARY_REGION: get('PRIMARY_REGION'),
  }
}

function readAppEnv(name: string): string {
  const value = Deno.env.get(name) ?? ''
  if (value.length === 0) {
    throw new Error(`Missing ${name} in environment`)
  }
  return value
}

export const envs = {
  DC_NFS: () => readAppEnv('DC_NFS'),
  DC_ROUTER: () => readAppEnv('DC_ROUTER'),
  DC_DOMAIN: () => readAppEnv('DC_DOMAIN'),
  DC_EXEC: () => readAppEnv('DC_EXEC'),
  DC_WORKER_POOL_APP: () => readAppEnv('DC_WORKER_POOL_APP'),
  DC_FLY_API_TOKEN: () => readAppEnv('DC_FLY_API_TOKEN'),
}
