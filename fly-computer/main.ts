import { createHandler } from './src/server.ts'

const port = Number(Deno.env.get('PORT') ?? '8080')
const handler = await createHandler()

Deno.serve({ port }, handler)
