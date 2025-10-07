import { expect } from '@std/expect'
import { startAgentTest } from '@artifact/agent-test'
import { harness } from '@artifact/supervisor/fixture'

import { createHostBasicOptions, resolveFaceKinds } from './main.ts'

denoTestResolveAgentKinds()
denoTestCreateHostBasicOptions()
denoTestIntegration()

function denoTestResolveAgentKinds() {
  Deno.test('resolveAgentKinds exposes the test agent', () => {
    const kinds = resolveFaceKinds()
    expect(Array.isArray(kinds)).toBe(true)
    expect(kinds.length).toBe(1)
    const [agent] = kinds
    expect(agent.id).toBe('test')
    expect(agent.title).toBe('Test Agent')
    expect(agent.create).toBe(startAgentTest)
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
    await using fixtures = await harness({
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
