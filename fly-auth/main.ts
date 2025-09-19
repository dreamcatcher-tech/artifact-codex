import { createApp } from './src/app.ts'

const app = createApp()

const port = Number(Deno.env.get('PORT') ?? '8080')

Deno.serve({ port }, (request, info) => app.fetch(request, info))
