import { createAgentWebServer } from '@artifact/web-server'
import type { IdleShutdownOptions } from '@artifact/web-server'

import type { FaceKindConfig } from '@artifact/web-server'
import type { CreateAgentWebServerOptions } from '@artifact/web-server'
import { FACE_KIND_SPECS, type FaceKindId } from '@artifact/shared'
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
  const specs = FACE_KIND_SPECS.filter((spec) => FACE_KIND_CREATORS[spec.id])
  return specs.map((spec) => {
    const creator = FACE_KIND_CREATORS[spec.id]
    return {
      id: spec.id,
      title: spec.title,
      description: spec.description,
      create: creator,
    }
  })
}

export interface CreateAgentDevSuiteAppOptions {
  idleShutdown?: IdleShutdownOptions
}

export function createAgentDevSuiteOptions(
  options: CreateAgentDevSuiteAppOptions = {},
): CreateAgentWebServerOptions {
  const faceKinds = resolveFaceKinds()
  return {
    serverName: 'agent-dev-suite',
    serverVersion: '0.0.1',
    faceKinds,
    defaultFaceKindId: 'codex',
    debugNamespace: '@artifact/agent-dev-suite',
    idleShutdown: options.idleShutdown,
  }
}

export function createApp(options?: CreateAgentDevSuiteAppOptions) {
  const serverOptions = createAgentDevSuiteOptions(options)
  return createAgentWebServer(serverOptions)
}
