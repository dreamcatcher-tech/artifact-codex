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
    ({ agentId: _agentId, input }) => {
      if (input === 'error') {
        throw new Error('Test error')
      }
      const interactionId = String(interactionIdSequence++)
      if (input === 'reject') {
        interactions.set(interactionId, {
          error: new Error(input),
          state: 'pending',
        })
      } else {
        interactions.set(interactionId, {
          value: input,
          state: 'pending',
        })
      }
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
      const { value, error } = interaction
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
    ({ agentId: _agentId, interactionId }) => {
      const wasActive = interactions.delete(interactionId)
      interactions.set(interactionId, {
        ...interactions.get(interactionId)!,
        state: 'cancelled',
      })
      return toStructured({ cancelled: true, wasActive })
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
  server.registerResource(
    'views',
    'mcp://views',
    {
      title: 'Agent Views',
      description: 'Static view list for agent-test.',
      mimeType: 'application/json',
    },
    () => ({
      contents: [{
        uri: 'mcp://views',
        mimeType: 'application/json',
        text: JSON.stringify({ views: [] }, null, 2),
      }],
    }),
  )
}
