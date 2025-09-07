import { expect } from '@std/expect'
import { spawnStdioMcpServer } from '@artifact/shared'

Deno.test(
  {
    name: 'MCP initialize handshake',
    sanitizeOps: false,
    sanitizeResources: false,
  },
  async (_t) => {
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

      expect(result).toBeDefined()
      expect(typeof result.serverInfo?.name).toBe('string')
      expect(result.serverInfo?.name).toBe('fly-mcp')
      expect(typeof result.protocolVersion).toBe('string')
    } finally {
      await srv.close()
    }
  },
)

Deno.test({
  name: 'tools/list includes only agent tools',
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
    expect(names).toContain('list_agents')
    expect(names).toContain('create_agent')
    expect(names).toContain('destroy_agent')
    expect(names).not.toContain('create_computer')
    expect(names).not.toContain('list_computers')
    expect(names).not.toContain('computer_exists')
  } finally {
    await srv.close()
  }
})

// (moved unit tests that previously targeted fly.ts)

// Removed echo/add tools and their tests.

Deno.test({
  name: 'create_agent rejects invalid names before env checks',
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
    type ToolsCallTextResult = { content?: { type: string; text?: string }[] }
    const res = await srv.request<ToolsCallTextResult>('tools/call', {
      name: 'create_agent',
      arguments: { name: 'Bad_Name' },
    }, 5)
    const content = res?.content?.[0]
    expect(content?.type).toBe('text')
    expect(String(content?.text)).toContain('Invalid agent name')
  } finally {
    await srv.close()
  }
})
