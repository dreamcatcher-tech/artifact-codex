import {
  INTERACTION_TOOL_NAMES,
  type InteractionAwait,
  type InteractionCancel,
  type InteractionStart,
  type InteractionStatus,
  requireStructured,
  spawnStdioMcpServer,
  type ToolResult,
} from '@artifact/shared'
import { expect } from '@std/expect'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'

async function spawnInitializedServer() {
  const server = await spawnStdioMcpServer()
  await server.client.listTools({})
  return server
}

Deno.test('stdio exposes agent interaction tools', async () => {
  await using srv = await spawnInitializedServer()
  const list = await srv.client.listTools({})
  const names = list.tools.map((tool) => tool.name)
  for (const name of INTERACTION_TOOL_NAMES) {
    expect(names).toContain(name)
  }
})

Deno.test('interaction_start values are available via interaction_await', async () => {
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
  expect(requireStructured(beforeStatus).state).toBe('pending')

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
  expect(requireStructured(afterStatus).state).toBe('cancelled')

  const awaited = await srv.client.callTool({
    name: 'interaction_await',
    arguments: { interactionId },
  }) as ToolResult<InteractionAwait>
  expect(awaited.isError).toBe(true)
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
