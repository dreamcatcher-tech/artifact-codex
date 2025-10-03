import Debug from 'debug'
import { createApp } from './app.ts'
import { mount } from '@artifact/fly-nfs'

if (import.meta.main) {
  const log = Debug('@artifact/agent-basic:main')
  await mount(log)
  const abortController = new AbortController()
  const timeoutMs = 5 * 60 * 1000
  const { app } = createApp({
    idleShutdown: {
      timeoutMs,
      onIdle: () => {
        log('idle timeout reached (%dms); aborting server', timeoutMs)
        abortController.abort()
      },
    },
  })

  const port = Number(Deno.env.get('PORT') ?? '8080')
  const hostname = '0.0.0.0'
  log('starting agent-basic server on :%d', port)
  Deno.serve({ port, hostname, ...abortController }, app.fetch)
}
