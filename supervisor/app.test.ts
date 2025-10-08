import { expect } from '@std/expect'
import { createFixture, createLoadedFixture } from './fixture.ts'
import { INTERACTION_TOOLS, isTextContent } from '@artifact/shared'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'

const agentId = 'agent-1'

Deno.test('app routes MCP traffic to the agent once the loader completes', async () => {
  await using fixture = await createFixture()
  const { client } = fixture

  const initialTools = await client.listTools()
  expect(initialTools.tools).toHaveLength(1)
  expect(initialTools.tools?.[0]?.name).toBe('load')

  const loadResult = await client.callTool({
    name: 'load',
    arguments: { computerId: 'comp-1', agentId },
  }) as CallToolResult
  expect(loadResult.isError).not.toBeDefined()
  expect(loadResult.structuredContent).toEqual({ ok: true })

  const listed = await client.listTools()
  const toolNames = (listed.tools ?? []).map((tool) => tool.name).sort()
  const expected = [...Object.keys(INTERACTION_TOOLS), 'halt'].sort()
  expect(toolNames).toEqual(expected)
  expect(toolNames).not.toContain('load')

  const start = await client.callTool({
    name: 'interaction_start',
    arguments: { agentId, input: 'hello' },
  }) as { structuredContent: { interactionId: string } }
  const { interactionId } = start.structuredContent
  expect(typeof interactionId).toBe('string')

  const awaited = await client.callTool({
    name: 'interaction_await',
    arguments: { agentId, interactionId },
  }) as { structuredContent: { value: string } }
  expect(awaited.structuredContent.value).toBe('hello')
})

Deno.test('app proxies agent resources through supervisor', async () => {
  await using fixture = await createLoadedFixture()
  const { client } = fixture

  const { resources } = await client.listResources({})
  const resourceNames = resources.map((resource) => resource.name)
  expect(resourceNames).toContain('views')

  const read = await client.readResource({ uri: 'mcp://views' })
  const textContent = read.contents.find(isTextContent)
  expect(textContent?.mimeType).toBe('application/json')
})
