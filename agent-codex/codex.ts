import {
  HOST,
  launchTmuxTerminal,
  sendKeysViaTmux,
  SHARED_TMUX_SOCKET,
} from '@artifact/shared'
import type { AgentView } from '@artifact/shared'
import { startNotifyWatcher } from './notify_watcher.ts'
import {
  type CodexAgentOptions,
  type CodexConfig,
  type CodexLaunchArgs,
  type CodexLaunchResult,
  type CodexOverrides,
  prepareLaunchDirectories,
} from './config.ts'

const TTYD_PORT = 10000
const CODEX_PROMPT_REGEX = /(?:^|\n)›\s/

type InteractionState = 'pending' | 'completed' | 'cancelled' | 'rejected'

type InteractionRecord = {
  id: string
  input: string
  state: InteractionState
  started: boolean
  promise: Promise<string>
  deliver: (raw: string) => void
  fail: (error: unknown, state: InteractionState) => void
  value?: string
  error?: Error
}

type LaunchState = {
  child?: Deno.ChildProcess
  pid?: number
  views: AgentView[]
  tmuxSession?: string
}

type PendingNotify = Promise<void> | null

export type CodexAgentStatus = {
  startedAt: string
  closed: boolean
  interactions: number
  lastInteractionId?: string
  pid?: number
  config?: string
  home?: string
  workspace?: string
  notifications: number
  lastNotificationRaw?: string
  views: AgentView[]
}

export class CodexAgent {
  readonly startedAt = new Date()
  private closed = false
  private interactionSeq = 0
  private lastInteractionId: string | undefined

  private readonly interactions = new Map<string, InteractionRecord>()
  private readonly pendingQueue: InteractionRecord[] = []
  private readonly executionQueue: InteractionRecord[] = []
  private readonly backlog: string[] = []

  private lastNotificationRaw: string | undefined
  private notifications = 0

  private pendingNotifyWatcher: PendingNotify = null
  private notifyWatcherAbort: AbortController | null = null

  private configDir: string | undefined
  private workspaceDir: string | undefined

  private readonly notifyDirOverride: string | undefined
  private readonly launchState: LaunchState = { views: [] }
  private launchPromise: Promise<void> | null = null
  private launchError: Error | null = null
  private destroyPromise: Promise<void> | null = null
  private activeInteraction: InteractionRecord | null = null
  private readyPromise: Promise<void> | null = null

  private readonly sendKeysFn: NonNullable<CodexOverrides['sendKeys']>
  private readonly sendCancelFn: NonNullable<CodexOverrides['sendCancel']>
  private readonly launchProcess: NonNullable<CodexOverrides['launchProcess']>

  constructor(private readonly options: CodexAgentOptions = {}) {
    this.notifyDirOverride = this.options.config?.notifyDir
    const overrides = options.overrides ?? {}
    this.sendKeysFn = overrides.sendKeys ?? defaultSendKeys
    this.sendCancelFn = overrides.sendCancel ?? defaultSendCancel
    this.launchProcess = overrides.launchProcess ?? launchCodexProcess
  }

  async startInteraction(input: string): Promise<string> {
    this.assertOpen()
    await this.ensureLaunch()
    this.assertOpen()

    const interactionId = String(this.interactionSeq++)
    this.lastInteractionId = interactionId

    const record = this.createInteractionRecord(interactionId, input)
    this.executionQueue.push(record)
    this.enqueue(record)
    this.ensureNotifyWatcher()
    this.maybeRunQueue().catch(() => {
      // queue processing errors surface via interaction promises
    })
    return interactionId
  }

  async awaitInteraction(interactionId: string): Promise<string> {
    const record = this.requireInteraction(interactionId)
    const value = await record.promise
    record.value = value
    return value
  }

  async cancelInteraction(
    interactionId: string,
  ): Promise<{ cancelled: boolean; wasActive: boolean }> {
    const record = this.interactions.get(interactionId)
    if (!record || record.state !== 'pending') {
      return { cancelled: false, wasActive: false }
    }

    const wasActive = record.started && this.activeInteraction?.id === record.id
    this.removeFromPendingQueue(record)

    if (wasActive) {
      const session = this.launchState.tmuxSession
      if (session) {
        try {
          await this.sendCancelFn(session)
        } catch {
          // ignore cancel signalling failures; promise reject handles result
        }
      }
    }

    record.fail(
      new Error(`interaction cancelled: ${interactionId}`),
      'cancelled',
    )
    return { cancelled: true, wasActive }
  }

  interactionStatus(interactionId: string): InteractionState {
    const record = this.interactions.get(interactionId)
    if (!record) {
      throw new Error(`unknown interaction id: ${interactionId}`)
    }
    return record.state
  }

  async status(): Promise<CodexAgentStatus> {
    await this.ensureLaunch()
    if (this.launchError) {
      throw this.launchError
    }
    return {
      startedAt: this.startedAt.toISOString(),
      closed: this.closed,
      interactions: this.interactionSeq,
      lastInteractionId: this.lastInteractionId,
      pid: this.launchState.pid,
      config: this.configDir,
      home: this.configDir,
      workspace: this.workspaceDir ?? this.options.workspace,
      notifications: this.notifications,
      lastNotificationRaw: this.lastNotificationRaw,
      views: this.launchState.views.slice(),
    }
  }

  getViews(): AgentView[] {
    return this.launchState.views.slice()
  }

  async destroy(): Promise<void> {
    if (this.destroyPromise) {
      await this.destroyPromise
      return
    }
    this.destroyPromise = this.destroyInternal()
    await this.destroyPromise
  }

  private async destroyInternal(): Promise<void> {
    if (this.closed) return
    this.closed = true

    const watcherPromise = this.pendingNotifyWatcher
    this.pendingNotifyWatcher = null
    this.notifyWatcherAbort?.abort()
    this.notifyWatcherAbort = null

    const child = this.launchState.child
    this.launchState.child = undefined
    this.launchState.views = []
    this.activeInteraction = null
    this.executionQueue.length = 0
    this.pendingQueue.length = 0
    this.readyPromise = null

    if (child) {
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
    }

    await this.removeHomeDirectory(this.configDir)
    this.configDir = undefined

    if (watcherPromise) {
      try {
        await watcherPromise
      } catch {
        // ignore watcher errors on shutdown
      }
    }

    for (const record of this.interactions.values()) {
      if (record.state === 'pending') {
        record.fail(new Error('agent is closed'), 'cancelled')
      }
    }
  }

  private assertOpen() {
    if (this.closed) {
      throw new Error('agent is closed')
    }
  }

  private requireInteraction(interactionId: string): InteractionRecord {
    const record = this.interactions.get(interactionId)
    if (!record) {
      throw new Error(`unknown interaction id: ${interactionId}`)
    }
    return record
  }

  private createInteractionRecord(
    id: string,
    input: string,
  ): InteractionRecord {
    const record: InteractionRecord = {
      id,
      input,
      state: 'pending',
      started: false,
      promise: Promise.resolve(''),
      deliver: () => {},
      fail: () => {},
    }
    record.promise = new Promise<string>((resolve, reject) => {
      record.deliver = (raw: string) => {
        if (record.state !== 'pending') return
        record.state = 'completed'
        record.value = raw
        resolve(raw)
        this.onInteractionSettled(record)
      }
      record.fail = (error: unknown, state: InteractionState) => {
        if (record.state !== 'pending') return
        const err = error instanceof Error ? error : new Error(String(error))
        record.error = err
        record.state = state
        reject(err)
        this.onInteractionSettled(record)
      }
    })
    this.interactions.set(id, record)
    return record
  }

  private enqueue(record: InteractionRecord) {
    if (this.backlog.length > 0) {
      const raw = this.backlog.shift()!
      record.deliver(raw)
      return
    }
    this.pendingQueue.push(record)
  }

  private removeFromPendingQueue(record: InteractionRecord) {
    const idx = this.pendingQueue.indexOf(record)
    if (idx >= 0) {
      this.pendingQueue.splice(idx, 1)
    }
  }

  private ensureNotifyWatcher() {
    if (this.closed || this.pendingNotifyWatcher) return
    const dir = this.configDir ?? this.notifyDirOverride
    if (!dir) return

    const controller = new AbortController()
    this.notifyWatcherAbort = controller
    this.pendingNotifyWatcher = startNotifyWatcher(
      dir,
      (raw) => {
        this.notifications += 1
        this.lastNotificationRaw = raw
        this.deliver(raw)
      },
      'notify.json',
      controller.signal,
    ).finally(() => {
      if (this.notifyWatcherAbort === controller) {
        this.notifyWatcherAbort = null
      }
      this.pendingNotifyWatcher = null
      if (!this.closed) {
        this.ensureNotifyWatcher()
      }
    })
    this.pendingNotifyWatcher.catch(() => {
      // ignore watcher errors; status polling continues to work
    })
  }

  private deliver(raw: string) {
    while (this.pendingQueue.length > 0) {
      const record = this.pendingQueue.shift()!
      if (record.state !== 'pending') continue
      record.deliver(raw)
      return
    }
    this.backlog.push(raw)
  }

  private async maybeRunQueue(): Promise<void> {
    if (this.closed) return
    if (this.activeInteraction && this.activeInteraction.state === 'pending') {
      return
    }
    const next = this.executionQueue.find((candidate) =>
      candidate.state === 'pending' && !candidate.started
    )
    if (!next) return

    this.activeInteraction = next
    next.started = true

    const session = this.launchState.tmuxSession
    if (!session) return
    try {
      await this.ensureReady()
      await this.sendKeysFn(session, next.input)
    } catch (error) {
      next.fail(error, 'rejected')
    }
  }

  private async ensureReady(): Promise<void> {
    const promise = this.readyPromise
    if (!promise) return
    await promise
  }

  private onInteractionSettled(record: InteractionRecord) {
    if (this.activeInteraction?.id === record.id) {
      this.activeInteraction = null
    }
    const idx = this.executionQueue.indexOf(record)
    if (idx >= 0) {
      this.executionQueue.splice(idx, 1)
    }
    this.maybeRunQueue().catch(() => {
      // errors propagate via pending promises
    })
  }

  private async ensureLaunch(): Promise<void> {
    if (this.launchError) {
      throw this.launchError
    }
    if (!this.launchPromise) {
      this.launchPromise = this.launchInternal().catch((error) => {
        const err = error instanceof Error ? error : new Error(String(error))
        this.launchError = err
        throw err
      }).finally(() => {
        if (this.launchError) {
          this.launchPromise = null
        }
      })
    }
    await this.launchPromise
  }

  private async launchInternal(): Promise<void> {
    const prepared = await prepareLaunchDirectories(this.options)
    if (!prepared) {
      this.ensureNotifyWatcher()
      return
    }

    this.configDir = prepared.home
    this.workspaceDir = prepared.workspace

    this.ensureNotifyWatcher()

    const cfg: CodexConfig = this.options.config ?? {}
    const launchMode = cfg.launch ?? 'tmux'
    if (launchMode === 'disabled') {
      this.launchState.views = []
      return
    }

    const tmuxSession = createTmuxSession()
    this.launchState.tmuxSession = tmuxSession

    const result = await this.launchProcess({
      configDir: prepared.home,
      workspace: prepared.workspace,
      host: HOST,
      tmuxSession,
    })

    this.launchState.child = result.child
    this.launchState.pid = result.pid
    this.launchState.views = result.views

    if (result.child) {
      const readyPromise = waitForCodexReady(tmuxSession)
      this.readyPromise = readyPromise
      readyPromise.catch((error) => {
        const err = error instanceof Error ? error : new Error(String(error))
        this.launchError = err
      })
    } else {
      this.readyPromise = null
    }
  }

  private async removeHomeDirectory(path: string | undefined) {
    if (!path) return
    try {
      await Deno.remove(path, { recursive: true })
    } catch (err) {
      if (err instanceof Deno.errors.NotFound) return
      throw err
    }
  }
}

async function waitForCodexReady(
  session: string,
  options: { timeoutMs?: number; pollIntervalMs?: number } = {},
): Promise<void> {
  const timeoutMs = options.timeoutMs ?? 60_000
  const pollIntervalMs = options.pollIntervalMs ?? 200
  const started = Date.now()
  while (true) {
    const pane = await captureTmuxPane(session)
    if (pane && isCodexPromptReady(pane)) {
      return
    }
    if (Date.now() - started >= timeoutMs) {
      throw new Error('timed out waiting for codex prompt')
    }
    await delay(pollIntervalMs)
  }
}

async function captureTmuxPane(session: string): Promise<string> {
  try {
    const command = new Deno.Command('tmux', {
      args: [
        '-L',
        SHARED_TMUX_SOCKET,
        'capture-pane',
        '-pt',
        `${session}:0`,
      ],
      stdout: 'piped',
      stderr: 'null',
    })
    const result = await command.output()
    if (!result.success) return ''
    return new TextDecoder().decode(result.stdout)
  } catch {
    return ''
  }
}

function isCodexPromptReady(text: string): boolean {
  if (!text) return false
  if (CODEX_PROMPT_REGEX.test(text)) return true
  if (text.includes('Codex')) return true

  return false
}

async function defaultSendKeys(session: string, input: string): Promise<void> {
  await sendKeysViaTmux(session, input)
}

async function defaultSendCancel(session: string): Promise<void> {
  try {
    const child = new Deno.Command('tmux', {
      args: [
        '-L',
        SHARED_TMUX_SOCKET,
        'send-keys',
        '-t',
        `${session}:0`,
        'C-c',
      ],
      stdin: 'null',
      stdout: 'null',
      stderr: 'null',
    }).spawn()
    await child.status
  } catch {
    // ignore failures; cancellation will still reject interaction
  }
}

async function launchCodexProcess(
  args: CodexLaunchArgs,
): Promise<CodexLaunchResult> {
  const { configDir, workspace, host, tmuxSession } = args
  const env: Record<string, string> = {
    ...readEnvSafe(),
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
  env.LANG = 'C.UTF-8'
  env.LC_ALL = 'C.UTF-8'
  env.LC_CTYPE = 'C.UTF-8'

  const command = ['codex', '--cd', workspace, 'resume', '--last']

  const tmuxEnvKeys = [
    'CODEX_HOME',
    'OPENAI_API_KEY',
    'SESSION',
    'TTYD_PORT',
    'TTYD_HOST',
    'HOST',
    'WRITEABLE',
    'LANG',
    'LC_ALL',
    'LC_CTYPE',
    'COLORTERM',
    'FORCE_COLOR',
    'CLICOLOR_FORCE',
    'TERM_PROGRAM',
    'TERM_PROGRAM_VERSION',
    'PATH',
  ] as const
  const tmuxEnv: Record<string, string> = {}
  for (const key of tmuxEnvKeys) {
    const value = env[key]
    if (typeof value === 'string' && value.length > 0) {
      tmuxEnv[key] = value
    }
  }

  const { child } = await launchTmuxTerminal({
    command,
    session: tmuxSession,
    ttydPort: TTYD_PORT,
    ttydHost: host,
    cwd: workspace,
    env,
    writeable: true,
    tmuxEnv,
  })

  const views: AgentView[] = [{
    name: 'terminal',
    port: TTYD_PORT,
    protocol: 'http',
    url: `http://${host}:${TTYD_PORT}`,
  }]

  return { child, pid: child.pid, views }
}

async function delay(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms))
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

function readEnvSafe(): Record<string, string> {
  try {
    return Deno.env.toObject()
  } catch {
    return {}
  }
}

export function createCodexAgent(options: CodexAgentOptions = {}): CodexAgent {
  return new CodexAgent(options)
}
