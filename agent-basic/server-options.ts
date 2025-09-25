import type { FaceKindConfig } from '@artifact/web-server'
import type { CreateAgentWebServerOptions } from '@artifact/web-server'
import { type FaceKindId, readConfiguredFaceKindSpecs } from '@artifact/shared'
import { startFaceTest } from '@artifact/face-test'
import { startFaceInspector } from '@artifact/face-inspector'
import { startFaceCodex } from '@artifact/face-codex'
import { startFaceCmd } from '@artifact/face-cmd'

const FACE_KIND_CREATORS: Record<FaceKindId, FaceKindConfig['create']> = {
  test: startFaceTest,
  inspector: startFaceInspector,
  codex: startFaceCodex,
  cmd: startFaceCmd,
}

export function resolveFaceKinds(): FaceKindConfig[] {
  const specs = readConfiguredFaceKindSpecs()
  return specs.map((spec) => {
    const creator = FACE_KIND_CREATORS[spec.id]
    if (!creator) {
      throw new Error(`Configured face kind has no creator: ${spec.id}`)
    }
    return {
      id: spec.id,
      title: spec.title,
      description: spec.description,
      create: creator,
    }
  })
}

export function createAgentBasicOptions(): CreateAgentWebServerOptions {
  const faceKinds = resolveFaceKinds()
  const hasCodex = faceKinds.some((kind) => kind.id === 'codex')
  return {
    serverName: 'agent-basic',
    serverVersion: '0.0.1',
    faceKinds,
    defaultFaceKindId: hasCodex ? 'codex' : undefined,
    debugNamespace: '@artifact/agent-basic',
  }
}
