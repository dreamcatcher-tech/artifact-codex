import { type Context, Hono, type MiddlewareHandler } from '@hono/hono'
import {
  type ClerkAuthVariables,
  clerkMiddleware,
  getAuth,
} from '@hono/clerk-auth'

import {
  actorAppExists,
  type ActorSecretProbeResult,
  deriveActorAppName,
  destroyActorApp,
  ensureActorApp,
  type EnsureActorAppOptions,
  type EnsureActorAppResult,
  probeActorSecrets,
} from './actors.ts'
import {
  ClerkRedirects,
  resolveClerkRedirects,
  resolveRedirectUrl,
  wantsJson,
} from './redirects.ts'
import {
  computerFolderExists,
  createComputerFolder,
  ensureComputersMounted,
  removeComputerFolder,
} from './storage.ts'
import {
  readAppEnv,
  readRequiredAppEnv,
  setFlyMachineHeader,
} from '@artifact/shared'

const TEST_USER_HEADER = 'x-artifact-test-user'
const integrationTestUserId = resolveIntegrationTestUserId()

type AuthDependencies = {
  middleware: MiddlewareHandler<{ Variables: ClerkAuthVariables }>
  resolve: typeof getAuth
}

type AppDependencies = {
  ensureMount: () => Promise<void>
  folderExists: (appName: string) => Promise<boolean>
  createFolder: (appName: string) => Promise<void>
  ensureActorApp: (
    appName: string,
    options?: EnsureActorAppOptions,
  ) => Promise<EnsureActorAppResult>
  destroyActorApp: (appName: string) => Promise<void>
  removeFolder: (appName: string) => Promise<void>
  appExists: (appName: string) => Promise<boolean>
  probeSecrets: (appName: string) => Promise<ActorSecretProbeResult>
  auth: AuthDependencies
  baseDomain: string
}

type CreateAppOptions = {
  dependencies?: Partial<AppDependencies>
}

export function createApp({ dependencies }: CreateAppOptions = {}) {
  const overrides = dependencies ?? {}
  const deps: AppDependencies = {
    ensureMount: overrides.ensureMount ?? ensureComputersMounted,
    folderExists: overrides.folderExists ?? computerFolderExists,
    createFolder: overrides.createFolder ?? createComputerFolder,
    ensureActorApp: overrides.ensureActorApp ?? ensureActorApp,
    destroyActorApp: overrides.destroyActorApp ?? destroyActorApp,
    removeFolder: overrides.removeFolder ?? removeComputerFolder,
    appExists: overrides.appExists ?? actorAppExists,
    probeSecrets: overrides.probeSecrets ?? probeActorSecrets,
    auth: {
      middleware: overrides.auth?.middleware ?? clerkMiddleware(),
      resolve: overrides.auth?.resolve ?? getAuth,
    },
    baseDomain: overrides.baseDomain ?? resolveBaseDomain(),
  }

  const app = new Hono<{ Variables: ClerkAuthVariables }>()

  app.use('*', async (c, next) => {
    try {
      await next()
    } finally {
      if (c.res) setFlyMachineHeader(c.res.headers)
    }
  })

  app.use('*', deps.auth.middleware)

  app.get('*', async (c) => {
    const requestUrl = new URL(c.req.url)
    const userId = resolveUserId(c, deps.auth.resolve)

    if (!userId) {
      if (wantsJson(c)) {
        return c.json({ error: 'unauthenticated' }, 401)
      }

      const destination = resolveRedirectUrl(c, resolveClerkRedirects())
      if (!destination) return c.json({ error: 'unauthenticated' }, 401)
      return c.redirect(destination, 302)
    }

    const actorApp = deriveActorAppName(userId)
    const expectedHost = `${actorApp}.${deps.baseDomain}`

    try {
      await deps.ensureMount()
    } catch {
      return c.json({ error: 'storage_unavailable' }, 503)
    }

    let folderExists = false
    try {
      folderExists = await deps.folderExists(actorApp)
    } catch {
      return c.json({ error: 'filesystem_error' }, 500)
    }

    let appExists = false
    try {
      appExists = await deps.appExists(actorApp)
    } catch {
      return c.json({ error: 'provision_failed' }, 500)
    }

    let secretStatus: ActorSecretProbeResult
    try {
      secretStatus = await deps.probeSecrets(actorApp)
    } catch {
      return c.json({ error: 'provision_failed' }, 500)
    }

    if (folderExists && !appExists) {
      try {
        await deps.removeFolder(actorApp)
        folderExists = false
      } catch {
        return c.json({ error: 'filesystem_error' }, 500)
      }
    }

    const secretsReady = secretStatus.status === 'present'
    let environmentReady = folderExists && appExists && secretsReady

    if (!environmentReady) {
      try {
        await deps.ensureActorApp(actorApp, { secretStatus })
        appExists = true
      } catch {
        if (!appExists) {
          try {
            await deps.removeFolder(actorApp)
          } catch {
            // ignore cleanup failures for prototypes
          }
        }
        return c.json({ error: 'provision_failed' }, 500)
      }

      try {
        await deps.createFolder(actorApp)
        folderExists = true
      } catch (error) {
        if (!(error instanceof Deno.errors.AlreadyExists)) {
          return c.json({ error: 'filesystem_error' }, 500)
        }
      }

      environmentReady = folderExists && appExists
    }

    if (!isActorHost(requestUrl.hostname, expectedHost)) {
      return redirectToActorHost(c, expectedHost, requestUrl)
    }

    return replayToActorApp(c, actorApp)
  })

  app.delete('/integration/actor', async (c) => {
    const testUser = extractTestUserId(c)
    if (testUser !== integrationTestUserId) {
      return c.json({ error: 'unauthorized' }, 401)
    }

    const actorApp = deriveActorAppName(testUser)

    try {
      await deps.ensureMount()
    } catch {
      return c.json({ error: 'storage_unavailable' }, 503)
    }

    try {
      await deps.destroyActorApp(actorApp)
    } catch {
      return c.json({ error: 'destroy_failed' }, 502)
    }

    try {
      await deps.removeFolder(actorApp)
    } catch {
      return c.json({ error: 'filesystem_error' }, 500)
    }

    return c.body(null, 204)
  })

  return app
}

export type { CreateAppOptions }
export { deriveActorAppName }

function resolveUserId(c: Context, resolveAuth: typeof getAuth): string | null {
  const testUser = extractTestUserId(c)
  if (testUser) return testUser
  const auth = resolveAuth(c)
  return auth?.userId ?? null
}

function extractTestUserId(c: Context): string | null {
  const header = c.req.header(TEST_USER_HEADER)
  if (!header) return null
  const trimmed = header.trim()
  return trimmed === integrationTestUserId ? integrationTestUserId : null
}

function resolveIntegrationTestUserId(): string {
  const raw = readAppEnv('INTEGRATION_TEST_USER_ID')?.trim()
  return raw && raw.length > 0 ? raw : 'integration-suite'
}

function redirectToActorHost(
  c: Context,
  actorHost: string,
  requestUrl: URL,
): Response {
  const protoHeader = c.req.header('fly-forwarded-proto') ??
    c.req.header('x-forwarded-proto') ?? ''
  const forwardedProto = protoHeader.split(',')[0]?.trim().toLowerCase()
  const target = new URL(requestUrl.toString())
  target.protocol = forwardedProto
    ? forwardedProto.endsWith(':') ? forwardedProto : `${forwardedProto}:`
    : 'https:'
  target.hostname = actorHost
  target.port = ''
  return c.redirect(target.toString(), 302)
}

function isActorHost(actual: string, desired: string): boolean {
  const actualLower = actual.toLowerCase()
  const desiredLower = desired.toLowerCase()
  if (actualLower === desiredLower) return true

  const dotIndex = desiredLower.indexOf('.')
  if (dotIndex === -1) return false

  const desiredLabel = desiredLower.slice(0, dotIndex)
  const desiredDomain = desiredLower.slice(dotIndex + 1)

  if (!actualLower.endsWith(`.${desiredDomain}`)) return false

  const prefix = actualLower.slice(
    0,
    actualLower.length - (desiredDomain.length + 1),
  )
  if (prefix === desiredLabel) return true
  if (prefix.endsWith(`--${desiredLabel}`)) return true

  return false
}

function replayToActorApp(c: Context, actorApp: string): Response {
  const res = c.body(null, 204)
  res.headers.set('fly-replay', `app=${actorApp}`)
  return res
}

function resolveBaseDomain(): string {
  return readRequiredAppEnv('FLY_AUTH_BASE_DOMAIN')
}
