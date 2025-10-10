import { expect } from '@std/expect'
import { join } from '@std/path'
import { COMPUTER_AGENTS, COMPUTER_EXEC } from '@artifact/shared'
import { createReconciler } from './reconcile.ts'
import type { HostInstance } from '@artifact/fly-nfs/schemas'

class ReconcileTestSetup implements AsyncDisposable {
  readonly computerDir: string
  readonly execDir: string
  readonly agentsDir: string
  readonly instancePath: string
  readonly agentEntryPath: string

  constructor(
    readonly root: string,
    readonly computerId: string,
    readonly instanceName: string,
  ) {
    this.computerDir = join(root, computerId)
    this.execDir = join(this.computerDir, COMPUTER_EXEC)
    this.agentsDir = join(this.computerDir, COMPUTER_AGENTS)
    this.instancePath = join(this.execDir, instanceName)
    this.agentEntryPath = join(this.agentsDir, this.instanceName)
  }

  async init() {
    await Deno.mkdir(this.execDir, { recursive: true })
    await Deno.mkdir(this.agentsDir, { recursive: true })
  }

  async ensureAgentDirectory() {
    await Deno.mkdir(this.agentEntryPath, { recursive: true })
  }

  async ensureAgentFile() {
    await Deno.writeTextFile(this.agentEntryPath, '')
  }

  async instanceExists() {
    try {
      await Deno.stat(this.instancePath)
      return true
    } catch (error) {
      if (error instanceof Deno.errors.NotFound) return false
      throw error
    }
  }

  async [Symbol.asyncDispose]() {
    await Deno.remove(this.root, { recursive: true })
  }
}

const createTestSetup = async (
  options: { computerId?: string; instanceName?: string } = {},
) => {
  const computerId = options.computerId ?? 'computer'
  const instanceName = options.instanceName ?? 'worker.json'
  const root = await Deno.makeTempDir()
  const setup = new ReconcileTestSetup(root, computerId, instanceName)
  await setup.init()
  return setup
}

Deno.test('reconcile starts queued instance', async () => {
  await using setup = await createTestSetup({ computerId: 'computer-start' })
  await setup.ensureAgentDirectory()

  const startCalls: HostInstance[] = []
  const loadAgentCalls: Array<
    { machineId: string; computerId: string; agentId: string }
  > = []
  const {
    reconcile,
    writeInstance,
    readInstance,
  } = createReconciler({
    computerDir: setup.root,
    startInstance: (instance, computerId) => {
      startCalls.push(structuredClone(instance))
      expect(instance.hardware).toBe('starting')
      expect(computerId).toBe('computer-start')
      return Promise.resolve('machine-123')
    },
    loadAgent: (machineId, computerId, agentId) => {
      loadAgentCalls.push({ machineId, computerId, agentId })
      expect(machineId).toBe('machine-123')
      expect(computerId).toBe('computer-start')
      expect(agentId).toBe('worker')
      return Promise.resolve()
    },
  })

  await writeInstance(setup.instancePath, {
    software: 'running',
    hardware: 'queued',
    record: {
      image: 'registry/image:latest',
      cpu_kind: 'shared',
      cpus: 1,
      memory_mb: 1024,
    },
  })

  const changeCount = await reconcile(setup.computerId)
  expect(changeCount).toBe(1)
  expect(startCalls.length).toBe(1)
  expect(loadAgentCalls.length).toBe(1)

  const updated = await readInstance(setup.instancePath)
  expect(updated.hardware).toBe('running')
  expect(updated.machineId).toBe('machine-123')
})

Deno.test('reconcile stops running instance', async () => {
  await using setup = await createTestSetup({ computerId: 'computer-stop' })
  await setup.ensureAgentDirectory()

  const stopCalls: HostInstance[] = []
  const { reconcile, writeInstance } = createReconciler({
    computerDir: setup.root,
    stopInstance: (instance, computerId) => {
      stopCalls.push(structuredClone(instance))
      expect(instance.hardware).toBe('stopping')
      expect(computerId).toBe('computer-stop')
      return Promise.resolve()
    },
  })

  await writeInstance(setup.instancePath, {
    software: 'stopped',
    hardware: 'running',
    record: {
      image: 'registry/image:latest',
      cpu_kind: 'shared',
      cpus: 1,
      memory_mb: 1024,
    },
    machineId: 'machine-existing',
  })

  const changeCount = await reconcile(setup.computerId)
  expect(changeCount).toBe(1)
  expect(stopCalls.length).toBe(1)
  expect(await setup.instanceExists()).toBe(false)
})
