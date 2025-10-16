import {
  INTERACTION_TOOL_NAMES,
  type InteractionAwait,
  type InteractionCancel,
  type InteractionStart,
  type InteractionStatus,
  readErrorText,
  requireStructured,
  spawnStdioMcpServer,
  type ToolResult,
} from '@artifact/shared'
import { expect } from '@std/expect'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'

const agentId = 'agent-test'

Deno.test('stdio exposes agent interaction tools', async () => {
  await using srv = await spawnStdioMcpServer()
  const list = await srv.client.listTools({})
  const names = list.tools.map((tool) => tool.name)
  for (const name of INTERACTION_TOOL_NAMES) {
    expect(names).toContain(name)
  }
})

Deno.test('interaction_start values are available via interaction_await', async () => {
  await using srv = await spawnStdioMcpServer()

  const started = await srv.client.callTool({
    name: 'interaction_start',
    arguments: { agentId, input: 'echo-value' },
  }) as ToolResult<InteractionStart>
  const { interactionId } = requireStructured(started)
  expect(typeof interactionId).toBe('string')

  const awaited = await srv.client.callTool({
    name: 'interaction_await',
    arguments: { agentId, interactionId },
  }) as ToolResult<InteractionAwait>
  const { value } = requireStructured(awaited)
  expect(value).toBe('echo-value')
})

Deno.test('interaction_cancel clears stored interaction and updates status', async () => {
  await using srv = await spawnStdioMcpServer()

  const started = await srv.client.callTool({
    name: 'interaction_start',
    arguments: { agentId, input: 'cancel-me' },
  }) as ToolResult<InteractionStart>
  const { interactionId } = requireStructured(started)

  const beforeStatus = await srv.client.callTool({
    name: 'interaction_status',
    arguments: { agentId, interactionId },
  }) as ToolResult<InteractionStatus>
  expect(requireStructured(beforeStatus).state).toBe('pending')

  const cancelled = await srv.client.callTool({
    name: 'interaction_cancel',
    arguments: { agentId, interactionId },
  }) as ToolResult<InteractionCancel>
  const { cancelled: didCancel, wasActive } = requireStructured(cancelled)
  expect(didCancel).toBe(true)
  expect(wasActive).toBe(true)

  const afterStatus = await srv.client.callTool({
    name: 'interaction_status',
    arguments: { agentId, interactionId },
  }) as ToolResult<InteractionStatus>
  expect(requireStructured(afterStatus).state).toBe('cancelled')

  const awaited = await srv.client.callTool({
    name: 'interaction_await',
    arguments: { agentId, interactionId },
  }) as ToolResult<InteractionAwait>
  expect(awaited.isError).toBe(true)
})

Deno.test('interaction_await reports error for unknown interaction ids', async () => {
  await using srv = await spawnStdioMcpServer()

  const result = await srv.client.callTool({
    name: 'interaction_await',
    arguments: { agentId, interactionId: 'missing' },
  }) as CallToolResult

  expect(result.isError).toBe(true)
  const error = readErrorText(result)
  expect(error).toContain('unknown interaction id: missing')
})
