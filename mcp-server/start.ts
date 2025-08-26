import { createServer } from './web-server.ts'

const { app } = createServer()

const port = Number(Deno.env.get('PORT') ?? '8080')
const hostname = '0.0.0.0'

console.log(`[mcp-server] listening on http://${hostname}:${port}`)

Deno.serve({ hostname, port }, (req: Request) => app.fetch(req))

