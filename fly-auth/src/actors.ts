import {
  isFlyResourceNotFound,
  readAppEnv,
  readRequiredAppEnv,
} from '@artifact/shared'
import {
  flyCliAppsCreate,
  flyCliAppsDestroy,
  type FlyCliAppStatus,
  flyCliAppStatus,
  flyCliGetMachine,
  flyCliMachineRun,
  flyCliSecretsSet,
  flyCliTokensCreateDeploy,
  FlyCommandError,
} from '@artifact/tasks'

const MAX_FLY_APP_NAME = 63
const ACTOR_PREFIX = 'actor-'
const TEMPLATE_COMPUTER_APP = 'fly-computer'
export type EnsureActorAppResult = {
  appName: string
  existed: boolean
}

async function getAppStatus(
  options: { token: string; appName: string },
): Promise<FlyCliAppStatus | null> {
  try {
    return await flyCliAppStatus(options)
  } catch (error) {
    if (error instanceof FlyCommandError) {
      return null
    }
    throw error
  }
}

type TemplateMachineInfo = {
  sourceApp: string
  machineId: string
  image: string
  config: Record<string, unknown>
  region?: string
  name?: string
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
  const token = readRequiredAppEnv('FLY_API_DEPLOY_TOKEN')

  const template = await loadTemplateMachine(token)

  const existingStatus = await getAppStatus({ token, appName })
  if (existingStatus) {
    await ensureActorAppDeployToken({
      token,
      appName,
      agentImage: template.image,
      targetApp: appName,
    })
    return { appName, existed: true }
  }

  const createdApp = await flyCliAppsCreate({
    token,
    appName,
    orgSlug: resolveOrgSlug(),
  })
  const createdName = createdApp.name ?? appName
  if (!createdName || createdName.trim().length === 0) {
    throw new Error(`Created Fly app '${appName}' did not return a name`)
  }

  try {
    await ensureActorAppDeployToken({
      token,
      appName,
      agentImage: template.image,
      targetApp: appName,
    })
  } catch (error) {
    console.error('failed to provision deploy token for actor app', error)
    try {
      await flyCliAppsDestroy({ token, appName, force: true })
    } catch (destroyError) {
      console.error(
        'failed to remove actor app after credential failure',
        destroyError,
      )
    }
    throw error
  }

  const machineConfig = prepareActorMachineConfig(template, appName)

  try {
    await flyCliMachineRun({
      appName,
      token,
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
  const token = readRequiredAppEnv('FLY_API_DEPLOY_TOKEN')
  const status = await getAppStatus({ token, appName })
  return status !== null
}

type EnsureActorTokenInput = {
  token: string
  appName: string
  agentImage: string
  targetApp: string
}

async function ensureActorAppDeployToken(
  { token, appName, agentImage, targetApp }: EnsureActorTokenInput,
): Promise<void> {
  console.info('provisioning actor deploy token', { appName })
  let deployToken: string
  try {
    deployToken = await createDeployTokenWithRetry({ token, appName })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (
      message.includes('Not authorized to access this createlimitedaccesstoken')
    ) {
      console.warn(
        'createDeployToken unauthorized; reusing controller token for actor app',
        { appName },
      )
      deployToken = token
    } else {
      throw error
    }
  }
  console.info('configuring actor secrets', { appName, agentImage, targetApp })
  await flyCliSecretsSet({
    token,
    appName,
    secrets: {
      FLY_API_DEPLOY_TOKEN: deployToken,
      FLY_COMPUTER_TARGET_APP: targetApp,
      FLY_COMPUTER_AGENT_IMAGE: agentImage,
    },
  })
}

const CREATE_DEPLOY_TOKEN_ATTEMPTS = 5
const CREATE_DEPLOY_TOKEN_DELAY_MS = 2_000

type CreateDeployTokenRetryInput = {
  token: string
  appName: string
}

async function createDeployTokenWithRetry(
  { token, appName }: CreateDeployTokenRetryInput,
): Promise<string> {
  let lastError: unknown
  for (let attempt = 1; attempt <= CREATE_DEPLOY_TOKEN_ATTEMPTS; attempt++) {
    try {
      return await flyCliTokensCreateDeploy({ token, appName })
    } catch (error) {
      lastError = error
      const done = attempt === CREATE_DEPLOY_TOKEN_ATTEMPTS
      console.warn(
        'createDeployToken attempt failed',
        { appName, attempt, retries: CREATE_DEPLOY_TOKEN_ATTEMPTS, done },
        error instanceof Error ? error.message : error,
      )
      if (done) break
      await delay(CREATE_DEPLOY_TOKEN_DELAY_MS * attempt)
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new Error('Failed to create deploy token after retries')
}

async function delay(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms))
}

export async function destroyActorApp(appName: string): Promise<void> {
  const token = readRequiredAppEnv('FLY_API_DEPLOY_TOKEN')
  try {
    await flyCliAppsDestroy({ token, appName, force: true })
  } catch (error) {
    if (isFlyResourceNotFound(error)) {
      return
    }
    throw error
  }
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

  const fallbacks = ['FLY_AUTH_ORG_SLUG', 'FLY_ORGANIZATION_SLUG']
  for (const key of fallbacks) {
    const value = readAppEnv(key)
    if (value) {
      console.warn(
        `${key} is deprecated; set FLY_ORG_SLUG instead for provisioning actor apps.`,
      )
      return value
    }
  }

  throw new Error('Missing FLY_ORG_SLUG; set it to your Fly organization slug')
}

async function loadTemplateMachine(
  token: string,
): Promise<TemplateMachineInfo> {
  const templateApp = readAppEnv('FLY_COMPUTER_TEMPLATE_APP') ??
    TEMPLATE_COMPUTER_APP

  const status = await flyCliAppStatus({ appName: templateApp, token })
  const candidate = status.machines[0]
  if (!candidate || !candidate.id) {
    throw new Error(
      `Template app '${templateApp}' has no machines to replicate configuration from`,
    )
  }

  const detail = await flyCliGetMachine({
    appName: templateApp,
    token,
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

  return config
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
