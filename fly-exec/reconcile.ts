import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { HostInstance, hostInstanceSchema } from '@artifact/fly-nfs/schemas'
import { basename, join } from '@std/path'
import {
  COMPUTER_EXEC,
  envs,
  NFS_MOUNT_DIR,
  SERVICE_AGENT_CONTROL,
  SERVICE_VIEW_BROAD_PORTS,
  SERVICE_VIEW_DEFAULT,
} from '@artifact/shared'
import { FlyIoClient } from '@alexarena/fly-io-client'
import Debug from 'debug'

const log = Debug('@artifact/fly-exec:reconcile')

const PING_INTERVAL_MS = 100
const PING_TIMEOUT_MS = 60_000

type ReconcilerOptions = {
  computerDir?: string
  startInstance?: (
    instance: HostInstance,
    computerId: string,
  ) => Promise<string>
  stopInstance?: (instance: HostInstance, computerId: string) => Promise<void>
  loadAgent?: (
    machineId: string,
    computerId: string,
    agentId: string,
  ) => Promise<void>
}

export const createReconciler = (options: ReconcilerOptions = {}) => {
  const {
    computerDir = NFS_MOUNT_DIR,
    startInstance = baseStartInstance,
    stopInstance = baseStopInstance,
    loadAgent = baseLoadAgent,
  } = options

  const reconcile = async (computerId: string): Promise<number> => {
    computerId = computerId.toLowerCase()
    const paths = await getInstancePaths(computerId)

    const promises: Promise<boolean>[] = []
    for (const path of paths) {
      promises.push(syncInstance(path, computerId))
    }
    const results = await Promise.all(promises)
    const changeCount = results.filter(Boolean).length
    return changeCount
  }

  const getInstancePaths = async (computerId: string): Promise<string[]> => {
    computerId = computerId.toLowerCase()
    const path = join(computerDir, computerId, COMPUTER_EXEC)
    const paths = []
    for await (const entry of Deno.readDir(path)) {
      if (entry.isDirectory) continue
      if (!entry.name.toLowerCase().endsWith('.json')) continue
      const filePath = join(path, entry.name.toLowerCase())
      paths.push(filePath)
    }
    return paths
  }

  const readInstance = async (filePath: string): Promise<HostInstance> => {
    const string = await Deno.readTextFile(filePath)
    const json = JSON.parse(string)
    const instance = hostInstanceSchema.parse(json)
    return instance
  }

  const syncInstance = async (path: string, computerId: string) => {
    computerId = computerId.toLowerCase()
    const instance = await readInstance(path)
    const agentId = basename(path, '.json')
    log('syncInstance', path, instance.software, instance.hardware)

    let changed = false

    if (instance.software === 'running') {
      if (instance.hardware === 'queued') {
        instance.hardware = 'starting'
        await writeInstance(path, instance)

        const machineId = await startInstance(instance, computerId)
        instance.machineId = machineId
        instance.hardware = 'loadable'
        await writeInstance(path, instance)
        changed = true
      }

      if (instance.hardware === 'loadable') {
        if (!instance.machineId) {
          throw new Error('machineId is required to load an agent')
        }
        await loadAgent(instance.machineId, computerId, agentId)
        instance.hardware = 'running'
        await writeInstance(path, instance)
        changed = true
      }
    }

    if (instance.software === 'stopped') {
      if (instance.hardware === 'running') {
        instance.hardware = 'stopping'
        await writeInstance(path, instance)
        await stopInstance(instance, computerId)
        await deleteInstance(path)
        changed = true
      }
    }
    return changed
  }

  const writeInstance = async (path: string, instance: HostInstance) => {
    const record = hostInstanceSchema.parse(instance)
    const body = JSON.stringify(record, null, 2) + '\n'
    await Deno.writeTextFile(path, body)
  }

  const deleteInstance = async (path: string) => {
    await Deno.remove(path)
  }

  return {
    reconcile,
    readInstance,
    writeInstance,
    deleteInstance,
    getInstancePaths,
  }
}

const baseStartInstance = async (
  instance: HostInstance,
  computerId: string,
) => {
  computerId = computerId.toLowerCase()
  const apiKey = envs.DC_FLY_API_TOKEN()
  const app_name = envs.DC_WORKER_POOL_APP()
  const fly = new FlyIoClient({ apiKey, maxRetries: 30 })

  const { image, cpu_kind, cpus, memory_mb } = instance.record
  log('baseStartInstance', { app_name, image, cpu_kind, cpus, memory_mb })
  const result = await fly.apps.machines.create(app_name, {
    config: {
      auto_destroy: true,
      restart: { policy: 'no' },
      init: { swap_size_mb: 2048 },
      guest: { cpu_kind, cpus, memory_mb },
      image,
      metadata: {
        fly_platform_version: 'standalone',
        dc_computer_id: computerId,
      },
      env: {
        DC_NFS: envs.DC_NFS(),
        DC_DOMAIN: envs.DC_DOMAIN(),
        DC_EXEC: envs.DC_EXEC(),
        DC_OPENAI_PROXY_BASE_URL: envs.DC_OPENAI_PROXY_BASE_URL(),
      },
      services: [
        SERVICE_AGENT_CONTROL,
        SERVICE_VIEW_DEFAULT,
        SERVICE_VIEW_BROAD_PORTS,
      ],
    },
  })
  log('machine created', result)
  if (!result.id) {
    throw new Error('Fly Machines API did not return a machine id')
  }
  return result.id
}

const baseStopInstance = async (instance: HostInstance, computerId: string) => {
  computerId = computerId.toLowerCase()
  const apiKey = envs.DC_FLY_API_TOKEN()
  const app_name = envs.DC_WORKER_POOL_APP()
  const fly = new FlyIoClient({ apiKey, maxRetries: 30 })
  const { machineId: machine_id } = instance
  if (!machine_id) {
    throw new Error('machineId is required to stop an instance')
  }
  await fly.apps.machines.destroy(machine_id, { app_name, force: true })
  log('machine destroyed', { machine_id, computerId })
}

const baseLoadAgent = async (
  machineId: string,
  computerId: string,
  agentId: string,
) => {
  const poolApp = envs.DC_WORKER_POOL_APP()
  const url = `http://${machineId}.vm.${poolApp}.internal:8080`
  log('baseLoadAgent', { url, computerId, agentId })

  const pingUrl = new URL('/ping', url)
  const start = Date.now()
  while (true) {
    try {
      const response = await fetch(pingUrl)
      if (response.ok) {
        break
      }
      log('ping waiting', {
        status: response.status,
        statusText: response.statusText,
      })
    } catch (error) {
      log('ping error', error)
    }
    if (Date.now() - start > PING_TIMEOUT_MS) {
      throw new Error('Timed out waiting for agent ping response')
    }
    await new Promise((resolve) => setTimeout(resolve, PING_INTERVAL_MS))
  }

  const client = new Client({ name: 'exec', version: '0.0.0' })
  const transport = new StreamableHTTPClientTransport(new URL(url))
  await client.connect(transport)
  const result = await client.callTool({
    name: 'load',
    arguments: { computerId, agentId },
  }) as CallToolResult
  if (!result.structuredContent?.ok) {
    log('baseLoadAgent failed', result)
    throw new Error('Failed to load agent')
  }
  log('baseLoadAgent success', result)
}
