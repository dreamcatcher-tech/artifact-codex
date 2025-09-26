import { ExecInstance, execInstanceSchema } from './schemas.ts'
import { basename, join } from '@std/path'
import {
  COMPUTER_AGENTS,
  COMPUTER_EXEC,
  envs,
  NFS_MOUNT_DIR,
  readFlyMachineRuntimeEnv,
} from '@artifact/shared'
import { createClient } from 'fly-admin'

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
      promises.push(syncInstance(computerId, path))
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

  const syncInstance = async (computerId: string, path: string) => {
    const instance = await readInstance(path)
    console.log('instance', path, instance)
    const { software, hardware } = instance
    const agent = basename(path)
    const agentPath = join(computerDir, computerId, COMPUTER_AGENTS, agent)
    const agentEntry = await Deno.stat(agentPath)
    if (!agentEntry || !agentEntry.isDirectory) {
      console.error('agent folder does not exist', agentPath)
      return false
    }

    if (software === 'running' && hardware === 'queued') {
      instance.hardware = 'starting'
      await writeInstance(path, instance)
      const machineId = await startInstance(instance)
      instance.machineId = machineId
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

  return reconcile
}

const baseStartInstance = async (instance: ExecInstance) => {
  const apiKey = envs.DC_FLY_API_TOKEN()
  const flyEnv = readFlyMachineRuntimeEnv()
  const app_name = flyEnv.FLY_APP_NAME
  const fly = createClient(apiKey)
  const result = await fly.Machine.createMachine({
    app_name,
    config: {
      image: instance.image,
      metadata: { fly_platform_version: 'standalone' },
    },
  })
  console.log('machine created', result)
  return result.id
}

const baseStopInstance = async (instance: ExecInstance) => {
  const apiKey = envs.DC_FLY_API_TOKEN()
  const flyEnv = readFlyMachineRuntimeEnv()
  const app_name = flyEnv.FLY_APP_NAME
  const fly = createClient(apiKey)
  const { machineId: machine_id } = instance
  if (!machine_id) {
    throw new Error('machineId is required to stop an instance')
  }
  const result = await fly.Machine.deleteMachine({
    app_name,
    machine_id,
    force: true,
  })
  console.log('machine stopped', result)
}
