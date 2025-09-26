import {
  COMPUTER_AGENTS,
  COMPUTER_EXEC,
  COMPUTER_REPOS,
  NFS_MOUNT_DIR,
} from '@artifact/shared'
import { join } from '@std/path'

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

    return 'asdf'
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
    // we have the agent name
    // check if there is an instance already running
    // else create a new one
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
