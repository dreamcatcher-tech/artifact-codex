import { expect } from '@std/expect'
import { createMachine, listMachines } from './fly.ts'

Deno.test(
  'listMachines maps fields and builds URL without query params',
  async () => {
    let calledUrl = ''
    let authHeader = ''
    const mockFetch: typeof fetch = (
      input: Request | URL | string,
      init?: RequestInit,
    ) => {
      calledUrl = typeof input === 'string'
        ? input
        : input instanceof URL
        ? input.toString()
        : input.url
      const headers = new Headers(init?.headers)
      authHeader = headers.get('authorization') ?? ''
      const payload = [
        {
          id: 'm123',
          name: 'agent-1',
          state: 'started',
          region: 'iad',
          'image_ref': { repository: 'registry-1.docker.io/owner/agent:1.2.3' },
          'private_ip': 'fdaa:0:abcd',
          'created_at': '2025-01-01T00:00:00Z',
        },
      ]
      return Promise.resolve(
        new Response(JSON.stringify(payload), {
          headers: { 'Content-Type': 'application/json' },
          status: 200,
        }),
      )
    }

    const res = await listMachines({
      appName: 'my-app',
      token: 'TEST_TOKEN',
      fetchImpl: mockFetch,
    })

    expect(calledUrl).toBe('https://api.machines.dev/v1/apps/my-app/machines')
    expect(authHeader).toBe('Bearer TEST_TOKEN')
    expect(Array.isArray(res)).toBe(true)
    expect(res[0].id).toBe('m123')
    expect(res[0].image).toContain('owner/agent:1.2.3')
    // metadata absent in payload => undefined
    expect(res[0].metadata).toBeUndefined()
  },
)

Deno.test('listMachines throws on non-OK', async () => {
  const mockFetch: typeof fetch = () =>
    Promise.resolve(
      new Response('nope', { status: 403, statusText: 'Forbidden' }),
    )
  await expect(
    listMachines({
      appName: 'x',
      token: 't',
      fetchImpl: mockFetch,
    }),
  ).rejects.toThrow()
})

Deno.test(
  'createMachine posts correct URL with headers and body and returns summary',
  async () => {
    let calledUrl = ''
    let method = ''
    let authHeader = ''
    let contentType = ''
    type CreateReqBody = {
      name?: string
      region?: string
      config?: { image?: string }
    }
    let bodyObj: unknown = null

    const mockFetch: typeof fetch = (
      input: Request | URL | string,
      init?: RequestInit,
    ) => {
      calledUrl = typeof input === 'string'
        ? input
        : input instanceof URL
        ? input.toString()
        : input.url
      method = String(init?.method)
      const headers = new Headers(init?.headers)
      authHeader = headers.get('authorization') ?? ''
      contentType = headers.get('content-type') ?? ''
      bodyObj = init?.body ? JSON.parse(String(init.body)) : null
      const b = bodyObj as CreateReqBody | null
      const payload = {
        id: 'mid-1',
        name: b?.name ?? 'agent-x',
        state: 'created',
        region: b?.region ?? 'iad',
        'image_ref': { repository: b?.config?.image ?? 'image:test' },
        'private_ip': null,
        'created_at': '2025-01-02T03:04:05Z',
      }
      return Promise.resolve(
        new Response(JSON.stringify(payload), {
          headers: { 'Content-Type': 'application/json' },
          status: 200,
        }),
      )
    }

    const res = await createMachine({
      appName: 'my-app',
      token: 'TEST_TOKEN',
      name: 'agent-77',
      config: { image: 'owner/agent:2.0.0' },
      region: 'iad',
      fetchImpl: mockFetch,
    })

    expect(calledUrl).toBe('https://api.machines.dev/v1/apps/my-app/machines')
    expect(method).toBe('POST')
    expect(authHeader).toBe('Bearer TEST_TOKEN')
    expect(contentType).toBe('application/json')
    const b = bodyObj as CreateReqBody | null
    expect(b?.name).toBe('agent-77')
    expect(b?.region).toBe('iad')
    expect(b?.config?.image).toBe('owner/agent:2.0.0')

    expect(res.id).toBe('mid-1')
    expect(res.name).toBe('agent-77')
    expect(res.image).toContain('owner/agent:2.0.0')
  },
)

Deno.test('createMachine throws on non-OK', async () => {
  const mockFetch: typeof fetch = () =>
    Promise.resolve(
      new Response('nope', { status: 400, statusText: 'Bad Request' }),
    )
  await expect(
    createMachine({
      appName: 'a',
      token: 't',
      name: 'n',
      config: { image: 'img' },
      fetchImpl: mockFetch,
    }),
  ).rejects.toThrow()
})
