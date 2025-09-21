import { expect } from '@std/expect'

import { runSelfMountCheck } from './self_mount_check.ts'
import type { CommandExecutor, TaskResult } from './types.ts'

function successResult(id: string): TaskResult {
  const now = new Date()
  return {
    id,
    state: 'succeeded',
    success: true,
    code: 0,
    signal: null,
    stdout: '',
    stderr: '',
    pid: 1234,
    startedAt: now,
    endedAt: now,
    attempts: 1,
  }
}

Deno.test('runSelfMountCheck sets mount environment and runs cleanup', async () => {
  const calls: Array<{ command: string; env?: Record<string, string> }> = []
  const executor: CommandExecutor = (options) => {
    calls.push({ command: options.command, env: options.env })
    return Promise.resolve(successResult(options.command))
  }

  const mountDir = await Deno.makeTempDir()
  const env = {
    FLY_NFS_CHECK_DIR: mountDir,
    FLY_NFS_SOURCE: 'explicit-source',
    FLY_NFS_EXPORT_PATH: '/custom/data',
    FLY_NFS_MOUNT_OPTS: 'nfsvers=4.2',
  }

  await runSelfMountCheck({ env, commandExecutor: executor })

  const mountCall = calls[0]!
  expect(mountCall.command).toBe('/usr/local/bin/mount-nfs.sh')
  expect(mountCall.env?.FLY_NFS_SOURCE).toBe('explicit-source')
  expect(mountCall.env?.FLY_NFS_MOUNT_DIR).toBe(mountDir)
  expect(calls.some((call) => call.command === 'umount')).toBe(true)

  await Deno.remove(mountDir, { recursive: true }).catch(() => {})
})

Deno.test('runSelfMountCheck falls back to app host when source missing', async () => {
  const calls: Array<{ command: string; env?: Record<string, string> }> = []
  const executor: CommandExecutor = (options) => {
    calls.push({ command: options.command, env: options.env })
    return Promise.resolve(successResult(options.command))
  }

  const mountDir = await Deno.makeTempDir()
  await runSelfMountCheck({
    env: {
      FLY_NFS_CHECK_DIR: mountDir,
      FLY_NFS_APP: 'example-app',
    },
    commandExecutor: executor,
  })

  const mountCall = calls[0]!
  expect(mountCall.env?.FLY_NFS_SOURCE).toBe('example-app.internal')

  await Deno.remove(mountDir, { recursive: true }).catch(() => {})
})

Deno.test('runSelfMountCheck removes temporary directory when mount fails', async () => {
  let attemptedDir = ''
  const executor: CommandExecutor = (options) => {
    if (options.command === '/usr/local/bin/mount-nfs.sh') {
      attemptedDir = options.env?.FLY_NFS_MOUNT_DIR ?? ''
      return Promise.reject(new Error('mount failed'))
    }
    return Promise.resolve(successResult(options.command))
  }

  await expect(runSelfMountCheck({ commandExecutor: executor })).rejects
    .toThrow(
      'mount failed',
    )

  if (attemptedDir) {
    await expect(Deno.stat(attemptedDir)).rejects.toBeInstanceOf(
      Deno.errors.NotFound,
    )
  }
})

Deno.test('runSelfMountCheck uses custom list command when provided', async () => {
  const commands: string[] = []
  const executor: CommandExecutor = (options) => {
    commands.push(options.command)
    return Promise.resolve(successResult(options.command))
  }

  const mountDir = await Deno.makeTempDir()
  await runSelfMountCheck({
    env: { FLY_NFS_CHECK_DIR: mountDir },
    commandExecutor: executor,
    listCommand: {
      command: 'echo',
      args: ['checking'],
      stdio: { stdout: 'inherit', stderr: 'inherit' },
    },
  })

  expect(commands).toContain('echo')
  expect(commands).toContain('umount')

  await Deno.remove(mountDir, { recursive: true }).catch(() => {})
})
