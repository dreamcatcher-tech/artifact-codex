import { expect } from '@std/expect'
import { startFaceTest } from './main.ts'

Deno.test('start returns Face with basic methods', async () => {
  const face = startFaceTest()
  try {
    expect(typeof face.interaction).toBe('function')
    expect(typeof face.awaitInteraction).toBe('function')
    expect(typeof face.destroy).toBe('function')
    expect(typeof face.status).toBe('function')
    const s = await face.status()
    expect(s.closed).toBe(false)
    expect(s.interactions).toBe(0)
    expect(typeof s.startedAt).toBe('string')
    expect(Array.isArray(s.views)).toBe(true)
    expect(s.views?.length ?? 0).toBeGreaterThan(0)
    expect(typeof s.views?.[0]?.url).toBe('string')
  } finally {
    await face.destroy()
  }
})

Deno.test('interaction stores provided id; awaitInteraction returns result', async () => {
  const face = startFaceTest()
  try {
    const id = '0'
    face.interaction(id, 'hello world')
    const res = await face.awaitInteraction(id)
    expect(res).toBe('hello world')

    const s = await face.status()
    expect(s.interactions).toBe(1)
    expect(s.lastInteractionId).toBe(id)
  } finally {
    await face.destroy()
  }
})

Deno.test('error path: awaitInteraction rejects with error', async () => {
  const face = startFaceTest()
  try {
    const id = '1'
    face.interaction(id, 'error')
    await expect(face.awaitInteraction(id)).rejects.toThrow(
      'intentional test error',
    )
  } finally {
    await face.destroy()
  }
})

Deno.test('close marks closed and prevents interactions', async () => {
  const face = startFaceTest()
  await face.destroy()
  const s1 = await face.status()
  expect(s1.closed).toBe(true)
  expect(() => face.interaction('2', 'ping')).toThrow()
  // idempotent close
  await face.destroy()
  const s2 = await face.status()
  expect(s2.closed).toBe(true)
})
