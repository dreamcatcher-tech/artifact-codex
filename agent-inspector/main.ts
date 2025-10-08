import { startAgent } from '@artifact/shared'
import { registerAgent } from './mcp.ts'
import deno from './deno.json' with { type: 'json' }

if (import.meta.main) {
  await startAgent(deno.name, deno.version, registerAgent)
}
