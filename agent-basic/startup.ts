import Debug from 'debug'
import { envs, NFS_MOUNT_DIR } from '@artifact/shared'

const log = Debug('@artifact/agent-basic:startup')

export async function mountNfs(): Promise<void> {
  const nfsApp = envs.DC_NFS()
  log('mounting NFS share host=%s mountDir=%s', nfsApp, NFS_MOUNT_DIR)

  await Deno.mkdir(NFS_MOUNT_DIR, { recursive: true })

  const command = new Deno.Command('mount', {
    args: ['-t', 'nfs4', '-o', 'nfsvers=4.1', nfsApp, NFS_MOUNT_DIR],
  })
  const { code, stderr } = await command.output()
  if (code !== 0) {
    const msg = new TextDecoder().decode(stderr)
    throw new Error('Failed to mount NFS share: ' + msg)
  }

  log('NFS mount ready')
}
