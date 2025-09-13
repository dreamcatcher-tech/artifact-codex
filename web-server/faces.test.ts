import { expect } from '@std/expect'
import { withApp } from './fixture.ts'
import type { ListFacesOutput } from '@artifact/mcp-faces'

Deno.test('tools/list exposes face tools', async () => {
  using fixtures = await withApp()
  const { client } = fixtures
  const list = await client.listTools()
  const names = (list.tools ?? []).map((t) => t.name)
  expect(names).toContain('list_faces')
  expect(names).toContain('create_face')
  expect(names).toContain('read_face')
  expect(names).toContain('destroy_face')
})

Deno.test('tools/call list_faces returns available kinds', async () => {
  using fixtures = await withApp()
  const { client } = fixtures
  const result = await client.callTool({
    name: 'list_faces',
    arguments: { agentId: 'agent123' },
  }) as { structuredContent?: ListFacesOutput }
  const kinds = result.structuredContent?.face_kinds ?? []
  expect(Array.isArray(kinds)).toBe(true)
  const kindNames = kinds.map((k) => k.faceKind)
  expect(kindNames).toContain('test')
  const live = result.structuredContent?.live_faces
  expect(Array.isArray(live)).toBe(true)
})

Deno.test('tools/call create_face returns a face id', async () => {
  using fixtures = await withApp()
  const { client } = fixtures
  const result = await client.callTool({
    name: 'create_face',
    arguments: { agentId: 'agent123', faceKind: 'test' },
  }) as { structuredContent?: { faceId?: string } }
  const faceId = result.structuredContent?.faceId
  expect(typeof faceId).toBe('string')
  expect(faceId?.startsWith('face-')).toBe(true)
})

Deno.test('tools/call read_face returns error for unknown id', async () => {
  using fixtures = await withApp()
  const { client } = fixtures
  const res = await client.callTool({
    name: 'read_face',
    arguments: { agentId: 'agent123', faceId: 'does-not-exist' },
  })
  expect(res.isError).toBe(true)
})

Deno.test('tools/call destroy_face returns error for unknown id', async () => {
  using fixtures = await withApp()
  const { client } = fixtures
  const res = await client.callTool({
    name: 'destroy_face',
    arguments: { agentId: 'agent123', faceId: 'does-not-exist' },
  })
  expect(res.isError).toBe(true)
})
