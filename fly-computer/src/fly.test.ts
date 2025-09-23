import { expect } from '@std/expect'

import type { CommandExecutor, CommandResult } from '@artifact/tasks'

import { createFlyApi } from './fly.ts'
import type { AppConfig } from './config.ts'

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
    const normalizedArgs = [command, ...(args ?? [])]
    calls.push(normalizedArgs)
    const key = normalizedArgs.join(' ')
    const response = outputs[key]
    if (!response) {
      throw new Error(`Unexpected command: ${key}`)
    }
    return Promise.resolve(response)
  }
  return { executor, calls }
}

function createConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  return {
    targetApp: overrides.targetApp ?? 'actor-template',
    registryRoot: overrides.registryRoot ?? '/tmp/registry',
    agentTemplateApp: overrides.agentTemplateApp ?? 'fly-agent',
    baseDomain: overrides.baseDomain ?? 'example.test',
    agentImage: overrides.agentImage,
    defaultRegion: overrides.defaultRegion,
  }
}

Deno.test('createFlyApi.runMachine issues fly machine run with expected arguments', async () => {
  const previousToken = Deno.env.get('FLY_API_TOKEN')
  Deno.env.set('FLY_API_TOKEN', 'test-token')
  try {
    const machineConfig = { metadata: { artifact_agent_id: 'agent-1' } }
    const machineConfigJson = JSON.stringify(machineConfig)
    const { executor, calls } = createRecordingExecutor({
      [
        'fly machine run registry.fly.io/template:latest --app actor-template --machine-config ' +
        machineConfigJson +
        ' --name agent-machine --region ord'
      ]: makeResult(true),
      'fly machine list --app actor-template --json': makeResult(true, {
        stdout: JSON.stringify([
          { ID: 'run-1', Name: 'agent-machine', Region: 'ord' },
        ]),
      }),
    })

    const fly = createFlyApi(createConfig(), executor)
    const summary = await fly.runMachine({
      name: 'agent-machine',
      config: machineConfig,
      image: 'registry.fly.io/template:latest',
      region: 'ord',
    })

    expect(summary.id).toBe('run-1')
    expect(calls[0]).toEqual([
      'fly',
      'machine',
      'run',
      'registry.fly.io/template:latest',
      '--app',
      'actor-template',
      '--machine-config',
      machineConfigJson,
      '--name',
      'agent-machine',
      '--region',
      'ord',
    ])
    expect(calls[1]).toEqual([
      'fly',
      'machine',
      'list',
      '--app',
      'actor-template',
      '--json',
    ])
  } finally {
    if (previousToken === undefined) {
      Deno.env.delete('FLY_API_TOKEN')
    } else {
      Deno.env.set('FLY_API_TOKEN', previousToken)
    }
  }
})
