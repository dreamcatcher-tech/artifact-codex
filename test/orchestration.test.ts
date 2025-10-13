import { expect } from '@std/expect'
import { ensureDir } from '@std/fs'
import { join } from '@std/path'
import { createApp as createRouterApp } from '../fly-router/app.ts'
import { createApp as createExecApp } from '../fly-exec/app.ts'
import type { HostInstance } from '@artifact/fly-nfs/schemas'
import {
  COMPUTER_AGENT_CONTAINERS,
  COMPUTER_EXEC,
  COMPUTER_REPOS,
  REPO_CONTAINER_IMAGES,
} from '../shared/const.ts'

const CLERK_SECRET = 'sk_test_dummy_secret_key_1234567890'
const CLERK_PUBLISHABLE = 'pk_test_dGFtZS1saW9uLTEuY2xlcmsuYWNjb3VudHMuZGV2JA=='

function setTestEnv(baseDomain: string, workerApp: string) {
  Deno.env.set('CLERK_SECRET_KEY', CLERK_SECRET)
  Deno.env.set('CLERK_PUBLISHABLE_KEY', CLERK_PUBLISHABLE)
  Deno.env.set('DC_DOMAIN', baseDomain)
  Deno.env.set('DC_WORKER_POOL_APP', workerApp)
  Deno.env.set('DC_FLY_API_TOKEN', 'test-token')
  Deno.env.set('DC_NFS', '/test-nfs')
  Deno.env.set('DC_EXEC', 'exec.test.internal')
  Deno.env.set('DC_OPENAI_PROXY_BASE_URL', 'https://localhost')
}

async function seedImageRecord(root: string) {
  const containersDir = join(
    root,
    COMPUTER_AGENT_CONTAINERS,
    COMPUTER_REPOS,
    REPO_CONTAINER_IMAGES,
  )
  await ensureDir(containersDir)
  const payload = {
    image: 'registry.fly.io/mock/host-coder:latest',
    cpu_kind: 'shared' as const,
    cpus: 1,
    memory_mb: 256,
  }
  await Deno.writeTextFile(
    join(containersDir, 'host-coder.json'),
    JSON.stringify(payload, null, 2),
  )
}

function createExecHarness(computerDir: string) {
  type MachineInfo = { computerId: string; agentId?: string }
  const machines = new Map<string, MachineInfo>()
  const loads: Array<
    { machineId: string; computerId: string; agentId: string }
  > = []

  function startInstance(
    _instance: HostInstance,
    computerId: string,
  ): Promise<string> {
    const machineId = `machine-${crypto.randomUUID()}`
    machines.set(machineId, { computerId })
    return Promise.resolve(machineId)
  }

  function stopInstance(instance: HostInstance): Promise<void> {
    if (instance.machineId) {
      machines.delete(instance.machineId)
    }
    return Promise.resolve()
  }

  function loadAgent(
    machineId: string,
    computerId: string,
    agentId: string,
  ): Promise<void> {
    const entry = machines.get(machineId)
    if (!entry) {
      throw new Error(`Unknown machine id ${machineId}`)
    }
    entry.agentId = agentId
    loads.push({ machineId, computerId, agentId })
    return Promise.resolve()
  }

  function listMachineIds(): Promise<Set<string>> {
    return Promise.resolve(new Set(machines.keys()))
  }

  const app = createExecApp({
    computerDir,
    startInstance,
    stopInstance,
    loadAgent,
    listMachineIds,
  })

  return {
    app,
    loads,
    machines,
  }
}

async function consume(response: Response) {
  if (response.bodyUsed) return
  await response.arrayBuffer()
}

Deno.test('router and exec coordinate agent machine lifecycle in-process', async () => {
  const baseDomain = 'suite.test'
  const workerApp = 'worker.suite.test'
  const computerDir = await Deno.makeTempDir({ prefix: 'test-suite-' })
  setTestEnv(baseDomain, workerApp)
  await seedImageRecord(computerDir)

  try {
    const exec = createExecHarness(computerDir)
    const kickExecApp = async (computerId: string) => {
      const url = new URL(`http://exec.internal/changed/${computerId}`)
      const res = await exec.app.fetch(
        new Request(url, { method: 'POST' }),
      )
      if (!res.ok) {
        await consume(res)
        throw new Error(`exec app returned ${res.status}`)
      }
      await consume(res)
    }

    const routerApp = createRouterApp({
      baseDomain,
      computerDir,
      workerPoolApp: workerApp,
      kickExecApp,
    })

    const baseResponse = await routerApp.fetch(
      new Request(`http://${baseDomain}/`),
    )
    expect(baseResponse.status).toBe(307)
    const baseLocation = baseResponse.headers.get('location')
    expect(baseLocation).toBe(`http://test-computer.${baseDomain}/`)
    await baseResponse.body?.cancel?.()

    const computerResponse = await routerApp.fetch(
      new Request(`http://test-computer.${baseDomain}/`),
    )
    expect(computerResponse.status).toBe(307)
    const agentLocation = computerResponse.headers.get('location')
    expect(agentLocation?.startsWith('http://')).toBe(true)
    await computerResponse.body?.cancel?.()

    if (!agentLocation) {
      throw new Error('missing agent redirect')
    }
    const agentUrl = new URL(agentLocation)
    const computerId = agentUrl.hostname.split('--')[1]?.split('.')[0]
    expect(computerId).toBe('test-computer')
    const agentId = agentUrl.hostname.split('--')[0]
    expect(agentId?.length).toBeGreaterThan(0)

    const agentResponse = await routerApp.fetch(new Request(agentLocation))
    expect(agentResponse.status).toBe(202)
    const payload = await agentResponse.json() as {
      app: string
      instance: string
    }
    expect(payload.app).toBe(workerApp)
    expect(exec.loads.length).toBe(1)
    expect(exec.loads[0]).toEqual({
      machineId: payload.instance,
      computerId: 'test-computer',
      agentId,
    })

    const instancePath = join(
      computerDir,
      'test-computer',
      COMPUTER_EXEC,
      `${agentId}.json`,
    )
    const instanceText = await Deno.readTextFile(instancePath)
    const instance = JSON.parse(instanceText) as {
      hardware: string
      machineId: string
    }
    expect(instance.hardware).toBe('running')
    expect(instance.machineId).toBe(payload.instance)
  } finally {
    await Deno.remove(computerDir, { recursive: true })
  }
})
