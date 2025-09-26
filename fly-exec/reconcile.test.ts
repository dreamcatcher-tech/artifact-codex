import { expect } from '@std/expect'
import { join } from '@std/path'
import { COMPUTER_AGENTS, COMPUTER_EXEC } from '@artifact/shared'
import { createReconciler } from './reconcile.ts'
import type { ExecInstance } from './schemas.ts'

class ReconcileTestSetup implements AsyncDisposable {
  readonly computerDir: string
  readonly execDir: string
  readonly agentsDir: string
  readonly instancePath: string

  constructor(
    readonly root: string,
    readonly computerId: string,
    readonly instanceName: string,
  ) {
    this.computerDir = join(root, computerId)
    this.execDir = join(this.computerDir, COMPUTER_EXEC)
    this.agentsDir = join(this.computerDir, COMPUTER_AGENTS)
    this.instancePath = join(this.execDir, instanceName)
  }

  async init() {
    await Deno.mkdir(this.execDir, { recursive: true })
    await Deno.mkdir(this.agentsDir, { recursive: true })
  }

  async writeInstance(instance: ExecInstance) {
    const body = JSON.stringify(instance, null, 2) + '\n'
    await Deno.writeTextFile(this.instancePath, body)
  }

  async readInstance(): Promise<ExecInstance> {
    const contents = await Deno.readTextFile(this.instancePath)
    return JSON.parse(contents)
  }

  async ensureAgentDirectory() {
    await Deno.mkdir(join(this.agentsDir, this.instanceName), {
      recursive: true,
    })
  }

  async ensureAgentFile() {
    await Deno.writeTextFile(join(this.agentsDir, this.instanceName), '')
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
  await setup.writeInstance({
    software: 'running',
    hardware: 'queued',
    image: 'registry/image:latest',
  })

  const startCalls: ExecInstance[] = []
  const reconciler = createReconciler({
    computerDir: setup.root,
    startInstance: (instance) => {
      startCalls.push(structuredClone(instance))
      expect(instance.hardware).toBe('starting')
      return Promise.resolve('machine-123')
    },
  })

  const changeCount = await reconciler(setup.computerId)
  expect(changeCount).toBe(1)
  expect(startCalls.length).toBe(1)

  const updated = await setup.readInstance()
  expect(updated.hardware).toBe('starting')
  expect(updated.machineId).toBe('machine-123')
})

Deno.test('reconcile stops running instance', async () => {
  await using setup = await createTestSetup({ computerId: 'computer-stop' })
  await setup.ensureAgentDirectory()
  await setup.writeInstance({
    software: 'stopped',
    hardware: 'running',
    image: 'registry/image:latest',
    machineId: 'machine-existing',
  })

  const stopCalls: ExecInstance[] = []
  const reconciler = createReconciler({
    computerDir: setup.root,
    stopInstance: (instance) => {
      stopCalls.push(structuredClone(instance))
      expect(instance.hardware).toBe('stopping')
      return Promise.resolve()
    },
  })

  const changeCount = await reconciler(setup.computerId)
  expect(changeCount).toBe(1)
  expect(stopCalls.length).toBe(1)
  expect(await setup.instanceExists()).toBe(false)
})

Deno.test('reconcile ignores instances without agent directories', async () => {
  await using setup = await createTestSetup({
    computerId: 'computer-missing',
  })
  await setup.ensureAgentFile()
  const initial: ExecInstance = {
    software: 'running',
    hardware: 'queued',
    image: 'registry/image:latest',
  }
  await setup.writeInstance(initial)

  const reconciler = createReconciler({ computerDir: setup.root })
  const changeCount = await reconciler(setup.computerId)
  expect(changeCount).toBe(0)

  const final = await setup.readInstance()
  expect(final).toEqual(initial)
})
