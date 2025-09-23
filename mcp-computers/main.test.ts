import { expect } from '@std/expect'
import { spawnStdioMcpServer } from '@artifact/shared'

Deno.test('MCP initialize handshake', async () => {
  await using srv = await spawnStdioMcpServer()
  type InitializeResult = {
    serverInfo?: { name?: string; version?: string }
    protocolVersion?: string
  }
  const result = await srv.request<InitializeResult>('initialize', {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name: 'test-client', version: '0.1.0' },
  }, 1)
  expect(result).toBeDefined()
  expect(result.serverInfo?.name).toBe('computer-mcp')
  expect(typeof result.protocolVersion).toBe('string')
})

Deno.test('no org token => tools/list not available', async () => {
  await using srv = await spawnStdioMcpServer()
  await srv.request('initialize', {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name: 'test-client', version: '0.1.0' },
  }, 1)
  let err: unknown
  try {
    await srv.request('tools/list', {}, 2)
  } catch (e) {
    err = e
  }
  expect(String(err)).toContain('tools/list error')
  expect(String(err)).toContain('Method not found')
})

Deno.test('org-scoped token => computer tools exposed', async () => {
  await using srv = await spawnStdioMcpServer({
    env: { FLY_API_DEPLOY_TOKEN: 'TEST_ORG', FLY_APP_NAME: 'dummy' },
  })
  await srv.request('initialize', {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name: 'test-client', version: '0.1.0' },
  }, 1)
  type ToolsListResult = { tools?: { name: string }[] }
  const list = await srv.request<ToolsListResult>('tools/list', {}, 2)
  const names = (list.tools ?? []).map((t) => t.name)
  expect(names).toContain('create_computer')
  expect(names).toContain('list_computers')
  expect(names).toContain('read_computer')
  expect(names).toContain('destroy_computer')
  expect(names).not.toContain('list_agents')
})

Deno.test('create_computer rejects invalid userId early (org token)', async () => {
  await using srv = await spawnStdioMcpServer({
    env: { FLY_API_DEPLOY_TOKEN: 'TEST_ORG', FLY_APP_NAME: 'dummy' },
  })
  await srv.request('initialize', {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name: 'test-client', version: '0.1.0' },
  }, 1)
  type ToolsCallTextResult = { content?: { type: string; text?: string }[] }
  const res = await srv.request<ToolsCallTextResult>('tools/call', {
    name: 'create_computer',
    arguments: { userId: 'Bad_User' },
  }, 6)
  const content = res?.content?.[0]
  expect(content?.type).toBe('text')
  expect(String(content?.text)).toContain('Invalid computer name')
})
