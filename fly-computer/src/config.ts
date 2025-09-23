import {
  readAppEnv,
  readFlyMachineRuntimeEnv,
  readRequiredAppEnv,
} from '@artifact/shared'
import type { FlyMachineRuntimeEnv } from '@artifact/shared'

export type AppConfig = {
  targetApp: string
  registryRoot: string
  agentImage?: string
  agentTemplateApp: string
  defaultRegion?: string
  baseDomain: string
}

export type ConfigOverrides = Partial<AppConfig> & {
  flyAppName?: string
  mountDir?: string
}

const DEFAULT_MOUNT_DIR = '/mnt/computer'
const DEFAULT_AGENT_TEMPLATE_APP = 'fly-agent'

export function resolveConfig(overrides: ConfigOverrides = {}): AppConfig {
  const targetApp = overrides.targetApp?.trim() ||
    readRequiredAppEnv('FLY_COMPUTER_TARGET_APP')
  const agentImage = overrides.agentImage?.trim() ||
    readAppEnv('FLY_COMPUTER_AGENT_IMAGE')
  const defaultRegion = overrides.defaultRegion?.trim() ||
    readAppEnv('FLY_COMPUTER_REGION')
  const flyRuntimeEnv = readFlyMachineRuntimeEnv()
  const registryRoot = resolveRegistryRoot(overrides, flyRuntimeEnv)
  const agentTemplateApp = overrides.agentTemplateApp?.trim() ||
    readAppEnv('FLY_AGENT_TEMPLATE_APP') ||
    DEFAULT_AGENT_TEMPLATE_APP
  const baseDomain = overrides.baseDomain?.trim() ||
    readRequiredAppEnv('FLY_AUTH_BASE_DOMAIN')

  if (!registryRoot.trim()) {
    throw new Error('Unable to resolve registry root directory')
  }

  return {
    targetApp,
    agentImage,
    registryRoot,
    agentTemplateApp,
    defaultRegion,
    baseDomain,
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

  return `${mountDir}/agents`
}
