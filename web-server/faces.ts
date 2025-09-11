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

  return {
    list_faces: (): Promise<CallToolResult> => {
      return Promise.resolve(
        toStructured({ face_kinds: Object.keys(faceKinds) }),
      )
    },
    create_face: ({ faceKind }): Promise<CallToolResult> => {
      if (!faceKinds[faceKind]) {
        const kinds = Object.keys(faceKinds).join(', ')
        throw new Error(`Unknown face kind: ${faceKind} - use one of ${kinds}`)
      }
      const id = `face-${idCounter++}`
      const face = faceKinds[faceKind].creator({})
      faces.set(id, face)
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
      return toStructured({ deleted: true })
    },
  }
}
