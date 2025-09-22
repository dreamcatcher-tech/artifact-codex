import { expect } from '@std/expect'

import { probeTokenScope, type ProbeTokenScopeResult } from '@artifact/shared'
import type { CommandExecutor, CommandResult } from '@artifact/tasks'

function makeResult(
  success: boolean,
  overrides: Partial<CommandResult> = {},
): CommandResult {
  return {
    success,
    code: success ? 0 : 1,
    signal: null,
    stdout: '',
    stderr: '',
    ...overrides,
  }
}

function executorFromMap(
  commands: Record<string, CommandResult>,
): CommandExecutor {
  return ({ command, args }) => {
    const key = [command, ...(args ?? [])].join(' ')
    const res = commands[key]
    if (!res) throw new Error(`Unexpected command: ${key}`)
    return Promise.resolve(res)
  }
}

Deno.test('probeTokenScope -> org when info and list succeed', async () => {
  const executor = executorFromMap({
    'fly info --app my-app --json': makeResult(true, {
      stdout: JSON.stringify({
        id: 'app-id',
        name: 'my-app',
        organization: { slug: 'personal' },
      }),
    }),
    'fly apps list --org personal --json': makeResult(true, {
      stdout: JSON.stringify([{ id: 'app-id', name: 'my-app' }]),
    }),
  })

  const res = await probeTokenScope({
    token: 'T',
    appName: 'my-app',
    commandExecutor: executor,
  })

  expect(res.classification).toBe('org')
  expect(res.orgSlug).toBe('personal')
  expect(res.evidence.getApp?.ok).toBe(true)
  expect(res.evidence.listApps?.ok).toBe(true)
})

Deno.test('probeTokenScope -> app when list apps denied', async () => {
  const executor = executorFromMap({
    'fly info --app my-app --json': makeResult(true, {
      stdout: JSON.stringify({
        id: 'app-id',
        name: 'my-app',
        organization: { slug: 'personal' },
      }),
    }),
    'fly apps list --org personal --json': makeResult(false, {
      code: 403,
      stderr: 'forbidden',
    }),
  })

  const res = await probeTokenScope({
    token: 'T',
    appName: 'my-app',
    commandExecutor: executor,
  })

  expect(res.classification).toBe('app')
  expect(res.evidence.listApps?.status).toBe(403)
})

Deno.test('probeTokenScope -> unknown when org missing', async () => {
  const executor = executorFromMap({
    'fly info --app missing --json': makeResult(false, {
      code: 404,
      stderr: 'not found',
    }),
  })

  const res: ProbeTokenScopeResult = await probeTokenScope({
    token: 'T',
    appName: 'missing',
    commandExecutor: executor,
  })

  expect(res.classification).toBe('unknown')
  expect(res.message).toMatch(/Provide orgSlug/i)
})
