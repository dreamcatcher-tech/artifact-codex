import { expect } from '@std/expect'
import { createFixture, createLoadedFixture } from './fixture.ts'
import { INTERACTION_TOOLS, requireStructured } from '@artifact/shared'
import type { AgentView, ToolResult } from '@artifact/shared'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'

const agentId = 'agent-1'

Deno.test('app routes MCP traffic to the agent once the loader completes', async () => {
  await using fixture = await createFixture()
  const { client } = fixture

  const initialTools = await client.listTools()
  expect(initialTools.tools).toHaveLength(1)
  expect(initialTools.tools?.[0]?.name).toBe('load')

  const loadResult = await client.callTool({
    name: 'load',
    arguments: { computerId: 'comp-1', agentId },
  }) as CallToolResult
  expect(loadResult.isError).not.toBeDefined()
  expect(loadResult.structuredContent).toEqual({ ok: true })

  const listed = await client.listTools()
  const toolNames = (listed.tools ?? []).map((tool) => tool.name).sort()
  const expected = [...Object.keys(INTERACTION_TOOLS), 'halt'].sort()
  expect(toolNames).toEqual(expected)
  expect(toolNames).not.toContain('load')

  const start = await client.callTool({
    name: 'interaction_start',
    arguments: { agentId, input: 'hello' },
  }) as { structuredContent: { interactionId: string } }
  const { interactionId } = start.structuredContent
  expect(typeof interactionId).toBe('string')

  const awaited = await client.callTool({
    name: 'interaction_await',
    arguments: { agentId, interactionId },
  }) as { structuredContent: { value: string } }
  expect(awaited.structuredContent.value).toBe('hello')
})

Deno.test('app proxies agent resources through supervisor', async (t) => {
  await using fixture = await createLoadedFixture()
  const { client, app } = fixture

  let initialViews: AgentView[] = []
  let serveInteractionId = ''
  const serveInput = 'serve /test-view'
  let newView: AgentView | undefined

  await t.step('reads initial views', async () => {
    const viewsResult = await client.callTool({
      name: 'interaction_views',
      arguments: {},
    }) as ToolResult<{ views: AgentView[] }>
    const { views } = requireStructured(viewsResult)
    initialViews = views
  })

  await t.step('starts serve interaction', async () => {
    const serveStart = await client.callTool({
      name: 'interaction_start',
      arguments: { agentId, input: serveInput },
    }) as { structuredContent: { interactionId: string } }
    serveInteractionId = serveStart.structuredContent.interactionId
    expect(typeof serveInteractionId).toBe('string')
  })

  await t.step('awaits serve completion', async () => {
    const serveAwait = await client.callTool({
      name: 'interaction_await',
      arguments: { agentId, interactionId: serveInteractionId },
    }) as { structuredContent: { value: string } }
    expect(serveAwait.structuredContent.value).toBe(serveInput)
  })

  await t.step('rereads views for serve view', async () => {
    const reread = await client.callTool({
      name: 'interaction_views',
      arguments: {},
    }) as ToolResult<{ views: AgentView[] }>
    const { views: nextViews } = requireStructured(reread)
    expect(nextViews.length).toBeGreaterThan(initialViews.length)
    newView = nextViews.find((view) =>
      view.name === `test-agent-${serveInteractionId}`
    )
    expect(newView).toBeDefined()
    if (!newView) {
      throw new Error('expected serve view to be present')
    }
    expect(typeof newView.port).toBe('number')
  })

  await t.step('proxies forwarded requests to new view', async () => {
    if (!newView) {
      throw new Error('serve view missing before proxy verification')
    }
    const response = await app.fetch(
      new Request('http://supervisor.local/proxied'),
    )
    expect(response.status).toBe(200)
    const body = await response.json() as {
      status: string
      count: number
      interactionId: string
      agentId: string
      input: string
    }
    expect(body).toMatchObject({
      status: 'ok',
      interactionId: serveInteractionId,
      agentId,
      input: serveInput,
    })
    expect(body.count).toBe(0)
  })
})
