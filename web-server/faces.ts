import type { FacesHandlers } from '@artifact/mcp-faces'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import type { Face, FaceOptions } from '@artifact/shared'
import { HOST, toStructured } from '@artifact/shared'
import { join } from '@std/path'
import { startFaceTest } from '@artifact/face-test'
import { startFaceInspector } from '@artifact/face-inspector'
import { startFaceCodex } from '@artifact/face-codex'
import { startFaceCmd } from '@artifact/face-cmd'
import { createVirtualFace } from './face-self.ts'

import Debug from 'debug'

type FaceKind = {
  title: string
  description: string
  creator: (opts: FaceOptions) => Face
}
type FaceId = string

let faceIdSequence = 0

function allocateFaceId(): FaceId {
  const id = `face-${faceIdSequence}`
  faceIdSequence += 1
  return id
}

const SELF_KIND_ID = '@self system'

const faceKinds: Record<string, FaceKind> = {
  [SELF_KIND_ID]: {
    title: '@self system',
    description:
      'the read only face that shows the process that the face management server runs on.  THIS CANNOT BE INSTANTIATED, DESTROYED, OR INTERACTED WITH',
    creator: () => {
      throw new Error('@self system face cannot be instantiated')
    },
  },
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
  cmd: {
    title: 'Command',
    description: 'Runs an arbitrary shell command in tmux with a ttyd view',
    creator: startFaceCmd,
  },
}

export const createFaces = (faces: Map<FaceId, Face>): FacesHandlers => {
  const log = Debug('@artifact/web-server:faces')

  const faceIdToKind = new Map<FaceId, string>()

  const virtualFace = createVirtualFace()
  const virtualFaceId = allocateFaceId()
  faces.set(virtualFaceId, virtualFace)
  faceIdToKind.set(virtualFaceId, SELF_KIND_ID)

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
      if (faceKindId === SELF_KIND_ID) {
        throw new Error('@self system face cannot be instantiated')
      }
      if (!faceKinds[faceKindId]) {
        const kinds = Object.keys(faceKinds).join(', ')
        throw new Error(`Unknown kind: ${faceKindId} - use one of ${kinds}`)
      }
      const id = allocateFaceId()
      const finalWorkspace = workspace ?? Deno.cwd()
      const finalHome = resolveFaceHome(home, faceKindId)
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
      if (faceId === virtualFaceId) {
        throw new Error('@self system face cannot be destroyed')
      }
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

function resolveFaceHome(home: string | undefined, faceKindId: string) {
  if (home && home !== '') {
    return validateHome(home)
  }
  const envHome = Deno.env.get('CODEX_HOME')
  if (envHome && envHome !== '') {
    return validateHome(envHome)
  }
  return defaultFaceHome(faceKindId)
}

function defaultFaceHome(faceKindId: string) {
  const base = join(Deno.cwd(), '.faces', faceKindId)
  return join(base, crypto.randomUUID())
}

function validateHome(path: string) {
  if (path.startsWith('~')) {
    throw new Error('home paths under ~ are not permitted')
  }
  return path
}
