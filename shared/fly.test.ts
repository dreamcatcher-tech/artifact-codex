import { expect } from '@std/expect'

import { createMachine, listMachines } from '@artifact/shared'
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

function createExecutor(
  outputs: Record<string, CommandResult>,
): { executor: CommandExecutor; calls: string[][] } {
  const calls: string[][] = []
  const executor: CommandExecutor = ({ command, args }) => {
    const parts = [command, ...(args ?? [])]
    calls.push(parts)
    const key = parts.join(' ')
    const response = outputs[key]
    if (!response) {
      throw new Error(`Unexpected command: ${key}`)
    }
    return Promise.resolve(response)
  }
  return { executor, calls }
}

Deno.test('listMachines maps CLI fields', async () => {
  const payload = JSON.stringify([
    {
      ID: 'm123',
      Name: 'agent-1',
      State: 'started',
      Region: 'lhr',
      Image: 'registry.fly.io/example:tag',
      PrivateIP: 'fdaa:0:1',
      CreatedAt: '2025-01-01T00:00:00Z',
      Config: { metadata: { role: 'worker' } },
    },
  ])
  const { executor } = createExecutor({
    'fly machine list --app my-app --json': makeResult(true, {
      stdout: payload,
    }),
  })

  const machines = await listMachines({
    appName: 'my-app',
    token: 'noop',
    commandExecutor: executor,
  })

  expect(machines).toEqual([
    {
      id: 'm123',
      name: 'agent-1',
      state: 'started',
      region: 'lhr',
      image: 'registry.fly.io/example:tag',
      ip: 'fdaa:0:1',
      createdAt: '2025-01-01T00:00:00Z',
      metadata: { role: 'worker' },
    },
  ])
})

Deno.test('createMachine delegates to CLI create + list', async () => {
  const { executor, calls } = createExecutor({
    'fly machine create --app my-app --machine-config {"image":"example"} --name agent-1 --region ord':
      makeResult(true),
    'fly machine list --app my-app --json': makeResult(true, {
      stdout: JSON.stringify([
        { ID: 'm200', Name: 'agent-1', Region: 'ord' },
      ]),
    }),
  })

  const created = await createMachine({
    appName: 'my-app',
    token: 'noop',
    name: 'agent-1',
    config: { image: 'example' },
    region: 'ord',
    commandExecutor: executor,
  })

  expect(calls[0]).toEqual([
    'fly',
    'machine',
    'create',
    '--app',
    'my-app',
    '--machine-config',
    '{"image":"example"}',
    '--name',
    'agent-1',
    '--region',
    'ord',
  ])
  expect(calls[1]).toEqual([
    'fly',
    'machine',
    'list',
    '--app',
    'my-app',
    '--json',
  ])
  expect(created.id).toBe('m200')
})
