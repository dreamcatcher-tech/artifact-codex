import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import {
  AGENT_WORKSPACE,
  type AgentView,
  HOST,
  INTERACTION_TOOLS,
  type InteractionStatus,
  toStructured,
} from '@artifact/shared'
import { join } from '@std/path'

const DEFAULT_TTYD_PORT = 10000

type InteractionRecord = {
  state: InteractionStatus['state']
  promise: Promise<string>
  result?: string
  error?: Error
}

export async function register(server: McpServer, agentDir: string) {
  const workspaceDir = join(agentDir, AGENT_WORKSPACE)
  const views: AgentView[] = [{
    name: 'terminal',
    port: DEFAULT_TTYD_PORT,
    protocol: 'http',
    url: `http://${HOST}:${DEFAULT_TTYD_PORT}`,
  }]

  const interactions = new Map<string, InteractionRecord>()
  let interactionSeq = 0

  const resolveInteraction = (
    id: string,
  ): InteractionRecord | undefined => interactions.get(id)

  const startInteraction = (
    _input: string,
  ): { interactionId: string; record: InteractionRecord } => {
    const interactionId = String(interactionSeq++)
    const record: InteractionRecord = {
      state: 'pending',
      promise: Promise.resolve(''),
    }
    record.promise = (async () => {
      try {
        if (record.state === 'cancelled') {
          throw new Error(`interaction cancelled: ${interactionId}`)
        }
        record.state = 'completed'
        record.result = 'ok'
        return 'ok'
      } catch (error) {
        record.state = 'completed'
        const err = error instanceof Error ? error : new Error(String(error))
        record.error = err
        throw err
      }
    })()
    interactions.set(interactionId, record)
    return { interactionId, record }
  }

  const awaitInteraction = async (
    interactionId: string,
  ): Promise<CallToolResult> => {
    const record = resolveInteraction(interactionId)
    if (!record) {
      throw new Error(`unknown interaction id: ${interactionId}`)
    }
    if (record.state === 'cancelled') {
      interactions.delete(interactionId)
      throw record.error ?? new Error(`interaction cancelled: ${interactionId}`)
    }
    try {
      const value = await record.promise
      interactions.delete(interactionId)
      return toStructured({ value })
    } catch (error) {
      interactions.delete(interactionId)
      throw error
    }
  }

  const cancelInteraction = (interactionId: string): CallToolResult => {
    const record = resolveInteraction(interactionId)
    if (!record) {
      return toStructured({ cancelled: false, wasActive: false })
    }
    record.state = 'cancelled'
    if (!record.error) {
      record.error = new Error(`interaction cancelled: ${interactionId}`)
    }
    interactions.set(interactionId, record)
    return toStructured({ cancelled: true, wasActive: true })
  }

  const statusInteraction = (interactionId: string): CallToolResult => {
    const record = resolveInteraction(interactionId)
    const state = record?.state ?? 'pending'
    return toStructured({ state })
  }

  server.registerTool(
    'interaction_start',
    INTERACTION_TOOLS.interaction_start,
    ({ input }) => {
      const { interactionId } = startInteraction(String(input ?? ''))
      return toStructured({ interactionId })
    },
  )

  server.registerTool(
    'interaction_await',
    INTERACTION_TOOLS.interaction_await,
    ({ interactionId }) => awaitInteraction(interactionId),
  )

  server.registerTool(
    'interaction_cancel',
    INTERACTION_TOOLS.interaction_cancel,
    ({ interactionId }) => cancelInteraction(interactionId),
  )

  server.registerTool(
    'interaction_status',
    INTERACTION_TOOLS.interaction_status,
    ({ interactionId }) => statusInteraction(interactionId),
  )

  server.registerTool(
    'interaction_views',
    INTERACTION_TOOLS.interaction_views,
    () => toStructured({ views }),
  )
}
