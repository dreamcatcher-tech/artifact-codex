import { expect } from '@std/expect'
import { startFaceCodex } from './main.ts'

Deno.test('custom mock runner receives stdin and triggers notify', async () => {
  const workspace = await Deno.makeTempDir()
  const config = await Deno.makeTempDir()
  const face = startFaceCodex({
    workspace,
    home: config,
    config: { test: true },
  })
  try {
    // Wait until runner process spawned (pid available)
    const readyBy = Date.now() + 2000
    while (Date.now() < readyBy) {
      const s = await face.status()
      if (s.pid) break
      await new Promise((r) => setTimeout(r, 10))
    }
    face.interaction('do-thing')
    // Wait for notification to be observed
    const deadline = Date.now() + 5000
    let noted = 0
    let raw = ''
    while (Date.now() < deadline) {
      const s = await face.status()
      noted = s.notifications ?? 0
      if (noted > 0) {
        raw = s.lastNotificationRaw ?? ''
        break
      }
      await new Promise((r) => setTimeout(r, 25))
    }
    expect(noted).toBe(1)
    const obj = JSON.parse(raw)
    expect(obj.type).toBe('agent-turn-complete')
    expect(obj['input-messages']).toEqual(['do-thing'])
    expect(String(obj['turn-id']).startsWith('mock-')).toBe(true)
  } finally {
    await face.destroy()
  }
})
