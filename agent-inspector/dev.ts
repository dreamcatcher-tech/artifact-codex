#!/usr/bin/env -S deno run -A
import { startAgent, type AgentOptions } from '@artifact/shared'
import { dirname, fromFileUrl } from '@std/path'
import { registerAgent } from './mcp.ts'
import deno from './deno.json' with { type: 'json' }

async function main() {
  const workspace = dirname(dirname(fromFileUrl(import.meta.url)))
  const home = await Deno.makeTempDir({ prefix: 'agent-inspector-' })

  console.log(`Workspace: ${workspace}`)
  console.log(`Home: ${home}`)
  console.log('Launching agent-inspector (tmux + inspector UI)...')

  const options: AgentOptions = { workspace, home }
  ;(globalThis as { options?: AgentOptions }).options = options

  await startAgent(deno.name, deno.version, registerAgent)
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : error)
  Deno.exit(1)
})
