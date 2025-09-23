import { expect } from '@std/expect'

import { runSelfMountCheck } from './mod.ts'
import type { CommandExecutor, CommandResult } from './types.ts'

function successResult(overrides: Partial<CommandResult> = {}): CommandResult {
  const now = new Date('2024-01-01T00:00:00Z')
  return {
    id: overrides.id ?? 'test-command',
    state: overrides.state ?? 'succeeded',
    success: overrides.success ?? true,
    code: overrides.code ?? 0,
    signal: overrides.signal ?? null,
    stdout: overrides.stdout ?? '',
    stderr: overrides.stderr ?? '',
    pid: overrides.pid ?? 123,
    startedAt: overrides.startedAt ?? now,
    endedAt: overrides.endedAt ?? now,
    attempts: overrides.attempts ?? 1,
  }
}

Deno.test('runSelfMountCheck sets mount environment and runs cleanup', async () => {
  const calls: Array<
    { command: string; env?: Record<string, string>; args?: string[] }
  > = []
  let verifying = false
  const executor: CommandExecutor = (options) => {
    calls.push({
      command: options.command,
      env: options.env,
      args: options.args,
    })
    switch (options.command) {
      case 'mountpoint':
        if (verifying) {
          verifying = false
          return Promise.resolve(successResult())
        }
        return Promise.resolve(
          successResult({ success: false, state: 'failed', code: 1 }),
        )
      case 'mount':
        verifying = true
        return Promise.resolve(successResult())
      case 'umount':
        return Promise.resolve(successResult())
      case 'ls':
        return Promise.resolve(successResult())
      default:
        return Promise.reject(
          new Error(`Unexpected command: ${options.command}`),
        )
    }
  }

  const mountDir = await Deno.makeTempDir()
  const env = {
    FLY_NFS_CHECK_DIR: mountDir,
    FLY_NFS_APP: 'example-app',
    FLY_NFS_MOUNT_OPTS: 'nfsvers=4.2',
  }

  await runSelfMountCheck({
    env,
    commandExecutor: executor,
    mountOptions: {
      source: 'explicit-source',
      validateBinaries: false,
      validatePrivileges: false,
      delayMs: 0,
      retries: 1,
    },
  })

  const mountCall = calls.find((call) => call.command === 'mount')!
  expect(mountCall.env?.FLY_NFS_MOUNT_DIR).toBe(mountDir)
  expect(mountCall.args ?? []).toContain(mountDir)
  expect((mountCall.args ?? []).some((arg) => arg.includes('explicit-source')))
    .toBe(true)
  expect(calls.some((call) => call.command === 'umount')).toBe(true)

  await Deno.remove(mountDir, { recursive: true }).catch(() => {})
})

Deno.test('runSelfMountCheck throws when source missing', async () => {
  const mountDir = await Deno.makeTempDir()
  try {
    await expect(runSelfMountCheck({
      env: {
        FLY_NFS_CHECK_DIR: mountDir,
      },
      mountOptions: {
        validateBinaries: false,
        validatePrivileges: false,
        delayMs: 0,
        retries: 1,
      },
      commandExecutor: (_opts) =>
        Promise.resolve(
          successResult({ success: false, state: 'failed', code: 1 }),
        ),
    })).rejects.toThrow('Missing FLY_NFS_APP environment variable')
  } finally {
    await Deno.remove(mountDir, { recursive: true }).catch(() => {})
  }
})

Deno.test('runSelfMountCheck removes temporary directory when mount fails', async () => {
  let attemptedDir = ''
  const executor: CommandExecutor = (options) => {
    if (options.command === 'mountpoint') {
      return Promise.resolve(
        successResult({ success: false, state: 'failed', code: 1 }),
      )
    }
    if (options.command === 'mount') {
      attemptedDir = options.env?.FLY_NFS_MOUNT_DIR ?? ''
      return Promise.reject(new Error('mount failed'))
    }
    return Promise.resolve(successResult())
  }

  await expect(runSelfMountCheck({
    env: { FLY_NFS_APP: 'example-app' },
    commandExecutor: executor,
    mountOptions: {
      validateBinaries: false,
      validatePrivileges: false,
      delayMs: 0,
      retries: 1,
      source: 'test-source',
    },
  })).rejects.toThrow('mount failed')

  if (attemptedDir) {
    await expect(Deno.stat(attemptedDir)).rejects.toBeInstanceOf(
      Deno.errors.NotFound,
    )
  }
})

Deno.test('runSelfMountCheck uses custom list command when provided', async () => {
  const commands: string[] = []
  let verifying = false
  const executor: CommandExecutor = (options) => {
    commands.push(options.command)
    if (options.command === 'mountpoint') {
      if (verifying) {
        verifying = false
        return Promise.resolve(successResult())
      }
      return Promise.resolve(
        successResult({ success: false, state: 'failed', code: 1 }),
      )
    }
    if (options.command === 'mount') {
      verifying = true
      return Promise.resolve(successResult())
    }
    return Promise.resolve(successResult())
  }

  const mountDir = await Deno.makeTempDir()
  await runSelfMountCheck({
    env: { FLY_NFS_CHECK_DIR: mountDir, FLY_NFS_APP: 'example-app' },
    commandExecutor: executor,
    listCommand: {
      command: 'echo',
      args: ['checking'],
      stdio: { stdout: 'inherit', stderr: 'inherit' },
    },
    mountOptions: {
      validateBinaries: false,
      validatePrivileges: false,
      delayMs: 0,
      retries: 1,
      source: 'test-source',
    },
  })

  expect(commands).toContain('echo')
  expect(commands).toContain('umount')

  await Deno.remove(mountDir, { recursive: true }).catch(() => {})
})
