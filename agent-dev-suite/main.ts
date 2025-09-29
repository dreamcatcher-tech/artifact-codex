import Debug from 'debug'
import { createApp } from './app.ts'
import { mount } from '@artifact/fly-nfs'

if (import.meta.main) {
  const log = Debug('@artifact/agent-basic:main')
  await mount(log)
  const { app } = createApp()

  const port = Number(Deno.env.get('PORT') ?? '8080')
  const flycastHostname = '0.0.0.0'
  log('starting agent-basic server on :%d', port)
  Deno.serve({ port, hostname: flycastHostname }, app.fetch)
}
