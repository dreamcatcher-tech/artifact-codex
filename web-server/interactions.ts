import type { InteractionsHandlers } from '@artifact/mcp-interactions'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { toStructured } from '@artifact/shared'
import { Face } from '@artifact/shared'
type FaceId = string
type InteractionId = string
type InteractionRecord = { faceId: FaceId; id: string }

export const createInteractions = (
  faces: Map<FaceId, Face>,
): InteractionsHandlers => {
  const interactions = new Map<InteractionId, InteractionRecord>()

  return {
    list_interactions: ({ faceId }): Promise<CallToolResult> => {
      const face = faces.get(faceId)
      if (!face) {
        throw new Error(`Face not found: ${faceId}`)
      }
      const interactionIds = Array.from(interactions.keys()).filter(
        (interactionId) => interactions.get(interactionId)?.faceId === faceId,
      )
      return Promise.resolve(toStructured({ interactionIds }))
    },
    create_interaction: ({ faceId, input }): Promise<CallToolResult> => {
      const face = faces.get(faceId)
      if (!face) {
        throw new Error(`Face not found: ${faceId}`)
      }
      const { id } = face.interaction(input)
      const interactionId = `f-${faceId}_i-${id}`
      interactions.set(interactionId, { faceId, id })
      return Promise.resolve(toStructured({ interactionId }))
    },
    read_interaction: async ({ interactionId }): Promise<CallToolResult> => {
      const interaction = interactions.get(interactionId)
      if (!interaction) {
        throw new Error(`Interaction not found: ${interactionId}`)
      }
      const face = faces.get(interaction.faceId)
      if (!face) {
        throw new Error(`Face not found: ${interaction.faceId}`)
      }
      const result = await face.waitFor(interaction.id)
      interactions.delete(interactionId)
      return toStructured(result)
    },
    destroy_interaction: async ({ interactionId }): Promise<CallToolResult> => {
      const interaction = interactions.get(interactionId)
      if (!interaction) {
        throw new Error(`Interaction not found: ${interactionId}`)
      }
      const face = faces.get(interaction.faceId)
      if (!face) {
        throw new Error(`Face not found: ${interaction.faceId}`)
      }
      await face.cancel(interaction.id)
      interactions.delete(interactionId)
      return toStructured({ ok: true })
    },
  }
}
