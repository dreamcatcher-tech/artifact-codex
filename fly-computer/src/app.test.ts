import { expect } from '@std/expect'
import { join } from '@std/path'

import type { MachineDetail } from '@artifact/shared'

import { createApp } from './app.ts'
import type { FlyApi } from './fly.ts'
import { slugify } from './naming.ts'
import { buildAgentHost } from './routing.ts'

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
  FLY_AGENT_TEMPLATE_APP: 'universal-compute',
  FLY_NFS_APP: 'nfs-proto',
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
  const dir = join(root, 'agents')
  await Deno.mkdir(dir, { recursive: true })
  const body = JSON.stringify({ id, ...config }, null, 2) + '\n'
  await Deno.writeTextFile(join(dir, `${id}.json`), body)
}

async function writeMachineRecord(
  root: string,
  machineId: string,
  record: Record<string, unknown>,
) {
  const dir = join(root, 'machines')
  await Deno.mkdir(dir, { recursive: true })
  const body = JSON.stringify({ id: machineId, ...record }, null, 2) + '\n'
  await Deno.writeTextFile(join(dir, `${machineId}.json`), body)
}

function hostForAgentSegment(segment: string): string {
  return buildAgentHost([segment], COMPUTER_NAME, BASE_DOMAIN)
}

function hostForAgentPath(path: string[]): string {
  return buildAgentHost(path, COMPUTER_NAME, BASE_DOMAIN)
}

function deriveSegment(name: string, id: string): string {
  const idFragment = id.replace(/[^a-z0-9]/gi, '').toLowerCase().slice(0, 10) ||
    'agent'
  const base = slugify(name).slice(0, 16).replace(/^-+|-+$/g, '')
  const combined = base ? `${base}-${idFragment}` : idFragment
  const normalized = slugify(combined)
  return normalized || idFragment
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

    const agentsDir = join(registryRoot, 'agents')
    const agentFiles: string[] = []
    for await (const entry of Deno.readDir(agentsDir)) {
      if (entry.isFile) agentFiles.push(entry.name)
    }
    expect(agentFiles.length).toBe(1)
    const agentConfig = JSON.parse(
      await Deno.readTextFile(join(agentsDir, agentFiles[0]!)),
    ) as { name: string; id: string }
    const expectedSegment = deriveSegment(
      agentConfig.name,
      String(agentConfig.id),
    )
    const expectedHost = hostForAgentSegment(expectedSegment)
    expect(locationHost).toBe(expectedHost)

    const machinesDir = join(registryRoot, 'machines')
    const machineFiles: string[] = []
    for await (const entry of Deno.readDir(machinesDir)) {
      if (entry.isFile) machineFiles.push(entry.name)
    }
    expect(machineFiles.length).toBe(1)
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
    await writeAgentConfig(registryRoot, '1', { name: 'foo' })
    await writeMachineRecord(registryRoot, 'm-1', {
      agentId: '1',
      name: 'agent-1',
      updatedAt: new Date('2024-12-31T00:00:00Z').toISOString(),
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

    const agentHost = hostForAgentSegment(deriveSegment('foo', '1'))
    const res = await handler(
      new Request(`http://${agentHost}/`, {
        headers: { host: agentHost },
      }),
    )
    expect(res.status).toBe(204)
    expect(res.headers.get('fly-replay')).toBe(
      'app=universal-compute;fly_force_instance=m-1',
    )
    expect(fly.startCalls).toEqual([])

    const saved = JSON.parse(
      await Deno.readTextFile(join(registryRoot, 'agents', '1.json')),
    ) as Record<string, unknown>
    expect(saved.machine).toBeUndefined()
    const machineRecord = JSON.parse(
      await Deno.readTextFile(join(registryRoot, 'machines', 'm-1.json')),
    ) as Record<string, unknown>
    expect(machineRecord.agentId).toBe('1')
    expect(machineRecord.name).toBe('agent-1')
    expect(typeof machineRecord.updatedAt).toBe('string')
  } finally {
    await Deno.remove(tmp, { recursive: true })
  }
})

Deno.test('restarts machine when configuration points to stopped instance', async () => {
  const tmp = await Deno.makeTempDir()
  try {
    const registryRoot = join(tmp, 'registry')
    await Deno.mkdir(registryRoot, { recursive: true })
    await writeAgentConfig(registryRoot, '1', { name: 'foo' })
    await writeMachineRecord(registryRoot, 'm-2', { agentId: '1' })

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

    const agentHost = hostForAgentSegment(deriveSegment('foo', '1'))
    const res = await handler(
      new Request(`http://${agentHost}/`, {
        headers: { host: agentHost },
      }),
    )
    expect(res.status).toBe(204)
    expect(fly.startCalls).toEqual(['m-2'])
  } finally {
    await Deno.remove(tmp, { recursive: true })
  }
})

Deno.test('removes stale machine record when remote machine is missing', async () => {
  const tmp = await Deno.makeTempDir()
  try {
    const registryRoot = join(tmp, 'registry')
    await Deno.mkdir(registryRoot, { recursive: true })
    await writeAgentConfig(registryRoot, '1', { name: 'foo' })
    await writeMachineRecord(registryRoot, 'm-meta', { agentId: '1' })

    const fly = createFlyStub({
      getMachine(machineId): Promise<MachineDetail> {
        return Promise.reject(
          new Error(`Machine ${machineId} not found`),
        ) as Promise<MachineDetail>
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

    const agentHost = hostForAgentSegment(deriveSegment('foo', '1'))
    const res = await handler(
      new Request(`http://${agentHost}/`, {
        headers: { host: agentHost },
      }),
    )
    expect(res.status).toBe(204)
    expect(fly.created.length).toBe(1)
    await expectPathMissing(join(registryRoot, 'machines', 'm-meta.json'))
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

    const agentHost = hostForAgentSegment(deriveSegment('foo', '1'))
    const res = await handler(
      new Request(`http://${agentHost}/`, {
        headers: { host: agentHost },
      }),
    )
    expect(res.status).toBe(204)
    expect(fly.created.length).toBe(1)
    const createdConfig = fly.created[0]?.config as {
      metadata?: Record<string, unknown>
    }
    expect(createdConfig?.metadata?.artifact_agent_id).toBe('1')

    const saved = JSON.parse(
      await Deno.readTextFile(join(registryRoot, 'agents', '1.json')),
    ) as Record<string, unknown>
    expect(saved.machine).toBeUndefined()
    const machine = JSON.parse(
      await Deno.readTextFile(
        join(registryRoot, 'machines', 'new-machine.json'),
      ),
    ) as Record<string, unknown>
    expect(machine.id).toBe('new-machine')
    expect(machine.agentId).toBe('1')
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
    })
    await writeMachineRecord(registryRoot, 'm-beta', { agentId: '2' })

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

    const nestedHost = hostForAgentPath([
      deriveSegment('alpha', '1'),
      deriveSegment('beta child', '2'),
    ])
    const res = await handler(
      new Request(`http://${nestedHost}/`, {
        headers: { host: nestedHost },
      }),
    )
    expect(res.status).toBe(204)
  } finally {
    await Deno.remove(tmp, { recursive: true })
  }
})

async function expectPathMissing(path: string): Promise<void> {
  try {
    await Deno.stat(path)
    throw new Error(`Expected path to be missing: ${path}`)
  } catch (err) {
    if (err instanceof Deno.errors.NotFound) return
    throw err
  }
}
