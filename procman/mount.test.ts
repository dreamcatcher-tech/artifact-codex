import { expect } from '@std/expect'

import { ensureNfsMount } from './mount.ts'
import type { CommandExecutor, TaskResult } from './types.ts'

function makeResult(
  success: boolean,
  overrides: Partial<TaskResult> = {},
): TaskResult {
  const now = new Date()
  return {
    id: 'test',
    state: success ? 'succeeded' : 'failed',
    success,
    code: success ? 0 : 1,
    signal: null,
    stdout: '',
    stderr: '',
    pid: 123,
    startedAt: now,
    endedAt: now,
    attempts: 1,
    ...overrides,
  }
}

Deno.test('ensureNfsMount succeeds on first attempt', async () => {
  let calls = 0
  const executor: CommandExecutor = () => {
    calls += 1
    return Promise.resolve(makeResult(true))
  }

  await ensureNfsMount({ commandExecutor: executor, logger: () => {} })

  expect(calls).toBe(1)
})

Deno.test('ensureNfsMount retries until success', async () => {
  let attempt = 0
  const executor: CommandExecutor = () => {
    attempt += 1
    return Promise.resolve(makeResult(attempt === 3))
  }
  const events: string[] = []

  await ensureNfsMount({
    commandExecutor: executor,
    logger: (msg) => events.push(msg),
    delayMs: 0,
  })

  expect(attempt).toBe(3)
  expect(events.some((msg) => msg.includes('retrying'))).toBe(true)
})

Deno.test('ensureNfsMount throws after exhausting retries', async () => {
  const executor: CommandExecutor = () => Promise.resolve(makeResult(false))

  await expect(ensureNfsMount({
    commandExecutor: executor,
    retries: 2,
    delayMs: 0,
  })).rejects.toThrow('Task')
})

Deno.test('ensureNfsMount propagates executor errors', async () => {
  const error = new Error('boom')
  const executor: CommandExecutor = () => Promise.reject(error)

  await expect(ensureNfsMount({
    commandExecutor: executor,
    retries: 1,
    delayMs: 0,
  })).rejects.toBe(error)
})
