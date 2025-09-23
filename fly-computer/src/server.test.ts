import { expect } from '@std/expect'
import { join } from '@std/path'

import type { MachineDetail, MachineSummary } from '@artifact/shared'

import { createHandler } from './server.ts'
import type { FlyApi } from './fly.ts'

async function writeAgentConfig(
  root: string,
  id: string,
  config: Record<string, unknown>,
) {
  const dir = join(root, id)
  await Deno.mkdir(dir, { recursive: true })
  const body = JSON.stringify({ id, ...config }, null, 2) + '\n'
  await Deno.writeTextFile(join(dir, 'config.json'), body)
}

type FlyStub = FlyApi & {
  startCalls: string[]
  created: {
    name: string
    config: Record<string, unknown>
    region?: string
  }[]
}

function createFlyStub(overrides: Partial<FlyApi> = {}): FlyStub {
  const startCalls: string[] = []
  const created: FlyStub['created'] = []
  const stub: FlyStub = {
    getMachine() {
      return Promise.resolve({
        id: 'unused',
        state: 'started',
        config: {},
      })
    },
    listMachines() {
      return Promise.resolve([])
    },
    createMachine(input) {
      created.push(input)
      return Promise.resolve({ id: 'new-machine', name: input.name })
    },
    startMachine(machineId) {
      startCalls.push(machineId)
      return Promise.resolve()
    },
    startCalls,
    created,
  }
  return Object.assign(stub, overrides)
}

Deno.test('returns 404 when no subdomain is present', async () => {
  const tmp = await Deno.makeTempDir()
  try {
    const registryRoot = join(tmp, 'registry')
    await Deno.mkdir(registryRoot, { recursive: true })
    const handler = await createHandler({
      config: {
        flyApiToken: 'token',
        targetApp: 'universal-compute',
        agentImage: 'registry.fly.io/universal-compute:latest',
        registryRoot,
      },
    })
    const res = await handler(new Request('http://example.test/'))
    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ error: 'agent not found' })
  } finally {
    await Deno.remove(tmp, { recursive: true })
  }
})

Deno.test('replays to configured machine without restarting when already running', async () => {
  const tmp = await Deno.makeTempDir()
  try {
    const registryRoot = join(tmp, 'registry')
    await Deno.mkdir(registryRoot, { recursive: true })
    await writeAgentConfig(registryRoot, '1', {
      name: 'foo',
      machine: { id: 'm-1' },
    })

    const fly = createFlyStub({
      getMachine(machineId): Promise<MachineDetail> {
        return Promise.resolve({
          id: machineId,
          name: 'agent-1',
          state: 'started',
          config: { image: 'img:latest' },
        })
      },
    })

    const handler = await createHandler({
      config: {
        flyApiToken: 'token',
        targetApp: 'universal-compute',
        agentImage: 'registry.fly.io/universal-compute:latest',
        registryRoot,
      },
      dependencies: {
        now: () => new Date('2025-01-01T00:00:00Z'),
        fly,
      },
    })

    const res = await handler(
      new Request('http://foo.example.test/', {
        headers: { host: 'foo.example.test' },
      }),
    )
    expect(res.status).toBe(204)
    expect(res.headers.get('fly-replay')).toBe(
      'app=universal-compute;fly_force_instance=m-1',
    )
    expect(fly.startCalls).toEqual([])

    const saved = JSON.parse(
      await Deno.readTextFile(join(registryRoot, '1', 'config.json')),
    ) as Record<string, unknown>
    expect(saved.machine).toMatchObject({ id: 'm-1', name: 'agent-1' })
    expect(typeof (saved.machine as { updatedAt?: unknown }).updatedAt).toBe(
      'string',
    )
  } finally {
    await Deno.remove(tmp, { recursive: true })
  }
})

Deno.test('restarts machine when configuration points to stopped instance', async () => {
  const tmp = await Deno.makeTempDir()
  try {
    const registryRoot = join(tmp, 'registry')
    await Deno.mkdir(registryRoot, { recursive: true })
    await writeAgentConfig(registryRoot, '1', {
      name: 'foo',
      machine: { id: 'm-2' },
    })

    const fly = createFlyStub({
      getMachine(machineId): Promise<MachineDetail> {
        return Promise.resolve({
          id: machineId,
          name: 'agent-1',
          state: 'stopped',
          config: { image: 'img:latest' },
        })
      },
    })

    const handler = await createHandler({
      config: {
        flyApiToken: 'token',
        targetApp: 'universal-compute',
        agentImage: 'registry.fly.io/universal-compute:latest',
        registryRoot,
      },
      dependencies: {
        now: () => new Date('2025-01-01T00:00:00Z'),
        fly,
      },
    })

    const res = await handler(
      new Request('http://foo.example.test/', {
        headers: { host: 'foo.example.test' },
      }),
    )
    expect(res.status).toBe(204)
    expect(fly.startCalls).toEqual(['m-2'])
  } finally {
    await Deno.remove(tmp, { recursive: true })
  }
})

Deno.test('reuses machine discovered by agent metadata when config missing machine id', async () => {
  const tmp = await Deno.makeTempDir()
  try {
    const registryRoot = join(tmp, 'registry')
    await Deno.mkdir(registryRoot, { recursive: true })
    await writeAgentConfig(registryRoot, '1', { name: 'foo' })

    const fly = createFlyStub({
      listMachines(): Promise<MachineSummary[]> {
        return Promise.resolve([{
          id: 'm-meta',
          name: 'agent-1',
          metadata: { artifact_agent_id: '1' },
        }])
      },
      getMachine(machineId): Promise<MachineDetail> {
        return Promise.resolve({
          id: machineId,
          name: 'agent-1',
          state: 'started',
          config: { image: 'img:latest', metadata: { artifact_agent_id: '1' } },
        })
      },
    })

    const handler = await createHandler({
      config: {
        flyApiToken: 'token',
        targetApp: 'universal-compute',
        agentImage: 'registry.fly.io/universal-compute:latest',
        registryRoot,
      },
      dependencies: {
        now: () => new Date('2025-01-01T00:00:00Z'),
        fly,
      },
    })

    const res = await handler(
      new Request('http://foo.example.test/', {
        headers: { host: 'foo.example.test' },
      }),
    )
    expect(res.status).toBe(204)
    const saved = JSON.parse(
      await Deno.readTextFile(join(registryRoot, '1', 'config.json')),
    ) as Record<string, unknown>
    expect((saved.machine as { id?: string }).id).toBe('m-meta')
  } finally {
    await Deno.remove(tmp, { recursive: true })
  }
})

Deno.test('creates new machine when none exist and updates registry', async () => {
  const tmp = await Deno.makeTempDir()
  try {
    const registryRoot = join(tmp, 'registry')
    await Deno.mkdir(registryRoot, { recursive: true })
    await writeAgentConfig(registryRoot, '1', { name: 'foo' })

    const fly = createFlyStub({
      getMachine(machineId): Promise<MachineDetail> {
        return Promise.resolve({
          id: machineId,
          name: 'foo-1',
          state: 'stopped',
          config: { image: 'registry.fly.io/universal-compute:latest' },
        })
      },
      createMachine(input) {
        fly.created.push(input)
        return Promise.resolve({ id: 'new-machine', name: input.name })
      },
    })

    const handler = await createHandler({
      config: {
        flyApiToken: 'token',
        targetApp: 'universal-compute',
        agentImage: 'registry.fly.io/universal-compute:latest',
        registryRoot,
      },
      dependencies: {
        now: () => new Date('2025-01-01T00:00:00Z'),
        fly,
      },
    })

    const res = await handler(
      new Request('http://foo.example.test/', {
        headers: { host: 'foo.example.test' },
      }),
    )
    expect(res.status).toBe(204)
    expect(fly.created.length).toBe(1)
    const createdConfig = fly.created[0]?.config as {
      metadata?: Record<string, unknown>
    }
    expect(createdConfig?.metadata?.artifact_agent_id).toBe('1')

    const saved = JSON.parse(
      await Deno.readTextFile(join(registryRoot, '1', 'config.json')),
    ) as Record<string, unknown>
    expect(saved.machine).toMatchObject({ id: 'new-machine' })
  } finally {
    await Deno.remove(tmp, { recursive: true })
  }
})

Deno.test('resolves nested agent path using parent links', async () => {
  const tmp = await Deno.makeTempDir()
  try {
    const registryRoot = join(tmp, 'registry')
    await Deno.mkdir(registryRoot, { recursive: true })
    await writeAgentConfig(registryRoot, '1', { name: 'alpha' })
    await writeAgentConfig(registryRoot, '2', {
      name: 'beta child',
      parentId: '1',
      machine: { id: 'm-beta' },
    })

    const fly = createFlyStub({
      getMachine(machineId): Promise<MachineDetail> {
        return Promise.resolve({
          id: machineId,
          name: 'beta-2',
          state: 'started',
          config: {},
        })
      },
    })

    const handler = await createHandler({
      config: {
        flyApiToken: 'token',
        targetApp: 'universal-compute',
        agentImage: 'registry.fly.io/universal-compute:latest',
        registryRoot,
      },
      dependencies: {
        now: () => new Date('2025-01-01T00:00:00Z'),
        fly,
      },
    })

    const res = await handler(
      new Request('http://alpha--beta-child.example.test/', {
        headers: { host: 'alpha--beta-child.example.test' },
      }),
    )
    expect(res.status).toBe(204)
  } finally {
    await Deno.remove(tmp, { recursive: true })
  }
})
