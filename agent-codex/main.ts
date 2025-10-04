#!/usr/bin/env -S deno run
import { dirname, fromFileUrl, join } from '@std/path'
import type { Agent, AgentView } from '@artifact/shared'
import { HOST, launchTmuxTerminal, sendKeysViaTmux } from '@artifact/shared'
import { startNotifyWatcher } from './notify_watcher.ts'
import {
  type CodexConfig,
  type CodexFaceOptions,
  prepareLaunchDirectories,
} from './config.ts'
import { load } from '@std/dotenv'
const MODULE_DIR = dirname(fromFileUrl(import.meta.url))
await load({ envPath: join(MODULE_DIR, '/.env'), export: true })
const MOCK_APP_SCRIPT = join(MODULE_DIR, 'mock-app.ts')
const NOTIFY_SCRIPT = join(MODULE_DIR, 'notify.ts')
const TTYD_PORT = 10000

type Pending = {
  id: string
  resolve: (raw: string) => void
  reject: (err: unknown) => void
  canceled: boolean
}

type LaunchState = {
  child?: Deno.ChildProcess
  pid?: number
  views?: AgentView[]
  tmuxSession?: string
}

export function startAgentCodex(opts: CodexFaceOptions = {}): Agent {
  console.log('startAgentCodex:', opts)
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
  let notifyWatcherAbort: AbortController | null = null
  let configDir: string | undefined
  let cwd: string | undefined

  const notifyDirOverride = (opts.config as Record<string, unknown> | undefined)
    ?.notifyDir as string | undefined

  const launchState: LaunchState = {}

  async function launchIfNeeded() {
    const prepared = await prepareLaunchDirectories(opts)
    if (!prepared) {
      ensureNotifyWatcher()
      return
    }

    configDir = prepared.home
    cwd = prepared.workspace

    ensureNotifyWatcher()

    const host = HOST
    const cfg = opts.config ?? {}

    const launchMode = cfg.launch ?? 'tmux'
    if (launchMode === 'disabled') {
      launchState.views = []
      return
    }

    const tmuxSession = createTmuxSession()
    launchState.tmuxSession = tmuxSession

    const result = await launchCodexProcess({
      cfg,
      configDir,
      workspace: cwd,
      host,
      tmuxSession,
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
    if (closed || pendingNotifyWatcher) return
    const dir = configDir ?? notifyDirOverride
    if (!dir) return
    const controller = new AbortController()
    notifyWatcherAbort = controller
    pendingNotifyWatcher = startNotifyWatcher(
      dir,
      (raw) => {
        lastNotificationRaw = raw
        notifications += 1
        deliver(raw)
      },
      'notify.json',
      controller.signal,
    ).finally(() => {
      if (notifyWatcherAbort === controller) {
        notifyWatcherAbort = null
      }
      pendingNotifyWatcher = null
      ensureNotifyWatcher()
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
    const tmuxSession = launchState.tmuxSession
    if (!tmuxSession) return
    sendKeysViaTmux(tmuxSession, input).catch(() => {
      // ignore
    })
  }

  function interaction(id: string, input: string) {
    assertOpen()
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
    const watcher = pendingNotifyWatcher
    notifyWatcherAbort?.abort()
    notifyWatcherAbort = null
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
    if (watcher) {
      try {
        await watcher
      } catch {
        // ignore
      }
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
  tmuxSession: string
}

type LaunchResult = {
  child: Deno.ChildProcess
  pid: number
  views: AgentView[]
}

async function launchCodexProcess(args: LaunchArgs): Promise<LaunchResult> {
  const { cfg, configDir, workspace, host, tmuxSession } = args
  const env: Record<string, string> = {
    ...Deno.env.toObject(),
    CODEX_HOME: configDir,
    SESSION: tmuxSession,
    TTYD_PORT: String(TTYD_PORT),
    HOST: host,
    TTYD_HOST: host,
    WRITEABLE: 'on',
  }
  ensureEnv(env, 'COLORTERM', 'truecolor')
  ensureEnv(env, 'FORCE_COLOR', '1')
  ensureEnv(env, 'CLICOLOR_FORCE', '1')
  ensureEnv(env, 'TERM_PROGRAM', 'artifact-codex')
  ensureEnv(env, 'TERM_PROGRAM_VERSION', '1')
  ensureEnv(env, 'LANG', 'C.UTF-8')
  ensureEnv(env, 'LC_ALL', env.LANG)
  ensureEnv(env, 'LC_CTYPE', env.LANG)
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
    : ['codex', '--cd', workspace, 'resume', '--last']

  const { child } = await launchTmuxTerminal({
    command: cmdArgs,
    session: tmuxSession,
    ttydPort: TTYD_PORT,
    ttydHost: host,
    cwd: workspace,
    env,
    writeable: true,
  })
  const views: AgentView[] = [{
    name: 'terminal',
    port: TTYD_PORT,
    protocol: 'http',
    url: `http://${host}:${TTYD_PORT}`,
  }]
  return { child, pid: child.pid, views }
}

function createTmuxSession(): string {
  return `agent-codex-${crypto.randomUUID().slice(0, 8)}`
}

function ensureEnv(env: Record<string, string>, key: string, value: string) {
  const current = env[key]
  if (!current || current.trim().length === 0) {
    env[key] = value
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
