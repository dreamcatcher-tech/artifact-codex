import Debug from 'debug'
import { createApp } from './app.ts'

if (import.meta.main) {
  const log = Debug('@artifact/fly-auth:main')
  const app = createApp()
  const port = Number(Deno.env.get('PORT') ?? '8080')

  log('starting fly-auth server on :%d', port)
  Deno.serve({ port }, app.fetch)
}
