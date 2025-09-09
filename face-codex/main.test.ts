import { expect } from '@std/expect'
import { startFaceCodex } from './main.ts'

Deno.test('start returns object with required methods', async () => {
  const face = startFaceCodex()
  try {
    expect(typeof face.interaction).toBe('function')
    expect(typeof face.waitFor).toBe('function')
    expect(typeof face.destroy).toBe('function')
    expect(typeof face.status).toBe('function')
    const s = await face.status()
    expect(s.closed).toBe(false)
    expect(s.interactions).toBe(0)
    expect(typeof s.startedAt).toBe('string')
  } finally {
    await face.destroy()
  }
})

Deno.test('interaction returns id; outcome via waitFor, updates status', async () => {
  const face = startFaceCodex()
  try {
    const out = face.interaction('hello')
    expect(typeof out.id).toBe('string')
    expect(out.id.length).toBeGreaterThan(8)
    const res = await face.waitFor(out.id)
    expect('result' in res).toBe(true)
    const s = await face.status()
    expect(s.interactions).toBe(1)
    expect(s.lastInteractionId).toBe(out.id)
  } finally {
    await face.destroy()
  }
})

Deno.test('close makes face reject new interactions and sets closed', async () => {
  const face = startFaceCodex()
  await face.destroy()
  const s1 = await face.status()
  expect(s1.closed).toBe(true)
  expect(() => face.interaction('x')).toThrow()
  // idempotent
  await face.destroy()
  const s2 = await face.status()
  expect(s2.closed).toBe(true)
})
