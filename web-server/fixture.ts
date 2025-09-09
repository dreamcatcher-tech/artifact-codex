import { createApp } from './main.ts'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import type { FetchLike } from '@modelcontextprotocol/sdk/shared/transport.js'

const baseUrl = 'http://in-memory/mcp'

export async function withApp() {
  const { app, close } = createApp()
  const fetch: FetchLike = (url, init) => {
    const request = new Request(url, init as RequestInit)
    return Promise.resolve(app.fetch(request))
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
