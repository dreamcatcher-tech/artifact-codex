import {
  INTERACTION_TOOL_NAMES,
  isTextContent,
  readErrorText,
  spawnStdioMcpServer,
} from '@artifact/shared'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { expect } from '@std/expect'

const agentId = 'agent-inspector'

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

Deno.test('stdio exposes agent interaction tools', async () => {
  const { env, dispose } = await prepareEnv()
  await using srv = await spawnStdioMcpServer({ env, dispose })
  const listed = await srv.client.listTools({})
  const names = listed.tools.map((tool) => tool.name)
  for (const name of INTERACTION_TOOL_NAMES) {
    expect(names).toContain(name)
  }
})

Deno.test('interaction_start rejects requests', async () => {
  const { env, dispose } = await prepareEnv()
  await using srv = await spawnStdioMcpServer({ env, dispose })
  const started = await srv.client.callTool({
    name: 'interaction_start',
    arguments: { agentId, input: 'launch inspector' },
  })
  expect(started.isError).toBe(true)
  expect(readErrorText(started as CallToolResult)).toContain(
    'does not support interactions',
  )
})

Deno.test('interaction_cancel rejects requests', async () => {
  const { env, dispose } = await prepareEnv()
  await using srv = await spawnStdioMcpServer({ env, dispose })
  const cancelled = await srv.client.callTool({
    name: 'interaction_cancel',
    arguments: { agentId, interactionId: 'noop' },
  })
  expect(cancelled.isError).toBe(true)
  expect(readErrorText(cancelled as CallToolResult)).toContain(
    'does not support interactions',
  )

  const status = await srv.client.callTool({
    name: 'interaction_status',
    arguments: { agentId, interactionId: 'noop' },
  })
  expect(status.isError).toBe(true)
  expect(readErrorText(status as CallToolResult)).toContain(
    'does not support interactions',
  )
})

Deno.test('interaction_await rejects requests', async () => {
  const { env, dispose } = await prepareEnv()
  await using srv = await spawnStdioMcpServer({ env, dispose })
  const result = await srv.client.callTool({
    name: 'interaction_await',
    arguments: { agentId, interactionId: 'missing' },
  })
  expect(result.isError).toBe(true)
  expect(readErrorText(result as CallToolResult)).toContain(
    'does not support interactions',
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
