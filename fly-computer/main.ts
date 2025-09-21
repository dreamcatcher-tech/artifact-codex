import { ensureComputerStorageMounted } from './src/storage.ts'
import { createHandler } from './src/server.ts'

const port = Number(Deno.env.get('PORT') ?? '8080')
await ensureComputerStorageMounted()
const handler = await createHandler()

Deno.serve({ port }, handler)
