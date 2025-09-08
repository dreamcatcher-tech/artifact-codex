import { createApp } from './main.ts'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'

const baseUrl = 'http://in-memory/mcp'

export async function withApp() {
  const { app, close } = createApp()
  const fetchLike = (url: string | URL, init?: RequestInit) => {
    return Promise.resolve(app.fetch(new Request(url, init)))
  }
  const client = new Client({ name: 'test-client', version: '0.0.0' })
  const transport = new StreamableHTTPClientTransport(
    new URL(baseUrl),
    { fetch: fetchLike } as unknown as Record<string, unknown>,
  )
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
