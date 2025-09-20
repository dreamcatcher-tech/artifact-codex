import { expect } from '@std/expect'
import { join } from '@std/path'

import { createHandler } from './app.ts'
import type { MachineDetail, MachineSummary } from '@artifact/shared'

type FlyStub = {
  getMachine: (machineId: string) => Promise<MachineDetail>
  listMachines: () => Promise<MachineSummary[]>
  createMachine: (input: {
    name: string
    config: Record<string, unknown>
    region?: string
  }) => Promise<MachineSummary>
  startMachine: (machineId: string) => Promise<void>
}

type HandlerConfig = {
  tmpDir: string
  fly?: FlyStub
}

async function setupHandler({ tmpDir, fly }: HandlerConfig) {
  const handler = await createHandler({
    config: {
      flyApiToken: 'token',
      targetApp: 'universal-compute',
      agentImage: 'registry.fly.io/universal-compute:latest',
      nfsMountDir: tmpDir,
      registrySubdir: 'computers',
      baseDomain: 'example.test',
    },
    dependencies: {
      now: () => new Date('2025-01-01T00:00:00Z'),
      fly: fly ?? {
        getMachine: () =>
          Promise.resolve({
            id: 'unused',
            state: 'started',
            config: {},
          }),
        listMachines: () => Promise.resolve([]),
        createMachine: () => Promise.resolve({ id: 'unused', name: 'unused' }),
        startMachine: () => Promise.resolve(),
      },
    },
  })
  return handler
}

Deno.test('returns 404 when subdomain missing', async () => {
  const tmp = await Deno.makeTempDir()
  try {
    const handler = await setupHandler({ tmpDir: tmp })
    const res = await handler(new Request('http://example.test/'))
    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ error: 'unknown subdomain' })
  } finally {
    await Deno.remove(tmp, { recursive: true })
  }
})

Deno.test('replays to existing mapping without starting machine when already running', async () => {
  const tmp = await Deno.makeTempDir()
  try {
    const mappingPath = join(tmp, 'computers')
    await Deno.mkdir(mappingPath, { recursive: true })
    await Deno.writeTextFile(
      join(mappingPath, 'foo.json'),
      JSON.stringify({ machineId: 'm-1', subdomain: 'foo' }, null, 2),
    )

    let startCalls = 0
    const handler = await setupHandler({
      tmpDir: tmp,
      fly: {
        getMachine: (machineId) =>
          Promise.resolve({
            id: machineId,
            name: 'computer-foo',
            state: 'started',
            config: {},
          }),
        listMachines: () => Promise.resolve([]),
        createMachine: () =>
          Promise.resolve({ id: 'new', name: 'computer-foo' }),
        startMachine: () => {
          startCalls += 1
          return Promise.resolve()
        },
      },
    })

    const res = await handler(
      new Request('http://foo.example.test/', {
        headers: { host: 'foo.example.test' },
      }),
    )
    expect(res.status).toBe(204)
    expect(res.headers.get('fly-replay')).toBe(
      'app=universal-compute;instance=m-1',
    )
    expect(startCalls).toBe(0)

    const saved = JSON.parse(
      await Deno.readTextFile(join(mappingPath, 'foo.json')),
    ) as Record<string, unknown>
    expect(saved.machineId).toBe('m-1')
    expect(typeof saved.updatedAt).toBe('string')
  } finally {
    await Deno.remove(tmp, { recursive: true })
  }
})

Deno.test('starts machine when mapping exists but machine stopped', async () => {
  const tmp = await Deno.makeTempDir()
  try {
    const mappingDir = join(tmp, 'computers')
    await Deno.mkdir(mappingDir, { recursive: true })
    await Deno.writeTextFile(
      join(mappingDir, 'foo.json'),
      JSON.stringify({ machineId: 'm-2', subdomain: 'foo' }, null, 2),
    )

    let started: string | undefined
    const handler = await setupHandler({
      tmpDir: tmp,
      fly: {
        getMachine: (machineId) =>
          Promise.resolve({
            id: machineId,
            name: 'computer-foo',
            state: 'stopped',
            config: {},
          }),
        listMachines: () => Promise.resolve([]),
        createMachine: () =>
          Promise.resolve({ id: 'new', name: 'computer-foo' }),
        startMachine: (machineId) => {
          started = machineId
          return Promise.resolve()
        },
      },
    })

    const res = await handler(
      new Request('http://foo.example.test/', {
        headers: { host: 'foo.example.test' },
      }),
    )
    expect(res.status).toBe(204)
    expect(started).toBe('m-2')
  } finally {
    await Deno.remove(tmp, { recursive: true })
  }
})

Deno.test('reuses machine discovered by metadata when mapping missing', async () => {
  const tmp = await Deno.makeTempDir()
  try {
    let listed = false
    const handler = await setupHandler({
      tmpDir: tmp,
      fly: {
        getMachine: (machineId) =>
          Promise.resolve({
            id: machineId,
            name: 'computer-foo',
            state: 'started',
            config: {},
            metadata: { artifact_subdomain: 'foo' },
          }),
        listMachines: () => {
          listed = true
          return Promise.resolve([{
            id: 'm-meta',
            name: 'computer-foo',
            metadata: { artifact_subdomain: 'foo' },
          }])
        },
        createMachine: () => Promise.resolve({ id: 'should-not-create' }),
        startMachine: () => Promise.resolve(),
      },
    })

    const res = await handler(
      new Request('http://foo.example.test/', {
        headers: { host: 'foo.example.test' },
      }),
    )
    expect(res.status).toBe(204)
    expect(listed).toBe(true)
    const registryFile = join(tmp, 'computers', 'foo.json')
    const saved = JSON.parse(await Deno.readTextFile(registryFile))
    expect(saved.machineId).toBe('m-meta')
  } finally {
    await Deno.remove(tmp, { recursive: true })
  }
})

Deno.test('creates new machine when none exist and records mapping', async () => {
  const tmp = await Deno.makeTempDir()
  try {
    const configs: Record<string, unknown>[] = []
    const startCalls: string[] = []

    const handler = await setupHandler({
      tmpDir: tmp,
      fly: {
        getMachine: (machineId) => {
          if (machineId === 'template') {
            return Promise.resolve({
              id: 'template',
              name: 'root',
              state: 'started',
              config: { metadata: { foo: 'bar' }, image: 'template-image' },
            })
          }
          return Promise.resolve({
            id: machineId,
            name: 'computer-foo',
            state: 'stopped',
            config: {},
          })
        },
        listMachines: () => Promise.resolve([{ id: 'template', name: 'root' }]),
        createMachine: ({ name, config }) => {
          configs.push(config)
          expect(name).toBe('computer-foo')
          return Promise.resolve({ id: 'new-machine', name })
        },
        startMachine: (machineId) => {
          startCalls.push(machineId)
          return Promise.resolve()
        },
      },
    })

    const res = await handler(
      new Request('http://foo.example.test/', {
        headers: { host: 'foo.example.test' },
      }),
    )
    expect(res.status).toBe(204)
    expect(res.headers.get('fly-replay')).toBe(
      'app=universal-compute;instance=new-machine',
    )
    expect(configs.length).toBe(1)
    const savedConfig = configs[0]
    expect(savedConfig.image).toBe('registry.fly.io/universal-compute:latest')
    expect(
      (savedConfig.metadata as { artifact_subdomain?: string })
        .artifact_subdomain,
    ).toBe('foo')
    expect(startCalls).toEqual(['new-machine'])

    const saved = JSON.parse(
      await Deno.readTextFile(join(tmp, 'computers', 'foo.json')),
    ) as Record<string, unknown>
    expect(saved.machineId).toBe('new-machine')
    expect(saved.machineName).toBe('computer-foo')
    expect(saved.subdomain).toBe('foo')
  } finally {
    await Deno.remove(tmp, { recursive: true })
  }
})
