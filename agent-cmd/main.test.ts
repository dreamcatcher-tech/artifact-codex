import { requireStructured, spawnStdioMcpServer } from '@artifact/shared'
import type {
  AgentView,
  InteractionAwait,
  InteractionCancel,
  InteractionStart,
  InteractionStatus,
  ToolResult,
} from '@artifact/shared'
import { expect } from '@std/expect'

const agentId = 'agent-cmd'

Deno.test('interaction_start followed by interaction_await returns ok', async () => {
  await using srv = await spawnStdioMcpServer()

  const started = await srv.client.callTool({
    name: 'interaction_start',
    arguments: { agentId, input: 'echo hello' },
  }) as ToolResult<InteractionStart>
  const { interactionId } = requireStructured(started)
  expect(typeof interactionId).toBe('string')

  const awaited = await srv.client.callTool({
    name: 'interaction_await',
    arguments: { agentId, interactionId },
  }) as ToolResult<InteractionAwait>
  const { value } = requireStructured(awaited)
  expect(value).toBe('ok')
})

Deno.test('interaction_cancel marks interaction as cancelled', async () => {
  await using srv = await spawnStdioMcpServer()

  const started = await srv.client.callTool({
    name: 'interaction_start',
    arguments: { agentId, input: 'noop' },
  }) as ToolResult<InteractionStart>
  const { interactionId } = requireStructured(started)

  const cancelled = await srv.client.callTool({
    name: 'interaction_cancel',
    arguments: { agentId, interactionId },
  }) as ToolResult<InteractionCancel>
  const { cancelled: didCancel, wasActive } = requireStructured(cancelled)
  expect(didCancel).toBe(true)
  expect(wasActive).toBe(true)

  const status = await srv.client.callTool({
    name: 'interaction_status',
    arguments: { agentId, interactionId },
  }) as ToolResult<InteractionStatus>
  const { state } = requireStructured(status)
  expect(state).toBe('cancelled')

  const awaited = await srv.client.callTool({
    name: 'interaction_await',
    arguments: { agentId, interactionId },
  })
  expect(awaited.isError).toBe(true)
})

Deno.test('interaction_await for unknown interaction id returns error', async () => {
  await using srv = await spawnStdioMcpServer()

  const result = await srv.client.callTool({
    name: 'interaction_await',
    arguments: { agentId, interactionId: 'missing' },
  })

  expect(result.isError).toBe(true)
  const content = Array.isArray(result.content) ? result.content[0] : undefined
  expect(content?.type).toBe('text')
  expect(String(content?.text ?? '')).toContain(
    'unknown interaction id: missing',
  )
})

Deno.test('interaction_views returns current views', async () => {
  await using srv = await spawnStdioMcpServer()

  const viewsResult = await srv.client.callTool({
    name: 'interaction_views',
    arguments: {},
  }) as ToolResult<{ views: AgentView[] }>
  const { views } = requireStructured(viewsResult)
  expect(Array.isArray(views)).toBe(true)
  for (const view of views) {
    expect(typeof view.name).toBe('string')
    expect(typeof view.port).toBe('number')
  }
})
