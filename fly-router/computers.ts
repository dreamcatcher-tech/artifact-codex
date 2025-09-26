import {
  AGENT_HOME,
  AGENT_TOML,
  AGENT_WORKSPACE,
  COMPUTER_AGENT_CONTAINERS,
  COMPUTER_AGENTS,
  COMPUTER_EXEC,
  COMPUTER_REPOS,
  NFS_MOUNT_DIR,
  REPO_CONTAINER_IMAGES,
} from '@artifact/shared'
import { join } from '@std/path'
import {
  adjectives,
  animals,
  uniqueNamesGenerator,
} from 'unique-names-generator'
import { createReconciler } from '@artifact/fly-exec'

type ComputerManagerOptions = {
  computerDir?: string
  execApp?: string
}

export function createComputerManager(options: ComputerManagerOptions) {
  const { computerDir = NFS_MOUNT_DIR } = options

  const upsertComputer = async (computer: string) => {
    const path = join(computerDir, computer)

    const agents = join(path, COMPUTER_AGENTS)
    const exec = join(path, COMPUTER_EXEC)
    const repos = join(path, COMPUTER_REPOS)
    await Promise.all([
      Deno.mkdir(agents, { recursive: true }),
      Deno.mkdir(exec, { recursive: true }),
      Deno.mkdir(repos, { recursive: true }),
    ])
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
      const image = await readLatestImage()
      writeInstance(path, { software: 'running', hardware: 'queued', image })
    }
  }

  const execRunning = async (computerId: string, agentId: string) => {
    return 'asdf'
  }

  const shutdownComputer = async (computerId: string) => {
    // mark all instances as stopped
    // await the response to the exec app
    return 'asdf'
  }

  const deleteComputer = async (computerId: string) => {
    await shutdownComputer(computerId)
    // check there are no instances running
    // delete the computer folder
    await Deno.remove(join(computerDir, computerId), { recursive: true })
  }

  const readLatestImage = async () => {
    const containersDir = join(
      computerDir,
      COMPUTER_AGENT_CONTAINERS,
      COMPUTER_REPOS,
      REPO_CONTAINER_IMAGES,
    )
    const recordPath = join(containersDir, 'agent-basic.json')
    const text = await Deno.readTextFile(recordPath)
    const json = JSON.parse(text)
    return json.image
  }

  return {
    upsertComputer,
    upsertLandingAgent,
    computerExists,
    agentExists,
    upsertExec,
    execRunning,
    shutdownComputer,
    deleteComputer,
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
      await Deno.mkdir(join(path, name), { recursive: true })
      return name
    } catch {
      continue
    }
  }
}

async function populateAgent(name: string) {
  return await Promise.all([
    Deno.mkdir(join(name, AGENT_HOME), { recursive: true }),
    Deno.mkdir(join(name, AGENT_WORKSPACE), { recursive: true }),
    Deno.writeTextFile(join(name, AGENT_TOML), ''),
  ])
}
