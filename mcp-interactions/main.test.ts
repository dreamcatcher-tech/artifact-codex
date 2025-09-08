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
  expect(result?.serverInfo?.name).toBe('interactions-mcp')
  expect(typeof result?.protocolVersion).toBe('string')
})

Deno.test('tools/list includes interaction tools', async () => {
  await using srv = await spawnStdioMcpServer()
  await srv.request('initialize', {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name: 'test-client', version: '0.1.0' },
  }, 1)
  type ToolsListResult = { tools?: { name: string }[] }
  const list = await srv.request<ToolsListResult>('tools/list', {}, 2)
  const names = (list.tools ?? []).map((t) => t.name)
  expect(names).toContain('list_interactions')
  expect(names).toContain('create_interaction')
  expect(names).toContain('read_interaction')
  expect(names).toContain('destroy_interaction')
})
