import { expect } from '@std/expect'
import { startFaceInspector } from './main.ts'

Deno.test('inspector face basic methods and non-interactive behavior', async () => {
  const workspace = await Deno.makeTempDir()
  const home = await Deno.makeTempDir()
  const face = startFaceInspector({
    workspace,
    home,
    config: { skipLaunch: true },
  })
  try {
    expect(typeof face.interaction).toBe('function')
    expect(typeof face.awaitInteraction).toBe('function')
    expect(typeof face.destroy).toBe('function')
    expect(typeof face.status).toBe('function')

    const s = await face.status()
    expect(s.closed).toBe(false)
    expect(s.interactions).toBe(0)
    expect(s.views).toHaveLength(2)
    expect(() => face.interaction('ping')).toThrow()
  } finally {
    await face.destroy()
  }
})
