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

const agentId = 'agent-inspector'

type TextContent = {
  text: string
  mimeType?: string
}

async function prepareEnv(
  config: Record<string, unknown> = { test: true },
) {
  const workspace = await Deno.makeTempDir()
  const home = await Deno.makeTempDir()
  const env = {
    AGENT_INSPECTOR_WORKSPACE: workspace,
    AGENT_INSPECTOR_HOME: home,
    AGENT_INSPECTOR_CONFIG: JSON.stringify(config),
  }
  const dispose = async () => {
    await Promise.allSettled([
      Deno.remove(workspace, { recursive: true }),
      Deno.remove(home, { recursive: true }),
    ])
  }
  return { env, dispose }
}

function isTextContent(content: unknown): content is TextContent {
  return Boolean(
    content && typeof content === 'object' &&
      typeof (content as { text?: unknown }).text === 'string',
  )
}

Deno.test('stdio exposes agent interaction tools', async () => {
  const { env, dispose } = await prepareEnv()
  await using srv = await spawnStdioMcpServer({ env, dispose })
  const listed = await srv.client.listTools({})
  const names = listed.tools.map((tool) => tool.name)
  for (const name of INTERACTION_TOOL_NAMES) {
    expect(names).toContain(name)
  }
})

Deno.test('interaction_start awaits ready state', async () => {
  const { env, dispose } = await prepareEnv()
  await using srv = await spawnStdioMcpServer({ env, dispose })
  const started = await srv.client.callTool({
    name: 'interaction_start',
    arguments: { agentId, input: 'launch inspector' },
  }) as ToolResult<InteractionStart>
  const { interactionId } = requireStructured(started)
  expect(typeof interactionId).toBe('string')

  const awaited = await srv.client.callTool({
    name: 'interaction_await',
    arguments: { agentId, interactionId },
  }) as ToolResult<InteractionAwait>
  const { value } = requireStructured(awaited)
  expect(value).toBe('ready')
})

Deno.test('interaction_cancel marks interaction as cancelled', async () => {
  const { env, dispose } = await prepareEnv()
  await using srv = await spawnStdioMcpServer({ env, dispose })
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
  expect(requireStructured(status).state).toBe('cancelled')

  const awaited = await srv.client.callTool({
    name: 'interaction_await',
    arguments: { agentId, interactionId },
  })
  expect(awaited.isError).toBe(true)
})

Deno.test('interaction_await reports error for unknown interaction id', async () => {
  const { env, dispose } = await prepareEnv()
  await using srv = await spawnStdioMcpServer({ env, dispose })
  const result = await srv.client.callTool({
    name: 'interaction_await',
    arguments: { agentId, interactionId: 'missing' },
  })
  expect(result.isError).toBe(true)
  const payload = Array.isArray(result.content) ? result.content[0] : undefined
  expect(payload?.type).toBe('text')
  expect(String(payload?.text ?? '')).toContain(
    'unknown interaction id: missing',
  )
})

Deno.test('views resource lists inspector views', async () => {
  const { env, dispose } = await prepareEnv()
  await using srv = await spawnStdioMcpServer({ env, dispose })
  const listed = await srv.client.listResources({})
  const names = (listed.resources ?? []).map((resource) => resource.name)
  expect(names).toContain('views')

  const read = await srv.client.readResource({ uri: 'mcp://views' })
  const textContent = read.contents.find(isTextContent)
  if (!textContent) {
    throw new Error('views resource missing text content')
  }
  expect(textContent.mimeType).toBe('application/json')

  const payload = JSON.parse(String(textContent.text)) as { views?: unknown }
  expect(Array.isArray(payload.views)).toBe(true)
  expect((payload.views as unknown[]).length).toBeGreaterThan(0)
})
