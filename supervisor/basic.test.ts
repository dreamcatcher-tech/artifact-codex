import { expect } from '@std/expect'

import { createAgentWebServer, type FaceKindConfig } from './mod.ts'
import { createTestServerOptions } from './test-helpers.ts'
import type { Agent } from '@artifact/shared'

function createStubFace(): Agent {
  let destroyed = false
  return {
    interaction: () => {
      if (destroyed) throw new Error('face destroyed')
    },
    awaitInteraction: (interactionId: string) => {
      if (destroyed) throw new Error('face destroyed')
      return Promise.resolve(`result:${interactionId}`)
    },
    cancel: () => {
      if (destroyed) throw new Error('face destroyed')
    },
    destroy: () => {
      destroyed = true
    },
    status: () =>
      Promise.resolve({
        startedAt: new Date().toISOString(),
        closed: destroyed,
        interactions: 0,
        lastInteractionId: undefined,
        pid: Deno.pid,
        views: [],
        home: undefined,
        workspace: Deno.cwd(),
      }),
  }
}

function stubFaceKinds(): FaceKindConfig[] {
  return [{
    id: 'test',
    title: 'Test',
    description: 'Stub face for supervisor tests',
    create: () => createStubFace(),
  }]
}

Deno.test('createAgentWebServer returns app and close', async () => {
  const { app, close } = createAgentWebServer(
    createTestServerOptions({
      serverName: 'supervisor-test',
      faceKinds: stubFaceKinds(),
    }),
  )
  expect(typeof app.fetch).toBe('function')
  await close()
})
