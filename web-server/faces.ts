import type { FacesHandlers } from '@artifact/mcp-faces'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import type { Face, FaceOptions } from '@artifact/shared'
import { toStructured } from '@artifact/shared'
import { startFaceTest } from '@artifact/face-test'
import { startFaceInspector } from '@artifact/face-inspector'
import { startFaceCodex } from '@artifact/face-codex'
import Debug from 'debug'

type FaceKind = {
  title: string
  description: string
  creator: (opts: FaceOptions) => Face
}
type FaceId = string

export const createFaces = (faces: Map<FaceId, Face>): FacesHandlers => {
  const log = Debug('@artifact/web-server:faces')
  const faceKinds: Record<string, FaceKind> = {
    test: {
      title: 'Test',
      description: 'A test face',
      creator: startFaceTest,
    },
    inspector: {
      title: 'Inspector',
      description: 'MCP Inspector that presents a web server UI',
      creator: startFaceInspector,
    },
    codex: {
      title: 'Codex',
      description: 'Runs a Codex session and presents it in a ttyd ui',
      creator: startFaceCodex,
    },
  }

  let idCounter = 0
  const faceIdToKind = new Map<FaceId, string>()

  return {
    list_faces: (): Promise<CallToolResult> => {
      log(
        'list_faces: kinds=%d live=%d',
        Object.keys(faceKinds).length,
        faces.size,
      )
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
        log('list_faces: live %s (%s)', faceId, faceKind)
        return {
          faceId,
          faceKind,
          title: info.title,
          description: info.description,
        }
      })
      return Promise.resolve(toStructured({ face_kinds, live_faces }))
    },
    create_face: (
      { faceKind, home, workspace, config },
    ): Promise<CallToolResult> => {
      if (!faceKinds[faceKind]) {
        const kinds = Object.keys(faceKinds).join(', ')
        throw new Error(`Unknown face kind: ${faceKind} - use one of ${kinds}`)
      }
      const id = `face-${idCounter++}`
      const finalWorkspace = workspace ?? Deno.cwd()
      const finalHome = home ?? Deno.env.get('CODEX_HOME') ?? '/root/.codex'
      const finalConfig = config ?? {}
      const face = faceKinds[faceKind].creator({
        home: finalHome,
        workspace: finalWorkspace,
        config: finalConfig,
      })
      faces.set(id, face)
      faceIdToKind.set(id, faceKind)
      log('create_face: %s (%s)', id, faceKind)
      return Promise.resolve(toStructured({ faceId: id }))
    },
    read_face: async ({ faceId }): Promise<CallToolResult> => {
      const face = faces.get(faceId)
      if (!face) {
        throw new Error(`Face not found: ${faceId}`)
      }
      const status = await face.status()
      log('read_face: %s status=%j', faceId, status)
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
      log('destroy_face: %s', faceId)
      return toStructured({ deleted: true })
    },
  }
}
