import { createApp } from './app.ts'

const app = createApp()

const port = Number(Deno.env.get('PORT') ?? '8080')
console.log(`proxy listening on http://127.0.0.1:${port}`)

Deno.serve({ port }, (req) => app.fetch(req))

