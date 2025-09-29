import Debug from 'debug'
import { envs, NFS_MOUNT_DIR, NFS_SHARE_PATH } from '@artifact/shared'
import { ensureDir } from '@std/fs'

export async function mount(
  log: Debug.Debugger,
  mode: 'sync' | 'async' = 'async',
): Promise<void> {
  const source = envs.DC_NFS()
  const target = `${source}:${NFS_SHARE_PATH}`
  log('mounting NFS share target=%s mountDir=%s', target, NFS_MOUNT_DIR)

  await ensureDir(NFS_MOUNT_DIR)

  // agent and machine files can race if not synchronous
  // but repos and big workdirs are never concurrently accessed
  const mountOptions = 'nfsvers=4.1,' + mode

  const command = new Deno.Command('mount', {
    args: ['-t', 'nfs4', '-o', mountOptions, target, NFS_MOUNT_DIR],
  })
  const { code, stderr, stdout } = await command.output()
  if (code !== 0) {
    const msg = new TextDecoder().decode(stderr)
    throw new Error('Failed to mount NFS share: ' + msg)
  }
  log('NFS mount ready: %s', new TextDecoder().decode(stdout))
}
