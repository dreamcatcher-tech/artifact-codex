import Debug from 'debug'
import { createApp } from './app.ts'
import { mount } from '@artifact/fly-nfs'

if (import.meta.main) {
  const log = Debug('@artifact/fly-router:main')
  await mount(log, 'sync')
  const app = createApp()
  const port = Number(Deno.env.get('PORT') ?? '8080')

  log('starting fly-auth server on :%d', port)
  const fly6pnHostname = '[::]' // in fly, grabs the ipv4 address too

  Deno.serve({ port, hostname: fly6pnHostname }, app.fetch)
}
