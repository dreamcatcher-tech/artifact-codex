import { expect } from '@std/expect'
import { handleNotification } from './notify.ts'
import { join } from '@std/path'

Deno.test('writes notification JSON in specified dir', async () => {
  const dir = await Deno.makeTempDir()
  const input =
    '{"type":"agent-turn-complete","turn-id":"123","input-messages":["Rename `foo` to `bar` and update the callsites."],"last-assistant-message":"Rename complete and verified `cargo build` succeeds."}'
  await handleNotification(input, { dir })
  const file = join(dir, 'notify.json')
  const content = await Deno.readTextFile(file)
  expect(JSON.parse(content)).toEqual(JSON.parse(input))
})

Deno.test('accepts null last assistant message', async () => {
  const dir = await Deno.makeTempDir()
  const input =
    '{"type":"agent-turn-complete","turn-id":"abc","input-messages":[],"last-assistant-message":null}'
  await handleNotification(input, { dir })
  const file = join(dir, 'notify.json')
  const content = await Deno.readTextFile(file)
  expect(JSON.parse(content)).toEqual({
    type: 'agent-turn-complete',
    'turn-id': 'abc',
    'input-messages': [],
    'last-assistant-message': null,
  })
})

Deno.test('accepts missing last assistant message', async () => {
  const dir = await Deno.makeTempDir()
  const input =
    '{"type":"agent-turn-complete","turn-id":"def","input-messages":["foo"]}'
  await handleNotification(input, { dir })
  const file = join(dir, 'notify.json')
  const content = await Deno.readTextFile(file)
  expect(JSON.parse(content)).toEqual({
    type: 'agent-turn-complete',
    'turn-id': 'def',
    'input-messages': ['foo'],
    'last-assistant-message': null,
  })
})

Deno.test('throws on invalid payload (missing fields)', async () => {
  const dir = await Deno.makeTempDir()
  const bad = '{"type":"agent-turn-complete","turn-id":"x"}'
  await expect(handleNotification(bad, { dir })).rejects.toThrow()
})

Deno.test('throws on non-JSON input', async () => {
  const dir = await Deno.makeTempDir()
  const bad = 'not-json'
  await expect(handleNotification(bad, { dir })).rejects.toThrow()
})

Deno.test('writes notify.json atomically in dir and errors if exists', async () => {
  const dir = await Deno.makeTempDir()
  const payload =
    '{"type":"agent-turn-complete","turn-id":"42","input-messages":["x"],"last-assistant-message":"done"}'
  await handleNotification(payload, { dir })
  const file = join(dir, 'notify.json')
  const content = await Deno.readTextFile(file)
  expect(JSON.parse(content)).toEqual(JSON.parse(payload))
  // Second call should error since file already exists
  await expect(handleNotification(payload, { dir })).rejects.toThrow()
})
