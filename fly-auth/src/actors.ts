import {
  isFlyResourceNotFound,
  readAppEnv,
  readRequiredAppEnv,
} from '@artifact/shared'
import {
  flyCliAppsCreate,
  flyCliAppsDestroy,
  flyCliAppStatus,
  flyCliGetMachine,
  flyCliMachineRun,
  flyCliSecretsList,
  flyCliSecretsSet,
  FlyCommandError,
} from '@artifact/tasks'
import type { FlyCliAppStatus } from '@artifact/tasks'

const MAX_FLY_APP_NAME = 63
const ACTOR_PREFIX = 'actor-'
const TEMPLATE_COMPUTER_APP = 'fly-computer'
export type EnsureActorAppResult = {
  appName: string
  existed: boolean
}

type TemplateMachineInfo = {
  sourceApp: string
  machineId: string
  image: string
  config: Record<string, unknown>
  region?: string
  name?: string
}

async function getAppStatus(appName: string): Promise<FlyCliAppStatus | null> {
  try {
    return await flyCliAppStatus({ appName })
  } catch (error) {
    if (error instanceof FlyCommandError) {
      return null
    }
    throw error
  }
}

export function deriveActorAppName(clerkId: string): string {
  const sanitized = sanitizeClerkId(clerkId)
  const maxSuffix = Math.max(0, MAX_FLY_APP_NAME - ACTOR_PREFIX.length)
  const truncated = sanitized.slice(0, maxSuffix)
  const normalized = truncated.replace(/-+$/g, '') || 'user'
  return `${ACTOR_PREFIX}${normalized}`
}

export async function ensureActorApp(
  appName: string,
): Promise<EnsureActorAppResult> {
  const controllerToken = readRequiredAppEnv('FLY_API_TOKEN')
  const template = await loadTemplateMachine()

  const existingStatus = await getAppStatus(appName)
  if (existingStatus) {
    const secretExisted = await actorApiTokenSecretExists(appName)
    await ensureActorAppSecrets({
      appName,
      agentImage: template.image,
      targetApp: appName,
      controllerToken,
    })
    if (!secretExisted) {
      console.info(
        'provisioned missing controller token secret for actor app',
        {
          appName,
        },
      )
    }
    return { appName, existed: true }
  }

  const createdApp = await flyCliAppsCreate({
    appName,
    orgSlug: resolveOrgSlug(),
  })
  const createdName = createdApp.name ?? appName
  if (!createdName || createdName.trim().length === 0) {
    throw new Error(`Created Fly app '${appName}' did not return a name`)
  }

  await ensureActorAppSecrets({
    appName,
    agentImage: template.image,
    targetApp: appName,
    controllerToken,
  })

  const machineConfig = prepareActorMachineConfig(template, appName)
  try {
    await flyCliMachineRun({
      appName,
      image: template.image,
      config: machineConfig,
      name: template.name,
      region: template.region,
    })
  } catch (error) {
    console.error('failed to launch template machine for actor app', error)
    throw error
  }

  return { appName, existed: false }
}

export async function actorAppExists(appName: string): Promise<boolean> {
  return (await getAppStatus(appName)) !== null
}

export async function destroyActorApp(appName: string): Promise<void> {
  try {
    await flyCliAppsDestroy({ appName, force: true })
  } catch (error) {
    if (isFlyResourceNotFound(error)) {
      return
    }
    throw error
  }
}

async function ensureActorAppSecrets(
  {
    appName,
    agentImage,
    targetApp,
    controllerToken,
  }: {
    appName: string
    agentImage: string
    targetApp: string
    controllerToken: string
  },
): Promise<void> {
  console.info('configuring actor secrets', { appName, agentImage, targetApp })
  await flyCliSecretsSet({
    appName,
    secrets: {
      FLY_API_TOKEN: controllerToken,
      FLY_COMPUTER_TARGET_APP: targetApp,
      FLY_COMPUTER_AGENT_IMAGE: agentImage,
    },
  })
}

async function actorApiTokenSecretExists(appName: string): Promise<boolean> {
  const secrets = await flyCliSecretsList({ appName })
  return secrets.some((secret) =>
    secret.name.trim().toUpperCase() === 'FLY_API_TOKEN'
  )
}

async function loadTemplateMachine(): Promise<TemplateMachineInfo> {
  const templateApp = readAppEnv('FLY_COMPUTER_TEMPLATE_APP') ??
    TEMPLATE_COMPUTER_APP

  const status = await flyCliAppStatus({ appName: templateApp })
  const candidate = status.machines[0]
  if (!candidate || !candidate.id) {
    throw new Error(
      `Template app '${templateApp}' has no machines to replicate configuration from`,
    )
  }

  const detail = await flyCliGetMachine({
    appName: templateApp,
    machineId: candidate.id,
  })

  const image = extractMachineImage(detail)
  if (!image) {
    throw new Error(
      `Template machine '${candidate.id}' in '${templateApp}' is missing an image reference`,
    )
  }

  const config = detail.config && isPlainObject(detail.config)
    ? structuredClone(detail.config)
    : {}
  ;(config as { image?: string }).image = image

  return {
    sourceApp: templateApp,
    machineId: candidate.id,
    image,
    config,
    region: detail.region ?? candidate.region,
    name: detail.name ?? candidate.name,
  }
}

function extractMachineImage(
  detail: { config?: Record<string, unknown>; image?: string },
): string | undefined {
  if (detail.config && isPlainObject(detail.config)) {
    const image = (detail.config as { image?: unknown }).image
    if (typeof image === 'string' && image.trim()) return image
  }
  if (typeof detail.image === 'string' && detail.image.trim()) {
    return detail.image
  }
  return undefined
}

function prepareActorMachineConfig(
  template: TemplateMachineInfo,
  appName: string,
): Record<string, unknown> {
  const cloned = structuredClone(template.config)
  const config = isPlainObject(cloned) ? cloned : {}

  pruneMachineIdentity(config)
  ;(config as { image?: string }).image = template.image

  if (isPlainObject(config.metadata)) {
    const metadata = structuredClone(config.metadata)
    replaceExactStringValues(metadata, template.sourceApp, appName)
    metadata.app ??= appName
    metadata.app_name ??= appName
    metadata.appName ??= appName
    metadata.fly_app ??= appName
    metadata.flyApp ??= appName
    metadata['fly.app'] = appName
    config.metadata = metadata
  } else {
    config.metadata = {
      app: appName,
      'fly.app': appName,
    }
  }

  if (isPlainObject(config.env)) {
    replaceExactStringValues(
      config.env as Record<string, unknown>,
      template.sourceApp,
      appName,
    )
  }

  const services = Array.isArray((config as { services?: unknown }).services)
    ? structuredClone((config as { services: unknown[] }).services)
    : []
  const normalizedServices = services.filter((service) =>
    isPlainObject(service)
  ) as Array<Record<string, unknown>>

  if (normalizedServices.length === 0) {
    normalizedServices.push(createDefaultService())
  }

  for (const service of normalizedServices) {
    service.internal_port ??= 8080
    service.protocol ??= 'tcp'
    service.force_instance_id ??= true
    if (!Array.isArray(service.ports) || service.ports.length === 0) {
      service.ports = [createDefaultPort()]
    } else {
      service.ports = (service.ports as unknown[]).map((raw) => {
        const port = isPlainObject(raw) ? structuredClone(raw) : {}
        ;(port as { handlers?: unknown[] }).handlers = normalizeHandlers(
          port.handlers,
        )
        port.port ??= 80
        return port
      })
    }
  }

  ;(config as { services?: unknown }).services = normalizedServices

  return config
}

function createDefaultService(): Record<string, unknown> {
  return {
    internal_port: 8080,
    protocol: 'tcp',
    ports: [createDefaultPort()],
    force_instance_id: true,
  }
}

function createDefaultPort(): Record<string, unknown> {
  return {
    port: 80,
    handlers: ['http'],
  }
}

function normalizeHandlers(value: unknown): string[] {
  if (Array.isArray(value) && value.every((item) => typeof item === 'string')) {
    const handlers = value.map((item) => item.toLowerCase())
    if (handlers.includes('http') || handlers.includes('tls')) {
      return handlers
    }
  }
  return ['http']
}

function sanitizeClerkId(clerkId: string): string {
  const lower = clerkId.trim().toLowerCase()
  const replaced = lower.replace(/[^a-z0-9]+/g, '-')
  const collapsed = replaced.replace(/-+/g, '-')
  const stripped = collapsed.replace(/^-+|-+$/g, '')
  return stripped || 'user'
}

function resolveOrgSlug(): string {
  const primary = readAppEnv('FLY_ORG_SLUG')
  if (primary) return primary
  throw new Error('Missing FLY_ORG_SLUG; set it to your Fly organization slug')
}

function pruneMachineIdentity(node: unknown): void {
  if (Array.isArray(node)) {
    for (const value of node) {
      pruneMachineIdentity(value)
    }
    return
  }
  if (!isPlainObject(node)) return

  const record = node as Record<string, unknown>
  const identityKeys = [
    'id',
    'ID',
    'app_id',
    'appId',
    'AppID',
    'machine_id',
    'machineId',
    'MachineID',
    'created_at',
    'CreatedAt',
    'updated_at',
    'UpdatedAt',
  ]
  for (const key of identityKeys) {
    if (key in record) {
      delete record[key]
    }
  }

  for (const value of Object.values(record)) {
    pruneMachineIdentity(value)
  }
}

function replaceExactStringValues(
  record: Record<string, unknown>,
  target: string,
  replacement: string,
): void {
  for (const [key, value] of Object.entries(record)) {
    if (typeof value === 'string' && value === target) {
      record[key] = replacement
    }
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}
