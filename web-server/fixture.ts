import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'

import {
  createAgentWebServer,
  type CreateAgentWebServerOptions,
  createInMemoryFetch,
  inMemoryBaseUrl,
} from './app.ts'

export interface WithAppOptions extends CreateAgentWebServerOptions {
  clientName?: string
  clientVersion?: string
}

export async function withApp(options: WithAppOptions) {
  const { clientName = 'test-client', clientVersion = '0.0.0', ...serverOpts } =
    options
  const { app, close } = createAgentWebServer(serverOpts)
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
