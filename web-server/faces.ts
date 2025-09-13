import type { FacesHandlers } from '@artifact/mcp-faces'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import type { Face, FaceOptions } from '@artifact/shared'
import { toStructured } from '@artifact/shared'
import { startFaceTest } from '@artifact/face-test'
import { startFaceInspector } from '@artifact/face-inspector'

type FaceKind = {
  title: string
  description: string
  creator: (opts: FaceOptions) => Face
}
type FaceId = string

export const createFaces = (faces: Map<FaceId, Face>): FacesHandlers => {
  const faceKinds: Record<string, FaceKind> = {
    test: {
      title: 'Test',
      description: 'A test face',
      creator: startFaceTest,
    },
    inspector: {
      title: 'Inspector',
      description: 'Runs MCP Inspector and reports ports',
      creator: startFaceInspector,
    },
  }

  let idCounter = 0
  const faceIdToKind = new Map<FaceId, string>()

  return {
    list_faces: (): Promise<CallToolResult> => {
      const face_kinds = Object.entries(faceKinds).map(([faceKind, info]) => ({
        faceKind,
        title: info.title,
        description: info.description,
      }))
      const live_faces = Array.from(faces.keys()).map((faceId) => {
        const faceKind = faceIdToKind.get(faceId)
        if (!faceKind) {
          throw new Error(`Internal error: missing faceKind for face ${faceId}`)
        }
        const info = faceKinds[faceKind]
        if (!info) {
          throw new Error(`Internal error: ${faceId} unknown: ${faceKind}`)
        }
        return {
          faceId,
          faceKind,
          title: info.title,
          description: info.description,
        }
      })
      return Promise.resolve(toStructured({ face_kinds, live_faces }))
    },
    create_face: ({ faceKind }): Promise<CallToolResult> => {
      if (!faceKinds[faceKind]) {
        const kinds = Object.keys(faceKinds).join(', ')
        throw new Error(`Unknown face kind: ${faceKind} - use one of ${kinds}`)
      }
      const id = `face-${idCounter++}`
      const face = faceKinds[faceKind].creator({})
      faces.set(id, face)
      faceIdToKind.set(id, faceKind)
      return Promise.resolve(toStructured({ faceId: id }))
    },
    read_face: async ({ faceId }): Promise<CallToolResult> => {
      const face = faces.get(faceId)
      if (!face) {
        throw new Error(`Face not found: ${faceId}`)
      }
      const status = await face.status()
      return toStructured({ status })
    },
    destroy_face: async ({ faceId }): Promise<CallToolResult> => {
      const face = faces.get(faceId)
      if (!face) {
        throw new Error(`Face not found: ${faceId}`)
      }
      await face.destroy()
      faces.delete(faceId)
      faceIdToKind.delete(faceId)
      return toStructured({ deleted: true })
    },
  }
}
