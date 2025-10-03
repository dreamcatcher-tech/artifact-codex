import { mount } from '@artifact/fly-nfs'
import { createAgentWebServer } from '@artifact/web-server'
import type { FaceKindConfig } from '@artifact/web-server'
import type { AgentWebServerOptions } from '@artifact/web-server'
import { startFaceTest } from '@artifact/face-test'
import Debug from 'debug'

function resolveFaceKinds(): FaceKindConfig[] {
  return [{
    id: 'test',
    title: 'Test Agent',
    description: 'A test agent',
    create: startFaceTest,
  }]
}

function createAgentBasicOptions(
  abort: AbortController,
): AgentWebServerOptions {
  const faceKinds = resolveFaceKinds()
  const log = Debug('@artifact/agent-basic')
  const timeoutMs = 5 * 60 * 1000
  return {
    serverName: 'agent-basic',
    serverVersion: '0.0.1',
    faceKinds,
    log: Debug('@artifact/agent-basic'),
    timeoutMs,
    onIdle: () => {
      log('idle timeout reached (%dms); aborting server', timeoutMs)
      abort.abort()
    },
  }
}

if (import.meta.main) {
  const log = Debug('@artifact/agent-basic:main')
  await mount(log, 'async')

  const abort = new AbortController()
  const options = createAgentBasicOptions(abort)
  const { app } = createAgentWebServer(options)

  const port = Number(Deno.env.get('PORT') ?? '8080')
  const flycastHostname = '0.0.0.0'
  log('starting agent-basic server on :%d', port)
  Deno.serve({ port, hostname: flycastHostname, ...abort }, app.fetch)
}
