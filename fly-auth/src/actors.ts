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
  flyCliSecretsList,
  flyCliSecretsSet,
  FlyCommandError,
  parseFlyJson,
  runFlyCommand,
} from '@artifact/tasks'
import type { FlyCliAppStatus } from '@artifact/tasks'
import { parse as parseToml, stringify as stringifyToml } from '@std/toml'

const MAX_FLY_APP_NAME = 63
const ACTOR_PREFIX = 'actor-'
const TEMPLATE_COMPUTER_APP = 'fly-computer'

export type EnsureActorAppResult = {
  appName: string
  existed: boolean
}

type TemplateMachineInfo = {
  sourceApp: string
  image: string
  region?: string
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
  const templateApp = readAppEnv('FLY_COMPUTER_TEMPLATE_APP') ??
    TEMPLATE_COMPUTER_APP
  const templateMachine = await loadTemplateMachine(templateApp)
  const templateConfig = await loadTemplateAppConfig(templateApp)
  const actorConfig = prepareActorAppConfig(
    templateConfig,
    templateMachine,
    appName,
  )

  const existingStatus = await getAppStatus(appName)
  if (existingStatus) {
    const secretExisted = await actorApiTokenSecretExists(appName)
    await ensureActorAppSecrets({
      appName,
      agentImage: templateMachine.image,
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
    agentImage: templateMachine.image,
    targetApp: appName,
    controllerToken,
  })

  try {
    await deployActorApp({
      appName,
      image: templateMachine.image,
      config: actorConfig,
    })
  } catch (error) {
    console.error('failed to deploy actor app', error)
    try {
      await flyCliAppsDestroy({ appName, force: true })
    } catch (destroyError) {
      if (!isFlyResourceNotFound(destroyError)) {
        console.error(
          'failed to remove actor app after deploy failure',
          destroyError,
        )
      }
    }
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

async function loadTemplateMachine(
  templateApp: string,
): Promise<TemplateMachineInfo> {
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

  return {
    sourceApp: templateApp,
    image,
    region: detail.region ?? candidate.region,
  }
}

async function loadTemplateAppConfig(
  templateApp: string,
): Promise<Record<string, unknown>> {
  const result = await runFlyCommand(['config', 'show', '--app', templateApp])
  const raw = result.stdout
  const trimmed = raw.trimStart()
  if (!trimmed) {
    throw new Error(
      `Fly config show returned empty output for template app '${templateApp}'`,
    )
  }

  const firstCharIndex = trimmed.search(/\S/)
  const firstChar = firstCharIndex === -1 ? undefined : trimmed[firstCharIndex]

  if (firstChar === '{' || firstChar === '[') {
    const json = parseFlyJson<Record<string, unknown>>(raw)
    return extractFlyConfigFromJson(json)
  }

  return parseToml(trimmed) as Record<string, unknown>
}

function prepareActorAppConfig(
  templateConfig: Record<string, unknown>,
  template: TemplateMachineInfo,
  appName: string,
): Record<string, unknown> {
  const config = structuredClone(templateConfig)
  config.app = appName

  if (
    template.region &&
    (!config.primary_region || typeof config.primary_region !== 'string')
  ) {
    config.primary_region = template.region
  }

  if (isPlainObject(config.build)) {
    ;(config.build as Record<string, unknown>).image = template.image
  } else {
    config.build = { image: template.image }
  }

  config.services = normalizeServices(
    (config as { services?: unknown }).services,
  )

  return config
}

function normalizeServices(value: unknown): Array<Record<string, unknown>> {
  const services = Array.isArray(value)
    ? value.filter(isPlainObject).map((service) =>
      structuredClone(service as Record<string, unknown>)
    )
    : []

  if (services.length === 0) {
    services.push(createDefaultService())
  }

  for (const service of services) {
    service.internal_port = normalizePortNumber(service.internal_port, 8080)
    service.protocol = typeof service.protocol === 'string'
      ? service.protocol
      : 'tcp'
    if (!('force_instance_id' in service)) {
      service.force_instance_id = true
    }

    const ports = Array.isArray(service.ports)
      ? service.ports.filter(isPlainObject).map((port) =>
        structuredClone(port as Record<string, unknown>)
      )
      : []
    if (ports.length === 0) {
      ports.push(createDefaultPort())
    }

    for (const port of ports) {
      port.port = normalizePortNumber(port.port, 80)
      port.handlers = normalizeHandlers(port.handlers)
    }

    service.ports = ports
  }

  return services
}

function normalizePortNumber(value: unknown, fallback: number): number {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return Math.floor(value)
  }
  if (typeof value === 'string') {
    const parsed = Number.parseInt(value, 10)
    if (Number.isFinite(parsed) && parsed > 0) return parsed
  }
  return fallback
}

function normalizeHandlers(value: unknown): string[] {
  if (Array.isArray(value)) {
    const normalized = value
      .filter((item): item is string =>
        typeof item === 'string' && item.trim().length > 0
      )
      .map((item) => item.trim().toLowerCase())
    if (normalized.length > 0) {
      if (
        !normalized.some((handler) => handler === 'http' || handler === 'https')
      ) {
        normalized.push('http')
      }
      return Array.from(new Set(normalized))
    }
  }
  return ['http']
}

function createDefaultService(): Record<string, unknown> {
  return {
    internal_port: 8080,
    protocol: 'tcp',
    force_instance_id: true,
    ports: [createDefaultPort()],
  }
}

function createDefaultPort(): Record<string, unknown> {
  return {
    port: 80,
    handlers: ['http'],
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

async function deployActorApp(
  { appName, image, config }: {
    appName: string
    image: string
    config: Record<string, unknown>
  },
): Promise<void> {
  const tomlText = stringifyToml(config)
  const tempFile = await Deno.makeTempFile({ suffix: '.toml' })
  try {
    await Deno.writeTextFile(tempFile, tomlText)
    await runFlyCommand([
      'deploy',
      '--config',
      tempFile,
      '--app',
      appName,
      '--image',
      image,
      '--yes',
    ])
  } finally {
    await Deno.remove(tempFile)
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

function extractFlyConfigFromJson(
  payload: Record<string, unknown>,
): Record<string, unknown> {
  const candidates: unknown[] = [payload]
  if (isPlainObject(payload)) {
    for (const key of ['definition', 'Definition', 'config', 'Config']) {
      if (key in payload) candidates.push(payload[key])
    }
  }

  for (const candidate of candidates) {
    if (typeof candidate === 'string') {
      const text = candidate.trim()
      if (!text) continue
      if (text.startsWith('{') || text.startsWith('[')) {
        const nested = parseFlyJson<Record<string, unknown>>(text)
        if (isPlainObject(nested) && isLikelyFlyConfig(nested)) {
          return structuredClone(nested)
        }
        continue
      }
      try {
        const nestedToml = parseToml(text)
        if (isPlainObject(nestedToml) && isLikelyFlyConfig(nestedToml)) {
          return structuredClone(nestedToml)
        }
      } catch {
        continue
      }
    }
    if (isPlainObject(candidate) && isLikelyFlyConfig(candidate)) {
      return structuredClone(candidate)
    }
  }

  throw new Error('Failed to locate Fly app configuration in JSON output')
}

function isLikelyFlyConfig(value: Record<string, unknown>): boolean {
  if (typeof value.app === 'string' && value.app.trim().length > 0) {
    return true
  }
  if (isPlainObject(value.build)) return true
  if (Array.isArray((value as { services?: unknown }).services)) return true
  return false
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}
