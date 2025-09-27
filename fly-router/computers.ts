import {
  AGENT_HOME,
  AGENT_TOML,
  AGENT_WORKSPACE,
  COMPUTER_AGENT_CONTAINERS,
  COMPUTER_AGENTS,
  COMPUTER_EXEC,
  COMPUTER_REPOS,
  envs,
  NFS_MOUNT_DIR,
  REPO_CONTAINER_IMAGES,
} from '@artifact/shared'
import { join } from '@std/path'
import { ensureDir } from '@std/fs'
import {
  adjectives,
  animals,
  uniqueNamesGenerator,
} from 'unique-names-generator'
import { createReconciler } from '@artifact/fly-exec'
import { readImageRecord } from '@artifact/fly-nfs'

type ComputerManagerOptions = {
  computerDir?: string
  kickExecApp?: (computerId: string) => Promise<void>
}

export function createComputerManager(options: ComputerManagerOptions) {
  const { computerDir = NFS_MOUNT_DIR, kickExecApp = baseKickExecApp } = options

  const upsertComputer = async (computer: string) => {
    const path = join(computerDir, computer)

    const agents = join(path, COMPUTER_AGENTS)
    const exec = join(path, COMPUTER_EXEC)
    const repos = join(path, COMPUTER_REPOS)
    await ensureDir(agents)
    await ensureDir(exec)
    await ensureDir(repos)
  }

  const upsertLandingAgent = async (computer: string) => {
    const path = join(computerDir, computer)
    const agents = join(path, 'agents')

    const name = await makeAgentFolder(agents)
    await populateAgent(join(agents, name))
    return name
  }

  const computerExists = async (computer: string) => {
    const path = join(computerDir, computer)
    const agents = join(path, COMPUTER_AGENTS)
    const exec = join(path, COMPUTER_EXEC)
    const repos = join(path, COMPUTER_REPOS)
    const results = await Promise.all([
      Deno.stat(agents),
      Deno.stat(exec),
      Deno.stat(repos),
    ])
    return results.every((result) => result.isDirectory)
  }

  const agentExists = async (computerId: string, agentId: string) => {
    const path = join(computerDir, computerId, COMPUTER_AGENTS, agentId)
    try {
      const info = await Deno.stat(path)
      return info.isDirectory
    } catch {
      return false
    }
  }

  const upsertExec = async (computerId: string, agentId: string) => {
    const filename = agentId + '.json'
    const path = join(computerDir, computerId, COMPUTER_EXEC, filename)
    const { readInstance, writeInstance } = createReconciler({ computerDir })
    try {
      await readInstance(path)
    } catch {
      const record = await readLatestRecord()
      writeInstance(path, { software: 'running', hardware: 'queued', record })
    }
  }

  const waitForMachineId = async (computerId: string, agentId: string) => {
    const path = join(computerDir, computerId, COMPUTER_EXEC, `${agentId}.json`)
    const { readInstance } = createReconciler({ computerDir })

    await kickExecApp(computerId)

    let instance
    const start = Date.now()
    do {
      instance = await readInstance(path)
      if (instance.hardware === 'running') {
        return
      }
      await new Promise((resolve) => setTimeout(resolve, 10))
    } while (Date.now() - start < 60_000)
    throw new Error('Instance did not start within 60 seconds')
  }

  const shutdownComputer = async (computerId: string) => {
    const { readInstance, writeInstance, getInstancePaths } = createReconciler({
      computerDir,
    })
    for (const path of await getInstancePaths(computerId)) {
      const instance = await readInstance(path)
      if (instance.software !== 'stopped') {
        instance.software = 'stopped'
        await writeInstance(path, instance)
      }
    }
    await kickExecApp(computerId)
  }

  const deleteComputer = async (computerId: string) => {
    await shutdownComputer(computerId)
    await Deno.remove(join(computerDir, computerId), { recursive: true })
  }

  const readLatestRecord = async () => {
    const containersDir = join(
      computerDir,
      COMPUTER_AGENT_CONTAINERS,
      COMPUTER_REPOS,
      REPO_CONTAINER_IMAGES,
    )
    const recordPath = join(containersDir, 'agent-basic.json')
    return await readImageRecord(recordPath)
  }

  return {
    upsertComputer,
    upsertLandingAgent,
    computerExists,
    agentExists,
    upsertExec,
    waitForMachineId,
    shutdownComputer,
    deleteComputer,
  }
}

async function baseKickExecApp(computerId: string) {
  const execApp = envs.DC_EXEC()
  const url = 'http://' + execApp + '/changed/' + computerId
  console.log('kicking exec app:', url)
  const result = await fetch(url, { method: 'POST' })
  if (!result.ok) {
    throw new Error('Failed to kick exec app')
  }
}

async function makeAgentFolder(path: string) {
  while (true) {
    const name = uniqueNamesGenerator({
      dictionaries: [adjectives, animals],
      length: 2,
      separator: '-',
      style: 'lowerCase',
    })
    try {
      await Deno.mkdir(join(path, name))
      return name
    } catch {
      continue
    }
  }
}

async function populateAgent(name: string) {
  return await Promise.all([
    Deno.mkdir(join(name, AGENT_HOME)),
    Deno.mkdir(join(name, AGENT_WORKSPACE)),
    Deno.writeTextFile(join(name, AGENT_TOML), ''),
  ])
}
