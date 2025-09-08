import type { FacesHandlers } from '@artifact/mcp-faces'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { toError, toStructured } from '@artifact/shared'

export const faces: FacesHandlers = {
  list_faces: ({ agentPath }, extra): Promise<CallToolResult> => {
    console.log('list_faces', { agentPath, extra })
    try {
      return Promise.resolve(toStructured({ face_kinds: [] }))
    } catch (err) {
      return Promise.resolve(toError(err))
    }
  },
  create_face: ({ agentPath, faceKind }, extra): Promise<CallToolResult> => {
    console.log('create_face', { agentPath, faceKind, extra })
    try {
      return Promise.resolve(
        toStructured({ face_id: `stub-${crypto.randomUUID()}` }),
      )
    } catch (err) {
      return Promise.resolve(toError(err))
    }
  },
  read_face: ({ agentPath, faceId }, extra): Promise<CallToolResult> => {
    console.log('read_face', { agentPath, faceId, extra })
    try {
      return Promise.resolve(
        toStructured({ exists: false, reason: 'Not implemented' }),
      )
    } catch (err) {
      return Promise.resolve(toError(err))
    }
  },
  destroy_face: ({ agentPath, faceId }, extra): Promise<CallToolResult> => {
    console.log('destroy_face', { agentPath, faceId, extra })
    try {
      return Promise.resolve(
        toStructured({ ok: false, reason: 'Not implemented' }),
      )
    } catch (err) {
      return Promise.resolve(toError(err))
    }
  },
}
