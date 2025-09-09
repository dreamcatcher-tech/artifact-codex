import { expect } from '@std/expect'
import { startFaceTest } from './main.ts'

Deno.test('start returns Face with basic methods', async () => {
  const face = startFaceTest()
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

Deno.test('interaction returns id; waitFor returns result', async () => {
  const face = startFaceTest()
  try {
    const out = face.interaction('hello world')
    expect(typeof out.id).toBe('string')
    const res = await face.waitFor(out.id)
    expect('error' in res).toBe(false)
    expect('result' in res).toBe(true)
    // @ts-ignore narrow result branch
    expect(res.result.message).toBe('hello world')
    const s = await face.status()
    expect(s.interactions).toBe(1)
    expect(s.lastInteractionId).toBe(out.id)
  } finally {
    await face.destroy()
  }
})

Deno.test('error path: waitFor returns { error: true }', async () => {
  const face = startFaceTest()
  try {
    const out = face.interaction('error')
    const res = await face.waitFor(out.id)
    expect('error' in res).toBe(true)
  } finally {
    await face.destroy()
  }
})

Deno.test('close marks closed and prevents interactions', async () => {
  const face = startFaceTest()
  await face.destroy()
  const s1 = await face.status()
  expect(s1.closed).toBe(true)
  expect(() => face.interaction('ping')).toThrow()
  // idempotent close
  await face.destroy()
  const s2 = await face.status()
  expect(s2.closed).toBe(true)
})
