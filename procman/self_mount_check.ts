import { join } from '@std/path/join'

import { CommandExecutor, CommandRunOptions, TaskResult } from './types.ts'
import { runCommand } from './task.ts'

export interface SelfMountCheckOptions {
  env?: Record<string, string>
  logger?: (message: string) => void
  mountCommand?: string
  mountArgs?: string[]
  listCommand?: CommandRunOptions
  commandExecutor?: CommandExecutor
}

interface CleanupAction {
  (): Promise<void> | void
}

const DEFAULT_MOUNT_COMMAND = '/usr/local/bin/mount-nfs.sh'

export async function runSelfMountCheck(
  options: SelfMountCheckOptions = {},
): Promise<void> {
  const env = { ...Deno.env.toObject(), ...(options.env ?? {}) }
  const logger = options.logger ?? ((msg: string) => console.error(msg))
  const executor = options.commandExecutor ?? defaultExecutor

  const mountCommand = options.mountCommand ?? DEFAULT_MOUNT_COMMAND
  const exportPath = env.FLY_NFS_EXPORT_PATH ?? '/data'
  const mountOpts = env.FLY_NFS_MOUNT_OPTS ?? 'nfsvers=4.1'

  let mountDir = env.FLY_NFS_CHECK_DIR
  let createdTempDir = false
  if (!mountDir) {
    mountDir = await Deno.makeTempDir({ prefix: 'fly-nfs-check.' })
    createdTempDir = true
  } else {
    await Deno.mkdir(mountDir, { recursive: true })
  }

  const source = resolveSource(env)

  const mountEnv = {
    ...env,
    FLY_NFS_MOUNT_DIR: mountDir,
    FLY_NFS_SOURCE: source,
    FLY_NFS_MOUNT_OPTS: mountOpts,
    FLY_NFS_EXPORT_PATH: exportPath,
  }

  const cleanup: CleanupAction[] = []
  let mounted = false

  try {
    await executor({
      ...options.mountArgs ? { args: options.mountArgs } : {},
      command: mountCommand,
      env: mountEnv,
      stdio: { stdout: 'inherit', stderr: 'inherit' },
      check: true,
    })
    mounted = true

    cleanup.push(async () => {
      await executor({
        command: 'umount',
        args: [mountDir!],
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
  if (env.FLY_NFS_SOURCE) return env.FLY_NFS_SOURCE
  if (env.FLY_NFS_HOST) return env.FLY_NFS_HOST
  if (env.FLY_NFS_APP) return `${env.FLY_NFS_APP}.internal`
  if (env.FLY_TEST_MACHINE_IP) return env.FLY_TEST_MACHINE_IP
  return 'nfs-proto.internal'
}

async function listMountDir(
  executor: CommandExecutor,
  mountDir: string,
  listCommand: CommandRunOptions | undefined,
  env: Record<string, string>,
) {
  const command = listCommand ?? {
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

async function defaultExecutor(
  options: CommandRunOptions,
): Promise<TaskResult> {
  return await runCommand(options)
}
