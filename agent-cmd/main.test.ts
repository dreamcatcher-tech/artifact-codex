import { expect } from '@std/expect'
import { startAgentCmd } from './main.ts'

Deno.test('startAgentCmd basic interaction resolves ok without launch', async () => {
  const face = startAgentCmd()
  const id = '0'
  face.interaction(id, 'echo hello')
  const result = await face.awaitInteraction(id)
  expect(result).toBe('ok')
  await face.destroy()
})
