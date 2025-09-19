import { expect } from '@std/expect'

import { createApp } from './app.ts'

const TEST_SECRET = 'sk_test_dummy'
const TEST_PUBLISHABLE =
  'pk_test_cXVpY2stcGhlYXNhbnQtNTguY2xlcmsuYWNjb3VudHMuZGV2JA'

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

Deno.test('unauthorized request is rejected', async () => {
  const cleanup = setClerkEnv()
  try {
    const app = createApp()
    const res = await app.request('/')
    expect(res.status).toBe(401)
    expect(await res.json()).toEqual({ error: 'unauthenticated' })
  } finally {
    cleanup()
  }
})
