import { expect } from '@std/expect'
import { withApp } from './fixture.ts'

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
