import { expect } from '@std/expect'
import { startFaceTest } from '@artifact/face-test'
import { withApp } from '@artifact/web-server/fixture'

import { createHostBasicOptions, resolveFaceKinds } from './main.ts'

denoTestResolveFaceKinds()
denoTestCreateHostBasicOptions()
denoTestIntegration()

function denoTestResolveFaceKinds() {
  Deno.test('resolveFaceKinds exposes the test face', () => {
    const kinds = resolveFaceKinds()
    expect(Array.isArray(kinds)).toBe(true)
    expect(kinds.length).toBe(1)
    const [face] = kinds
    expect(face.id).toBe('test')
    expect(face.title).toBe('Test Agent')
    expect(face.create).toBe(startFaceTest)
  })
}

function denoTestCreateHostBasicOptions() {
  Deno.test('createHostBasicOptions aborts when idle', () => {
    const abort = new AbortController()
    const options = createHostBasicOptions(abort)
    expect(options.serverName).toBe('host-basic')
    expect(options.serverVersion).toBe('0.0.1')
    expect(options.timeoutMs).toBe(5 * 60 * 1000)
    expect(options.faceKinds).toStrictEqual(resolveFaceKinds())
    expect(abort.signal.aborted).toBe(false)
    options.onIdle()
    expect(abort.signal.aborted).toBe(true)
  })
}

function denoTestIntegration() {
  Deno.test('createHostBasicOptions integrates with the agent web server', async () => {
    const abort = new AbortController()
    const options = createHostBasicOptions(abort)
    await using fixtures = await withApp({
      ...options,
      clientName: 'host-basic-test-client',
      clientVersion: '0.0.0',
    })
    const info = fixtures.client.getServerVersion()
    expect(info?.name).toBe('host-basic')
    const tools = await fixtures.client.listTools()
    const toolNames = (tools.tools ?? []).map((tool) => tool.name)
    expect(toolNames).toContain('list_faces')
  })
}
