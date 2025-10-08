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

type TextContent = {
  uri: string
  text: string
  mimeType?: string
}

const viewsResourceName = 'views'
const viewsResourceUri = 'mcp://views'
const agentId = 'agent-cmd'

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

function isTextContent(content: unknown): content is TextContent {
  return Boolean(
    content && typeof content === 'object' && 'text' in content &&
      typeof (content as { text: unknown }).text === 'string',
  )
}

Deno.test('views resource exposes current views', async () => {
  await using srv = await spawnStdioMcpServer()

  const listed = await srv.client.listResources({})
  const resourceNames = (listed.resources ?? []).map((resource) =>
    resource.name
  )
  expect(resourceNames).toContain(viewsResourceName)

  const read = await srv.client.readResource({ uri: viewsResourceUri })
  const textContent = read.contents.find(isTextContent)
  if (!textContent) {
    throw new Error('views resource missing text content')
  }
  expect(textContent.mimeType).toBe('application/json')

  const parsed = JSON.parse(textContent.text) as { views?: unknown }
  expect(Array.isArray(parsed.views)).toBe(true)
})
