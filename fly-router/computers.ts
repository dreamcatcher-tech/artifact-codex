import { envs, NFS_MOUNT_DIR } from '@artifact/shared'
import { join } from '@std/path'

type ComputerManagerOptions = {
  computerDir?: string
}

export function createComputerManager(options: ComputerManagerOptions) {
  const { computerDir = NFS_MOUNT_DIR } = options

  const upsertComputer = async (computer: string) => {
    const path = join(computerDir, computer)

    const agents = join(path, 'agents')
    const containers = join(path, 'containers')
    const repos = join(path, 'repos')
    await Promise.all([
      Deno.mkdir(agents, { recursive: true }),
      Deno.mkdir(containers, { recursive: true }),
      Deno.mkdir(repos, { recursive: true }),
    ])
  }

  const upsertLandingAgent = async (computer: string) => {
    const path = join(computerDir, computer)
    const agents = join(path, 'agents')
  }

  return {
    upsertComputer,
    upsertLandingAgent,
  }
}
