import { expect } from '@std/expect'
import { startFaceCodex } from './main.ts'

Deno.test('start returns object with required methods', async () => {
  const face = startFaceCodex()
  try {
    expect(typeof face.interaction).toBe('function')
    expect(typeof face.close).toBe('function')
    expect(typeof face.status).toBe('function')
    const s = await face.status()
    expect(s.closed).toBe(false)
    expect(s.interactions).toBe(0)
    expect(typeof s.startedAt).toBe('string')
  } finally {
    await face.close()
  }
})

Deno.test('interaction returns id and value, updates status', async () => {
  const face = startFaceCodex()
  try {
    const out = face.interaction('hello')
    expect(typeof out.id).toBe('string')
    expect(out.id.length).toBeGreaterThan(8)
    expect(out.value).toBe('hello')
    const s = await face.status()
    expect(s.interactions).toBe(1)
    expect(s.lastInteractionId).toBe(out.id)
  } finally {
    await face.close()
  }
})

Deno.test('close makes face reject new interactions and sets closed', async () => {
  const face = startFaceCodex()
  await face.close()
  const s1 = await face.status()
  expect(s1.closed).toBe(true)
  expect(() => face.interaction('x')).toThrow()
  // idempotent
  await face.close()
  const s2 = await face.status()
  expect(s2.closed).toBe(true)
})
