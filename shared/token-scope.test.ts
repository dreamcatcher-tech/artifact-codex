import { expect } from '@std/expect'
import { probeTokenScope } from '@artifact/shared'

Deno.test('probeTokenScope -> org when listFlyApps succeeds', async () => {
  // Mock fetch: getFlyApp (derive org) then listFlyApps ok
  const calls: string[] = []
  const mockFetch: typeof fetch = (input, _init) => {
    const url = typeof input === 'string'
      ? input
      : input instanceof URL
      ? input.toString()
      : input.url
    calls.push(url)
    if (url.endsWith('/v1/apps/my-app')) {
      return Promise.resolve(
        new Response(
          JSON.stringify({
            id: 'app-id',
            name: 'my-app',
            organization: { slug: 'personal' },
          }),
          { headers: { 'Content-Type': 'application/json' } },
        ),
      )
    }
    if (url.includes('/v1/apps?org_slug=')) {
      return Promise.resolve(
        new Response(
          JSON.stringify([
            { id: 'a1', name: 'x' },
          ]),
          { headers: { 'Content-Type': 'application/json' } },
        ),
      )
    }
    return Promise.resolve(new Response('not found', { status: 404 }))
  }

  const res = await probeTokenScope({
    token: 'T',
    appName: 'my-app',
    fetchImpl: mockFetch,
  })
  expect(res.classification).toBe('org')
  expect(res.orgSlug).toBe('personal')
  expect(Array.isArray(res.evidence)).toBe(false)
  expect(res.evidence.getApp?.ok).toBe(true)
  expect(res.evidence.listApps?.ok).toBe(true)
  expect(calls.some((u) => u.endsWith('/v1/apps/my-app'))).toBe(true)
  expect(calls.some((u) => u.includes('/v1/apps?org_slug=personal'))).toBe(true)
})

Deno.test('probeTokenScope -> app when listFlyApps 403', async () => {
  const mockFetch: typeof fetch = (input, _init) => {
    const url = typeof input === 'string'
      ? input
      : input instanceof URL
      ? input.toString()
      : input.url
    if (url.endsWith('/v1/apps/my-app')) {
      return Promise.resolve(
        new Response(
          JSON.stringify({
            id: 'app-id',
            name: 'my-app',
            organization: { slug: 'personal' },
          }),
          { headers: { 'Content-Type': 'application/json' } },
        ),
      )
    }
    if (url.includes('/v1/apps?org_slug=')) {
      return Promise.resolve(
        new Response('forbidden', { status: 403, statusText: 'Forbidden' }),
      )
    }
    return Promise.resolve(new Response('not found', { status: 404 }))
  }

  const res = await probeTokenScope({
    token: 'T',
    appName: 'my-app',
    fetchImpl: mockFetch,
  })
  expect(res.classification).toBe('app')
  expect(res.orgSlug).toBe('personal')
  expect(res.evidence.listApps?.status).toBe(403)
})

Deno.test('probeTokenScope -> unknown without org/app context', async () => {
  const mockFetch: typeof fetch = () =>
    Promise.resolve(new Response('no', { status: 400 }))
  const res = await probeTokenScope({ token: 'T', fetchImpl: mockFetch })
  expect(res.classification).toBe('unknown')
  expect(String(res.message)).toContain('Provide orgSlug or an appName')
})
