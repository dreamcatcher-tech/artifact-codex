import { spawnStdioMcpServer } from '@artifact/shared'
import { expect } from '@std/expect'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'

type ToolResult<T extends Record<string, unknown>> = CallToolResult & {
  structuredContent?: T
}

type InteractionStart = { interactionId: string }
type InteractionAwait = { value: string }
type InteractionCancel = { cancelled: boolean; wasActive: boolean }
type InteractionStatus = { state: 'pending' | 'completed' | 'cancelled' }

function requireStructured<T extends Record<string, unknown>>(
  result: ToolResult<T>,
): T {
  if (!result || typeof result !== 'object') {
    throw new Error('tool result missing structured content')
  }
  const structured = result.structuredContent
  if (!structured || typeof structured !== 'object') {
    throw new Error('tool result missing structured content')
  }
  return structured
}

async function spawnInitializedServer() {
  const server = await spawnStdioMcpServer()
  await server.client.listTools({})
  return server
}

Deno.test('registerAgent exposes interaction tools', async () => {
  await using srv = await spawnInitializedServer()
  const list = await srv.client.listTools({})
  const names = (list.tools ?? []).map((tool) => tool.name)
  expect(names).toContain('interaction_start')
  expect(names).toContain('interaction_await')
  expect(names).toContain('interaction_cancel')
  expect(names).toContain('interaction_status')
})

Deno.test('interaction_start stores values accessible via interaction_await', async () => {
  await using srv = await spawnInitializedServer()

  const started = await srv.client.callTool({
    name: 'interaction_start',
    arguments: { input: 'echo-value' },
  }) as ToolResult<InteractionStart>
  const { interactionId } = requireStructured(started)
  expect(typeof interactionId).toBe('string')

  const awaited = await srv.client.callTool({
    name: 'interaction_await',
    arguments: { interactionId },
  }) as ToolResult<InteractionAwait>
  const { value } = requireStructured(awaited)
  expect(value).toBe('echo-value')
})

Deno.test('interaction_cancel clears stored interaction and updates status', async () => {
  await using srv = await spawnInitializedServer()

  const started = await srv.client.callTool({
    name: 'interaction_start',
    arguments: { input: 'cancel-me' },
  }) as ToolResult<InteractionStart>
  const { interactionId } = requireStructured(started)

  const beforeStatus = await srv.client.callTool({
    name: 'interaction_status',
    arguments: { interactionId },
  }) as ToolResult<InteractionStatus>
  expect(requireStructured(beforeStatus).state).toBe('completed')

  const cancelled = await srv.client.callTool({
    name: 'interaction_cancel',
    arguments: { interactionId },
  }) as ToolResult<InteractionCancel>
  const { cancelled: didCancel, wasActive } = requireStructured(cancelled)
  expect(didCancel).toBe(true)
  expect(wasActive).toBe(true)

  const afterStatus = await srv.client.callTool({
    name: 'interaction_status',
    arguments: { interactionId },
  }) as ToolResult<InteractionStatus>
  expect(requireStructured(afterStatus).state).toBe('pending')
})

Deno.test('interaction_await reports error for unknown interaction ids', async () => {
  await using srv = await spawnInitializedServer()

  const result = await srv.client.callTool({
    name: 'interaction_await',
    arguments: { interactionId: 'missing' },
  }) as CallToolResult

  expect(result.isError).toBe(true)
  const first = result.content?.[0]
  expect(first?.type).toBe('text')
  expect(String(first?.text ?? '')).toContain('unknown interaction id: missing')
})
