import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { INTERACTION_TOOLS, toStructured } from '@artifact/shared'

export function registerAgent(server: McpServer) {
  let interactionIdSequence = 0
  const interactions = new Map<
    string,
    {
      value?: string
      error?: Error
      state: 'pending' | 'completed' | 'rejected' | 'cancelled'
    }
  >()

  server.registerTool(
    'interaction_start',
    INTERACTION_TOOLS.interaction_start,
    (params) => {
      if (params.input === 'error') {
        throw new Error('Test error')
      }
      const interactionId = String(interactionIdSequence++)
      if (params.input === 'reject') {
        interactions.set(interactionId, {
          error: new Error(params.input),
          state: 'pending',
        })
      } else {
        interactions.set(interactionId, {
          value: params.input,
          state: 'pending',
        })
      }
      return toStructured({ interactionId })
    },
  )
  server.registerTool(
    'interaction_await',
    INTERACTION_TOOLS.interaction_await,
    (params) => {
      const interaction = interactions.get(params.interactionId)
      if (!interaction) {
        throw new Error(`unknown interaction id: ${params.interactionId}`)
      }
      const { value, error } = interaction
      if (!value) {
        throw new Error(`corrupted interaction id: ${params.interactionId}`)
      }
      if (error) {
        interactions.set(params.interactionId, {
          ...interaction,
          state: 'rejected',
        })
        throw error
      }
      interactions.set(params.interactionId, {
        ...interaction,
        state: 'completed',
      })

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
    'interaction_cancel',
    INTERACTION_TOOLS.interaction_cancel,
    (params) => {
      const wasActive = interactions.delete(params.interactionId)
      interactions.set(params.interactionId, {
        ...interactions.get(params.interactionId)!,
        state: 'cancelled',
      })
      return toStructured({ cancelled: true, wasActive })
    },
  )
  server.registerTool(
    'interaction_status',
    INTERACTION_TOOLS.interaction_status,
    (params) => {
      const interaction = interactions.get(params.interactionId)
      if (!interaction) {
        throw new Error(`unknown interaction id: ${params.interactionId}`)
      }
      return toStructured({
        state: interaction.state,
      })
    },
  )
}
