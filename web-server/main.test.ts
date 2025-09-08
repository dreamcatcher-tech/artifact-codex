import { expect } from '@std/expect'
import { createApp } from './main.ts'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'

const baseUrl = 'http://in-memory/mcp'

async function withApp() {
  const { app, close } = createApp()
  const fetch = (...args: Parameters<typeof app.request>) => {
    return Promise.resolve(app.request(...args))
  }
  const client = new Client({ name: 'test-client', version: '0.0.0' })
  const transport = new StreamableHTTPClientTransport(new URL(baseUrl), {
    fetch,
  })
  await client.connect(transport)
  return {
    app,
    fetch,
    client,
    [Symbol.dispose]: () => {
      close()
    },
  }
}

Deno.test('MCP initialize handshake via SDK client', async () => {
  using fixtures = await withApp()
  const { client } = fixtures
  const info = client.getServerVersion()
  expect(info?.name).toBe('web-server')
  const caps = client.getServerCapabilities()
  expect(typeof caps).toBe('object')
})

Deno.test('tools/list returns stub tools (SDK client)', async () => {
  using fixtures = await withApp()
  const { client } = fixtures
  const list = await client.listTools()
  const names = (list.tools ?? []).map((t) => t.name)
  expect(names).toContain('echo')
  expect(names).toContain('time')
  expect(names).toContain('ping')
})

Deno.test('tools/call echo works (SDK client)', async () => {
  using fixtures = await withApp()
  const { client } = fixtures
  const result = await client.callTool({
    name: 'echo',
    arguments: { text: 'hello' },
  })
  const echoed =
    (result as unknown as { structuredContent?: { echoed?: string } })
      ?.structuredContent?.echoed
  expect(echoed).toBe('hello')
})
