import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import {
  type AgentView,
  HOST,
  INTERACTION_TOOLS,
  toStructured,
} from '@artifact/shared'

type InteractionRecord = {
  value?: string
  error?: Error
  state: 'pending' | 'completed' | 'rejected' | 'cancelled'
  agentId: string
  input: string
}

type ServeSession = {
  controller: AbortController
  server: Deno.HttpServer<Deno.NetAddr>
  view: AgentView
}

export function registerAgent(server: McpServer) {
  let interactionIdSequence = 0
  const interactions = new Map<
    string,
    InteractionRecord
  >()
  let views: AgentView[] = []
  const serveSessions = new Map<string, ServeSession>()

  const cleanupServeSession = (interactionId: string) => {
    const session = serveSessions.get(interactionId)
    if (!session) {
      return false
    }
    serveSessions.delete(interactionId)
    const nextViews = views.filter((view) => view !== session.view)
    if (nextViews.length !== views.length) {
      views = nextViews
    }
    return true
  }

  const stopServeSession = async (interactionId: string): Promise<boolean> => {
    const session = serveSessions.get(interactionId)
    if (!session) {
      return false
    }
    session.controller.abort()
    try {
      await session.server.finished
    } catch {
      // ignore finish wait failures
    }
    cleanupServeSession(interactionId)
    return true
  }

  const startServeSession = (
    interactionId: string,
    agentId: string,
    input: string,
  ) => {
    const viewName = `test-agent-${interactionId}`
    const controller = new AbortController()
    let count = 0

    const server = Deno.serve(
      { hostname: HOST, port: 0, signal: controller.signal },
      () => {
        const info = {
          status: 'ok',
          count: count++,
          interactionId,
          agentId,
          input,
        }
        const body = JSON.stringify(info, null, 2)
        console.log('serve session response', info)
        return new Response(body, {
          headers: { 'content-type': 'application/json; charset=utf-8' },
        })
      },
    )

    const view: AgentView = {
      name: viewName,
      protocol: 'http',
      port: server.addr.port,
      url: `http://${HOST}:${server.addr.port}`,
    }
    serveSessions.set(interactionId, { controller, server, view })
    views = [...views, view]
    server.finished.then(() => cleanupServeSession(interactionId))
  }

  server.registerTool(
    'interaction_start',
    INTERACTION_TOOLS.interaction_start,
    async ({ agentId, input }) => {
      if (input === 'error') {
        throw new Error('Test error')
      }

      const interactionId = String(interactionIdSequence++)
      const record: InteractionRecord = { input, agentId, state: 'pending' }
      record.value = input

      const trimmed = input.trim()
      const isServe = (trimmed + ' ').startsWith('serve ')
      const isUnserve = trimmed === 'unserve'

      if (input === 'reject') {
        record.error = new Error(input)
      } else if (isServe) {
        startServeSession(interactionId, agentId, input)
      } else if (isUnserve) {
        const targetId = trimmed.slice('unserve'.length).trim()
        if (!targetId) {
          throw new Error('requires a target interaction id')
        }
        const stopped = await stopServeSession(targetId)
        if (!stopped) {
          throw new Error(`no active serve interaction: ${targetId}`)
        }
      }
      interactions.set(interactionId, record)
      return toStructured({ interactionId })
    },
  )
  server.registerTool(
    'interaction_await',
    INTERACTION_TOOLS.interaction_await,
    ({ agentId: _agentId, interactionId }) => {
      const interaction = interactions.get(interactionId)
      if (!interaction) {
        throw new Error(`unknown interaction id: ${interactionId}`)
      }
      const { value, error, state } = interaction
      if (state === 'cancelled') {
        throw new Error(`interaction cancelled: ${interactionId}`)
      }
      if (!value) {
        throw new Error(`corrupted interaction id: ${interactionId}`)
      }
      if (error) {
        interactions.set(interactionId, {
          ...interaction,
          state: 'rejected',
        })
        throw error
      }
      interactions.set(interactionId, {
        ...interaction,
        state: 'completed',
      })

      return toStructured({ value })
    },
  )
  server.registerTool(
    'interaction_cancel',
    INTERACTION_TOOLS.interaction_cancel,
    async ({ agentId: _agentId, interactionId }) => {
      const interaction = interactions.get(interactionId)
      if (!interaction) {
        return toStructured({ cancelled: false, wasActive: false })
      }
      await stopServeSession(interactionId)
      interactions.set(interactionId, {
        ...interaction,
        state: 'cancelled',
      })
      return toStructured({ cancelled: true, wasActive: true })
    },
  )
  server.registerTool(
    'interaction_status',
    INTERACTION_TOOLS.interaction_status,
    ({ agentId: _agentId, interactionId }) => {
      const interaction = interactions.get(interactionId)
      if (!interaction) {
        throw new Error(`unknown interaction id: ${interactionId}`)
      }
      return toStructured({
        state: interaction.state,
      })
    },
  )
  server.registerTool(
    'interaction_views',
    INTERACTION_TOOLS.interaction_views,
    () => toStructured({ views }),
  )
}
