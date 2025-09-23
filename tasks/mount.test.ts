import { expect } from '@std/expect'

import { ensureNfsMount } from './mod.ts'
import type { CommandExecutor, CommandResult } from './types.ts'

function makeResult(
  success: boolean,
  overrides: Partial<CommandResult> = {},
): CommandResult {
  const now = new Date('2024-01-01T00:00:00Z')
  return {
    id: overrides.id ?? 'test-command',
    state: success ? 'succeeded' : 'failed',
    success,
    code: success ? 0 : 1,
    signal: null,
    stdout: '',
    stderr: '',
    pid: overrides.pid ?? 123,
    startedAt: overrides.startedAt ?? now,
    endedAt: overrides.endedAt ?? now,
    attempts: overrides.attempts ?? 1,
    ...overrides,
  }
}

async function withTempDir(fn: (dir: string) => Promise<void>) {
  const dir = await Deno.makeTempDir()
  try {
    await fn(dir)
  } finally {
    await Deno.remove(dir, { recursive: true }).catch(() => {})
  }
}

Deno.test('ensureNfsMount mounts when not already mounted', async () => {
  await withTempDir(async (mountDir) => {
    const commands: Array<{ name: string; args: string[] }> = []
    let verifying = false
    const executor: CommandExecutor = (options) => {
      commands.push({ name: options.command, args: options.args ?? [] })
      if (options.command === 'mountpoint') {
        if (verifying) {
          verifying = false
          return Promise.resolve(makeResult(true))
        }
        return Promise.resolve(makeResult(false))
      }
      if (options.command === 'mount') {
        verifying = true
        expect(options.args).toContain(mountDir)
        return Promise.resolve(makeResult(true))
      }
      return Promise.reject(new Error(`Unexpected command: ${options.command}`))
    }

    await ensureNfsMount({
      commandExecutor: executor,
      logger: () => {},
      validateBinaries: false,
      validatePrivileges: false,
      retries: 1,
      delayMs: 0,
      mountDir,
      source: 'test-source',
      env: { PATH: Deno.env.get('PATH') ?? '' },
    })

    expect(commands.map((c) => c.name)).toEqual([
      'mountpoint',
      'mount',
      'mountpoint',
    ])
  })
})

Deno.test('ensureNfsMount retries until success', async () => {
  await withTempDir(async (mountDir) => {
    let mountAttempts = 0
    let verifying = false
    const logs: string[] = []
    const executor: CommandExecutor = (options) => {
      if (options.command === 'mountpoint') {
        if (verifying) {
          verifying = false
          return Promise.resolve(makeResult(true))
        }
        return Promise.resolve(makeResult(false))
      }
      if (options.command === 'mount') {
        mountAttempts += 1
        if (mountAttempts < 3) {
          return Promise.reject(new Error('mount failed'))
        }
        verifying = true
        return Promise.resolve(makeResult(true))
      }
      return Promise.reject(new Error(`Unexpected command: ${options.command}`))
    }

    await ensureNfsMount({
      commandExecutor: executor,
      logger: (msg: string) => logs.push(msg),
      validateBinaries: false,
      validatePrivileges: false,
      retries: 5,
      delayMs: 0,
      mountDir,
      source: 'test-source',
      env: { PATH: Deno.env.get('PATH') ?? '' },
    })

    expect(mountAttempts).toBe(3)
    expect(logs.some((msg) => msg.includes('retrying'))).toBe(true)
  })
})

Deno.test('ensureNfsMount throws after exhausting retries', async () => {
  await withTempDir(async (mountDir) => {
    const executor: CommandExecutor = (options) => {
      if (options.command === 'mountpoint') {
        return Promise.resolve(makeResult(false))
      }
      if (options.command === 'mount') {
        return Promise.reject(new Error('mount failed'))
      }
      return Promise.reject(new Error(`Unexpected command: ${options.command}`))
    }

    await expect(ensureNfsMount({
      commandExecutor: executor,
      validateBinaries: false,
      validatePrivileges: false,
      retries: 2,
      delayMs: 0,
      logger: () => {},
      mountDir,
      source: 'test-source',
      env: { PATH: Deno.env.get('PATH') ?? '' },
    })).rejects.toThrow('mount failed')
  })
})

Deno.test('ensureNfsMount propagates unexpected executor errors', async () => {
  await withTempDir(async (mountDir) => {
    const boom = new Error('boom')
    const executor: CommandExecutor = (options) => {
      if (options.command === 'mountpoint') {
        return Promise.resolve(makeResult(false))
      }
      if (options.command === 'mount') {
        return Promise.reject(boom)
      }
      return Promise.reject(new Error(`Unexpected command: ${options.command}`))
    }

    await expect(ensureNfsMount({
      commandExecutor: executor,
      validateBinaries: false,
      validatePrivileges: false,
      retries: 1,
      delayMs: 0,
      logger: () => {},
      mountDir,
      source: 'test-source',
      env: { PATH: Deno.env.get('PATH') ?? '' },
    })).rejects.toBe(boom)
  })
})
