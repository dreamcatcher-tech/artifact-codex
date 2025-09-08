import type { FacesHandlers } from '@artifact/mcp-faces'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { Face, FaceOptions, toError, toStructured } from '@artifact/shared'
import { startFaceTest } from '@artifact/face-test'

type FaceId = string

type FaceKind = {
  title: string
  description: string
  creator: (opts: FaceOptions) => Face
}

export const createFaces = (): FacesHandlers => {
  const faces = new Map<FaceId, Face>()

  const faceKinds: Record<string, FaceKind> = {
    test: {
      title: 'Test',
      description: 'A test face',
      creator: startFaceTest,
    },
  }

  let idCounter = 0

  return {
    list_faces: (): Promise<CallToolResult> => {
      console.log('list_faces')
      return Promise.resolve(
        toStructured({ face_kinds: Object.keys(faceKinds) }),
      )
    },
    create_face: ({ agentPath, faceKind }, extra): Promise<CallToolResult> => {
      console.log('create_face', { agentPath, faceKind, extra })
      if (!faceKinds[faceKind]) {
        const kinds = Object.keys(faceKinds).join(', ')
        throw new Error(`Unknown face kind: ${faceKind} - use one of ${kinds}`)
      }
      const id = `face-${idCounter++}`
      const face = faceKinds[faceKind].creator({})
      faces.set(id, face)
      return Promise.resolve(toStructured({ faceId: id }))
    },
    read_face: async (
      { agentPath, faceId },
      extra,
    ): Promise<CallToolResult> => {
      console.log('read_face', { agentPath, faceId, extra })

      const face = faces.get(faceId)
      if (!face) {
        throw new Error(`Face not found: ${faceId}`)
      }
      const status = await face.status()
      return toStructured({ status })
    },
    destroy_face: async (
      { agentPath, faceId },
      extra,
    ): Promise<CallToolResult> => {
      console.log('destroy_face', { agentPath, faceId, extra })
      const face = faces.get(faceId)
      if (!face) {
        throw new Error(`Face not found: ${faceId}`)
      }
      await face.close()
      faces.delete(faceId)
      return toStructured({ deleted: true })
    },
  }
}
