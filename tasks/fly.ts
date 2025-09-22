import { runCommand } from '@artifact/procman'

import type { CommandExecutor, CommandResult } from './types.ts'

const FLY_BIN = 'fly'

export type FlyCliOptions = {
  token?: string
  env?: Record<string, string>
  commandExecutor?: CommandExecutor
  stdin?: string | string[]
  check?: boolean
}

export class FlyCommandError extends Error {
  constructor(
    public readonly args: string[],
    public readonly result: CommandResult,
  ) {
    super(
      `fly command failed (${args.join(' ')}): ${
        result.stderr || result.stdout
      }`,
    )
  }
}

export async function runFlyCommand(
  args: string[],
  options: FlyCliOptions = {},
): Promise<CommandResult> {
  const {
    token,
    env = {},
    commandExecutor = runCommand,
    stdin,
    check = true,
  } = options

  const mergedEnv: Record<string, string> = { ...env }
  if (token) {
    mergedEnv.FLY_API_TOKEN ??= token
    mergedEnv.FLY_ACCESS_TOKEN ??= token
  }

  const result = await commandExecutor({
    command: FLY_BIN,
    args,
    env: mergedEnv,
    stdin,
    check: false,
  })

  if (check && !result.success) {
    throw new FlyCommandError(args, result)
  }

  return result
}

export function parseFlyJson<T>(raw: string): T {
  const trimmed = raw.trim()
  if (!trimmed) {
    throw new Error('fly command returned empty output when JSON expected')
  }
  const start = trimmed.search(/[\[{]/)
  if (start === -1) {
    throw new Error(`unable to parse fly JSON output: ${trimmed}`)
  }
  const jsonSlice = trimmed.slice(start)
  try {
    return JSON.parse(jsonSlice) as T
  } catch (error) {
    throw new Error(
      `failed to parse fly JSON output: ${
        (error as Error).message
      }\n${trimmed}`,
    )
  }
}

export type FlyCliMachineSummary = {
  id: string
  name?: string
  state?: string
  region?: string
  image?: string
  privateIp?: string
  createdAt?: string
  metadata?: Record<string, unknown>
}

export type FlyCliMachineDetail = FlyCliMachineSummary & {
  config?: Record<string, unknown>
}

export type FlyCliAppInfo = {
  id: string
  name?: string
  organizationSlug?: string
  createdAt?: string
}

export async function flyCliListMachines(
  options: { appName: string } & FlyCliOptions,
): Promise<FlyCliMachineSummary[]> {
  const { appName, ...rest } = options
  const result = await runFlyCommand(
    ['machine', 'list', '--app', appName, '--json'],
    rest,
  )
  const rows = parseFlyJson<Array<Record<string, unknown>>>(result.stdout)
  return rows.map(mapMachineSummary)
}

export async function flyCliGetMachine(
  options: { appName: string; machineId: string } & FlyCliOptions,
): Promise<FlyCliMachineDetail> {
  const { appName, machineId, ...rest } = options
  const result = await runFlyCommand(
    ['machine', 'status', machineId, '--app', appName, '--display-config'],
    rest,
  )
  const detail = parseMachineStatusOutput(result.stdout)
  return mapMachineDetail(detail)
}

export async function flyCliCreateMachine(
  options: {
    appName: string
    config: Record<string, unknown>
    name?: string
    region?: string
  } & FlyCliOptions,
): Promise<FlyCliMachineSummary> {
  const { appName, config, name, region, ...rest } = options
  const machineConfig = JSON.stringify(config)
  const args = [
    'machine',
    'create',
    '--app',
    appName,
    '--machine-config',
    machineConfig,
  ]
  if (name) args.push('--name', name)
  if (region) args.push('--region', region)
  await runFlyCommand(args, rest)
  const list = await flyCliListMachines({ appName, ...rest })
  if (name) {
    const found = list.find((m) =>
      (m.name ?? '').toLowerCase() === name.toLowerCase()
    )
    if (found) return found
  }
  return list[list.length - 1]
}

export async function flyCliDestroyMachine(
  options:
    & { appName: string; machineId: string; force?: boolean }
    & FlyCliOptions,
): Promise<void> {
  const { appName, machineId, force = false, ...rest } = options
  const args = ['machine', 'destroy', machineId, '--app', appName]
  if (force) args.push('--force')
  await runFlyCommand(args, rest)
}

export async function flyCliStartMachine(
  options: { appName: string; machineId: string } & FlyCliOptions,
): Promise<void> {
  const { appName, machineId, ...rest } = options
  await runFlyCommand(['machine', 'start', machineId, '--app', appName], rest)
}

export async function flyCliAppsList(
  options: { orgSlug: string } & FlyCliOptions,
): Promise<FlyCliAppInfo[]> {
  const { orgSlug, ...rest } = options
  const result = await runFlyCommand(
    ['apps', 'list', '--org', orgSlug, '--json'],
    rest,
  )
  const rows = parseFlyJson<Array<Record<string, unknown>>>(result.stdout)
  return rows.map(mapAppInfo)
}

export async function flyCliAppsInfo(
  options: { appName: string } & FlyCliOptions,
): Promise<FlyCliAppInfo> {
  const { appName, ...rest } = options
  const result = await runFlyCommand(
    ['status', '--app', appName, '--json'],
    rest,
  )
  const data = parseFlyJson<Record<string, unknown>>(result.stdout)
  return mapAppInfo(data)
}

export async function flyCliAppsCreate(
  options: { appName: string; orgSlug: string } & FlyCliOptions,
): Promise<FlyCliAppInfo> {
  const { appName, orgSlug, ...rest } = options
  const result = await runFlyCommand(
    ['apps', 'create', '--name', appName, '--org', orgSlug, '--json', '--yes'],
    rest,
  )
  const data = parseFlyJson<Record<string, unknown>>(result.stdout)
  return mapAppInfo(data)
}

export async function flyCliAppsDestroy(
  options: { appName: string; force?: boolean } & FlyCliOptions,
): Promise<void> {
  const { appName, force = false, ...rest } = options
  const args = ['apps', 'destroy', appName, '--yes']
  if (force) {
    console.warn(
      'flyCliAppsDestroy: force destroy requested but flyctl no longer accepts --force; proceeding without it.',
    )
  }
  await runFlyCommand(args, rest)
}

export async function flyCliSecretsSet(
  options:
    & { appName: string; secrets: Record<string, string>; stage?: boolean }
    & FlyCliOptions,
): Promise<void> {
  const { appName, secrets, stage = false, ...rest } = options
  if (Object.keys(secrets).length === 0) return
  const args = ['secrets', 'set', '--app', appName]
  if (stage) args.push('--stage')
  const kvPairs = Object.entries(secrets).map(([key, value]) =>
    `${key}=${value}`
  )
  await runFlyCommand([...args, ...kvPairs], rest)
}

export async function flyCliTokensCreateDeploy(
  options: { appName: string; name?: string; expiry?: string } & FlyCliOptions,
): Promise<string> {
  const { appName, name, expiry, ...rest } = options
  const args = ['tokens', 'create', 'deploy', '--app', appName, '--json']
  if (name) args.push('--name', name)
  if (expiry) args.push('--expiry', expiry)
  const result = await runFlyCommand(args, rest)
  const data = parseFlyJson<Record<string, unknown>>(result.stdout)
  const token = (data.token ?? data['token'] ?? '') as string
  if (!token) {
    throw new Error('deploy token response missing token field')
  }
  return token
}

function parseMachineStatusOutput(output: string): Record<string, unknown> {
  const clean = stripAnsiSequences(output)
  const lines = clean.split('\n')
  const row: Record<string, unknown> = {}
  const configLines: string[] = []
  let collectingConfig = false

  for (const rawLine of lines) {
    const line = rawLine.trimEnd()
    if (collectingConfig) {
      configLines.push(line)
      continue
    }

    const trimmed = line.trim()
    if (!trimmed) continue

    if (trimmed.startsWith('Config:')) {
      collectingConfig = true
      continue
    }

    const colonIndex = trimmed.indexOf(':')
    if (colonIndex !== -1 && !trimmed.includes('=')) {
      const label = trimmed.slice(0, colonIndex).trim()
      const value = trimmed.slice(colonIndex + 1).trim()
      assignMachineStatusField(row, label, value)
      continue
    }

    const equalsIndex = trimmed.indexOf('=')
    if (equalsIndex !== -1) {
      const label = trimmed.slice(0, equalsIndex).trim()
      const value = trimmed.slice(equalsIndex + 1).trim()
      assignMachineStatusField(row, label, value)
    }
  }

  if (configLines.length === 0) {
    throw new Error('fly machine status output missing Config section')
  }

  const jsonText = configLines.join('\n').trim()
  try {
    row.config = JSON.parse(jsonText)
  } catch (error) {
    throw new Error(
      `failed to parse machine config from status output: ${
        error instanceof Error ? error.message : String(error)
      }`,
    )
  }

  return row
}

function assignMachineStatusField(
  target: Record<string, unknown>,
  label: string,
  value: string,
): void {
  if (!value) return
  const mapping: Record<string, string> = {
    'Machine ID': 'ID',
    'Instance ID': 'InstanceID',
    'State': 'State',
    'Image': 'Image',
    'Name': 'Name',
    'Private IP': 'PrivateIP',
    'Region': 'Region',
    'Created': 'CreatedAt',
    'Updated': 'UpdatedAt',
  }
  const key = mapping[label] ?? label.replace(/\s+/g, '')
  target[key] = value
}

function stripAnsiSequences(value: string): string {
  let result = ''
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i)
    if (code === 27) {
      i += 1
      if (i < value.length && value[i] === '[') {
        i += 1
        while (i < value.length) {
          const ch = value[i]
          if ((ch >= '0' && ch <= '9') || ch === ';') {
            i += 1
            continue
          }
          if (ch === 'm') {
            break
          }
          break
        }
      }
      continue
    }
    result += value[i]
  }
  return result
}

function mapMachineSummary(row: Record<string, unknown>): FlyCliMachineSummary {
  const config = readRecord(row, ['Config', 'config'])
  return {
    id: readString(row, ['id', 'ID']) ?? '',
    name: readString(row, ['name', 'Name']),
    state: readString(row, ['state', 'State']),
    region: readString(row, ['region', 'Region']),
    image: readString(row, ['image', 'Image', 'ImageRef', 'image_ref']) ??
      readString(config, ['image']),
    privateIp: readString(row, ['PrivateIP', 'private_ip', 'IP']),
    createdAt: readString(row, ['CreatedAt', 'created_at']),
    metadata: readRecord(config, ['metadata']),
  }
}

function mapMachineDetail(row: Record<string, unknown>): FlyCliMachineDetail {
  const summary = mapMachineSummary(row)
  const config = readRecord(row, ['Config', 'config'])
  return {
    ...summary,
    config,
  }
}

function mapAppInfo(row: Record<string, unknown>): FlyCliAppInfo {
  const organization = readRecord(row, ['organization', 'Organization'])
  return {
    id: readString(row, ['id', 'ID']) ?? '',
    name: readString(row, ['name', 'Name']),
    organizationSlug: readString(organization ?? {}, ['slug', 'Slug']) ??
      readString(row, ['Organization', 'organization']),
    createdAt: readString(row, ['CreatedAt', 'created_at']),
  }
}

function readString(
  source: Record<string, unknown> | undefined,
  keys: string[],
): string | undefined {
  if (!source) return undefined
  for (const key of keys) {
    const value = source[key]
    if (typeof value === 'string') return value
  }
  return undefined
}

function readRecord(
  source: Record<string, unknown> | undefined,
  keys: string[],
): Record<string, unknown> | undefined {
  if (!source) return undefined
  for (const key of keys) {
    const value = source[key]
    if (value && typeof value === 'object') {
      return value as Record<string, unknown>
    }
  }
  return undefined
}
