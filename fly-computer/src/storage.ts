import { ensureNfsMount } from '@artifact/tasks'
import { readFlyMachineRuntimeEnv } from '@artifact/shared'
import { join } from '@std/path'

const MOUNT_DIR = '/mnt/computer'
const LOG_PREFIX = '[fly-computer:nfs]'
const TREE_MAX_DEPTH = 3
const TREE_MAX_ENTRIES = 30

let mountPromise: Promise<string> | null = null

export async function ensureComputerStorageMounted(): Promise<string> {
  if (!mountPromise) {
    mountPromise = mountStorage().catch((error) => {
      mountPromise = null
      throw error
    })
  }
  return mountPromise
}

async function mountStorage(): Promise<string> {
  const { FLY_APP_NAME } = readFlyMachineRuntimeEnv()
  const appName = FLY_APP_NAME.trim()
  if (!appName) {
    throw new Error(
      'FLY_APP_NAME is not set; unable to determine NFS subpath for fly-computer.',
    )
  }

  const subpath = 'computers/' + appName

  await ensureNfsMount({
    mountDir: MOUNT_DIR,
    subpath,
    logger: (message) => console.error(`${LOG_PREFIX} ${message}`),
    logPrefix: '',
  })

  await logDirectoryTree(MOUNT_DIR)

  return MOUNT_DIR
}

async function logDirectoryTree(root: string): Promise<void> {
  console.error(`${LOG_PREFIX} directory tree for ${root}`)
  try {
    const lines: string[] = []
    await collectTreeLines(root, 0, lines)
    if (lines.length === 0) {
      console.error(`${LOG_PREFIX} (empty directory)`)
      return
    }
    for (const line of lines) {
      console.error(`${LOG_PREFIX} ${line}`)
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error(`${LOG_PREFIX} failed to read directory tree: ${message}`)
  }
}

async function collectTreeLines(
  dir: string,
  depth: number,
  target: string[],
): Promise<void> {
  if (depth > TREE_MAX_DEPTH) {
    target.push(`${indent(depth)}...`)
    return
  }

  let entries: Deno.DirEntry[] = []
  try {
    for await (const entry of Deno.readDir(dir)) {
      entries.push(entry)
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    target.push(`${indent(depth)}<error: ${message}>`)
    return
  }

  entries = entries.sort((a, b) => a.name.localeCompare(b.name))

  const limit = Math.max(0, TREE_MAX_ENTRIES)
  const total = entries.length
  const slice = limit === 0 ? entries : entries.slice(0, limit)

  for (const entry of slice) {
    const suffix = entry.isDirectory ? '/' : entry.isSymlink ? '@' : ''
    target.push(`${indent(depth)}- ${entry.name}${suffix}`)
    if (entry.isDirectory) {
      await collectTreeLines(join(dir, entry.name), depth + 1, target)
    }
  }

  if (limit > 0 && total > slice.length) {
    const remaining = total - slice.length
    target.push(`${indent(depth)}- ... (${remaining} more entries omitted)`)
  }
}

function indent(depth: number): string {
  return '  '.repeat(depth)
}
