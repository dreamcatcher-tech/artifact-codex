import { type Context, Hono, type MiddlewareHandler } from '@hono/hono'
import {
  type ClerkAuthVariables,
  clerkMiddleware,
  getAuth,
} from '@hono/clerk-auth'

import {
  deriveActorAppName,
  destroyActorApp,
  ensureActorAppExists,
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
const TEST_USER_HEADER = 'x-artifact-test-user'
const INTEGRATION_TEST_USER_ID = resolveIntegrationTestUserId()

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
    const testUser = extractTestUserId(c)
    const auth = testUser ? { userId: testUser } : deps.auth.resolve(c)
    if (!auth?.userId) {
      const redirects: ClerkRedirects = resolveClerkRedirects()
      if (wantsJson(c)) {
        return c.json({ error: 'unauthenticated' }, 401)
      }

      const destination = resolveRedirectUrl(c, redirects)
      if (!destination) {
        return c.json({ error: 'unauthenticated' }, 401)
      }

      return c.redirect(destination, 302)
    }

    const actorApp = deriveActorAppName(auth.userId)
    const requestUrl = new URL(c.req.url)
    const desiredHost = `${actorApp}.${deps.baseDomain}`
    const onActorHost = hostsMatch(requestUrl.hostname, desiredHost)

    try {
      await deps.ensureMount()
    } catch (error) {
      console.error('failed to mount computers share', error)
      return c.json({ error: 'storage_unavailable' }, 503)
    }

    let folderExists = false
    try {
      folderExists = await deps.folderExists(actorApp)
    } catch (error) {
      console.error('failed to inspect computers directory', error)
      return c.json({ error: 'filesystem_error' }, 500)
    }

    if (folderExists) {
      if (!onActorHost) {
        return redirectToActorHost(c, desiredHost, requestUrl)
      }
      return replayToActorApp(c, actorApp)
    }

    try {
      await deps.ensureActorApp(actorApp)
    } catch (error) {
      console.error('failed to ensure actor app', error)
      return c.json({ error: 'provision_failed' }, 500)
    }

    try {
      await deps.createFolder(actorApp)
    } catch (error) {
      if (!(error instanceof Deno.errors.AlreadyExists)) {
        console.error('failed to create actor directory', error)
        return c.json({ error: 'filesystem_error' }, 500)
      }
    }

    if (!onActorHost) {
      return redirectToActorHost(c, desiredHost, requestUrl)
    }

    return replayToActorApp(c, actorApp)
  })

  app.delete('/integration/actor', async (c) => {
    const testUser = extractTestUserId(c)
    if (testUser !== INTEGRATION_TEST_USER_ID) {
      return c.json({ error: 'unauthorized' }, 401)
    }

    const actorApp = deriveActorAppName(testUser)

    try {
      await deps.ensureMount()
    } catch (error) {
      console.error('failed to mount computers share', error)
      return c.json({ error: 'storage_unavailable' }, 503)
    }

    try {
      await deps.destroyActorApp(actorApp)
    } catch (error) {
      console.error('failed to destroy actor app', error)
      return c.json({ error: 'destroy_failed' }, 502)
    }

    try {
      await deps.removeFolder(actorApp)
    } catch (error) {
      console.error('failed to remove actor directory', error)
      return c.json({ error: 'filesystem_error' }, 500)
    }

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
    ensureActorApp: overrides.ensureActorApp ?? ensureActorAppExists,
    destroyActorApp: overrides.destroyActorApp ?? destroyActorApp,
    removeFolder: overrides.removeFolder ?? removeComputerFolder,
    auth: {
      middleware: authOverride.middleware ?? clerkMiddleware(),
      resolve: authOverride.resolve ?? getAuth,
    },
    baseDomain: overrides.baseDomain ?? resolveBaseDomain(),
  }
}

function replayToActorApp(c: Context, actorApp: string): Response {
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
  try {
    const value = Deno.env.get('INTEGRATION_TEST_USER_ID')?.trim()
    return value && value.length > 0 ? value : 'integration-suite'
  } catch {
    return 'integration-suite'
  }
}

function redirectToActorHost(
  c: Context,
  actorHost: string,
  requestUrl: URL,
): Response {
  const target = new URL(requestUrl.toString())
  target.hostname = actorHost
  target.port = ''
  return c.redirect(target.toString(), 302)
}

function hostsMatch(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase()
}

function resolveBaseDomain(): string {
  const value = readEnvTrimmed('FLY_AUTH_BASE_DOMAIN')
  if (value) return value
  throw new Error(
    'Missing FLY_AUTH_BASE_DOMAIN; set it to your app base domain',
  )
}

function readEnvTrimmed(name: string): string | undefined {
  try {
    const value = Deno.env.get(name)?.trim()
    return value ? value : undefined
  } catch {
    return undefined
  }
}
