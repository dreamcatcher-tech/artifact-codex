#!/usr/bin/env -S deno run

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

export function handleNotification(raw: string): void {
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

  // Log the validated, parsed object
  console.log(parsed.data)
}

if (import.meta.main) {
  if (Deno.args.length !== 1) {
    console.error('Usage: codex-notify <NOTIFICATION_JSON>')
    Deno.exit(1)
  }
  const [payload] = Deno.args
  try {
    handleNotification(payload)
  } catch (err) {
    console.error(String(err instanceof Error ? err.message : err))
    Deno.exit(2)
  }
}
