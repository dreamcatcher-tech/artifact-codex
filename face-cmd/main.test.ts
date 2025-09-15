import { expect } from '@std/expect'
import { startFaceCmd } from './main.ts'

Deno.test('startFaceCmd basic interaction resolves ok without launch', async () => {
  const face = startFaceCmd()
  const { id } = face.interaction('echo hello')
  const result = await face.awaitInteraction(id)
  expect(result).toBe('ok')
  await face.destroy()
})
