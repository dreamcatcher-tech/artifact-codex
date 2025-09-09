import { expect } from '@std/expect'
import { spawnStdioMcpServer } from '@artifact/shared'
import { createRemoteFacesHandlers } from './main.ts'
import { withApp } from '../web-server/fixture.ts'

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
  expect(result?.serverInfo?.name).toBe('faces-mcp')
  expect(typeof result?.protocolVersion).toBe('string')
})

Deno.test('tools/list includes face tools', async () => {
  await using srv = await spawnStdioMcpServer()
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
})

// Proxy behavior tests: use the in-memory web-server app and pass its fetch
// to the faces proxy so remote calls go to /mcp on that app.

Deno.test('proxy list_faces forwards to remote server', async () => {
  using fixtures = await withApp()
  const handlers = createRemoteFacesHandlers({ fetch: fixtures.fetch })
  const result = await handlers.list_faces({ agentId: 'in-memory' }) as {
    structuredContent?: { face_kinds?: string[] }
  }
  const kinds = result.structuredContent?.face_kinds
  expect(Array.isArray(kinds)).toBe(true)
  expect(kinds).toContain('test')
})

Deno.test('proxy create_face returns faceId via remote', async () => {
  using fixtures = await withApp()
  const handlers = createRemoteFacesHandlers({ fetch: fixtures.fetch })
  const created = await handlers.create_face({
    agentId: 'in-memory',
    faceKind: 'test',
  }) as { structuredContent?: { faceId?: string } }
  const faceId = created.structuredContent?.faceId
  expect(typeof faceId).toBe('string')
  expect(faceId?.startsWith('face-')).toBe(true)
})

Deno.test('proxy read/destroy on unknown id return errors', async () => {
  using fixtures = await withApp()
  const handlers = createRemoteFacesHandlers({ fetch: fixtures.fetch })
  const read = await handlers.read_face({
    agentId: 'in-memory',
    faceId: 'does-not-exist',
  })
  expect(read.isError).toBe(true)

  const destroyed = await handlers.destroy_face({
    agentId: 'in-memory',
    faceId: 'does-not-exist',
  })
  expect(destroyed.isError).toBe(true)
})
