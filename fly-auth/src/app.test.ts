import { expect } from '@std/expect'
import { type ClerkAuthVariables, getAuth } from '@hono/clerk-auth'
import { type MiddlewareHandler } from '@hono/hono'

import { createApp, deriveActorAppName } from './app.ts'

const TEST_SECRET = 'sk_test_dummy'
const TEST_PUBLISHABLE =
  'pk_test_bGVnaWJsZS1sbGFtYS0zMi5jbGVyay5hY2NvdW50cy5kZXYk'

const INTEGRATION_TEST_USER = (() => {
  const value = Deno.env.get('INTEGRATION_TEST_USER_ID')?.trim()
  return value && value.length > 0 ? value : 'integration-suite'
})()

const INTEGRATION_ACTOR_APP = deriveActorAppName(INTEGRATION_TEST_USER)

type EnvSnapshot = {
  secret?: string
  publishable?: string
}

function setClerkEnv(): () => void {
  const snapshot: EnvSnapshot = {
    secret: Deno.env.get('CLERK_SECRET_KEY') ?? undefined,
    publishable: Deno.env.get('CLERK_PUBLISHABLE_KEY') ?? undefined,
  }
  Deno.env.set('CLERK_SECRET_KEY', TEST_SECRET)
  Deno.env.set('CLERK_PUBLISHABLE_KEY', TEST_PUBLISHABLE)

  return () => {
    restore('CLERK_SECRET_KEY', snapshot.secret)
    restore('CLERK_PUBLISHABLE_KEY', snapshot.publishable)
  }
}

function restore(key: string, value: string | undefined) {
  if (value === undefined) {
    Deno.env.delete(key)
  } else {
    Deno.env.set(key, value)
  }
}

function stubAuth(userId: string) {
  const middleware = (async (_c, next) => {
    await next()
  }) as MiddlewareHandler<{ Variables: ClerkAuthVariables }>
  const resolve =
    ((_) => ({ userId } as ReturnType<typeof getAuth>)) as typeof getAuth
  return { middleware, resolve }
}

Deno.test('unauthorized JSON request is rejected', async () => {
  const cleanup = setClerkEnv()
  try {
    const app = createApp()
    const res = await app.request('http://localhost/', {
      headers: { accept: 'application/json' },
    })
    expect(res.status).toBe(401)
    expect(await res.json()).toEqual({ error: 'unauthenticated' })
  } finally {
    cleanup()
  }
})

Deno.test('redirects unauthorized request to Clerk sign-in', async () => {
  const cleanup = setClerkEnv()
  try {
    const app = createApp()
    const res = await app.request('http://localhost/', {
      headers: { accept: 'text/plain' },
    })
    expect(res.status).toBe(302)
    expect(res.headers.get('location')).toBe(
      'https://legible-llama-32.accounts.dev/sign-in?redirect_url=http://localhost/',
    )
  } finally {
    cleanup()
  }
})

Deno.test('redirects to sign-up when requested', async () => {
  const cleanup = setClerkEnv()
  try {
    const app = createApp()
    const res = await app.request('http://localhost/?flow=sign-up', {
      headers: { accept: 'text/plain' },
    })
    expect(res.status).toBe(302)
    expect(res.headers.get('location')).toBe(
      'https://legible-llama-32.accounts.dev/sign-up?redirect_url=http://localhost/?flow=sign-up',
    )
  } finally {
    cleanup()
  }
})

Deno.test('redirect sanitizes agent subdomain in redirect url', async () => {
  const cleanup = setClerkEnv()
  try {
    const app = createApp()
    const res = await app.request('http://SCOPED--Sub-Part.example.test/', {
      headers: { accept: 'text/plain' },
    })
    expect(res.status).toBe(302)
    expect(res.headers.get('location')).toBe(
      'https://legible-llama-32.accounts.dev/sign-in?redirect_url=http://scoped--sub-part.example.test/',
    )
  } finally {
    cleanup()
  }
})

Deno.test('replays existing actor app via redirect then fly-replay', async () => {
  let ensureCalls = 0
  let created = false
  const app = createApp({
    dependencies: {
      baseDomain: TEST_BASE_DOMAIN,
      ensureMount: () => Promise.resolve(),
      folderExists: () => Promise.resolve(true),
      createFolder: () => {
        created = true
        return Promise.resolve()
      },
      ensureActorApp: () => {
        ensureCalls += 1
        return Promise.resolve({
          appName: 'actor-user-test',
          appId: 'app-actor-user-test',
          existed: true,
        })
      },
      auth: stubAuth('User_Test'),
    },
  })

  const initial = await app.request('http://localhost/')
  expect(initial.status).toBe(302)
  expect(initial.headers.get('location')).toBe(
    'http://actor-user-test.example.test/',
  )

  const follow = await app.request('http://actor-user-test.example.test/')
  expect(follow.status).toBe(204)
  expect(follow.headers.get('fly-replay')).toBe('app=actor-user-test')
  expect(ensureCalls).toBe(0)
  expect(created).toBe(false)
})

Deno.test('provisions actor app then redirects to actor host', async () => {
  let ensureCalls = 0
  let created = false
  let folderExistsState = false
  const app = createApp({
    dependencies: {
      baseDomain: TEST_BASE_DOMAIN,
      ensureMount: () => Promise.resolve(),
      folderExists: () => Promise.resolve(folderExistsState),
      createFolder: () => {
        created = true
        folderExistsState = true
        return Promise.resolve()
      },
      ensureActorApp: (name) => {
        ensureCalls += 1
        expect(name).toBe('actor-new-user')
        return Promise.resolve({
          appName: name,
          appId: `id-${name}`,
          existed: false,
        })
      },
      auth: stubAuth('new.user'),
    },
  })

  const initial = await app.request('http://localhost/')
  expect(initial.status).toBe(302)
  expect(initial.headers.get('location')).toBe(
    'http://actor-new-user.example.test/',
  )

  const follow = await app.request('http://actor-new-user.example.test/')
  expect(follow.status).toBe(204)
  expect(follow.headers.get('fly-replay')).toBe('app=actor-new-user')
  expect(ensureCalls).toBe(1)
  expect(created).toBe(true)
})

Deno.test('creates missing folder for existing app then redirects', async () => {
  let created = false
  let folderExistsState = false
  const app = createApp({
    dependencies: {
      baseDomain: TEST_BASE_DOMAIN,
      ensureMount: () => Promise.resolve(),
      folderExists: () => Promise.resolve(folderExistsState),
      createFolder: () => {
        created = true
        folderExistsState = true
        return Promise.resolve()
      },
      ensureActorApp: (name) =>
        Promise.resolve({ appName: name, appId: `id-${name}`, existed: true }),
      auth: stubAuth('Existing_User'),
    },
  })

  const initial = await app.request('http://localhost/')
  expect(initial.status).toBe(302)
  expect(initial.headers.get('location')).toBe(
    'http://actor-existing-user.example.test/',
  )

  const follow = await app.request('http://actor-existing-user.example.test/')
  expect(follow.status).toBe(204)
  expect(follow.headers.get('fly-replay')).toBe('app=actor-existing-user')
  expect(created).toBe(true)
})

Deno.test('bypasses Clerk auth when test header is present', async () => {
  const ensured: string[] = []
  const created: string[] = []
  let authResolves = 0
  let folderExistsState = false
  const app = createApp({
    dependencies: {
      baseDomain: TEST_BASE_DOMAIN,
      ensureMount: () => Promise.resolve(),
      folderExists: (name) => {
        expect(name).toBe(INTEGRATION_ACTOR_APP)
        return Promise.resolve(folderExistsState)
      },
      createFolder: (name) => {
        created.push(name)
        folderExistsState = true
        return Promise.resolve()
      },
      ensureActorApp: (name) => {
        ensured.push(name)
        return Promise.resolve({
          appName: name,
          appId: `id-${name}`,
          existed: false,
        })
      },
      auth: {
        middleware: (async (_c, next) => {
          await next()
        }) as MiddlewareHandler<{ Variables: ClerkAuthVariables }>,
        resolve: (() => {
          authResolves += 1
          return { userId: undefined } as ReturnType<typeof getAuth>
        }) as typeof getAuth,
      },
    },
  })

  const initial = await app.request('http://localhost/', {
    headers: { 'x-artifact-test-user': INTEGRATION_TEST_USER },
  })

  expect(initial.status).toBe(302)
  expect(initial.headers.get('location')).toBe(
    `http://${INTEGRATION_ACTOR_APP}.example.test/`,
  )

  const follow = await app.request(
    `http://${INTEGRATION_ACTOR_APP}.example.test/`,
    {
      headers: { 'x-artifact-test-user': INTEGRATION_TEST_USER },
    },
  )

  expect(follow.status).toBe(204)
  expect(follow.headers.get('fly-replay')).toBe(`app=${INTEGRATION_ACTOR_APP}`)
  expect(ensured).toEqual([INTEGRATION_ACTOR_APP])
  expect(created).toEqual([INTEGRATION_ACTOR_APP])
  expect(authResolves).toBe(0)
})

Deno.test('returns 503 when NFS mount fails', async () => {
  const app = createApp({
    dependencies: {
      ensureMount: () => Promise.reject(new Error('mount failed')),
      folderExists: () => Promise.resolve(false),
      createFolder: () => Promise.resolve(),
      ensureActorApp: (name) =>
        Promise.resolve({ appName: name, appId: `id-${name}`, existed: false }),
      auth: stubAuth('Mount_Failure'),
    },
  })

  const res = await app.request('http://localhost/')
  expect(res.status).toBe(503)
  expect(await res.json()).toEqual({ error: 'storage_unavailable' })
})

Deno.test('deletes integration actor when header matches', async () => {
  const destroyed: string[] = []
  const removed: string[] = []
  let mountCalls = 0
  const app = createApp({
    dependencies: {
      ensureMount: () => {
        mountCalls += 1
        return Promise.resolve()
      },
      destroyActorApp: (name) => {
        destroyed.push(name)
        return Promise.resolve()
      },
      removeFolder: (name) => {
        removed.push(name)
        return Promise.resolve()
      },
      auth: stubAuth('ignored'),
    },
  })

  const res = await app.request('http://localhost/integration/actor', {
    method: 'DELETE',
    headers: { 'x-artifact-test-user': INTEGRATION_TEST_USER },
  })

  expect(res.status).toBe(204)
  expect(mountCalls).toBe(1)
  expect(destroyed).toEqual([INTEGRATION_ACTOR_APP])
  expect(removed).toEqual([INTEGRATION_ACTOR_APP])
})

Deno.test('rejects integration delete when header mismatches', async () => {
  const app = createApp({
    dependencies: {
      // track if these were called unexpectedly
      ensureMount: () => Promise.reject(new Error('should not mount')),
      destroyActorApp: () => Promise.reject(new Error('should not destroy')),
      removeFolder: () => Promise.reject(new Error('should not remove folder')),
      auth: stubAuth('ignored'),
    },
  })

  const res = await app.request('http://localhost/integration/actor', {
    method: 'DELETE',
    headers: { 'x-artifact-test-user': 'not-allowed' },
  })

  expect(res.status).toBe(401)
  expect(await res.json()).toEqual({ error: 'unauthorized' })
})
