#!/usr/bin/env -S deno run
import { dirname, fromFileUrl, join } from '@std/path'
import type { Face, FaceView } from '@artifact/shared'
import { findAvailablePort, HOST, waitForPort } from '@artifact/shared'
import { startNotifyWatcher } from './notify_watcher.ts'
import {
  type CodexConfig,
  type CodexFaceOptions,
  prepareLaunchDirectories,
} from './config.ts'
import { load } from '@std/dotenv'
const MODULE_DIR = dirname(fromFileUrl(import.meta.url))
await load({ envPath: join(MODULE_DIR, '/.env'), export: true })
const REPO_ROOT = dirname(MODULE_DIR)
const TMUX_SCRIPT = join(REPO_ROOT, 'shared', 'tmux.sh')
const MOCK_APP_SCRIPT = join(MODULE_DIR, 'mock-app.ts')
const NOTIFY_SCRIPT = join(MODULE_DIR, 'notify.ts')
const PORT_START = 10000
const PORT_SPAN = 200

type Pending = {
  id: string
  resolve: (raw: string) => void
  reject: (err: unknown) => void
  canceled: boolean
}

type TmuxIds = {
  session: string
  socket: string
  window: string
}

type LaunchState = {
  child?: Deno.ChildProcess
  pid?: number
  views?: FaceView[]
  tmux?: TmuxIds
}

export function startFaceCodex(opts: CodexFaceOptions = {}): Face {
  console.log('startFaceCodex:', opts)
  const startedAt = new Date()
  let closed = false
  let count = 0
  let lastId: string | undefined
  const active = new Map<string, Promise<string>>()
  const pendingQueue: Pending[] = []
  const pendingById = new Map<string, Pending>()
  const backlog: string[] = []
  let lastNotificationRaw: string | undefined
  let notifications = 0
  let pendingNotifyWatcher: Promise<void> | null = null
  let configDir: string | undefined
  let cwd: string | undefined

  const notifyDirOverride = (opts.config as Record<string, unknown> | undefined)
    ?.notifyDir as string | undefined

  const launchState: LaunchState = {}

  async function launchIfNeeded() {
    const prepared = await prepareLaunchDirectories(opts)
    if (!prepared) return

    configDir = prepared.home
    cwd = prepared.workspace

    const host = opts.hostname ?? HOST
    const cfg = opts.config ?? {}

    const launchMode = cfg.launch ?? 'tmux'
    if (launchMode === 'disabled') {
      launchState.views = []
      return
    }

    const tmux = createTmuxIds()
    launchState.tmux = tmux

    const result = await launchCodexProcess({
      cfg,
      configDir,
      workspace: cwd,
      host,
      tmux,
    })

    launchState.child = result.child
    launchState.pid = result.pid
    launchState.views = result.views
  }

  function assertOpen() {
    if (closed) throw new Error('face is closed')
  }

  function deliver(raw: string) {
    while (pendingQueue.length) {
      const pending = pendingQueue.shift()!
      pendingById.delete(pending.id)
      if (!pending.canceled) {
        pending.resolve(raw)
        return
      }
    }
    backlog.push(raw)
  }

  function ensureNotifyWatcher() {
    if (pendingNotifyWatcher) return
    const dir = configDir ?? notifyDirOverride
    if (!dir) return
    pendingNotifyWatcher = startNotifyWatcher(
      dir,
      (raw) => {
        lastNotificationRaw = raw
        notifications += 1
        deliver(raw)
      },
    ).finally(() => {
      pendingNotifyWatcher = null
    })
    pendingNotifyWatcher.catch(() => {
      // ignore
    })
  }

  function registerPending(id: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const pending: Pending = { id, resolve, reject, canceled: false }
      if (backlog.length) {
        const raw = backlog.shift()!
        resolve(raw)
        return
      }
      pendingQueue.push(pending)
      pendingById.set(id, pending)
    })
  }

  function queueSendKeys(input: string) {
    const tmux = launchState.tmux
    if (!tmux) return
    sendKeysViaTmux(tmux, input).catch(() => {
      // ignore
    })
  }

  function interaction(input: string) {
    assertOpen()
    const id = crypto.randomUUID()
    count += 1
    lastId = id

    const pending = registerPending(id)
    active.set(id, pending)
    queueSendKeys(input)
    ensureNotifyWatcher()
    return { id }
  }

  async function destroy() {
    closed = true
    const child = launchState.child
    if (child) {
      try {
        child.kill('SIGTERM')
        try {
          await child.status
        } catch {
          // ignore
        }
      } catch {
        // ignore
      }
    }
    if (configDir) {
      await removeHomeDirectory(configDir)
      configDir = undefined
    }
  }

  async function status() {
    await launchPromise
    if (launchError) {
      throw launchError
    }
    return {
      startedAt: startedAt.toISOString(),
      closed,
      interactions: count,
      lastInteractionId: lastId,
      pid: launchState.pid,
      config: configDir,
      home: configDir,
      workspace: cwd ?? opts.workspace,
      notifications,
      lastNotificationRaw,
      views: launchState.views,
    }
  }

  async function awaitInteraction(id: string) {
    const promise = active.get(id)
    if (!promise) throw new Error(`unknown interaction id: ${id}`)
    try {
      return await promise
    } finally {
      active.delete(id)
    }
  }

  function cancel(id: string) {
    const promise = active.get(id)
    if (!promise) throw new Error(`unknown interaction id: ${id}`)
    active.delete(id)
    const pending = pendingById.get(id)
    if (pending) {
      pending.canceled = true
      pendingById.delete(id)
      try {
        pending.reject(new Error('canceled'))
      } catch {
        // ignore
      }
    }
    return Promise.resolve()
  }

  const launchPromise = launchIfNeeded()
  let launchError: Error | undefined
  launchPromise.catch((err) => {
    launchError = err
  })

  return { interaction, awaitInteraction, cancel, destroy, status }
}

type LaunchArgs = {
  cfg: CodexConfig
  configDir: string
  workspace: string
  host: string
  tmux: TmuxIds
}

type LaunchResult = {
  child: Deno.ChildProcess
  pid: number
  views: FaceView[]
}

async function launchCodexProcess(args: LaunchArgs): Promise<LaunchResult> {
  const { cfg, configDir, workspace, host, tmux } = args
  const exclude = new Set<number>()
  const maxAttempts = PORT_SPAN
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const port = await findAvailablePort({
      port: PORT_START,
      min: PORT_START,
      max: PORT_START + PORT_SPAN - 1,
      exclude: [...exclude],
      hostname: host,
    })
    const env: Record<string, string> = {
      ...Deno.env.toObject(),
      CODEX_HOME: configDir,
      WINDOW_TITLE: tmux.window,
      SESSION: tmux.session,
      SOCKET: tmux.socket,
      TTYD_PORT: String(port),
      HOST: host,
      TTYD_HOST: host,
      WRITEABLE: 'on',
    }
    const cmdArgs = cfg.test
      ? [
        'deno',
        'run',
        '-A',
        MOCK_APP_SCRIPT,
        '--notify',
        NOTIFY_SCRIPT,
        '--dir',
        configDir,
      ]
      : ['npx', '-y', '@openai/codex', '--cd', workspace]

    const command = new Deno.Command(TMUX_SCRIPT, {
      args: cmdArgs,
      cwd: workspace,
      env,
    })
    const child = command.spawn()
    const ready = await Promise.race([
      waitForPort(port, { hostname: host, timeoutMs: 5000 }),
      child.status.then(() => false),
    ])
    if (ready) {
      const views: FaceView[] = [{
        name: 'terminal',
        port,
        protocol: 'http',
        url: `http://${host}:${port}`,
      }]
      return { child, pid: child.pid, views }
    }
    try {
      child.kill('SIGTERM')
    } catch {
      // ignore
    }
    try {
      await child.status
    } catch {
      // ignore
    }
    exclude.add(port)
  }
  throw new Error(
    'Failed to launch ttyd via tmux on available port starting at 10000',
  )
}

function createTmuxIds(): TmuxIds {
  return {
    session: `face-codex-${crypto.randomUUID().slice(0, 8)}`,
    socket: `face-codex-sock-${crypto.randomUUID().slice(0, 8)}`,
    window: 'Codex',
  }
}

async function removeHomeDirectory(path: string) {
  try {
    await Deno.remove(path, { recursive: true })
  } catch (err) {
    if (err instanceof Deno.errors.NotFound) return
    throw err
  }
}

const ENTER_DELAY_MS = 150

async function sleep(ms: number) {
  await new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

async function sendKeysViaTmux(tmux: TmuxIds, input: string) {
  const trimmed = input.trim()
  const baseArgs = [
    '-L',
    tmux.socket,
    'send-keys',
    '-t',
    `${tmux.session}:${tmux.window}`,
  ]
  if (trimmed.length > 0) {
    const typeCommand = new Deno.Command('tmux', {
      args: [...baseArgs, trimmed],
      stdout: 'inherit',
      stderr: 'inherit',
    })
    await typeCommand.output()
    await sleep(ENTER_DELAY_MS)
  }
  const enterCommand = new Deno.Command('tmux', {
    args: [...baseArgs, 'C-m'],
    stdout: 'inherit',
    stderr: 'inherit',
  })
  await enterCommand.output()
}
