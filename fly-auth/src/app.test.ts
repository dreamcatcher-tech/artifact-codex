import { expect } from '@std/expect'

import { createApp } from './app.ts'

const TEST_SECRET = 'sk_test_dummy'
const TEST_PUBLISHABLE =
  'pk_test_bGVnaWJsZS1sbGFtYS0zMi5jbGVyay5hY2NvdW50cy5kZXYk'

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
