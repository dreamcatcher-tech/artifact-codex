import { HOST } from '@artifact/shared'
import { fromFileUrl } from '@std/path'
import { ulid } from '@std/ulid'
const ENTER_DELAY_MS = 150
const DEFAULT_TTYD_PORT = 10000
const TMUX_SHELL = 'bash'

const TMUX_SOCKET_PREFIX = 'agent-tmux'

export const SHARED_TMUX_SOCKET = `${TMUX_SOCKET_PREFIX}-${ulid()}`

export const TMUX_SESSION = 'agent-terminal'

const TMUX_CONFIG_PATH = fromFileUrl(new URL('./tmux.conf', import.meta.url))

type SpawnEnv = Record<string, string | number | boolean>

export interface LaunchTmuxTerminalOptions {
  command: string
  args?: string[]
  cwd?: string
  env?: SpawnEnv
  ttydPort?: number
  writeable?: boolean
  signal?: AbortSignal
}

export interface LaunchTmuxTerminalResult {
  child: Deno.ChildProcess
  ttydHost: string
  ttydPort: number
  session: string
  sendInteraction: (
    input: string,
    options?: { enterDelayMs?: number },
  ) => Promise<Deno.CommandStatus>
  cancelInteraction: () => Promise<Deno.CommandStatus>
}

// tmux should be started with its initial command, rather than us putting it in

export async function launchTmuxTerminal(
  options: LaunchTmuxTerminalOptions,
): Promise<LaunchTmuxTerminalResult> {
  const { command } = options
  if (!command || command.trim().length === 0) {
    throw new Error('command is required')
  }
  if (options.signal?.aborted) {
    throw new DOMException('Aborted', 'AbortError')
  }

  await requireBinary('tmux')
  await requireBinary('ttyd')

  const args = options.args ?? []
  const ttydPort = options.ttydPort ?? DEFAULT_TTYD_PORT
  const ttydHost = HOST
  const cwd = options.cwd
  const env = (options.env ?? {}) as Record<string, string>
  const writeable = Boolean(options.writeable)

  await resetTmuxSession({ cwd, env })
  await createTmuxSession({ cwd, env })

  if (Object.keys(env).length > 0) {
    await applyTmuxEnvironment(env)
  }

  const initialCommand = shellQuote([command, ...args])
  if (initialCommand.length > 0) {
    await sendRawKeys(initialCommand, { cwd, env })
    await sendEnter({ cwd, env })
  }

  const ttydArgs = buildTtydArgs({ ttydPort, writeable })
  const child = new Deno.Command('ttyd', {
    args: ttydArgs,
    cwd,
    env,
    stdin: 'inherit',
    stdout: 'inherit',
    stderr: 'inherit',
  }).spawn()

  const cleanup = async () => {
    await killTmuxSession({ cwd, env })
  }

  const sendInteraction = async (
    input: string,
    options: { enterDelayMs?: number } = {},
  ): Promise<Deno.CommandStatus> => {
    const text = String(input ?? '')
    if (text.length > 0) {
      await sendRawKeys(text, { cwd, env })
      const delay = options.enterDelayMs ?? ENTER_DELAY_MS
      if (delay > 0) {
        await sleep(delay)
      }
    }
    return await sendEnter({ cwd, env })
  }

  const cancelInteraction = (): Promise<Deno.CommandStatus> => {
    return sendCancel({ cwd, env })
  }

  if (options.signal) {
    const onAbort = () => {
      try {
        child.kill('SIGTERM')
      } catch {
        // ignore
      }
      cleanup().catch(() => {
        // ignore cleanup failure during abort
      })
    }
    options.signal.addEventListener('abort', onAbort, { once: true })
    child.status.finally(() => {
      options.signal?.removeEventListener('abort', onAbort)
    })
  }

  child.status.finally(() => {
    cleanup().catch(() => {
      // ignore cleanup errors after process exit
    })
  })

  return {
    child,
    ttydHost,
    ttydPort,
    session: TMUX_SESSION,
    sendInteraction,
    cancelInteraction,
  }
}

async function resetTmuxSession(
  options: { cwd?: string; env?: Record<string, string> },
): Promise<void> {
  try {
    await run('tmux', {
      args: [
        '-L', // socket name for tmux server
        SHARED_TMUX_SOCKET,
        'kill-session', // terminate any existing session before recreating it
        '-t', // target session name
        TMUX_SESSION,
      ],
      cwd: options.cwd,
      env: options.env,
      stdout: 'null',
      stderr: 'null',
    })
  } catch {
    // ignore failures; session might not exist yet
  }
}

async function createTmuxSession(
  options: { cwd?: string; env?: Record<string, string> },
): Promise<void> {
  await run('tmux', {
    args: [
      '-L', // socket name for tmux server
      SHARED_TMUX_SOCKET,
      '-f', // tmux configuration file path
      TMUX_CONFIG_PATH,
      'new-session', // create a detached session for ttyd
      '-d', // start session detached
      '-s', // assign session name
      TMUX_SESSION,
      TMUX_SHELL,
      '-il', // launch shell as interactive login shell
    ],
    cwd: options.cwd,
    env: options.env,
    stdout: 'null',
    stderr: 'inherit',
    check: true,
  })
}

async function applyTmuxEnvironment(
  env: Record<string, string>,
): Promise<void> {
  const entries = Object.entries(env).filter(([, value]) => value.length > 0)
  if (entries.length === 0) return
  for (const [key, value] of entries) {
    try {
      await run('tmux', {
        args: [
          '-L', // socket name for tmux server
          SHARED_TMUX_SOCKET,
          'set-environment', // set server-wide environment variable
          '-g', // apply to the global tmux environment
          key,
          value,
        ],
        stdout: 'null',
        stderr: 'null',
      })
    } catch {
      // ignore failures; environment inheritance is best-effort
    }
  }
}

async function sendRawKeys(
  raw: string,
  options: { cwd?: string; env?: Record<string, string> },
): Promise<void> {
  await sendTmuxKeys(raw, options)
}

async function sendEnter(
  options: { cwd?: string; env?: Record<string, string> },
): Promise<Deno.CommandStatus> {
  return await sendTmuxKeys('C-m', options)
}

async function sendCancel(
  options: { cwd?: string; env?: Record<string, string> },
): Promise<Deno.CommandStatus> {
  return await sendTmuxKeys('C-c', options)
}

async function sendTmuxKeys(
  key: string,
  options: { cwd?: string; env?: Record<string, string> },
): Promise<Deno.CommandStatus> {
  return await run('tmux', {
    args: [
      '-L', // socket name for tmux server
      SHARED_TMUX_SOCKET,
      'send-keys', // push keystrokes into the pane
      '-t', // target pane "session:window"
      `${TMUX_SESSION}:0`,
      key,
    ],
    cwd: options.cwd,
    env: options.env,
    stdout: 'null',
    stderr: 'null',
    check: true,
  })
}

function buildTtydArgs(
  options: { ttydPort: number; writeable: boolean },
): string[] {
  const args = ['--port', String(options.ttydPort)] // expose ttyd on this port
  if (options.writeable) {
    args.push('--writable') // permit terminal input from viewers
  }
  args.push('--terminal-option', 'disableLeaveAlert=true') // prevent leave warning
  args.push(
    'tmux', // launch tmux inside ttyd
    '-u', // run tmux in UTF-8 mode
    '-L', // socket name for tmux server
    SHARED_TMUX_SOCKET,
    'new-session', // reuse existing session if present
    '-A', // attach to existing session instead of failing
    '-s', // assign session name
    TMUX_SESSION,
    TMUX_SHELL,
    '-il', // launch shell as interactive login shell
  )
  return args
}

async function killTmuxSession(
  options: { cwd?: string; env?: Record<string, string> },
): Promise<void> {
  try {
    await run('tmux', {
      args: [
        '-L', // socket name for tmux server
        SHARED_TMUX_SOCKET,
        'kill-session', // terminate the session on shutdown
        '-t', // target session name
        TMUX_SESSION,
      ],
      cwd: options.cwd,
      env: options.env,
      stdout: 'null',
      stderr: 'null',
    })
  } catch {
    // ignore cleanup failures
  }
}

async function requireBinary(name: string): Promise<void> {
  try {
    const child = new Deno.Command(name, {
      args: ['-V'],
      stdin: 'null',
      stdout: 'null',
      stderr: 'null',
    }).spawn()
    await child.status
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) {
      throw new Error(`missing '${name}' in PATH`)
    }
    throw error
  }
}

async function run(
  command: string,
  options: {
    args: string[]
    cwd?: string
    env?: Record<string, string>
    stdin?: 'inherit' | 'piped' | 'null'
    stdout?: 'inherit' | 'piped' | 'null'
    stderr?: 'inherit' | 'piped' | 'null'
    check?: boolean
  },
): Promise<Deno.CommandStatus> {
  const { check, ...rest } = options
  const child = new Deno.Command(command, rest).spawn()
  const status = await child.status
  if (check && !status.success) {
    throw new Error(`command failed: ${command}`)
  }
  return status
}

function shellQuote(parts: string[]): string {
  return parts.map(quote).join(' ')
}

function quote(value: string): string {
  if (value.length === 0) return "''"
  if (/^[A-Za-z0-9_@%+=:,./-]+$/.test(value)) return value
  return "'" + value.replace(/'/g, "'\\''") + "'"
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms))
}
