import { runSelfMountCheck } from '@artifact/tasks'
import {
  FLY_NFS_MOUNT_DIR,
  FLY_NFS_SUBPATH,
  NFS_EXPORT_BASE,
} from '@artifact/shared'

async function main() {
  const app = Deno.env.get('FLY_NFS_APP')?.trim()
  if (!app) {
    throw new Error('FLY_NFS_APP must be set for self mount check')
  }
  const source = `${app}.flycast`
  await runSelfMountCheck({
    mountOptions: {
      source,
      mountDir: FLY_NFS_MOUNT_DIR,
      exportBase: NFS_EXPORT_BASE,
      subpath: FLY_NFS_SUBPATH,
    },
  })
}

if (import.meta.main) {
  main().catch((error) => {
    const message = error instanceof Error ? error.message : String(error)
    console.error(message)
    Deno.exit(1)
  })
}
