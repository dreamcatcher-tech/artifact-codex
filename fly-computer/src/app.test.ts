import { expect } from '@std/expect'
import { join } from '@std/path'

import type { MachineDetail, MachineSummary } from '@artifact/shared'

import { createApp } from './app.ts'
import type { FlyApi } from './fly.ts'
import { slugify } from './naming.ts'

const BASE_DOMAIN = 'example.test'
const COMPUTER_NAME = 'computer'
const COMPUTER_HOST = `${COMPUTER_NAME}.${BASE_DOMAIN}`

const REQUIRED_FLY_ENV: Record<string, string> = {
  FLY_APP_NAME: 'test-computer',
  FLY_MACHINE_ID: 'test-machine',
  FLY_ALLOC_ID: 'test-machine',
  FLY_REGION: 'syd',
  FLY_PUBLIC_IP: '2001:db8::1',
  FLY_IMAGE_REF: 'registry.fly.io/test:latest',
  FLY_MACHINE_VERSION: '1',
  FLY_PRIVATE_IP: 'fdaa:0:1',
  FLY_PROCESS_GROUP: 'app',
  FLY_VM_MEMORY_MB: '256',
  PRIMARY_REGION: 'syd',
}

const previousFlyEnv = new Map<string, string | undefined>()
for (const [key, value] of Object.entries(REQUIRED_FLY_ENV)) {
  previousFlyEnv.set(key, Deno.env.get(key))
  Deno.env.set(key, value)
}

addEventListener('unload', () => {
  for (const [key, value] of previousFlyEnv.entries()) {
    if (value === undefined) {
      Deno.env.delete(key)
    } else {
      Deno.env.set(key, value)
    }
  }
})

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
    image: string
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
    runMachine(input) {
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

function templateDetail(
  image = 'registry.fly.io/fly-agent:latest',
): MachineDetail {
  return {
    id: 'template-machine',
    name: 'template-machine',
    state: 'started',
    config: { image },
  }
}

Deno.test('creates a new agent and redirects when no subdomain is present', async () => {
  const tmp = await Deno.makeTempDir()
  try {
    const registryRoot = join(tmp, 'registry')
    await Deno.mkdir(registryRoot, { recursive: true })
    const fly = createFlyStub()
    const handler = await createApp({
      config: {
        targetApp: 'universal-compute',
        agentImage: 'registry.fly.io/universal-compute:latest',
        registryRoot,
        baseDomain: BASE_DOMAIN,
      },
      dependencies: {
        fly,
        loadTemplateMachine: () => Promise.resolve(templateDetail()),
      },
    })
    const res = await handler(
      new Request(`http://${COMPUTER_HOST}/`, {
        headers: { host: COMPUTER_HOST },
      }),
    )
    expect(res.status).toBe(302)
    const location = res.headers.get('location')
    expect(location).not.toBeNull()
    const locationHost = location ? new URL(location).hostname : ''

    const createdDirs: string[] = []
    for await (const entry of Deno.readDir(registryRoot)) {
      if (entry.isDirectory) createdDirs.push(entry.name)
    }
    expect(createdDirs.length).toBe(1)
    const agentDir = join(registryRoot, createdDirs[0]!)
    const agentConfig = JSON.parse(
      await Deno.readTextFile(join(agentDir, 'config.json')),
    ) as { name: string; id: string }
    const expectedSlug = slugify(agentConfig.name)
    expect(locationHost.startsWith(`${expectedSlug}.`)).toBe(true)
    expect(fly.created.length).toBe(1)
  } finally {
    await Deno.remove(tmp, { recursive: true })
  }
})

Deno.test('uses template image when agentImage override is not provided', async () => {
  const tmp = await Deno.makeTempDir()
  try {
    const registryRoot = join(tmp, 'registry')
    await Deno.mkdir(registryRoot, { recursive: true })
    const fly = createFlyStub()
    const templateImage = 'registry.fly.io/fly-agent:stable'
    const handler = await createApp({
      config: {
        targetApp: 'universal-compute',
        registryRoot,
        baseDomain: BASE_DOMAIN,
      },
      dependencies: {
        fly,
        loadTemplateMachine: () =>
          Promise.resolve(templateDetail(templateImage)),
      },
    })

    await handler(
      new Request(`http://${COMPUTER_HOST}/`, {
        headers: { host: COMPUTER_HOST },
      }),
    )

    expect(fly.created[0]?.image).toBe(templateImage)
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

    const handler = await createApp({
      config: {
        targetApp: 'universal-compute',
        agentImage: 'registry.fly.io/universal-compute:latest',
        registryRoot,
        baseDomain: BASE_DOMAIN,
      },
      dependencies: {
        now: () => new Date('2025-01-01T00:00:00Z'),
        fly,
        loadTemplateMachine: () => Promise.resolve(templateDetail()),
      },
    })

    const res = await handler(
      new Request(`http://foo.${COMPUTER_HOST}/`, {
        headers: { host: `foo.${COMPUTER_HOST}` },
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

    const handler = await createApp({
      config: {
        targetApp: 'universal-compute',
        agentImage: 'registry.fly.io/universal-compute:latest',
        registryRoot,
        baseDomain: BASE_DOMAIN,
      },
      dependencies: {
        now: () => new Date('2025-01-01T00:00:00Z'),
        fly,
        loadTemplateMachine: () => Promise.resolve(templateDetail()),
      },
    })

    const res = await handler(
      new Request(`http://foo.${COMPUTER_HOST}/`, {
        headers: { host: `foo.${COMPUTER_HOST}` },
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

    const handler = await createApp({
      config: {
        targetApp: 'universal-compute',
        agentImage: 'registry.fly.io/universal-compute:latest',
        registryRoot,
        baseDomain: BASE_DOMAIN,
      },
      dependencies: {
        now: () => new Date('2025-01-01T00:00:00Z'),
        fly,
        loadTemplateMachine: () => Promise.resolve(templateDetail()),
      },
    })

    const res = await handler(
      new Request(`http://foo.${COMPUTER_HOST}/`, {
        headers: { host: `foo.${COMPUTER_HOST}` },
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

    const handler = await createApp({
      config: {
        targetApp: 'universal-compute',
        agentImage: 'registry.fly.io/universal-compute:latest',
        registryRoot,
        baseDomain: BASE_DOMAIN,
      },
      dependencies: {
        now: () => new Date('2025-01-01T00:00:00Z'),
        fly,
        loadTemplateMachine: () => Promise.resolve(templateDetail()),
      },
    })

    const res = await handler(
      new Request(`http://foo.${COMPUTER_HOST}/`, {
        headers: { host: `foo.${COMPUTER_HOST}` },
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

    const handler = await createApp({
      config: {
        targetApp: 'universal-compute',
        agentImage: 'registry.fly.io/universal-compute:latest',
        registryRoot,
        baseDomain: BASE_DOMAIN,
      },
      dependencies: {
        now: () => new Date('2025-01-01T00:00:00Z'),
        fly,
        loadTemplateMachine: () => Promise.resolve(templateDetail()),
      },
    })

    const res = await handler(
      new Request(`http://alpha--beta-child.${COMPUTER_HOST}/`, {
        headers: { host: `alpha--beta-child.${COMPUTER_HOST}` },
      }),
    )
    expect(res.status).toBe(204)
  } finally {
    await Deno.remove(tmp, { recursive: true })
  }
})
