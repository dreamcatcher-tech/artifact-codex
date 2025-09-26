import Debug from 'debug'
import { envs, NFS_MOUNT_DIR, NFS_SHARE_PATH } from '@artifact/shared'

const log = Debug('@artifact/fly-nfs:nfs-mount')

export async function mount(): Promise<void> {
  const source = envs.DC_NFS()
  const target = `${source}:${NFS_SHARE_PATH}`
  log('mounting NFS share target=%s mountDir=%s', target, NFS_MOUNT_DIR)

  await Deno.mkdir(NFS_MOUNT_DIR, { recursive: true })

  const command = new Deno.Command('mount', {
    args: ['-t', 'nfs4', '-o', 'nfsvers=4.1', target, NFS_MOUNT_DIR],
  })
  const { code, stderr, stdout } = await command.output()
  if (code !== 0) {
    const msg = new TextDecoder().decode(stderr)
    throw new Error('Failed to mount NFS share: ' + msg)
  }
  log('NFS mount ready: %s', new TextDecoder().decode(stdout))
}
