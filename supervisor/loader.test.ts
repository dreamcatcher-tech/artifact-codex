import { expect } from '@std/expect'
import { Hono } from '@hono/hono'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import type { FetchLike } from '@modelcontextprotocol/sdk/shared/transport.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { createLoader } from './loader.ts'
import { INTERACTION_TOOLS } from '@artifact/shared'

const createInMemoryFetch = (app: Hono): FetchLike => {
  const fetch: FetchLike = (url, init) => {
    const request = new Request(url, init as RequestInit)
    return Promise.resolve(app.fetch(request))
  }
  return fetch
}

const createFixture = async () => {
  let loaderCallback = false
  const loader = createLoader(() => {
    loaderCallback = true
  })
  const app = new Hono()
  app.use('*', loader.handler)

  const client = new Client({ name: 'loader-test', version: '0.0.0' })
  const transport = new StreamableHTTPClientTransport(
    new URL('http://loader.test/mcp'),
    { fetch: createInMemoryFetch(app) },
  )
  await client.connect(transport)

  return {
    loader,
    client,
    get loaderCallback() {
      return loaderCallback
    },
    [Symbol.asyncDispose]: async () => {
      console.log('closing fixture')
      await client.close()
      await loader.close()
    },
  }
}

Deno.test('loader exposes agent tools after load', async () => {
  await using fixture = await createFixture()
  const { client, loader } = fixture

  const { tools } = await client.listTools()
  expect(tools).toHaveLength(1)
  expect(tools[0].name).toBe('load')

  const loadResult = await client.callTool({
    name: 'load',
    arguments: { computerId: 'comp-1', agentId: 'agent-1' },
  }) as CallToolResult

  expect(loadResult.isError).not.toBeDefined()
  expect(loadResult.structuredContent).toEqual({ ok: true })

  const agentClient = loader.client
  const agentTools = loader.tools
  expect(agentTools).toHaveLength(Object.keys(INTERACTION_TOOLS).length)
  const listed = await agentClient.listTools()
  expect(listed.tools).toHaveLength(Object.keys(INTERACTION_TOOLS).length)
  expect(listed.tools?.map((t) => t.name)).toEqual(
    Object.keys(INTERACTION_TOOLS),
  )

  const start = await agentClient.callTool({
    name: 'interaction_start',
    arguments: { input: 'hello' },
  }) as { structuredContent: { interactionId: string } }
  const { interactionId } = start.structuredContent
  expect(typeof interactionId).toBe('string')

  const awaited = await agentClient.callTool({
    name: 'interaction_await',
    arguments: { interactionId },
  }) as { structuredContent: { value: string } }
  const { value } = awaited.structuredContent
  expect(value).toBe('hello')
})
