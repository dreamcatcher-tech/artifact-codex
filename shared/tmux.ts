#!/usr/bin/env -S deno run -A

import { fromFileUrl } from '@std/path'

const TRUTHY = new Set(['1', 'true', 'on', 'yes'])
const ENTER_DELAY_MS = 150

export const SHARED_TMUX_SOCKET = Deno.env.get('ARTIFACT_TMUX_SOCKET') ??
  'artifact-tmux'

const TMUX_CONFIG_PATH = fromFileUrl(new URL('./tmux.conf', import.meta.url))

export interface LaunchTmuxTerminalOptions {
  command: string[]
  session: string
  ttydPort: number
  ttydHost: string
  cwd?: string
  env?: Record<string, string>
  shell?: string
  writeable?: boolean
}

export interface LaunchTmuxTerminalResult {
  child: Deno.ChildProcess
  ttydPort: number
  ttydHost: string
  createdSession: boolean
}

interface CommandOptions {
  args: string[]
  cwd?: string
  env?: Record<string, string>
  stdin?: 'inherit' | 'piped' | 'null'
  stdout?: 'inherit' | 'piped' | 'null'
  stderr?: 'inherit' | 'piped' | 'null'
  check?: boolean
}

export async function launchTmuxTerminal(
  options: LaunchTmuxTerminalOptions,
): Promise<LaunchTmuxTerminalResult> {
  const { command, session, ttydPort, ttydHost } = options
  if (!Array.isArray(command) || command.length === 0) {
    throw new Error('command must be a non-empty string[]')
  }
  await requireBinary('tmux')
  await requireBinary('ttyd')

  const env = options.env
  const cwd = options.cwd
  const shell = options.shell ?? Deno.env.get('SHELL') ?? '/usr/bin/bash'
  const writeable = Boolean(options.writeable)

  const createdSession = await ensureTmuxSession({
    session,
    shell,
    cwd,
    env,
  })
  if (createdSession) {
    const quoted = shellQuote(command)
    await sendRawKeys(session, quoted, { cwd, env })
    await sendEnter(session, { cwd, env })
  }

  const ttydArgs = buildTtydArgs({
    session,
    shell,
    ttydPort,
    writeable,
  })
  const child = new Deno.Command('ttyd', {
    args: ttydArgs,
    cwd,
    env,
    stdin: 'inherit',
    stdout: 'inherit',
    stderr: 'inherit',
  }).spawn()

  return { child, ttydPort, ttydHost, createdSession }
}

export async function sendKeysViaTmux(
  session: string,
  input: string,
  opts: { cwd?: string; env?: Record<string, string>; enterDelayMs?: number } =
    {},
): Promise<void> {
  const trimmed = input.trim()
  if (trimmed.length > 0) {
    await sendRawKeys(session, trimmed, opts)
    const delay = opts.enterDelayMs ?? ENTER_DELAY_MS
    if (delay > 0) await sleep(delay)
  }
  await sendEnter(session, opts)
}

export function parseWritable(value: string | undefined): boolean {
  if (!value) return false
  return TRUTHY.has(value.trim().toLowerCase())
}

function shellQuote(args: string[]): string {
  return args.map(quote).join(' ')
}

function quote(value: string): string {
  if (value.length === 0) return "''"
  if (/^[A-Za-z0-9_@%+=:,./-]+$/.test(value)) return value
  return "'" + value.replace(/'/g, "'\\''") + "'"
}

async function requireBinary(name: string): Promise<void> {
  try {
    const child = new Deno.Command(name, {
      args: ['-V'],
      stdout: 'null',
      stderr: 'null',
    }).spawn()
    await child.status
  } catch (err) {
    if (err instanceof Deno.errors.NotFound) {
      throw new Error(`missing '${name}' in PATH`)
    }
    throw err
  }
}

async function ensureTmuxSession(
  options: {
    session: string
    shell: string
    cwd?: string
    env?: Record<string, string>
  },
): Promise<boolean> {
  if (await hasTmuxSession(options.session, options)) return false
  await run('tmux', {
    args: [
      '-L',
      SHARED_TMUX_SOCKET,
      '-f',
      TMUX_CONFIG_PATH,
      'new-session',
      '-Ad',
      '-s',
      options.session,
      options.shell,
      '-il',
    ],
    cwd: options.cwd,
    env: options.env,
    stdout: 'null',
    stderr: 'inherit',
    check: true,
  })
  return true
}

async function hasTmuxSession(
  session: string,
  options: { cwd?: string; env?: Record<string, string> },
): Promise<boolean> {
  const status = await run('tmux', {
    args: ['-L', SHARED_TMUX_SOCKET, 'has-session', '-t', session],
    cwd: options.cwd,
    env: options.env,
    stdout: 'null',
    stderr: 'null',
  })
  return status.success
}

async function sendRawKeys(
  session: string,
  raw: string,
  options: { cwd?: string; env?: Record<string, string> },
) {
  await run('tmux', {
    args: [
      '-L',
      SHARED_TMUX_SOCKET,
      'send-keys',
      '-t',
      `${session}:0`,
      raw,
    ],
    cwd: options.cwd,
    env: options.env,
    stdout: 'inherit',
    stderr: 'inherit',
    check: true,
  })
}

async function sendEnter(
  session: string,
  options: { cwd?: string; env?: Record<string, string> },
) {
  await run('tmux', {
    args: [
      '-L',
      SHARED_TMUX_SOCKET,
      'send-keys',
      '-t',
      `${session}:0`,
      'C-m',
    ],
    cwd: options.cwd,
    env: options.env,
    stdout: 'inherit',
    stderr: 'inherit',
    check: true,
  })
}

function buildTtydArgs(options: {
  session: string
  shell: string
  ttydPort: number
  writeable: boolean
}): string[] {
  const args = ['-p', String(options.ttydPort)]
  if (options.writeable) args.push('-W')
  args.push(
    'tmux',
    '-u',
    '-L',
    SHARED_TMUX_SOCKET,
    'new-session',
    '-A',
    '-s',
    options.session,
    options.shell,
    '-il',
  )
  return args
}

async function run(
  command: string,
  options: CommandOptions,
): Promise<Deno.CommandStatus> {
  try {
    const { check, ...rest } = options
    const child = new Deno.Command(command, rest).spawn()
    const status = await child.status
    if (check && !status.success) {
      throw new Error(`command failed: ${command}`)
    }
    return status
  } catch (err) {
    if (err instanceof Deno.errors.NotFound) {
      throw new Error(`missing '${command}' in PATH`)
    }
    throw err
  }
}

async function sleep(ms: number) {
  await new Promise((resolve) => setTimeout(resolve, ms))
}

if (import.meta.main) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : String(err))
    Deno.exit(1)
  })
}

async function main() {
  const args = Deno.args
  if (args.length === 0) {
    throw new Error(`usage: ${Deno.mainModule} <command> [args...]`)
  }

  const session = requireEnv('SESSION')
  const ttydHost = requireEnv('TTYD_HOST')
  const ttydPort = parsePort(requireEnv('TTYD_PORT'))
  const writeable = parseWritable(Deno.env.get('WRITEABLE'))

  const env = Deno.env.toObject()
  const cwd = Deno.cwd()

  console.log(`ttyd: http://${ttydHost}:${ttydPort}`)
  const { child } = await launchTmuxTerminal({
    command: args,
    session,
    ttydPort,
    ttydHost,
    cwd,
    env,
    shell: Deno.env.get('SHELL') ?? '/usr/bin/bash',
    writeable,
  })
  const status = await child.status
  Deno.exit(status.code ?? 0)
}

function requireEnv(name: string): string {
  const value = Deno.env.get(name)
  if (!value) {
    throw new Error(`missing env ${name}`)
  }
  return value
}

function parsePort(value: string): number {
  const port = Number.parseInt(value, 10)
  if (!Number.isFinite(port) || port <= 0) {
    throw new Error(`invalid port: ${value}`)
  }
  return port
}
