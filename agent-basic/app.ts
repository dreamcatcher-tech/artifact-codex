import Debug from 'debug'
import { createAgentWebServer } from '@artifact/web-server'
import { mount } from '@artifact/shared'
import type { FaceKindConfig } from '@artifact/web-server'
import type { CreateAgentWebServerOptions } from '@artifact/web-server'
import { type FaceKindId, readConfiguredFaceKindSpecs } from '@artifact/shared'
import { startFaceTest } from '@artifact/face-test'
import { startFaceInspector } from '@artifact/face-inspector'
import { startFaceCodex } from '@artifact/face-codex'
import { startFaceCmd } from '@artifact/face-cmd'

export function createApp() {
  const options = createAgentBasicOptions()
  return createAgentWebServer(options)
}

async function main(): Promise<void> {
  Debug.enable('@artifact/*')
  const log = Debug('@artifact/agent-basic:app')
  log('starting app: args=%o', Deno.args)

  await mount()

  const port = Number(Deno.env.get('PORT') ?? 8080)
  const hostname = '0.0.0.0'
  const { app } = createApp()
  log('serve: starting on %s:%d', hostname, port)
  Deno.serve({ port, hostname, reusePort: false }, app.fetch)
}

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

export function selectDefaultFaceKindId(
  faceKinds: readonly FaceKindConfig[],
): FaceKindConfig['id'] | undefined {
  return faceKinds.find((kind) => kind.id === 'codex')?.id ?? faceKinds[0]?.id
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

if (import.meta.main) {
  Debug.enable('@artifact/*')
  main()
}
