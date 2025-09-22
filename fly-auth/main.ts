import Debug from 'debug'
import { createApp } from './src/app.ts'

Debug.enable('@artifact/fly-auth*')

const log = Debug('@artifact/fly-auth:main')
const app = createApp()

const port = Number(Deno.env.get('PORT') ?? '8080')

log('starting fly-auth server on :%d', port)

Deno.serve({ port }, (request, info) => app.fetch(request, info))
