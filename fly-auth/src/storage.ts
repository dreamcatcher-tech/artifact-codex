import { ensureNfsMount } from '@artifact/tasks'
import {
  FLY_NFS_SUBPATH,
  NFS_EXPORT_BASE,
  NFS_MOUNT_DIR,
} from '@artifact/shared'
import { join } from '@std/path'

let computersMountPromise: Promise<void> | null = null

export async function ensureComputersMounted(): Promise<void> {
  if (!computersMountPromise) {
    computersMountPromise = ensureNfsMount({
      exportBase: NFS_EXPORT_BASE,
      mountDir: NFS_MOUNT_DIR,
      subpath: FLY_NFS_SUBPATH,
    }).catch((error) => {
      computersMountPromise = null
      throw error
    })
  }
  await computersMountPromise
}

export async function computerFolderExists(appName: string): Promise<boolean> {
  const path = join(NFS_MOUNT_DIR, appName)
  try {
    const info = await Deno.stat(path)
    return info.isDirectory
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return false
    throw error
  }
}

export async function createComputerFolder(appName: string): Promise<void> {
  const path = join(NFS_MOUNT_DIR, appName)
  await Deno.mkdir(path, { recursive: true })
}

export async function removeComputerFolder(appName: string): Promise<void> {
  const path = join(NFS_MOUNT_DIR, appName)
  try {
    await Deno.remove(path, { recursive: true })
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return
    throw error
  }
}
