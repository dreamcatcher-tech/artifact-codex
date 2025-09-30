import { expect } from '@std/expect'

import {
  createProxyHandler,
  isOriginAllowed,
  normalizeAllowedOrigins,
} from './main.ts'

Deno.test('normalizeAllowedOrigins falls back to wildcard', () => {
  expect(normalizeAllowedOrigins(undefined)).toEqual(['*'])
  expect(normalizeAllowedOrigins('')).toEqual(['*'])
})

Deno.test('isOriginAllowed accepts wildcard and exact matches', () => {
  expect(isOriginAllowed('https://example.com', ['*'])).toBe(true)
  expect(isOriginAllowed('https://example.com', ['https://example.com'])).toBe(
    true,
  )
  expect(
    isOriginAllowed('https://example.com', ['https://other.com']),
  ).toBe(false)
})

Deno.test('proxy rewrites authorization header with secret', async () => {
  const handler = createProxyHandler({
    apiKey: 'real-key',
    apiBase: new URL('https://example.com/'),
    allowedOrigins: ['*'],
  })

  let capturedInit: RequestInit | undefined
  let capturedInput: RequestInfo | URL | undefined

  const originalFetch = globalThis.fetch

  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    capturedInput = input
    capturedInit = init

    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('ok'))
        controller.close()
      },
    })

    return Promise.resolve(
      new Response(stream, {
        status: 200,
        headers: { 'Content-Type': 'text/plain' },
      }),
    )
  }) as typeof fetch

  try {
    const request = new Request('http://localhost/v1/responses', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer fake-key',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ input: 'hi' }),
    })

    const response = await handler(request)

    expect(String(capturedInput)).toEqual('https://example.com/v1/responses')
    expect((capturedInit?.headers as Headers).get('Authorization')).toEqual(
      'Bearer real-key',
    )
    expect(capturedInit?.body).not.toBeNull()
    expect(response.status).toBe(200)
    expect(await response.text()).toBe('ok')
  } finally {
    globalThis.fetch = originalFetch
  }
})
