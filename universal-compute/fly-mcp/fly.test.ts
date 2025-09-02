import { expect } from '@std/expect'
import { listFlyMachines } from './fly.ts'

Deno.test(
  'listFlyMachines maps fields and builds URL without query params',
  async () => {
    let calledUrl = ''
    let authHeader = ''
    const mockFetch: typeof fetch = async (url: any, init?: RequestInit) => {
      calledUrl = String(url)
      authHeader = String(
        (init?.headers as any)?.Authorization ??
          (init?.headers as any)?.authorization ?? '',
      )
      const payload = [
        {
          id: 'm123',
          name: 'agent-1',
          state: 'started',
          region: 'iad',
          image_ref: { repository: 'registry-1.docker.io/owner/agent:1.2.3' },
          private_ip: 'fdaa:0:abcd',
          created_at: '2025-01-01T00:00:00Z',
        },
      ]
      return new Response(JSON.stringify(payload), {
        headers: { 'Content-Type': 'application/json' },
        status: 200,
      })
    }

    const res = await listFlyMachines({
      appName: 'my-app',
      token: 'TEST_TOKEN',
      baseUrl: 'https://example.test',
      fetchImpl: mockFetch,
    })

    expect(calledUrl).toBe('https://example.test/v1/apps/my-app/machines')
    expect(authHeader).toBe('Bearer TEST_TOKEN')
    expect(Array.isArray(res)).toBe(true)
    expect(res[0].id).toBe('m123')
    expect(res[0].image).toContain('owner/agent:1.2.3')
  },
)

Deno.test('listFlyMachines throws on non-OK', async () => {
  const mockFetch: typeof fetch = async () =>
    new Response('nope', { status: 403, statusText: 'Forbidden' })
  await expect(
    listFlyMachines({
      appName: 'x',
      token: 't',
      baseUrl: 'https://example.test',
      fetchImpl: mockFetch,
    }),
  ).rejects.toThrow()
})

