import { mount } from '@artifact/fly-nfs'
import { createApp } from '@artifact/supervisor'
import { createIdleTrigger } from '@artifact/shared'
import Debug from 'debug'
const TIMEOUT_MS = 60 * 60 * 1000 // 1 hour

if (import.meta.main) {
  const log = Debug('@artifact/supervisor:main')
  await mount(log, 'async')

  const abort = new AbortController()
  const idler = createIdleTrigger(abort, TIMEOUT_MS)

  const { app, close } = createApp(idler)
  abort.signal.onabort = close

  const port = Number(Deno.env.get('PORT') ?? '8080')
  const flycastHostname = '0.0.0.0'
  const fly6pnHostname = '[::]' // in fly, grabs the ipv4 address too

  log('starting supervisor server on :%d', port)
  const { signal } = abort

  const reusePort = true
  Deno.serve({ port, hostname: flycastHostname, signal, reusePort }, app.fetch)
  Deno.serve({ port, hostname: fly6pnHostname, signal, reusePort }, app.fetch)
}
