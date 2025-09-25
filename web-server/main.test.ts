import { expect } from '@std/expect'
import { withApp } from './fixture.ts'
import { createTestServerOptions } from './test-helpers.ts'

Deno.test('MCP initialize handshake via SDK client', async () => {
  await using fixtures = await withApp(createTestServerOptions())
  const { client } = fixtures
  const info = client.getServerVersion()
  expect(info?.name).toBe('web-server-test')
  const caps = client.getServerCapabilities()
  expect(typeof caps).toBe('object')
})

Deno.test('tools/list exposes face + interaction tools', async () => {
  await using fixtures = await withApp(createTestServerOptions())
  const { client } = fixtures
  const list = await client.listTools()
  const names = (list.tools ?? []).map((t) => t.name)
  expect(names).toContain('list_faces')
  expect(names).toContain('create_face')
  expect(names).toContain('read_face')
  expect(names).toContain('destroy_face')
  expect(names).toContain('list_interactions')
  expect(names).toContain('create_interaction')
  expect(names).toContain('read_interaction')
  expect(names).toContain('destroy_interaction')
})
