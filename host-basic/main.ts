import { mount } from '@artifact/fly-nfs'
import { createAgentWebServer } from '@artifact/web-server'
import type { FaceKindConfig } from '@artifact/web-server'
import type { AgentWebServerOptions } from '@artifact/web-server'
import { startFaceTest } from '@artifact/face-test'
import Debug from 'debug'

export function resolveFaceKinds(): FaceKindConfig[] {
  return [{
    id: 'test',
    title: 'Test Agent',
    description: 'A test agent',
    create: startFaceTest,
  }]
}

export function createHostBasicOptions(
  abort: AbortController,
): AgentWebServerOptions {
  const faceKinds = resolveFaceKinds()
  const log = Debug('@artifact/host-basic')
  const timeoutMs = 5 * 60 * 1000
  return {
    serverName: 'host-basic',
    serverVersion: '0.0.1',
    faceKinds,
    log: Debug('@artifact/host-basic'),
    timeoutMs,
    onIdle: () => {
      log('idle timeout reached (%dms); aborting server', timeoutMs)
      abort.abort()
    },
  }
}

if (import.meta.main) {
  const log = Debug('@artifact/host-basic:main')
  await mount(log, 'async')

  const abort = new AbortController()
  const options = createHostBasicOptions(abort)
  const { app } = createAgentWebServer(options)

  const port = Number(Deno.env.get('PORT') ?? '8080')
  const flycastHostname = '0.0.0.0'
  log('starting host-basic server on :%d', port)
  Deno.serve({ port, hostname: flycastHostname, ...abort }, app.fetch)
}
