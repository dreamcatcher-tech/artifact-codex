import { expect } from '@std/expect'
import { startFaceInspector } from './main.ts'

Deno.test('inspector face basic methods and non-interactive behavior', async () => {
  const face = startFaceInspector()
  try {
    expect(typeof face.interaction).toBe('function')
    expect(typeof face.waitFor).toBe('function')
    expect(typeof face.destroy).toBe('function')
    expect(typeof face.status).toBe('function')
    const s = await face.status()
    expect(s.closed).toBe(false)
    expect(s.interactions).toBe(0)
    // Ports are optional and undefined until a child is launched by dev script
    expect(s.ports === undefined || typeof s.ports === 'object').toBe(true)
    expect(() => face.interaction('ping')).toThrow()
  } finally {
    await face.destroy()
  }
})
