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
      expect(result?.serverInfo?.name).toBe('faces-mcp')
      expect(typeof result?.protocolVersion).toBe('string')
    } finally {
      await srv.close()
    }
  },
)

Deno.test({
  name: 'tools/list includes face tools',
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
    expect(names).toContain('list_faces')
    expect(names).toContain('create_face')
    expect(names).toContain('read_face')
    expect(names).toContain('destroy_face')
  } finally {
    await srv.close()
  }
})
