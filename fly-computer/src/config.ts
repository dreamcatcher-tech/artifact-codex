import {
  readAppEnv,
  readFlyMachineRuntimeEnv,
  readRequiredAppEnv,
} from '@artifact/shared'
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

const DEFAULT_MOUNT_DIR = '/mnt/computer'

export function resolveConfig(overrides: ConfigOverrides = {}): AppConfig {
  const flyApiToken = overrides.flyApiToken?.trim() ||
    readRequiredAppEnv('FLY_API_TOKEN')
  const targetApp = overrides.targetApp?.trim() ||
    readRequiredAppEnv('FLY_COMPUTER_TARGET_APP')
  const agentImage = overrides.agentImage?.trim() ||
    readRequiredAppEnv('FLY_COMPUTER_AGENT_IMAGE')
  const defaultRegion = overrides.defaultRegion?.trim() ||
    readAppEnv('FLY_COMPUTER_REGION')
  const flyRuntimeEnv = readFlyMachineRuntimeEnv()
  const registryRoot = resolveRegistryRoot(overrides, flyRuntimeEnv)

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

  const mountDir = overrides.mountDir ?? DEFAULT_MOUNT_DIR
  const flyAppName = (overrides.flyAppName ?? flyEnv.FLY_APP_NAME).trim()
  if (!flyAppName) {
    throw new Error(
      'Missing FLY_APP_NAME; fly-computer requires the Fly Machines runtime to provide this environment variable.',
    )
  }

  return mountDir
}
