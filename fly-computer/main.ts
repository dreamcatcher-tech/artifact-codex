import { ensureComputerStorageMounted } from './src/storage.ts'
import { createApp } from './src/app.ts'
import Debug from 'debug'

const log = Debug('@artifact/fly-computer:main')

const port = Number(Deno.env.get('PORT') ?? '8080')
Debug.enable('@artifact/*')
log('starting fly-computer on port=%d', port)
await ensureComputerStorageMounted()
log('storage mounted')
const handler = await createApp()
log('app ready; serving requests')
Deno.serve({ port }, handler)
