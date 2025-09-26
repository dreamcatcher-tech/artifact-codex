import { envs, NFS_MOUNT_DIR } from '@artifact/shared'
import { join } from '@std/path'

export const createComputer = async (computer: string) => {
  const path = join(NFS_MOUNT_DIR, computer)

  const agents = join(path, 'agents')
  const containers = join(path, 'containers')
  const repos = join(path, 'repos')
  await Promise.all([
    Deno.mkdir(agents, { recursive: true }),
    Deno.mkdir(containers, { recursive: true }),
    Deno.mkdir(repos, { recursive: true }),
  ])
}

export const upsertLandingAgent = async (computer: string) => {
  const path = join(NFS_MOUNT_DIR, computer)
  const agents = join(path, 'agents')
}
