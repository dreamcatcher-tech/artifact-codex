#!/usr/bin/env -S deno run -A
import { join } from '@std/path'

/**
```json
{
  "type": "agent-turn-complete",
  "turn-id": "12345",
  "input-messages": ["Rename `foo` to `bar` and update the callsites."],
  "last-assistant-message": "Rename complete and verified `cargo build` succeeds."
}
```
 */

import { z } from 'zod'

export const AgentTurnCompleteSchema = z.object({
  type: z.literal('agent-turn-complete'),
  'turn-id': z.string(),
  'input-messages': z.array(z.string()),
  'last-assistant-message': z.string(),
})

export type AgentTurnComplete = z.infer<typeof AgentTurnCompleteSchema>

export async function handleNotification(
  raw: string,
  opts: { dir: string },
): Promise<void> {
  let data: unknown
  try {
    data = JSON.parse(raw)
  } catch (e) {
    throw new Error(`Invalid JSON: ${(e as Error).message}`)
  }

  const parsed = AgentTurnCompleteSchema.safeParse(data)
  if (!parsed.success) {
    throw new Error(`Invalid notification: ${parsed.error.message}`)
  }

  const outPath = join(opts.dir, 'notify.json')

  const payload = new TextEncoder().encode(JSON.stringify(parsed.data))
  let file: Deno.FsFile | undefined
  try {
    file = Deno.openSync(outPath, { createNew: true, write: true })
    await file.write(payload)
  } catch (err) {
    if (err instanceof Deno.errors.AlreadyExists) {
      throw new Error(`notify.json already exists at ${outPath}`)
    }
    throw err
  } finally {
    try {
      file?.close()
    } catch {
      // ignore
    }
  }
}

if (import.meta.main) {
  let payload: string | undefined
  let dir: string | undefined
  for (let i = 0; i < Deno.args.length; i++) {
    const a = Deno.args[i]
    if (a === '--dir' || a === '-d') {
      dir = Deno.args[++i]
    } else if (a.startsWith('--dir=')) {
      dir = a.slice('--dir='.length)
    } else if (!payload) {
      payload = a
    } else {
      // Ignore unknown extras for forward-compat
    }
  }
  if (!payload || !dir) {
    console.error('Usage: codex-notify  [--dir <PATH>] <NOTIFICATION_JSON>')
    Deno.exit(1)
  }
  try {
    await handleNotification(payload, { dir })
  } catch (err) {
    console.error(String(err instanceof Error ? err.message : err))
    Deno.exit(2)
  }
}
