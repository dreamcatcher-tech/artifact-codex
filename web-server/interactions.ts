import type { InteractionsHandlers } from '@artifact/mcp-interactions'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { toError, toStructured } from '@artifact/shared'

export const interactionsImpls: InteractionsHandlers = {
  list_interactions: ({ agentPath }, extra): Promise<CallToolResult> => {
    console.log('list_interactions', { agentPath, extra })
    try {
      return Promise.resolve(toStructured({ interaction_kinds: [] }))
    } catch (err) {
      return Promise.resolve(toError(err))
    }
  },
  create_interaction: (
    { agentPath, interactionKind },
    extra,
  ): Promise<CallToolResult> => {
    console.log('create_interaction', { agentPath, interactionKind, extra })
    try {
      return Promise.resolve(
        toStructured({ interaction_id: `stub-${crypto.randomUUID()}` }),
      )
    } catch (err) {
      return Promise.resolve(toError(err))
    }
  },
  read_interaction: (
    { agentPath, interactionId },
    extra,
  ): Promise<CallToolResult> => {
    console.log('read_interaction', { agentPath, interactionId, extra })
    try {
      return Promise.resolve(
        toStructured({ exists: false, reason: 'Not implemented' }),
      )
    } catch (err) {
      return Promise.resolve(toError(err))
    }
  },
  destroy_interaction: (
    { agentPath, interactionId },
    extra,
  ): Promise<CallToolResult> => {
    console.log('destroy_interaction', { agentPath, interactionId, extra })
    try {
      return Promise.resolve(
        toStructured({ ok: false, reason: 'Not implemented' }),
      )
    } catch (err) {
      return Promise.resolve(toError(err))
    }
  },
}
