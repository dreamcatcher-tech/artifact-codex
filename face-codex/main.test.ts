import { expect } from '@std/expect'
import { startFaceCodex } from './main.ts'
import { join } from '@std/path'

Deno.test('destroy removes home directory when prepared', async () => {
  const workspace = await Deno.makeTempDir()
  const face = startFaceCodex({
    workspace,
    config: {
      getEnv: (key) => key === 'OPENAI_API_KEY' ? 'test-key' : undefined,
      launch: 'disabled',
    },
  })
  let destroyed = false
  try {
    const statusBefore = await face.status()
    const home = statusBefore.home
    if (!home) {
      throw new Error('expected home directory')
    }
    expect(await pathExists(home)).toBe(true)
    await face.destroy()
    destroyed = true
    expect(await pathExists(home)).toBe(false)
  } finally {
    if (!destroyed) {
      try {
        await face.destroy()
      } catch {
        // ignore
      }
    }
    await Deno.remove(workspace, { recursive: true })
  }
})

Deno.test('start returns object with required methods', async () => {
  const face = startFaceCodex()
  try {
    expect(typeof face.interaction).toBe('function')
    expect(typeof face.awaitInteraction).toBe('function')
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

Deno.test('interaction resolves awaitInteraction', async () => {
  const dir = await Deno.makeTempDir()
  const face = startFaceCodex({ config: { notifyDir: dir } })
  try {
    const out = face.interaction('hello')
    expect(typeof out.id).toBe('string')
    expect(out.id.length).toBeGreaterThan(8)

    const payload =
      '{"type":"agent-turn-complete","turn-id":"t1","input-messages":["hello"],"last-assistant-message":"ok"}'
    await Deno.writeTextFile(join(dir, 'notify.json'), payload)

    const res = await face.awaitInteraction(out.id)
    expect(res).toBe(payload)

    const s = await face.status()
    expect(s.interactions).toBe(1)
    expect(s.lastInteractionId).toBe(out.id)
    expect(s.notifications).toBe(1)
    expect(s.lastNotificationRaw).toBe(payload)
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

async function pathExists(path: string) {
  try {
    await Deno.stat(path)
    return true
  } catch (err) {
    if (err instanceof Deno.errors.NotFound) return false
    throw err
  }
}
