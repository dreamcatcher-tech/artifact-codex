import Debug from 'debug'
import { createAgentWebServer } from '@artifact/web-server'
import { mount } from '@artifact/fly-nfs'
import type { FaceKindConfig } from '@artifact/web-server'
import type { CreateAgentWebServerOptions } from '@artifact/web-server'
import { type FaceKindId, readConfiguredFaceKindSpecs } from '@artifact/shared'
import { startFaceTest } from '@artifact/face-test'

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

const FACE_KIND_CREATORS: Partial<
  Record<FaceKindId, FaceKindConfig['create']>
> = {
  test: startFaceTest,
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

if (import.meta.main) {
  Debug.enable('@artifact/*')
  main()
}
