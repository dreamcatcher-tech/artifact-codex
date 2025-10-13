import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { createApp } from './app.ts'
import type { Hono } from '@hono/hono'
import type { FetchLike } from '@modelcontextprotocol/sdk/shared/transport.js'
import { createIdleTrigger } from '@artifact/shared'
import type { SupervisorEnv } from './app.ts'
import { MCP_PORT } from '@artifact/shared'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { join } from 'node:path'
import type { AgentResolver } from './loader.ts'
const defaultTimeoutMs = 2 * 60 * 1000

export async function createFixture(
  { timeoutMs = defaultTimeoutMs, agentResolver = testAgentResolver } = {},
) {
  const controller = new AbortController()
  const idler = createIdleTrigger(controller, timeoutMs)
  const { app, [Symbol.asyncDispose]: close } = createApp(idler, agentResolver)

  const fetch = createInMemoryFetch(app)
  const client = new Client({ name: 'test-client', version: '0.0.0' })
  const transport = new StreamableHTTPClientTransport(new URL('abc://nope/'), {
    fetch,
  })
  await client.connect(transport)
  const load = async (computerId = 'comp-1', agentId = 'agent-1') => {
    await client.callTool({
      name: 'load',
      arguments: { computerId, agentId },
    }) as CallToolResult
  }
  return {
    app,
    fetch,
    client,
    load,
    [Symbol.asyncDispose]: async () => {
      await client.close()
      await close()
    },
  }
}

export async function createLoadedFixture(
  { timeoutMs = defaultTimeoutMs, agentResolver = testAgentResolver } = {},
) {
  const fixture = await createFixture({ timeoutMs, agentResolver })
  await fixture.load()
  return fixture
}

export const createInMemoryFetch = (app: Hono<SupervisorEnv>): FetchLike => {
  const fetch: FetchLike = (url, init) => {
    const request = new Request(url, init as RequestInit)
    request.headers.set('Fly-Forwarded-Port', String(MCP_PORT))
    return Promise.resolve(app.fetch(request))
  }
  return fetch
}

export const testAgentResolver: AgentResolver = () => {
  const cwd = join(import.meta.dirname!, '..', 'agent-test')
  const file = join(cwd, 'main.ts')
  return Promise.resolve({
    command: 'deno',
    args: ['run', '-A', file],
    env: {},
    cwd,
  })
}
