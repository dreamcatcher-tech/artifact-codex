import { join } from '@std/path'
import { readFlyMachineRuntimeEnv } from '@artifact/shared'
import type { FlyMachineRuntimeEnv } from '@artifact/shared'

export type AppConfig = {
  flyApiToken: string
  targetApp: string
  agentImage: string
  registryRoot: string
  defaultRegion?: string
}

export type ConfigOverrides = Partial<AppConfig> & {
  flyAppName?: string
  mountDir?: string
}

export function resolveConfig(overrides: ConfigOverrides = {}): AppConfig {
  const flyApiToken = overrides.flyApiToken ?? readEnv('FLY_API_TOKEN')
  const targetApp = overrides.targetApp ?? readEnv('FLY_COMPUTER_TARGET_APP')
  const agentImage = overrides.agentImage ?? readEnv('FLY_COMPUTER_AGENT_IMAGE')
  const defaultRegion = overrides.defaultRegion ??
    (Deno.env.get('FLY_COMPUTER_REGION') ?? undefined)
  const flyRuntimeEnv = readFlyMachineRuntimeEnv()
  const registryRoot = resolveRegistryRoot(overrides, flyRuntimeEnv)

  if (!flyApiToken.trim()) throw new Error('Missing FLY_API_TOKEN')
  if (!targetApp.trim()) throw new Error('Missing FLY_COMPUTER_TARGET_APP')
  if (!agentImage.trim()) throw new Error('Missing FLY_COMPUTER_AGENT_IMAGE')
  if (!registryRoot.trim()) {
    throw new Error('Unable to resolve registry root directory')
  }

  return {
    flyApiToken,
    targetApp,
    agentImage,
    registryRoot,
    defaultRegion,
  }
}

function resolveRegistryRoot(
  overrides: ConfigOverrides,
  flyEnv: FlyMachineRuntimeEnv,
): string {
  if (overrides.registryRoot) {
    return overrides.registryRoot
  }

  const mountDir = overrides.mountDir ?? '/mnt/computer'
  const flyAppName = overrides.flyAppName ?? flyEnv.FLY_APP_NAME
  if (!flyAppName) {
    throw new Error(
      'Missing FLY_APP_NAME; fly-computer requires the Fly Machines runtime to provide this environment variable.',
    )
  }

  return join(mountDir, 'computers', flyAppName)
}

function readEnv(key: string): string {
  const value = Deno.env.get(key) ?? ''
  return value
}
