import { createServer } from './web-server.ts'

const machineId = Deno.env.get('FLY_MACHINE_ID')
if (!machineId) {
  throw new Error('FLY_MACHINE_ID is not set - are we running on fly?')
}

const { app } = createServer({ machineId })
const port = Number(Deno.env.get('PORT') ?? '8080')
const hostname = '0.0.0.0'

console.log(`[mcp-server] listening on http://${hostname}:${port}`)

Deno.serve({ hostname, port }, (req: Request) => app.fetch(req))
