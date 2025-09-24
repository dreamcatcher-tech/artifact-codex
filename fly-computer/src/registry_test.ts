import { expect } from '@std/expect'
import { join } from '@std/path'

import { createAgentRegistry } from './registry.ts'

const DEFAULT_DEPS = {
  readDir: Deno.readDir,
  readTextFile: Deno.readTextFile,
  writeTextFile: Deno.writeTextFile,
  stat: Deno.stat,
  mkdir: Deno.mkdir,
  remove: Deno.remove,
}

Deno.test('createAgent stores config without slug and resolves path segment', async () => {
  const root = await Deno.makeTempDir({ prefix: 'agent-registry-' })
  try {
    const registry = createAgentRegistry(root, DEFAULT_DEPS)
    await registry.ensureReady()

    const agent = await registry.createAgent({ name: 'Echo Bot' })

    expect(agent.pathSegment).toMatch(/^echo-bot-/)
    const configPath = join(root, 'agents', `${agent.id}.json`)
    const config = JSON.parse(await Deno.readTextFile(configPath)) as Record<
      string,
      unknown
    >

    expect(config.slug).toBeUndefined()
    expect(config.machine).toBeUndefined()
    expect(config.name).toBe('Echo Bot')
    expect(config.id).toBe(agent.id)

    const resolved = await registry.findByPath([agent.pathSegment])
    expect(resolved?.id).toBe(agent.id)
  } finally {
    await Deno.remove(root, { recursive: true })
  }
})

Deno.test('updateMachine records machine under machines directory', async () => {
  const root = await Deno.makeTempDir({ prefix: 'agent-registry-' })
  try {
    const registry = createAgentRegistry(root, DEFAULT_DEPS)
    await registry.ensureReady()

    const agent = await registry.createAgent({ name: 'Alpha' })

    const timestamp = new Date().toISOString()
    await registry.updateMachine(agent.id, {
      id: 'm-alpha',
      name: 'machine-alpha',
      image: 'registry.fly.io/alpha:latest',
      updatedAt: timestamp,
    })

    const machinePath = join(root, 'machines', 'm-alpha.json')
    const machine = JSON.parse(await Deno.readTextFile(machinePath)) as Record<
      string,
      unknown
    >
    expect(machine.agentId).toBe(agent.id)
    expect(machine.updatedAt).toBe(timestamp)

    const recorded = await registry.findMachineByAgent(agent.id)
    expect(recorded?.id).toBe('m-alpha')

    await registry.updateMachine(agent.id, {
      id: 'm-beta',
      name: 'machine-beta',
      image: 'registry.fly.io/beta:latest',
      updatedAt: new Date(Date.now() + 1000).toISOString(),
    })

    const staleExists = await pathExists(machinePath)
    expect(staleExists).toBe(false)
    const replacement = JSON.parse(
      await Deno.readTextFile(join(root, 'machines', 'm-beta.json')),
    ) as Record<string, unknown>
    expect(replacement.agentId).toBe(agent.id)
  } finally {
    await Deno.remove(root, { recursive: true })
  }
})

Deno.test('findByPath resolves nested segments using path segments', async () => {
  const root = await Deno.makeTempDir({ prefix: 'agent-registry-' })
  try {
    const registry = createAgentRegistry(root, DEFAULT_DEPS)
    await registry.ensureReady()

    const parent = await registry.createAgent({ name: 'Parent Agent' })
    const child = await registry.createAgent({
      name: 'Child Agent',
      parentId: parent.id,
    })

    const resolvedChild = await registry.findByPath([
      parent.pathSegment,
      child.pathSegment,
    ])
    expect(resolvedChild?.id).toBe(child.id)
  } finally {
    await Deno.remove(root, { recursive: true })
  }
})

async function pathExists(path: string): Promise<boolean> {
  try {
    await Deno.stat(path)
    return true
  } catch (err) {
    if (err instanceof Deno.errors.NotFound) return false
    throw err
  }
}
