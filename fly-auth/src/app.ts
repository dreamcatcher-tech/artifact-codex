import { type Context, Hono, type MiddlewareHandler } from '@hono/hono'
import {
  type ClerkAuthVariables,
  clerkMiddleware,
  getAuth,
} from '@hono/clerk-auth'
import Debug from 'debug'

import {
  actorAppExists,
  deriveActorAppName,
  destroyActorApp,
  ensureActorApp,
  type EnsureActorAppResult,
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
import { readAppEnv, readRequiredAppEnv } from '@artifact/shared'
const TEST_USER_HEADER = 'x-artifact-test-user'
const INTEGRATION_TEST_USER_ID = resolveIntegrationTestUserId()
const log = Debug('@artifact/fly-auth:app')
const requestLog = log.extend('request')
const storageLog = log.extend('storage')
const actorLog = log.extend('actor')
const errorLog = log.extend('error')

type AuthDependencies = {
  middleware: MiddlewareHandler<{ Variables: ClerkAuthVariables }>
  resolve: typeof getAuth
}

type AppDependencies = {
  ensureMount: () => Promise<void>
  folderExists: (appName: string) => Promise<boolean>
  createFolder: (appName: string) => Promise<void>
  ensureActorApp: (appName: string) => Promise<EnsureActorAppResult>
  destroyActorApp: (appName: string) => Promise<void>
  removeFolder: (appName: string) => Promise<void>
  appExists: (appName: string) => Promise<boolean>
  auth: AuthDependencies
  baseDomain: string
}

type CreateAppOptions = {
  dependencies?: Partial<AppDependencies>
}

export function createApp({ dependencies }: CreateAppOptions = {}) {
  const deps = createDependencies(dependencies)
  const app = new Hono<{ Variables: ClerkAuthVariables }>()

  app.use('*', deps.auth.middleware)

  app.get('/', async (c) => {
    const requestUrl = new URL(c.req.url)
    requestLog('GET / start host=%s', requestUrl.host)
    const testUser = extractTestUserId(c)
    const auth = testUser ? { userId: testUser } : deps.auth.resolve(c)
    requestLog(
      'authentication resolved user=%s source=%s',
      auth?.userId ?? 'USER NOT FOUND',
      testUser ? 'test-header' : 'clerk',
    )
    if (!auth?.userId) {
      const wantsJsonResponse = wantsJson(c)
      const redirects: ClerkRedirects = resolveClerkRedirects()
      if (wantsJsonResponse) {
        errorLog('unauthenticated request (json) host=%s', requestUrl.host)
        return c.json({ error: 'unauthenticated' }, 401)
      }

      const destination = resolveRedirectUrl(c, redirects)
      if (!destination) {
        errorLog(
          'unauthenticated request without redirect host=%s',
          requestUrl.host,
        )
        return c.json({ error: 'unauthenticated' }, 401)
      }

      requestLog('redirecting unauthenticated request to %s', destination)
      return c.redirect(destination, 302)
    }

    const actorApp = deriveActorAppName(auth.userId)
    const desiredHost = `${actorApp}.${deps.baseDomain}`
    const onActorHost = hostsMatch(requestUrl.hostname, desiredHost)

    try {
      await deps.ensureMount()
      storageLog('ensureMount success for %s', actorApp)
    } catch (error) {
      errorLog('failed to mount computers share for %s: %O', actorApp, error)
      return c.json({ error: 'storage_unavailable' }, 503)
    }

    let folderExists = false
    try {
      folderExists = await deps.folderExists(actorApp)
      storageLog('folderExists(%s) -> %s', actorApp, folderExists)
    } catch (error) {
      errorLog(
        'failed to inspect computers directory for %s: %O',
        actorApp,
        error,
      )
      return c.json({ error: 'filesystem_error' }, 500)
    }

    let appExists = false
    try {
      appExists = await deps.appExists(actorApp)
      actorLog('appExists(%s) -> %s', actorApp, appExists)
    } catch (error) {
      errorLog('failed to inspect fly app for %s: %O', actorApp, error)
      return c.json({ error: 'provision_failed' }, 500)
    }

    if (folderExists && !appExists) {
      storageLog('removing folder for %s (missing fly app)', actorApp)
      try {
        await deps.removeFolder(actorApp)
        folderExists = false
        storageLog('removed folder for %s before reprovisioning', actorApp)
      } catch (error) {
        errorLog('failed to remove stale folder for %s: %O', actorApp, error)
        return c.json({ error: 'filesystem_error' }, 500)
      }
    }

    if (folderExists && appExists) {
      actorLog('folder and app ready for %s', actorApp)
      if (!onActorHost) {
        actorLog('redirecting to actor host %s', desiredHost)
        return redirectToActorHost(c, desiredHost, requestUrl)
      }
      actorLog('replaying request to %s (existing)', actorApp)
      return replayToActorApp(c, actorApp)
    }

    try {
      actorLog('ensuring actor app %s', actorApp)
      await deps.ensureActorApp(actorApp)
      actorLog('actor app ready %s', actorApp)
    } catch (error) {
      errorLog('failed to ensure actor app %s: %O', actorApp, error)
      if (!appExists) {
        try {
          storageLog(
            'cleaning up folder for %s after provisioning failure',
            actorApp,
          )
          await deps.removeFolder(actorApp)
          storageLog(
            'removed folder for %s after provisioning failure',
            actorApp,
          )
        } catch (cleanupError) {
          errorLog(
            'failed to remove folder for %s after provisioning failure: %O',
            actorApp,
            cleanupError,
          )
        }
      }
      return c.json({ error: 'provision_failed' }, 500)
    }

    try {
      storageLog('creating folder for %s', actorApp)
      await deps.createFolder(actorApp)
      storageLog('folder created for %s', actorApp)
    } catch (error) {
      if (!(error instanceof Deno.errors.AlreadyExists)) {
        errorLog('failed to create actor directory for %s: %O', actorApp, error)
        return c.json({ error: 'filesystem_error' }, 500)
      }
    }

    if (!onActorHost) {
      actorLog('redirecting newly provisioned user to %s', desiredHost)
      return redirectToActorHost(c, desiredHost, requestUrl)
    }

    actorLog('replaying request to %s (new)', actorApp)
    return replayToActorApp(c, actorApp)
  })

  app.delete('/integration/actor', async (c) => {
    requestLog('DELETE /integration/actor start')
    const testUser = extractTestUserId(c)
    if (testUser !== INTEGRATION_TEST_USER_ID) {
      errorLog('integration destroy attempted without credentials')
      return c.json({ error: 'unauthorized' }, 401)
    }

    const actorApp = deriveActorAppName(testUser)

    try {
      await deps.ensureMount()
      storageLog('ensureMount success (integration) for %s', actorApp)
    } catch (error) {
      errorLog(
        'integration failed to mount computers share for %s: %O',
        actorApp,
        error,
      )
      return c.json({ error: 'storage_unavailable' }, 503)
    }

    try {
      await deps.destroyActorApp(actorApp)
      actorLog('destroyed actor app %s', actorApp)
    } catch (error) {
      errorLog('failed to destroy actor app %s: %O', actorApp, error)
      return c.json({ error: 'destroy_failed' }, 502)
    }

    try {
      await deps.removeFolder(actorApp)
      storageLog('removed folder for %s', actorApp)
    } catch (error) {
      errorLog('failed to remove actor directory for %s: %O', actorApp, error)
      return c.json({ error: 'filesystem_error' }, 500)
    }

    requestLog('DELETE /integration/actor complete for %s', actorApp)
    return c.body(null, 204)
  })

  return app
}

export type { CreateAppOptions }
export { deriveActorAppName }

function createDependencies(
  overrides: Partial<AppDependencies> = {},
): AppDependencies {
  const authOverride: Partial<AuthDependencies> = overrides.auth ?? {}
  return {
    ensureMount: overrides.ensureMount ?? ensureComputersMounted,
    folderExists: overrides.folderExists ?? computerFolderExists,
    createFolder: overrides.createFolder ?? createComputerFolder,
    ensureActorApp: overrides.ensureActorApp ?? ensureActorApp,
    destroyActorApp: overrides.destroyActorApp ?? destroyActorApp,
    removeFolder: overrides.removeFolder ?? removeComputerFolder,
    appExists: overrides.appExists ?? actorAppExists,
    auth: {
      middleware: authOverride.middleware ?? clerkMiddleware(),
      resolve: authOverride.resolve ?? getAuth,
    },
    baseDomain: overrides.baseDomain ?? resolveBaseDomain(),
  }
}

function replayToActorApp(c: Context, actorApp: string): Response {
  actorLog('replay -> fly-replay app=%s', actorApp)
  const res = c.body(null, 204)
  res.headers.set('fly-replay', `app=${actorApp}`)
  return res
}

function extractTestUserId(c: Context): string | null {
  const header = c.req.header(TEST_USER_HEADER)
  if (!header) return null
  const trimmed = header.trim()
  if (!trimmed) return null
  return trimmed === INTEGRATION_TEST_USER_ID ? INTEGRATION_TEST_USER_ID : null
}

function resolveIntegrationTestUserId(): string {
  return readAppEnv('INTEGRATION_TEST_USER_ID') ?? 'integration-suite'
}

function redirectToActorHost(
  c: Context,
  actorHost: string,
  requestUrl: URL,
): Response {
  actorLog('redirect -> %s from %s', actorHost, requestUrl.hostname)
  const target = new URL(requestUrl.toString())
  target.hostname = actorHost
  target.port = ''
  return c.redirect(target.toString(), 302)
}

function hostsMatch(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase()
}

function resolveBaseDomain(): string {
  return readRequiredAppEnv('FLY_AUTH_BASE_DOMAIN')
}
