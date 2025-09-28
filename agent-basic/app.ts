import { createAgentWebServer } from '@artifact/web-server'
import type { FaceKindConfig } from '@artifact/web-server'
import type { CreateAgentWebServerOptions } from '@artifact/web-server'
import { FACE_KIND_SPECS, type FaceKindId } from '@artifact/shared'
import { startFaceTest } from '@artifact/face-test'

export function createApp() {
  const options = createAgentBasicOptions()
  return createAgentWebServer(options)
}
const FACE_KIND_CREATORS: Partial<
  Record<FaceKindId, FaceKindConfig['create']>
> = {
  test: startFaceTest,
}

export function resolveFaceKinds(): FaceKindConfig[] {
  const specs = FACE_KIND_SPECS.filter((spec) => FACE_KIND_CREATORS[spec.id])
  return specs.map((spec) => {
    const creator = FACE_KIND_CREATORS[spec.id]!
    return {
      id: spec.id,
      title: spec.title,
      description: spec.description,
      create: creator,
    }
  })
}

export function selectDefaultFaceKindId(
  faceKinds: readonly FaceKindConfig[],
): FaceKindConfig['id'] | undefined {
  return faceKinds[0]?.id
}

function createAgentBasicOptions(): CreateAgentWebServerOptions {
  const faceKinds = resolveFaceKinds()
  const defaultFaceKindId = selectDefaultFaceKindId(faceKinds)
  return {
    serverName: 'agent-basic',
    serverVersion: '0.0.1',
    faceKinds,
    defaultFaceKindId,
    debugNamespace: '@artifact/agent-basic',
  }
}
