import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { createApp } from './app.ts'
import type { Hono } from '@hono/hono'
import type { FetchLike } from '@modelcontextprotocol/sdk/shared/transport.js'
import { createIdleTrigger } from '@artifact/shared'
import type { SupervisorEnv } from './app.ts'
import { MCP_PORT } from '@artifact/shared'

export async function createFixture(timoutMs = Number.MAX_SAFE_INTEGER) {
  const controller = new AbortController()
  const idler = createIdleTrigger(controller, timoutMs)
  const { app, [Symbol.asyncDispose]: close } = createApp(idler)

  const fetch = createInMemoryFetch(app)
  const client = new Client({ name: 'test-client', version: '0.0.0' })
  const transport = new StreamableHTTPClientTransport(new URL('abc://nope'), {
    fetch,
  })
  await client.connect(transport)
  return {
    app,
    fetch,
    client,
    [Symbol.asyncDispose]: async () => {
      await client.close()
      await close()
    },
  }
}

const createInMemoryFetch = (app: Hono<SupervisorEnv>): FetchLike => {
  const fetch: FetchLike = (url, init) => {
    const request = new Request(url, init as RequestInit)
    request.headers.set('Fly-Forwarded-Port', String(MCP_PORT))
    return Promise.resolve(app.fetch(request))
  }
  return fetch
}
