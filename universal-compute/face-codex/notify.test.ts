import { expect } from '@std/expect'
import { handleNotification } from './notify.ts'

Deno.test('logs parsed notification object', () => {
  const input =
    '{"type":"agent-turn-complete","turn-id":"123","input-messages":["Rename `foo` to `bar` and update the callsites."],"last-assistant-message":"Rename complete and verified `cargo build` succeeds."}'
  const seen: unknown[] = []
  const origLog = console.log
  try {
    console.log = (...args: unknown[]) => {
      seen.push(...args)
    }
    handleNotification(input)
  } finally {
    console.log = origLog
  }
  expect(seen).toHaveLength(1)
  const expected = JSON.parse(input)
  expect(seen[0]).toEqual(expected)
})

Deno.test('throws on invalid payload (missing fields)', () => {
  const bad = '{"type":"agent-turn-complete","turn-id":"x"}'
  expect(() => handleNotification(bad)).toThrow()
})

Deno.test('throws on non-JSON input', () => {
  const bad = 'not-json'
  expect(() => handleNotification(bad)).toThrow()
})
