#!/usr/bin/env -S deno run -A
import { startAgentInspector } from './main.ts'
import { HOST } from '@artifact/shared'
import { dirname, fromFileUrl } from '@std/path'

async function main() {
  const workspace = dirname(dirname(fromFileUrl(import.meta.url)))
  console.log('Workspace:', workspace)

  const home = await Deno.makeTempDir({ prefix: 'agent-inspector-' })
  console.log('Home:', home)

  const face = startAgentInspector({ workspace, home })

  console.log('Starting Face Inspector in dev mode...')
  const s = await face.status() // resolves when loading completes

  for (const v of s.views || []) {
    console.log(`- ${v.name}: ${v.protocol}://${HOST}:${v.port}`)
  }

  console.log('Face Inspector ready. Press Ctrl+C to exit.')
}

main().catch((err) => {
  console.error(err)
  Deno.exit(1)
})
