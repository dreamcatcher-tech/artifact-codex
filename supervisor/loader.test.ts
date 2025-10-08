import { createLoadedFixture } from '@artifact/supervisor/fixture'
import { expect } from '@std/expect'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { INTERACTION_TOOLS } from '@artifact/shared'

type ToolResult<T extends Record<string, unknown>> = CallToolResult & {
  structuredContent?: T
}

type InteractionStart = { interactionId: string }
type InteractionAwait = { value: string }
type InteractionCancel = { cancelled: boolean; wasActive: boolean }
type InteractionStatus = { state: 'pending' | 'completed' | 'cancelled' }

const TOOL_NAMES = Object.keys(INTERACTION_TOOLS)

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

Deno.test('loader exposes agent interaction tools', async () => {
  await using fixture = await createLoadedFixture()

  const list = await fixture.client.listTools({})
  const names = list.tools.map((tool) => tool.name)
  for (const name of TOOL_NAMES) {
    expect(names).toContain(name)
  }
})

Deno.test('interaction_start values are available via interaction_await', async () => {
  await using fixture = await createLoadedFixture()

  const started = await fixture.client.callTool({
    name: 'interaction_start',
    arguments: { input: 'echo-value' },
  }) as ToolResult<InteractionStart>
  const { interactionId } = requireStructured(started)
  expect(typeof interactionId).toBe('string')

  const awaited = await fixture.client.callTool({
    name: 'interaction_await',
    arguments: { interactionId },
  }) as ToolResult<InteractionAwait>
  const { value } = requireStructured(awaited)
  expect(value).toBe('echo-value')
})

Deno.test('interaction_cancel clears stored interaction and updates status', async () => {
  await using fixture = await createLoadedFixture()

  const started = await fixture.client.callTool({
    name: 'interaction_start',
    arguments: { input: 'cancel-me' },
  }) as ToolResult<InteractionStart>
  const { interactionId } = requireStructured(started)

  const beforeStatus = await fixture.client.callTool({
    name: 'interaction_status',
    arguments: { interactionId },
  }) as ToolResult<InteractionStatus>
  expect(requireStructured(beforeStatus).state).toBe('pending')

  const cancelled = await fixture.client.callTool({
    name: 'interaction_cancel',
    arguments: { interactionId },
  }) as ToolResult<InteractionCancel>
  const { cancelled: didCancel, wasActive } = requireStructured(cancelled)
  expect(didCancel).toBe(true)
  expect(wasActive).toBe(true)

  const afterStatus = await fixture.client.callTool({
    name: 'interaction_status',
    arguments: { interactionId },
  }) as ToolResult<InteractionStatus>
  expect(requireStructured(afterStatus).state).toBe('cancelled')

  const awaited = await fixture.client.callTool({
    name: 'interaction_await',
    arguments: { interactionId },
  }) as ToolResult<InteractionAwait>
  expect(awaited.isError).toBe(true)
})

Deno.test('interaction_await reports error for unknown interaction ids', async () => {
  await using fixture = await createLoadedFixture()

  const result = await fixture.client.callTool({
    name: 'interaction_await',
    arguments: { interactionId: 'missing' },
  }) as CallToolResult

  expect(result.isError).toBe(true)
  const first = result.content[0]
  expect(first.text).toContain('unknown interaction id: missing')
})
