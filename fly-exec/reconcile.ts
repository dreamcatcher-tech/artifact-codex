import { ExecInstance, execInstanceSchema } from '@artifact/fly-nfs/schemas'
import { join } from '@std/path'
import { COMPUTER_EXEC, envs, NFS_MOUNT_DIR } from '@artifact/shared'
import { FlyIoClient } from '@alexarena/fly-io-client'
import Debug from 'debug'

const log = Debug('@artifact/fly-exec:reconcile')

type ReconcilerOptions = {
  computerDir?: string
  startInstance?: (instance: ExecInstance) => Promise<string>
  stopInstance?: (instance: ExecInstance) => Promise<void>
}

export const createReconciler = (options: ReconcilerOptions = {}) => {
  const {
    computerDir = NFS_MOUNT_DIR,
    startInstance = baseStartInstance,
    stopInstance = baseStopInstance,
  } = options

  const reconcile = async (computerId: string): Promise<number> => {
    const paths = await getInstancePaths(computerId)

    const promises: Promise<boolean>[] = []
    for (const path of paths) {
      promises.push(syncInstance(path))
    }
    const results = await Promise.all(promises)
    const changeCount = results.filter(Boolean).length
    return changeCount
  }

  const getInstancePaths = async (computerId: string): Promise<string[]> => {
    const path = join(computerDir, computerId, COMPUTER_EXEC)
    const paths = []
    for await (const entry of Deno.readDir(path)) {
      if (entry.isDirectory) continue
      if (!entry.name.toLowerCase().endsWith('.json')) continue
      const filePath = join(path, entry.name)
      paths.push(filePath)
    }
    return paths
  }

  const readInstance = async (filePath: string): Promise<ExecInstance> => {
    const string = await Deno.readTextFile(filePath)
    const json = JSON.parse(string)
    const instance = execInstanceSchema.parse(json)
    return instance
  }

  const syncInstance = async (path: string) => {
    const instance = await readInstance(path)
    const { software, hardware } = instance
    log('syncInstance', path, { software, hardware })

    if (software === 'running' && hardware === 'queued') {
      instance.hardware = 'starting'
      await writeInstance(path, instance)

      const machineId = await startInstance(instance)
      instance.machineId = machineId
      instance.hardware = 'running'
      await writeInstance(path, instance)
      return true
    }

    if (software === 'stopped' && hardware === 'running') {
      instance.hardware = 'stopping'
      await writeInstance(path, instance)
      await stopInstance(instance)
      await deleteInstance(path)
      return true
    }
    return false
  }

  const writeInstance = async (path: string, instance: ExecInstance) => {
    const record = execInstanceSchema.parse(instance)
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

const baseStartInstance = async (instance: ExecInstance) => {
  const apiKey = envs.DC_FLY_API_TOKEN()
  const app_name = envs.DC_WORKER_POOL_APP()
  const fly = new FlyIoClient({ apiKey, maxRetries: 30 })

  const { image, cpu_kind, cpus, memory_mb } = instance.record
  const result = await fly.apps.machines.create(app_name, {
    config: {
      guest: { cpu_kind, cpus, memory_mb },
      image,
      metadata: { fly_platform_version: 'standalone' },
      env: {
        DC_NFS: envs.DC_NFS(),
        DC_DOMAIN: envs.DC_DOMAIN(),
        DC_EXEC: envs.DC_EXEC(),
        DC_OPENAI_PROXY_BASE_URL: envs.DC_OPENAI_PROXY_BASE_URL(),
      },
      services: [
        {
          internal_port: 8080,
          protocol: 'tcp',
          ports: [{
            start_port: 3000,
            end_port: 30000,
            handlers: ['tls', 'http'],
          }],
        },
        {
          internal_port: 8080,
          protocol: 'tcp',
          ports: [{
            force_https: true,
            port: 80,
            handlers: ['http'],
          }, {
            port: 443,
            handlers: ['tls', 'http'],
          }],
        },
      ],
    },
  })
  log('machine created', result)
  if (!result.id) {
    throw new Error('Fly Machines API did not return a machine id')
  }
  return result.id
}

const baseStopInstance = async (instance: ExecInstance) => {
  const apiKey = envs.DC_FLY_API_TOKEN()
  const app_name = envs.DC_WORKER_POOL_APP()
  const fly = new FlyIoClient({ apiKey, maxRetries: 30 })
  const { machineId: machine_id } = instance
  if (!machine_id) {
    throw new Error('machineId is required to stop an instance')
  }
  await fly.apps.machines.destroy(machine_id, { app_name, force: true })
  log('machine destroyed', { machine_id })
}
