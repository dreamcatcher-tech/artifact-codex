import { join } from '@std/path/join'

import { runCommand } from '@artifact/procman'

import { ensureNfsMount } from './mount.ts'
import type {
  CommandExecutor,
  CommandRunOptions,
  EnsureMountOptions,
} from './types.ts'

export interface SelfMountCheckOptions {
  env?: Record<string, string>
  logger?: (message: string) => void
  listCommand?: CommandRunOptions
  commandExecutor?: CommandExecutor
  mountOptions?: EnsureMountOptions
  subpath?: string
}

const DEFAULT_EXPORT_BASE = '/data'

interface CleanupAction {
  (): Promise<void> | void
}

export async function runSelfMountCheck(
  options: SelfMountCheckOptions = {},
): Promise<void> {
  const baseEnv = { ...Deno.env.toObject(), ...(options.env ?? {}) }
  const logger = options.logger ?? ((msg: string) => console.error(msg))
  const executor = options.commandExecutor ?? runCommand

  let mountDir = baseEnv.FLY_NFS_CHECK_DIR
  let createdTempDir = false
  if (!mountDir) {
    mountDir = await Deno.makeTempDir({ prefix: 'fly-nfs-check.' })
    createdTempDir = true
  } else {
    await Deno.mkdir(mountDir, { recursive: true })
  }

  const source = resolveSource(baseEnv)
  const mountOpts = baseEnv.FLY_NFS_MOUNT_OPTS ?? 'nfsvers=4.1'

  const mountEnv = {
    ...(options.mountOptions?.env ?? {}),
    ...baseEnv,
    FLY_NFS_MOUNT_DIR: mountDir,
    FLY_NFS_SOURCE: source,
    FLY_NFS_MOUNT_OPTS: mountOpts,
  }

  const ensureLogger = options.mountOptions?.logger ?? logger

  const ensureOptions: EnsureMountOptions = {
    ...options.mountOptions,
    env: mountEnv,
    exportBase: options.mountOptions?.exportBase ?? DEFAULT_EXPORT_BASE,
    subpath: options.subpath ?? options.mountOptions?.subpath,
    logger: ensureLogger,
    logPrefix: '[self-mount-check]',
    commandExecutor: options.mountOptions?.commandExecutor ?? executor,
  }

  if (
    options.commandExecutor &&
    options.mountOptions?.validateBinaries === undefined
  ) {
    ensureOptions.validateBinaries = false
  }
  if (
    options.commandExecutor &&
    options.mountOptions?.validatePrivileges === undefined
  ) {
    ensureOptions.validatePrivileges = false
  }

  const cleanup: CleanupAction[] = []
  let mounted = false

  try {
    await ensureNfsMount(ensureOptions)
    mounted = true

    cleanup.push(async () => {
      await executor({
        command: 'umount',
        args: [mountDir!],
        env: mountEnv,
        stdio: { stdout: 'inherit', stderr: 'inherit' },
      }).catch(() => {})
    })

    if (createdTempDir) {
      cleanup.push(async () => {
        await Deno.remove(mountDir!, { recursive: true }).catch(() => {})
      })
    }

    await listMountDir(executor, mountDir, options.listCommand, mountEnv)
    await smokeTest(mountDir)

    logger('self-mount-check: mount succeeded')
  } catch (error) {
    logger('self-mount-check: mount failed')
    throw error
  } finally {
    while (cleanup.length > 0) {
      const action = cleanup.shift()!
      await action()
    }
    if (!mounted && createdTempDir) {
      await Deno.remove(mountDir, { recursive: true }).catch(() => {})
    }
  }
}

function resolveSource(env: Record<string, string>): string {
  if (env.FLY_NFS_SOURCE && env.FLY_NFS_SOURCE.length > 0) {
    return env.FLY_NFS_SOURCE
  }
  if (env.FLY_NFS_HOST && env.FLY_NFS_HOST.length > 0) return env.FLY_NFS_HOST
  if (env.FLY_NFS_APP && env.FLY_NFS_APP.length > 0) {
    return `${env.FLY_NFS_APP}.flycast`
  }
  if (env.FLY_TEST_MACHINE_IP && env.FLY_TEST_MACHINE_IP.length > 0) {
    return env.FLY_TEST_MACHINE_IP
  }
  return 'nfs-proto.flycast'
}

async function listMountDir(
  executor: CommandExecutor,
  mountDir: string,
  listCommand: CommandRunOptions | undefined,
  env: Record<string, string>,
) {
  const command: CommandRunOptions = listCommand ?? {
    command: 'ls',
    args: ['-al', mountDir],
    stdio: { stdout: 'inherit', stderr: 'inherit' },
  }
  await executor({ ...command, env })
}

async function smokeTest(mountDir: string): Promise<void> {
  const tmpFile = join(mountDir, `.fly-agent-check-${crypto.randomUUID()}`)
  await Deno.writeTextFile(tmpFile, '')
  await Deno.remove(tmpFile).catch(() => {})
}
