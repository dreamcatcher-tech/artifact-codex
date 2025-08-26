import { expect } from '@std/expect'
import { createServer } from './web-server.ts'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'

Deno.test('unauthorized without token returns 401', async () => {
  await using server = createServer({ apiKeys: ['ok'] })
  const res = await server.app.request('/mcp', { method: 'POST', body: '{}' })
  expect(res.status).toBe(401)
})

async function setup() {
  const server = createServer({ apiKeys: ['ok'] })

  const fetch = async (...args: Parameters<typeof server.app.request>) => {
    return server.app.request(...args)
  }
  const url = new URL('http://localhost:8080/mcp')

  const transport = new StreamableHTTPClientTransport(url, {
    fetch,
    requestInit: {
      headers: { Authorization: 'Bearer ok' },
    },
  })
  const client = new Client({ name: 'test-client', version: '1.0.0' })
  await client.connect(transport)

  return {
    server,
    client,
    [Symbol.asyncDispose]: async () => {
      await server[Symbol.asyncDispose]()
      await client.close()
    },
  }
}

Deno.test('mcp client ping', async () => {
  await using fixtures = await setup()
  const { client } = fixtures
  const ping = await client.ping()
  expect(ping).toEqual({})
})

Deno.test('echo tool works', async () => {
  await using fixtures = await setup()
  const { client } = fixtures
  const { tools } = await client.listTools()
  expect(tools.some((t) => t.name === 'echo')).toBe(true)

  const res = await client.callTool({ name: 'echo', arguments: { message: 'hi' } })
  expect((res as any).structuredContent.echoed).toBe('hi')
})

