import { expect } from '@std/expect'

import {
  isFlyResourceNotFound,
  mapMachineDetail,
  mapMachineSummary,
} from '@artifact/shared'
import { FlyCommandError } from '@artifact/tasks'
import type {
  CommandResult,
  FlyCliMachineDetail,
  FlyCliMachineSummary,
} from '@artifact/tasks'

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
    signal: overrides.signal ?? null,
    stdout: overrides.stdout ?? '',
    stderr: overrides.stderr ?? '',
    pid: overrides.pid ?? 123,
    startedAt: overrides.startedAt ?? now,
    endedAt: overrides.endedAt ?? now,
    attempts: overrides.attempts ?? 1,
    ...overrides,
  }
}

Deno.test('mapMachineSummary remaps privateIp to ip', () => {
  const summary: FlyCliMachineSummary = {
    id: 'm123',
    name: 'agent-1',
    state: 'started',
    region: 'lhr',
    image: 'registry.fly.io/example:tag',
    privateIp: 'fdaa:0:1',
    createdAt: '2025-01-01T00:00:00Z',
    metadata: { role: 'worker' },
  }

  const mapped = mapMachineSummary(summary)
  expect(mapped).toEqual({
    id: 'm123',
    name: 'agent-1',
    state: 'started',
    region: 'lhr',
    image: 'registry.fly.io/example:tag',
    ip: 'fdaa:0:1',
    createdAt: '2025-01-01T00:00:00Z',
    metadata: { role: 'worker' },
  })
})

Deno.test('mapMachineDetail includes config while preserving summary fields', () => {
  const detail: FlyCliMachineDetail = {
    id: 'm200',
    name: 'agent-2',
    state: 'started',
    region: 'ord',
    image: 'registry.fly.io/example:tag',
    privateIp: undefined,
    createdAt: '2025-01-02T00:00:00Z',
    metadata: { role: 'worker' },
    config: {
      image: 'registry.fly.io/example:tag',
      metadata: { role: 'worker' },
    },
  }

  const mapped = mapMachineDetail(detail)
  expect(mapped.ip).toBeUndefined()
  expect(mapped.config).toEqual({
    image: 'registry.fly.io/example:tag',
    metadata: { role: 'worker' },
  })
})

Deno.test('isFlyResourceNotFound detects FlyCommandError failures', () => {
  const error = new FlyCommandError(
    ['machine', 'status', 'nope'],
    makeResult(false, {
      stderr: 'machine not found',
      state: 'failed',
    }),
  )
  expect(isFlyResourceNotFound(error)).toBe(true)
  expect(isFlyResourceNotFound(new Error('random error'))).toBe(false)
})
