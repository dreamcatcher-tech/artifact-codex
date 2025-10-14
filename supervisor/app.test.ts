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
  let firstServeInteractionId = ''
  const firstServeInput = 'serve /test-view'
  let firstServeView: AgentView | undefined
  let viewsAfterFirstServe: AgentView[] = []
  const secondServeInput = 'serve /test-view-2'
  let secondServeInteractionId = ''
  let secondServeView: AgentView | undefined

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
      arguments: { agentId, input: firstServeInput },
    }) as { structuredContent: { interactionId: string } }
    firstServeInteractionId = serveStart.structuredContent.interactionId
    expect(typeof firstServeInteractionId).toBe('string')
  })

  await t.step('awaits serve completion', async () => {
    const serveAwait = await client.callTool({
      name: 'interaction_await',
      arguments: { agentId, interactionId: firstServeInteractionId },
    }) as { structuredContent: { value: string } }
    expect(serveAwait.structuredContent.value).toBe(firstServeInput)
  })

  await t.step('rereads views for serve view', async () => {
    const reread = await client.callTool({
      name: 'interaction_views',
      arguments: {},
    }) as ToolResult<{ views: AgentView[] }>
    const { views: nextViews } = requireStructured(reread)
    expect(nextViews.length).toBeGreaterThan(initialViews.length)
    firstServeView = nextViews.find((view) =>
      view.name === `test-agent-${firstServeInteractionId}`
    )
    expect(firstServeView).toBeDefined()
    if (!firstServeView) {
      throw new Error('expected serve view to be present')
    }
    expect(typeof firstServeView.port).toBe('number')
    viewsAfterFirstServe = nextViews
  })

  await t.step('proxies default view to first serve view', async () => {
    if (!firstServeView) {
      throw new Error('serve view missing before default-view verification')
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
      interactionId: firstServeInteractionId,
      agentId,
      input: firstServeInput,
    })
    expect(body.count).toBe(0)
  })

  await t.step('starts second serve interaction', async () => {
    const serveStart = await client.callTool({
      name: 'interaction_start',
      arguments: { agentId, input: secondServeInput },
    }) as { structuredContent: { interactionId: string } }
    secondServeInteractionId = serveStart.structuredContent.interactionId
    expect(typeof secondServeInteractionId).toBe('string')
    expect(secondServeInteractionId).not.toBe(firstServeInteractionId)
  })

  await t.step('awaits second serve completion', async () => {
    const serveAwait = await client.callTool({
      name: 'interaction_await',
      arguments: { agentId, interactionId: secondServeInteractionId },
    }) as { structuredContent: { value: string } }
    expect(serveAwait.structuredContent.value).toBe(secondServeInput)
  })

  await t.step('rereads views for second serve view', async () => {
    const reread = await client.callTool({
      name: 'interaction_views',
      arguments: {},
    }) as ToolResult<{ views: AgentView[] }>
    const { views: nextViews } = requireStructured(reread)
    expect(nextViews.length).toBeGreaterThan(viewsAfterFirstServe.length)
    secondServeView = nextViews.find((view) =>
      view.name === `test-agent-${secondServeInteractionId}`
    )
    expect(secondServeView).toBeDefined()
    if (!secondServeView) {
      throw new Error('expected second serve view to be present')
    }
    expect(typeof secondServeView.port).toBe('number')
    if (!firstServeView) {
      throw new Error(
        'first serve view missing before second-view verification',
      )
    }
    expect(secondServeView.port).not.toBe(firstServeView.port)
  })

  await t.step('proxies forwarded requests to second serve view', async () => {
    if (!secondServeView) {
      throw new Error('second serve view missing before proxy verification')
    }
    const request = new Request('http://supervisor.local/proxied', {
      headers: { 'Fly-Forwarded-Port': String(secondServeView.port) },
    })
    const response = await app.fetch(request)
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
      interactionId: secondServeInteractionId,
      agentId,
      input: secondServeInput,
    })
    expect(body.count).toBe(0)
  })

  await t.step('default view continues to proxy first serve view', async () => {
    if (!firstServeView) {
      throw new Error('first serve view missing before final verification')
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
      interactionId: firstServeInteractionId,
      agentId,
      input: firstServeInput,
    })
    expect(body.count).toBe(1)
  })
})
