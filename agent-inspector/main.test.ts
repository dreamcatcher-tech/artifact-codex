import { expect } from '@std/expect'
import { startAgentInspector } from './main.ts'

Deno.test('inspector face basic methods and non-interactive behavior', async () => {
  const workspace = await Deno.makeTempDir()
  const home = await Deno.makeTempDir()
  const face = startAgentInspector({ workspace, home, config: { test: true } })
  try {
    expect(typeof face.interaction).toBe('function')
    expect(typeof face.awaitInteraction).toBe('function')
    expect(typeof face.destroy).toBe('function')
    expect(typeof face.status).toBe('function')

    const s = await face.status()
    expect(s.closed).toBe(false)
    expect(s.interactions).toBe(0)
    expect(s.views).toHaveLength(2)
    const msg = 'agent-inspector is non-interactive'
    expect(() => face.interaction('0', 'ping')).toThrow(msg)
  } finally {
    await face.destroy()
  }
})
