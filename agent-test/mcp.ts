import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { toStructured } from '@artifact/shared'
import { z } from 'zod'

const INTERACTION_TOOL_NAMES = {
  start: 'interaction_start',
  await: 'interaction_await',
  cancel: 'interaction_cancel',
  status: 'interaction_status',
}
const INTERACTION_TOOLS = {
  start: {
    title: 'Start Interaction',
    description: 'Queue a new interaction.',
    inputSchema: { input: z.string() },
    outputSchema: { interactionId: z.string() },
  },
  await: {
    title: 'Await Interaction',
    description:
      'Await the result of a previously queued interaction. Returns the echoed value or an error when the agent throws.',
    inputSchema: { interactionId: z.string() },
    outputSchema: { value: z.string() },
  },
  cancel: {
    title: 'Cancel Interaction',
    description: 'Cancel a pending interaction by id.',
    inputSchema: { interactionId: z.string() },
    outputSchema: { cancelled: z.boolean(), wasActive: z.boolean() },
  },
  status: {
    title: 'Get Interaction Status',
    description: 'Get the status of a previously queued interaction.',
    inputSchema: { interactionId: z.string() },
    outputSchema: { state: z.enum(['pending', 'completed', 'cancelled']) },
  },
}

export function registerAgent(server: McpServer) {
  let interactionIdSequence = 0
  const interactions = new Map<string, { value?: string; error?: Error }>()

  server.registerTool(
    INTERACTION_TOOL_NAMES.start,
    INTERACTION_TOOLS.start,
    (params) => {
      if (params.input === 'error') {
        throw new Error('Test error')
      }
      const interactionId = String(interactionIdSequence++)
      if (params.input === 'reject') {
        interactions.set(interactionId, { error: new Error(params.input) })
      } else {
        interactions.set(interactionId, { value: params.input })
      }
      return toStructured({ interactionId })
    },
  )
  server.registerTool(
    INTERACTION_TOOL_NAMES.await,
    INTERACTION_TOOLS.await,
    (params) => {
      const value = interactions.get(params.interactionId)?.value
      if (!value) {
        throw new Error(`unknown interaction id: ${params.interactionId}`)
      }
      if (interactions.get(params.interactionId)?.error) {
        throw interactions.get(params.interactionId)?.error
      }
      if (value === 'start view') {
        // TODO test view creation
        // return [{
        //   name: 'test-agent',
        //   protocol: 'http',
        //   port,
        //   url: `http://${hostname}:${port}`,
        // }]
        // const server = Deno.serve({ port: view.port }, (req) => {
        //   console.log('req', req)
        //   return new Response('ok')
        // })
      }
      return toStructured({ value })
    },
  )
  server.registerTool(
    INTERACTION_TOOL_NAMES.cancel,
    INTERACTION_TOOLS.cancel,
    (params) => {
      const wasActive = interactions.delete(params.interactionId)
      return toStructured({ cancelled: true, wasActive })
    },
  )
  server.registerTool(
    INTERACTION_TOOL_NAMES.status,
    INTERACTION_TOOLS.status,
    (params) => {
      return toStructured({
        state: interactions.get(params.interactionId) ? 'completed' : 'pending',
      })
    },
  )
}
