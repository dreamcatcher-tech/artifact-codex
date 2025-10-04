import type { FacesHandlers } from '@artifact/mcp-faces'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import type { Agent, AgentKindId, AgentOptions } from '@artifact/shared'
import { HOST, toStructured } from '@artifact/shared'
import { join } from '@std/path'
import type { Debugger } from 'debug'

import { createVirtualFace } from './face-self.ts'

type FaceId = string

const SELF_KIND_ID = '@self system'

export type FaceKindConfig = {
  id: AgentKindId
  title: string
  description: string
  create: (opts: AgentOptions) => Agent
}

type FaceKindEntry = {
  title: string
  description: string
  create?: (opts: AgentOptions) => Agent
}

interface CreateFacesOptions {
  faceKinds: readonly FaceKindConfig[]
  log: Debugger
}

export const createFaces = (
  facesStore: Map<FaceId, Agent>,
  { faceKinds, log }: CreateFacesOptions,
): FacesHandlers => {
  log = log.extend('faces')
  const faceIdToKind = new Map<FaceId, string>()
  let faceIdSequence = 0

  const allocateFaceId = (): FaceId => {
    const id = `face-${faceIdSequence}`
    faceIdSequence += 1
    return id
  }

  const knownKinds = new Map<string, FaceKindEntry>()
  knownKinds.set(SELF_KIND_ID, {
    title: '@self system',
    description:
      'the read only face that shows the process that the face management server runs on.  THIS CANNOT BE INSTANTIATED, DESTROYED, OR INTERACTED WITH',
  })

  for (const spec of faceKinds) {
    if (knownKinds.has(spec.id)) {
      throw new Error(`Duplicate face kind: ${spec.id}`)
    }
    knownKinds.set(spec.id, {
      title: spec.title,
      description: spec.description,
      create: spec.create,
    })
  }

  const virtualFace = createVirtualFace()
  const virtualFaceId = allocateFaceId()
  facesStore.set(virtualFaceId, virtualFace)
  faceIdToKind.set(virtualFaceId, SELF_KIND_ID)

  const listFaceKinds = () =>
    Array.from(knownKinds.entries()).map(([faceKindId, info]) => ({
      faceKindId,
      title: info.title,
      description: info.description,
    }))

  const listLiveFaces = async () => {
    return await Promise.all(
      Array.from(facesStore.keys()).map(async (faceId) => {
        const faceKindId = faceIdToKind.get(faceId)
        if (!faceKindId) {
          throw new Error(
            `Internal error: missing faceKindId for face ${faceId}`,
          )
        }
        const info = knownKinds.get(faceKindId)
        if (!info) {
          throw new Error(`Internal error: ${faceId} unknown: ${faceKindId}`)
        }
        const status = await facesStore.get(faceId)!.status()
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
  }

  return {
    list_faces: async (): Promise<CallToolResult> => {
      log('list_faces: kinds=%d live=%d', knownKinds.size, facesStore.size)
      const face_kinds = listFaceKinds()
      const live_faces = await listLiveFaces()
      return toStructured({ face_kinds, live_faces })
    },
    create_face: (
      { faceKindId, home, workspace, hostname, config },
    ): Promise<CallToolResult> => {
      if (faceKindId === SELF_KIND_ID) {
        throw new Error('@self system face cannot be instantiated')
      }
      const info = knownKinds.get(faceKindId)
      if (!info || !info.create) {
        const kinds = Array.from(faceKinds).map((k) => k.id).join(', ')
        throw new Error(`Unknown kind: ${faceKindId} - use one of ${kinds}`)
      }
      const id = allocateFaceId()
      const finalWorkspace = workspace ?? Deno.cwd()
      const finalHome = resolveFaceHome(home, faceKindId)
      const finalConfig = config ?? {}
      const face = info.create({
        home: finalHome,
        workspace: finalWorkspace,
        hostname,
        config: finalConfig,
      })
      facesStore.set(id, face)
      faceIdToKind.set(id, faceKindId)
      log('create_face: %s (%s)', id, faceKindId)
      return Promise.resolve(toStructured({ faceId: id }))
    },
    read_face: async ({ faceId }): Promise<CallToolResult> => {
      const face = facesStore.get(faceId)
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
      const face = facesStore.get(faceId)
      if (!face) {
        throw new Error(`Face not found: ${faceId}`)
      }
      await face.destroy()
      facesStore.delete(faceId)
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
