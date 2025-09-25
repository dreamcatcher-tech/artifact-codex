import { expect } from '@std/expect'
import type { ListFacesOutput } from '@artifact/mcp-faces'

import { withApp as withWebServerApp } from '@artifact/web-server/fixture'
import { createAgentBasicOptions } from './server-options.ts'

const EXPECTED_FACE_IDS = ['test', 'inspector', 'codex', 'cmd'] as const
const EXPECTED_TOOLS = [
  'list_faces',
  'create_face',
  'read_face',
  'destroy_face',
  'list_interactions',
  'create_interaction',
  'read_interaction',
  'destroy_interaction',
] as const

Deno.test('agent-basic exposes MCP tools and configured faces', async () => {
  Deno.env.set('DC_FACES', EXPECTED_FACE_IDS.join(','))

  await using fixtures = await withWebServerApp(createAgentBasicOptions())
  const { client } = fixtures

  const toolList = await client.listTools()
  const toolNames = new Set((toolList.tools ?? []).map((tool) => tool.name))
  for (const name of EXPECTED_TOOLS) {
    expect(toolNames.has(name)).toBe(true)
  }

  const facesResult = await client.callTool({
    name: 'list_faces',
    arguments: { agentId: 'agent-basic' },
  }) as { structuredContent?: ListFacesOutput }
  const kinds = facesResult.structuredContent?.face_kinds ?? []
  const returnedIds = kinds
    .map((kind) => kind.faceKindId)
    .filter((id) => id !== '@self system')
    .sort()
  const expectedIds = [...EXPECTED_FACE_IDS].sort()
  expect(returnedIds).toEqual(expectedIds)
})
