import { expect } from '@std/expect'

import {
  flyCliAppsDestroy,
  flyCliAppsInfo,
  flyCliCreateMachine,
  flyCliGetMachine,
  flyCliListMachines,
  flyCliStartMachine,
  flyCliTokensCreateDeploy,
} from './mod.ts'
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

function createRecordingExecutor(
  outputs: Record<string, CommandResult>,
): { executor: CommandExecutor; calls: string[][] } {
  const calls: string[][] = []
  const executor: CommandExecutor = ({ command, args }) => {
    calls.push([command, ...(args ?? [])])
    const key = [command, ...(args ?? [])].join(' ')
    const response = outputs[key]
    if (!response) {
      throw new Error(`Unexpected command: ${key}`)
    }
    return Promise.resolve(response)
  }
  return { executor, calls }
}

Deno.test('flyCliListMachines maps JSON fields', async () => {
  const json = JSON.stringify([
    {
      ID: '123',
      Name: 'agent-1',
      State: 'started',
      Region: 'iad',
      Image: 'registry.fly.io/example:123',
      PrivateIP: 'fdaa:0:1',
      CreatedAt: '2024-01-01T00:00:00Z',
      Config: { metadata: { role: 'worker' } },
    },
  ])
  const { executor } = createRecordingExecutor({
    'fly machine list --app test --json': makeResult(true, { stdout: json }),
  })
  const results = await flyCliListMachines({
    appName: 'test',
    commandExecutor: executor,
  })
  expect(results).toEqual([
    {
      id: '123',
      name: 'agent-1',
      state: 'started',
      region: 'iad',
      image: 'registry.fly.io/example:123',
      privateIp: 'fdaa:0:1',
      createdAt: '2024-01-01T00:00:00Z',
      metadata: { role: 'worker' },
    },
  ])
})

Deno.test('flyCliGetMachine parses config', async () => {
  const json = JSON.stringify({
    ID: '456',
    Name: 'agent-2',
    Config: {
      image: 'registry.fly.io/example:tag',
      metadata: { role: 'worker' },
    },
  })
  const { executor } = createRecordingExecutor({
    'fly machine status 456 --app test --json': makeResult(true, {
      stdout: json,
    }),
  })
  const detail = await flyCliGetMachine({
    appName: 'test',
    machineId: '456',
    commandExecutor: executor,
  })
  expect(detail.id).toBe('456')
  expect(detail.config).toEqual({
    image: 'registry.fly.io/example:tag',
    metadata: { role: 'worker' },
  })
})

Deno.test('flyCliCreateMachine reuses list output when name matches', async () => {
  const { executor, calls } = createRecordingExecutor({
    'fly machine create --app test --machine-config {"image":"img"} --name agent-3 --region ord':
      makeResult(true),
    'fly machine list --app test --json': makeResult(true, {
      stdout: JSON.stringify([
        { ID: '789', Name: 'agent-3', Region: 'ord' },
      ]),
    }),
  })

  const created = await flyCliCreateMachine({
    appName: 'test',
    config: { image: 'img' },
    name: 'agent-3',
    region: 'ord',
    commandExecutor: executor,
  })

  expect(calls[0]).toEqual([
    'fly',
    'machine',
    'create',
    '--app',
    'test',
    '--machine-config',
    '{"image":"img"}',
    '--name',
    'agent-3',
    '--region',
    'ord',
  ])
  expect(calls[1]).toEqual([
    'fly',
    'machine',
    'list',
    '--app',
    'test',
    '--json',
  ])
  expect(created.id).toBe('789')
})

Deno.test('flyCliAppsInfo maps organization', async () => {
  const { executor } = createRecordingExecutor({
    'fly info --app computers --json': makeResult(true, {
      stdout: JSON.stringify({
        ID: 'app_123',
        Name: 'computers',
        organization: { slug: 'artifact' },
      }),
    }),
  })

  const info = await flyCliAppsInfo({
    appName: 'computers',
    commandExecutor: executor,
  })

  expect(info).toEqual({
    id: 'app_123',
    name: 'computers',
    organizationSlug: 'artifact',
    createdAt: undefined,
  })
})

Deno.test('flyCliTokensCreateDeploy extracts token field', async () => {
  const { executor } = createRecordingExecutor({
    'fly tokens create deploy --app test --json': makeResult(true, {
      stdout: JSON.stringify({ token: 'deploy-token' }),
    }),
  })

  const token = await flyCliTokensCreateDeploy({
    appName: 'test',
    commandExecutor: executor,
  })
  expect(token).toBe('deploy-token')
})

Deno.test('flyCliAppsDestroy adds --force when requested', async () => {
  const { executor, calls } = createRecordingExecutor({
    'fly apps destroy demo --yes --force': makeResult(true),
  })

  await flyCliAppsDestroy({
    appName: 'demo',
    force: true,
    commandExecutor: executor,
  })

  expect(calls[0]).toEqual([
    'fly',
    'apps',
    'destroy',
    'demo',
    '--yes',
    '--force',
  ])
})
Deno.test('flyCliStartMachine invokes machine start', async () => {
  const { executor, calls } = createRecordingExecutor({
    'fly machine start 999 --app test': makeResult(true),
  })

  await flyCliStartMachine({
    appName: 'test',
    machineId: '999',
    commandExecutor: executor,
  })

  expect(calls[0]).toEqual([
    'fly',
    'machine',
    'start',
    '999',
    '--app',
    'test',
  ])
})
