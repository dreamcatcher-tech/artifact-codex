import { expect } from '@std/expect'

import {
  flyCliAllocatePrivateIp,
  flyCliAppsCreate,
  flyCliAppsDestroy,
  flyCliAppsInfo,
  flyCliAppStatus,
  flyCliCreateMachine,
  flyCliGetMachine,
  flyCliListMachines,
  flyCliMachineRun,
  flyCliSecretsList,
  flyCliStartMachine,
  flyCliUpdateMachine,
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
    env: { FLY_API_TOKEN: 'token' },
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
  const statusOutput = [
    'Machine ID: 456',
    'State: started',
    '',
    '  Name          = agent-2',
    '  Image         = registry.fly.io/example:tag',
    '  Private IP    = fdaa:0:1',
    '  Region        = iad',
    '  Created       = 2024-01-01T00:00:00Z',
    '',
    'Config:',
    '\u001b[1m{\u001b[0m',
    '  "image": "registry.fly.io/example:tag",',
    '  "metadata": { "role": "worker" }',
    '\u001b[1m}\u001b[0m',
  ].join('\n')
  const { executor } = createRecordingExecutor({
    'fly machine status 456 --app test --display-config': makeResult(true, {
      stdout: statusOutput,
    }),
  })
  const detail = await flyCliGetMachine({
    appName: 'test',
    machineId: '456',
    commandExecutor: executor,
    env: { FLY_API_TOKEN: 'token' },
  })
  expect(detail.id).toBe('456')
  expect(detail.config).toEqual({
    image: 'registry.fly.io/example:tag',
    metadata: { role: 'worker' },
  })
  expect(detail.region).toBe('iad')
})

Deno.test('flyCliCreateMachine reuses list output when name matches', async () => {
  const { executor, calls } = createRecordingExecutor({
    'fly machine create img --app test --machine-config {"image":"img"} --name agent-3 --region ord':
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
    image: 'img',
    name: 'agent-3',
    region: 'ord',
    commandExecutor: executor,
    env: { FLY_API_TOKEN: 'token' },
  })

  expect(calls[0]).toEqual([
    'fly',
    'machine',
    'create',
    'img',
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

Deno.test('flyCliMachineRun launches machine from config', async () => {
  const machineConfig = { metadata: { app: 'actor-new' } }
  const runCommand = [
    'fly',
    'machine',
    'run',
    'registry.fly.io/template:latest',
    '--app',
    'actor-new',
    '--machine-config',
    JSON.stringify(machineConfig),
    '--name',
    'web',
    '--region',
    'ord',
  ].join(' ')

  const { executor, calls } = createRecordingExecutor({
    [runCommand]: makeResult(true),
    'fly machine list --app actor-new --json': makeResult(true, {
      stdout: JSON.stringify([
        { ID: 'run-1', Name: 'web', Region: 'ord' },
      ]),
    }),
  })

  const runResult = await flyCliMachineRun({
    appName: 'actor-new',
    image: 'registry.fly.io/template:latest',
    config: machineConfig,
    name: 'web',
    region: 'ord',
    commandExecutor: executor,
    env: { FLY_API_TOKEN: 'token' },
  })

  expect(calls[0]).toEqual([
    'fly',
    'machine',
    'run',
    'registry.fly.io/template:latest',
    '--app',
    'actor-new',
    '--machine-config',
    JSON.stringify(machineConfig),
    '--name',
    'web',
    '--region',
    'ord',
  ])
  expect(calls[1]).toEqual([
    'fly',
    'machine',
    'list',
    '--app',
    'actor-new',
    '--json',
  ])
  expect(runResult.id).toBe('run-1')
})

Deno.test('flyCliAppsCreate passes network when provided', async () => {
  const responseJson = JSON.stringify({ Name: 'demo', ID: 'app_demo' })
  const { executor, calls } = createRecordingExecutor({
    'fly apps create --name demo --org artifact --network demo --json --yes':
      makeResult(true, { stdout: responseJson }),
  })

  const info = await flyCliAppsCreate({
    appName: 'demo',
    orgSlug: 'artifact',
    network: 'demo',
    commandExecutor: executor,
    env: { FLY_API_TOKEN: 'token' },
  })

  expect(calls[0]).toEqual([
    'fly',
    'apps',
    'create',
    '--name',
    'demo',
    '--org',
    'artifact',
    '--network',
    'demo',
    '--json',
    '--yes',
  ])
  expect(info.name).toBe('demo')
  expect(info.id).toBe('app_demo')
})

Deno.test('flyCliAppsInfo maps organization', async () => {
  const { executor } = createRecordingExecutor({
    'fly status --app computers --json': makeResult(true, {
      stdout: JSON.stringify({
        ID: 'app_123',
        Name: 'computers',
        Organization: { slug: 'artifact' },
      }),
    }),
  })

  const info = await flyCliAppsInfo({
    appName: 'computers',
    commandExecutor: executor,
    env: { FLY_API_TOKEN: 'token' },
  })

  expect(info).toEqual({
    id: 'app_123',
    name: 'computers',
    organizationSlug: 'artifact',
    createdAt: undefined,
  })
})

Deno.test('flyCliAppStatus parses machines from status output', async () => {
  const statusJson = JSON.stringify({
    App: { ID: 'app_456', Name: 'template-app' },
    Machines: [
      {
        ID: 'machine-1',
        Name: 'web',
        Region: 'ord',
        Image: 'registry.fly.io/template:latest',
      },
    ],
  })
  const { executor } = createRecordingExecutor({
    'fly status --app template-app --json': makeResult(true, {
      stdout: statusJson,
    }),
  })

  const status = await flyCliAppStatus({
    appName: 'template-app',
    commandExecutor: executor,
    env: { FLY_API_TOKEN: 'token' },
  })

  expect(status.appId).toBe('app_456')
  expect(status.appName).toBe('template-app')
  expect(status.machines).toEqual([
    {
      id: 'machine-1',
      name: 'web',
      region: 'ord',
      image: 'registry.fly.io/template:latest',
      state: undefined,
      privateIp: undefined,
      createdAt: undefined,
      metadata: undefined,
    },
  ])
})

Deno.test('flyCliAppStatus captures network name', async () => {
  const statusJson = JSON.stringify({
    App: {
      ID: 'app_net',
      Name: 'networked-app',
      Network: { Name: 'tenant-network' },
    },
  })
  const { executor } = createRecordingExecutor({
    'fly status --app networked-app --json': makeResult(true, {
      stdout: statusJson,
    }),
  })

  const status = await flyCliAppStatus({
    appName: 'networked-app',
    commandExecutor: executor,
    env: { FLY_API_TOKEN: 'token' },
  })

  expect(status.networkName).toBe('tenant-network')
})

Deno.test('flyCliSecretsList parses secret metadata', async () => {
  const json = JSON.stringify([
    { Name: 'FLY_API_TOKEN', CreatedAt: '2025-01-01T00:00:00Z' },
    { name: 'FLY_COMPUTER_TARGET_APP' },
  ])
  const { executor } = createRecordingExecutor({
    'fly secrets list --app demo --json': makeResult(true, { stdout: json }),
  })

  const secrets = await flyCliSecretsList({
    appName: 'demo',
    commandExecutor: executor,
    env: { FLY_API_TOKEN: 'token' },
  })

  expect(secrets).toEqual([
    { name: 'FLY_API_TOKEN', createdAt: '2025-01-01T00:00:00Z' },
    { name: 'FLY_COMPUTER_TARGET_APP', createdAt: undefined },
  ])
})

Deno.test('flyCliAllocatePrivateIp trims and forwards network option', async () => {
  const { executor, calls } = createRecordingExecutor({
    'fly ips allocate-v6 --private --app actor-app --network default':
      makeResult(true),
  })

  await flyCliAllocatePrivateIp({
    appName: 'actor-app',
    network: ' default ',
    commandExecutor: executor,
    env: { FLY_API_TOKEN: 'token' },
  })

  expect(calls[0]).toEqual([
    'fly',
    'ips',
    'allocate-v6',
    '--private',
    '--app',
    'actor-app',
    '--network',
    'default',
  ])
})

Deno.test('flyCliAllocatePrivateIp rejects empty network', async () => {
  await expect(
    flyCliAllocatePrivateIp({
      appName: 'actor-app',
      network: '  ',
      commandExecutor: () => Promise.resolve(makeResult(true)),
      env: { FLY_API_TOKEN: 'token' },
    }),
  ).rejects.toThrow('flyCliAllocatePrivateIp requires a non-empty network name')
})

Deno.test('flyCliAppsDestroy adds --force when requested', async () => {
  const { executor, calls } = createRecordingExecutor({
    'fly apps destroy demo --yes': makeResult(true),
  })

  await flyCliAppsDestroy({
    appName: 'demo',
    force: true,
    commandExecutor: executor,
    env: { FLY_API_TOKEN: 'token' },
  })

  expect(calls[0]).toEqual([
    'fly',
    'apps',
    'destroy',
    'demo',
    '--yes',
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
    env: { FLY_API_TOKEN: 'token' },
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

Deno.test('flyCliUpdateMachine updates image and can restart', async () => {
  const { executor, calls } = createRecordingExecutor({
    'fly machine update 777 --app test --image registry.fly.io/fly-agent:latest --restart':
      makeResult(true),
  })

  await flyCliUpdateMachine({
    appName: 'test',
    machineId: '777',
    image: 'registry.fly.io/fly-agent:latest',
    restart: true,
    commandExecutor: executor,
    env: { FLY_API_TOKEN: 'token' },
  })

  expect(calls[0]).toEqual([
    'fly',
    'machine',
    'update',
    '777',
    '--app',
    'test',
    '--image',
    'registry.fly.io/fly-agent:latest',
    '--restart',
  ])
})
