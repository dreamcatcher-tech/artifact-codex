import {
  appExists,
  createDeployToken,
  createFlyApp,
  createMachine,
  destroyFlyApp,
  getFlyApp,
  getFlyMachine,
  isFlyResourceNotFound,
  listMachines,
  setAppSecrets,
} from '@artifact/shared'

const MAX_FLY_APP_NAME = 63
const ACTOR_PREFIX = 'actor-'
const TEMPLATE_COMPUTER_APP = 'fly-computer'
export type EnsureActorAppResult = {
  appName: string
  appId: string
  existed: boolean
}

type TemplateMachineInfo = {
  config: Record<string, unknown>
  image: string
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

export async function ensureActorAppExists(
  appName: string,
): Promise<EnsureActorAppResult> {
  const token = readEnvTrimmed('FLY_API_TOKEN')
  if (!token) {
    throw new Error('Missing FLY_API_TOKEN for Fly API access')
  }

  const exists = await appExists({ token, appName })
  if (exists) {
    const existing = await getFlyApp({ token, appName })
    if (!existing.id) {
      throw new Error(`Existing Fly app '${appName}' is missing an id`)
    }
    return { appName, existed: true, appId: existing.id }
  }

  const template = await loadTemplateMachine(token)

  const createdApp = await createFlyApp({
    token,
    appName,
    orgSlug: resolveOrgSlug(),
  })
  if (!createdApp.id) {
    throw new Error(`Created Fly app '${appName}' did not return an id`)
  }

  try {
    await ensureActorAppDeployToken({
      token,
      appName,
      appId: createdApp.id,
      agentImage: template.image,
      targetApp: appName,
    })
  } catch (error) {
    console.error('failed to provision deploy token for actor app', error)
    try {
      await destroyFlyApp({ token, appName, force: true })
    } catch (destroyError) {
      console.error(
        'failed to remove actor app after credential failure',
        destroyError,
      )
    }
    throw error
  }

  try {
    await createMachine({
      appName,
      token,
      name: template.name ?? 'web',
      config: template.config,
      region: template.region,
    })
  } catch (error) {
    console.error('failed to create template machine for actor app', error)
    throw error
  }

  return { appName, existed: false, appId: createdApp.id }
}

type EnsureActorTokenInput = {
  token: string
  appName: string
  appId: string
  agentImage: string
  targetApp: string
}

async function ensureActorAppDeployToken(
  { token, appName, appId, agentImage, targetApp }: EnsureActorTokenInput,
): Promise<void> {
  console.info('provisioning actor deploy token', { appName, appId })
  const deployToken = await createDeployTokenWithRetry({ token, appName })
  console.info('configuring actor secrets', { appName, agentImage, targetApp })
  await setAppSecrets({
    token,
    appName,
    secrets: {
      FLY_API_TOKEN: deployToken,
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
      return await createDeployToken({ token, appName })
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
  const token = readEnvTrimmed('FLY_API_TOKEN')
  if (!token) {
    throw new Error('Missing FLY_API_TOKEN for Fly API access')
  }
  try {
    await destroyFlyApp({ token, appName, force: true })
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

function readEnvTrimmed(name: string): string | undefined {
  try {
    const value = Deno.env.get(name)?.trim()
    return value ? value : undefined
  } catch {
    return undefined
  }
}

function resolveOrgSlug(): string {
  const primary = readEnvTrimmed('FLY_ORG_SLUG')
  if (primary) return primary

  const fallbacks = ['FLY_AUTH_ORG_SLUG', 'FLY_ORGANIZATION_SLUG']
  for (const key of fallbacks) {
    const value = readEnvTrimmed(key)
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
  const templateApp = readEnvTrimmed('FLY_COMPUTER_TEMPLATE_APP') ??
    TEMPLATE_COMPUTER_APP

  const machines = await listMachines({ appName: templateApp, token })
  if (machines.length === 0) {
    throw new Error(
      `Template app '${templateApp}' has no machines to replicate configuration from`,
    )
  }

  const sorted = [...machines].sort((a, b) => {
    const aTime = Date.parse(a.createdAt ?? '') || 0
    const bTime = Date.parse(b.createdAt ?? '') || 0
    return bTime - aTime
  })
  const candidate = sorted[0]

  const detail = await getFlyMachine({
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
    config,
    image,
    region: detail.region,
    name: detail.name,
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

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}
