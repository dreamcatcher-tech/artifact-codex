import type { FacesHandlers } from '@artifact/mcp-faces'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import type { Face, FaceOptions } from '@artifact/shared'
import { HOST, toStructured } from '@artifact/shared'
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
    list_faces: async (): Promise<CallToolResult> => {
      log(
        'list_faces: kinds=%d live=%d',
        Object.keys(faceKinds).length,
        faces.size,
      )
      const face_kinds = Object.entries(faceKinds).map((
        [faceKindId, info],
      ) => ({
        faceKindId,
        title: info.title,
        description: info.description,
      }))
      const live_faces = await Promise.all(
        Array.from(faces.keys()).map(async (faceId) => {
          const faceKindId = faceIdToKind.get(faceId)
          if (!faceKindId) {
            throw new Error(
              `Internal error: missing faceKindId for face ${faceId}`,
            )
          }
          const info = faceKinds[faceKindId]
          if (!info) {
            throw new Error(`Internal error: ${faceId} unknown: ${faceKindId}`)
          }
          const status = await faces.get(faceId)!.status()
          const views = (status.views ?? []).map((v) => ({
            ...v,
            url: v.url ?? `http://${HOST}:${v.port}`,
          }))
          log('list_faces: live %s (%s)', faceId, faceKindId)
          return {
            faceId,
            faceKindId,
            title: info.title,
            description: info.description,
            views,
          }
        }),
      )
      return toStructured({ face_kinds, live_faces })
    },
    create_face: (
      { faceKindId, home, workspace, hostname, config },
    ): Promise<CallToolResult> => {
      if (!faceKinds[faceKindId]) {
        const kinds = Object.keys(faceKinds).join(', ')
        throw new Error(`Unknown kind: ${faceKindId} - use one of ${kinds}`)
      }
      const id = `face-${idCounter++}`
      const finalWorkspace = workspace ?? Deno.cwd()
      const finalHome = home ?? Deno.env.get('CODEX_HOME') ?? '/root/.codex'
      const finalConfig = config ?? {}
      const face = faceKinds[faceKindId].creator({
        home: finalHome,
        workspace: finalWorkspace,
        hostname,
        config: finalConfig,
      })
      faces.set(id, face)
      faceIdToKind.set(id, faceKindId)
      log('create_face: %s (%s)', id, faceKindId)
      return Promise.resolve(toStructured({ faceId: id }))
    },
    read_face: async ({ faceId }): Promise<CallToolResult> => {
      const face = faces.get(faceId)
      if (!face) {
        throw new Error(`Face not found: ${faceId}`)
      }
      const status = await face.status()
      log('read_face: %s status=%j', faceId, status)
      const views = (status.views ?? []).map((v) => ({
        ...v,
        url: v.url ?? `http://${HOST}:${v.port}`,
      }))
      return toStructured({ status, views })
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
