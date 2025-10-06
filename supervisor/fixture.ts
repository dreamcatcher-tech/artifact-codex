import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'

import {
  createSupervisor,
  inMemoryBaseUrl,
  type SupervisorOptions,
} from './app.ts'
import type { Hono } from '@hono/hono'
import type { FetchLike } from '@modelcontextprotocol/sdk/shared/transport.js'

export interface WithAppOptions extends SupervisorOptions {
  clientName?: string
  clientVersion?: string
}

export async function withApp(options: WithAppOptions) {
  const { clientName = 'test-client', clientVersion = '0.0.0', ...serverOpts } =
    options
  const { app, close } = createSupervisor(serverOpts)
  const fetch = createInMemoryFetch(app)
  const client = new Client({ name: clientName, version: clientVersion })
  const transport = new StreamableHTTPClientTransport(inMemoryBaseUrl, {
    fetch,
  })
  await client.connect(transport)
  return {
    app,
    fetch,
    client,
    baseUrl: String(inMemoryBaseUrl),
    [Symbol.asyncDispose]: async () => {
      await client.close()
      await close()
    },
  }
}

const createInMemoryFetch = (app: Hono): FetchLike => {
  const fetch: FetchLike = (url, init) => {
    const request = new Request(url, init as RequestInit)
    return Promise.resolve(app.fetch(request))
  }
  return fetch
}
