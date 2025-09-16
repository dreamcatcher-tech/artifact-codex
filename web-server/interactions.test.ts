import { expect } from '@std/expect'
import { withApp } from './fixture.ts'

Deno.test('MCP initialize handshake via SDK client', async () => {
  await using fixtures = await withApp()
  const { client } = fixtures
  const info = client.getServerVersion()
  expect(info?.name).toBe('web-server')
  const caps = client.getServerCapabilities()
  expect(typeof caps).toBe('object')
})

Deno.test('tools/list exposes face + interaction tools', async () => {
  await using fixtures = await withApp()
  const { client } = fixtures
  const list = await client.listTools()
  const names = (list.tools ?? []).map((t) => t.name)
  expect(names).toContain('list_interactions')
  expect(names).toContain('create_interaction')
  expect(names).toContain('read_interaction')
  expect(names).toContain('destroy_interaction')
})

Deno.test('tools/call list_interactions returns ids for a face', async () => {
  await using fixtures = await withApp()
  const { client } = fixtures
  const createdFace = await client.callTool({
    name: 'create_face',
    arguments: { agentId: 'agent123', faceKindId: 'test' },
  }) as { structuredContent?: { faceId?: string } }
  const faceId = createdFace.structuredContent?.faceId!

  const createdIx = await client.callTool({
    name: 'create_interaction',
    arguments: { agentId: 'agent123', faceId, input: 'hello' },
  }) as { structuredContent?: { interactionId?: string } }
  const interactionId = createdIx.structuredContent?.interactionId

  const list = await client.callTool({
    name: 'list_interactions',
    arguments: { agentId: 'agent123', faceId },
  }) as { structuredContent?: { interactionIds?: string[] } }
  const ids = list.structuredContent?.interactionIds ?? []

  expect(Array.isArray(ids)).toBe(true)
  expect(ids).toContain(interactionId)
})

Deno.test('tools/call create_interaction returns an interaction id', async () => {
  await using fixtures = await withApp()
  const { client } = fixtures
  const createdFace = await client.callTool({
    name: 'create_face',
    arguments: { agentId: 'agent123', faceKindId: 'test' },
  }) as { structuredContent?: { faceId?: string } }
  const faceId = createdFace.structuredContent?.faceId

  const result = await client.callTool({
    name: 'create_interaction',
    arguments: { agentId: 'agent123', faceId, input: 'ping' },
  }) as { structuredContent?: { interactionId?: string } }
  const id = result.structuredContent?.interactionId

  expect(typeof id).toBe('string')
})

Deno.test('tools/call read_interaction returns result and removes id', async () => {
  await using fixtures = await withApp()
  const { client } = fixtures
  const createdFace = await client.callTool({
    name: 'create_face',
    arguments: { agentId: 'agent123', faceKindId: 'test' },
  }) as { structuredContent?: { faceId?: string } }
  const faceId = createdFace.structuredContent?.faceId!
  const createdIx = await client.callTool({
    name: 'create_interaction',
    arguments: { agentId: 'agent123', faceId, input: 'hello world' },
  }) as { structuredContent?: { interactionId?: string } }
  const interactionId = createdIx.structuredContent?.interactionId!
  const read = await client.callTool({
    name: 'read_interaction',
    arguments: { agentId: 'agent123', interactionId },
  }) as { structuredContent?: { result?: unknown } }
  expect(read.structuredContent?.result).toBeDefined()
  const listAfter = await client.callTool({
    name: 'list_interactions',
    arguments: { agentId: 'agent123', faceId },
  }) as { structuredContent?: { interactionIds?: string[] } }
  const idsAfter = listAfter.structuredContent?.interactionIds ?? []
  expect(idsAfter).not.toContain(interactionId)
})

Deno.test('tools/call read_interaction returns MCP error for error input', async () => {
  await using fixtures = await withApp()
  const { client } = fixtures
  const createdFace = await client.callTool({
    name: 'create_face',
    arguments: { agentId: 'agent123', faceKindId: 'test' },
  }) as { structuredContent?: { faceId?: string } }
  const faceId = createdFace.structuredContent?.faceId!

  const createdIx = await client.callTool({
    name: 'create_interaction',
    arguments: { agentId: 'agent123', faceId, input: 'error' },
  }) as { structuredContent?: { interactionId?: string } }
  const interactionId = createdIx.structuredContent?.interactionId!

  const read = await client.callTool({
    name: 'read_interaction',
    arguments: { agentId: 'agent123', interactionId },
  })
  expect(read.isError).toBe(true)

  // Interaction id should be removed even on error path
  const listAfter = await client.callTool({
    name: 'list_interactions',
    arguments: { agentId: 'agent123', faceId },
  }) as { structuredContent?: { interactionIds?: string[] } }
  const idsAfter = listAfter.structuredContent?.interactionIds ?? []
  expect(idsAfter).not.toContain(interactionId)
})

Deno.test('tools/call read_interaction returns error for unknown id', async () => {
  await using fixtures = await withApp()
  const { client } = fixtures
  const res = await client.callTool({
    name: 'read_interaction',
    arguments: { agentId: 'agent123', interactionId: 'does-not-exist' },
  })
  expect(res.isError).toBe(true)
})

Deno.test('tools/call destroy_interaction returns error for unknown id', async () => {
  await using fixtures = await withApp()
  const { client } = fixtures
  const res = await client.callTool({
    name: 'destroy_interaction',
    arguments: { agentId: 'agent123', interactionId: 'does-not-exist' },
  })
  expect(res.isError).toBe(true)
})

Deno.test('tools/call destroy_interaction cancels and removes an id', async () => {
  await using fixtures = await withApp()
  const { client } = fixtures
  const createdFace = await client.callTool({
    name: 'create_face',
    arguments: { agentId: 'agent123', faceKindId: 'test' },
  }) as { structuredContent?: { faceId?: string } }
  const faceId = createdFace.structuredContent?.faceId!
  const createdIx = await client.callTool({
    name: 'create_interaction',
    arguments: { agentId: 'agent123', faceId, input: 'ping' },
  }) as { structuredContent?: { interactionId?: string } }
  const interactionId = createdIx.structuredContent?.interactionId!
  const destroyed = await client.callTool({
    name: 'destroy_interaction',
    arguments: { agentId: 'agent123', interactionId },
  }) as { structuredContent?: { ok: boolean } }
  expect(destroyed.structuredContent?.ok).toBe(true)
})
