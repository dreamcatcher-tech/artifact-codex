import { mount } from '@artifact/fly-nfs'
import { createSupervisor } from '@artifact/supervisor'
import { createIdleTrigger } from '@artifact/shared'
import Debug from 'debug'
const TIMEOUT_MS = 5 * 60 * 1000

if (import.meta.main) {
  const log = Debug('@artifact/host-basic')
  await mount(log, 'async')

  const abort = new AbortController()
  const idler = createIdleTrigger(abort, TIMEOUT_MS)
  const options = { serverName: 'host-basic', log, idler }
  const { app } = createSupervisor(options)

  const port = Number(Deno.env.get('PORT') ?? '8080')
  const flycastHostname = '0.0.0.0'
  log('starting host-basic server on :%d', port)
  const { signal } = abort
  Deno.serve({ port, hostname: flycastHostname, signal }, app.fetch)
}
