import type { InteractionsHandlers } from '@artifact/mcp-interactions'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { toStructured } from '@artifact/shared'
import type { Face } from '@artifact/shared'
import Debug from 'debug'
type FaceId = string
type InteractionId = string
type InteractionRecord = {
  faceId: FaceId
  input: string
}

export interface CreateInteractionsOptions {
  debugNamespace?: string
}

export const createInteractions = (
  faces: Map<FaceId, Face>,
  { debugNamespace }: CreateInteractionsOptions = {},
): InteractionsHandlers => {
  const log = Debug(debugNamespace ?? '@artifact/web-server:interactions')
  const interactions = new Map<InteractionId, InteractionRecord>()
  let interactionIdSequence = 0

  const allocateInteractionId = (): InteractionId => {
    const id = String(interactionIdSequence)
    interactionIdSequence += 1
    return id
  }

  return {
    list_interactions: ({ faceId }): Promise<CallToolResult> => {
      const face = faces.get(faceId)
      if (!face) {
        throw new Error(`Face not found: ${faceId}`)
      }
      const interactionIds = Array.from(interactions.keys()).filter(
        (interactionId) => interactions.get(interactionId)?.faceId === faceId,
      )
      log('list_interactions: face=%s count=%d', faceId, interactionIds.length)
      return Promise.resolve(toStructured({ interactionIds }))
    },
    create_interaction: ({ faceId, input }): Promise<CallToolResult> => {
      const face = faces.get(faceId)
      if (!face) {
        throw new Error(`Face not found: ${faceId}`)
      }
      const interactionId = allocateInteractionId()
      face.interaction(interactionId, input)
      interactions.set(interactionId, { faceId, input })
      log(
        'create_interaction: face=%s input=%j -> %s',
        faceId,
        input,
        interactionId,
      )
      return Promise.resolve(toStructured({ interactionId }))
    },
    read_interaction: async ({ interactionId }): Promise<CallToolResult> => {
      const interaction = interactions.get(interactionId)
      if (!interaction) {
        throw new Error(`Interaction not found: ${interactionId}`)
      }
      const face = faces.get(interaction.faceId)
      try {
        if (!face) {
          throw new Error(`Face not found: ${interaction.faceId}`)
        }
        const result = await face.awaitInteraction(interactionId)
        log(
          'read_interaction: %s -> result=%j (deleting)',
          interactionId,
          result,
        )
        return toStructured({ result, input: interaction.input })
      } finally {
        interactions.delete(interactionId)
      }
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
      await face.cancel(interactionId)
      interactions.delete(interactionId)
      log('destroy_interaction: %s (deleted)', interactionId)
      return toStructured({ ok: true })
    },
  }
}
