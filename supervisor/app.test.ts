import { expect } from '@std/expect'
import { createFixture } from './fixture.ts'
import { INTERACTION_TOOLS } from '@artifact/shared'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'

Deno.test('app routes MCP traffic to the agent once the loader completes', async () => {
  await using fixture = await createFixture()
  const { client } = fixture

  const initialTools = await client.listTools()
  expect(initialTools.tools).toHaveLength(1)
  expect(initialTools.tools?.[0]?.name).toBe('load')

  const loadResult = await client.callTool({
    name: 'load',
    arguments: { computerId: 'comp-1', agentId: 'agent-1' },
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
    arguments: { input: 'hello' },
  }) as { structuredContent: { interactionId: string } }
  const { interactionId } = start.structuredContent
  expect(typeof interactionId).toBe('string')

  const awaited = await client.callTool({
    name: 'interaction_await',
    arguments: { interactionId },
  }) as { structuredContent: { value: string } }
  expect(awaited.structuredContent.value).toBe('hello')
})
