import { expect } from '@std/expect'
import { spawnStdioMcpServer } from '@artifact/shared'

Deno.test(
  {
    name: 'MCP initialize handshake',
    sanitizeOps: false,
    sanitizeResources: false,
  },
  async () => {
    const srv = await spawnStdioMcpServer()
    try {
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
    } finally {
      await srv.close()
    }
  },
)

Deno.test({
  name: 'tools/list includes interaction tools',
  sanitizeOps: false,
  sanitizeResources: false,
}, async () => {
  const srv = await spawnStdioMcpServer()
  try {
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
  } finally {
    await srv.close()
  }
})
