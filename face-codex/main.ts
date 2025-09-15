#!/usr/bin/env -S deno run
import { dirname, fromFileUrl, join } from '@std/path'
import type { Face, FaceOptions, FaceView } from '@artifact/shared'
import { HOST } from '@artifact/shared'
import { startNotifyWatcher } from './notify_watcher.ts'

/**
 * Start a lightweight in-memory "face" that echoes interactions and tracks status.
 */
type CodexConfig = { test?: boolean }

export function startFaceCodex(
  opts: FaceOptions & { config?: CodexConfig } = {},
): Face {
  const startedAt = new Date()
  let closed = false
  let count = 0
  let lastId: string | undefined
  const active = new Map<string, Promise<string>>()

  // Child process state (when launching)
  let child: Deno.ChildProcess | undefined
  let pid: number | undefined
  let configDir: string | undefined
  let cwd: string | undefined
  let lastNotificationRaw: string | undefined
  let notifications = 0
  let pendingNotifyWatcher: Promise<void> | null = null
  let views: FaceView[] | undefined
  let tmuxSession: string | undefined
  let tmuxSocket: string | undefined
  let tmuxWindow: string | undefined

  type Pending = {
    id: string
    resolve: (raw: string) => void
    reject: (err: unknown) => void
    canceled: boolean
  }
  const pendingQueue: Pending[] = []
  const pendingById = new Map<string, Pending>()
  const backlog: string[] = []

  // Optional: allow tests to set a notify directory without launching child
  const notifyDirOverride = (opts.config as Record<string, unknown> | undefined)
    ?.notifyDir as
      | string
      | undefined

  async function ensureConfigIfNeeded() {
    // Only act when both directories are provided (implies launch)
    if (!opts.workspace || !opts.home) return
    configDir = opts.home
    // Must not create directories; error if missing
    try {
      const st = await Deno.stat(configDir)
      if (!st.isDirectory) {
        throw new Error(`home is not a directory: ${configDir}`)
      }
    } catch {
      throw new Error(`home directory not found: ${configDir}`)
    }

    // Compute repo root and load template
    const thisFile = fromFileUrl(import.meta.url)
    const thisDir = dirname(thisFile)
    const repoRoot = dirname(thisDir) // face-codex/..
    const templatePath = join(thisDir, 'codex.config.toml')
    let template = await Deno.readTextFile(templatePath)

    // Rewrite MCP command paths from "/headers/<pkg>/main.ts" to absolute
    const abs = (pkg: string) => join(repoRoot, pkg, 'main.ts')
    const replacements: Record<string, string> = {
      '/headers/mcp-computers/main.ts': abs('mcp-computers'),
      '/headers/mcp-agents/main.ts': abs('mcp-agents'),
      '/headers/mcp-faces/main.ts': abs('mcp-faces'),
      '/headers/mcp-interactions/main.ts': abs('mcp-interactions'),
    }
    for (const [needle, value] of Object.entries(replacements)) {
      template = template.split(needle).join(value)
    }

    // Inject notify command to call our notify script with required permissions.
    const notifyScript = join(thisDir, 'notify.ts')
    const notifyArr = [
      'deno',
      'run',
      `--allow-write=${configDir}`,
      notifyScript,
      '--dir',
      String(configDir),
    ]
    if (!/\nnotify\s*=/.test(template)) {
      const notifyListStr = notifyArr
        .map((s) => JSON.stringify(s))
        .join(', ')
      template += `\nnotify = [${notifyListStr}]\n`
    }

    const outPathCodex = join(configDir, 'config.toml')
    await Deno.writeTextFile(outPathCodex, template)
  }

  async function isTcpListening(port: number): Promise<boolean> {
    try {
      const conn = await Deno.connect({ hostname: HOST, port })
      try {
        conn.close()
      } catch {
        // ignore
      }
      return true
    } catch {
      return false
    }
  }

  async function waitForPort(port: number, timeoutMs = 8000) {
    const start = Date.now()
    while (Date.now() - start < timeoutMs) {
      if (await isTcpListening(port)) return true
      await new Promise((r) => setTimeout(r, 50))
    }
    return false
  }

  async function maybeLaunch() {
    if (!opts.workspace || !opts.home) return
    await ensureConfigIfNeeded()
    cwd = opts.workspace
    // Must not create directories; error if missing
    try {
      const st = await Deno.stat(cwd)
      if (!st.isDirectory) {
        throw new Error(`workspace is not a directory: ${cwd}`)
      }
    } catch {
      throw new Error(`workspace directory not found: ${cwd}`)
    }

    const cfg = (opts.config ?? {}) as CodexConfig
    const thisDir = dirname(fromFileUrl(import.meta.url))
    const repoRoot = dirname(thisDir)
    const tmuxScript = join(repoRoot, 'shared', 'tmux.sh')

    // Pre-assign tmux identifiers so we can use send-keys reliably
    tmuxSession = `face-codex-${crypto.randomUUID().slice(0, 8)}`
    tmuxSocket = `face-codex-sock-${crypto.randomUUID().slice(0, 8)}`
    tmuxWindow = 'Codex'
    const extHost = opts.hostname ?? HOST

    // Try sequential ports starting at 10000 until ttyd is listening
    const startPort = 10000
    let launched = false
    for (let port = startPort; port < startPort + 200 && !launched; port += 1) {
      const env: Record<string, string> = {
        ...Deno.env.toObject(),
        CODEX_HOME: configDir!,
        WINDOW_TITLE: tmuxWindow,
        SESSION: tmuxSession,
        SOCKET: tmuxSocket,
        TTYD_PORT: String(port),
        HOST,
        TTYD_HOST: extHost,
        WRITEABLE: 'on',
      }
      const args = cfg.test
        ? [
          'deno',
          'run',
          '-A',
          join(thisDir, 'mock-app.ts'),
          '--notify',
          join(thisDir, 'notify.ts'),
          '--dir',
          String(configDir!),
        ]
        : ['npx', '-y', '@openai/codex', '--cd', cwd]

      const cmd = new Deno.Command(tmuxScript, { args, cwd, env })
      const proc = cmd.spawn()
      const ok = await Promise.race([
        waitForPort(port, 5000),
        proc.status.then(() => false),
      ])
      if (ok) {
        child = proc
        pid = proc.pid
        views = [{
          name: 'terminal',
          port,
          protocol: 'http',
          url: `http://${extHost}:${port}`,
        }]
        launched = true
      } else {
        try {
          proc.kill('SIGTERM')
        } catch {
          // ignore
        }
        try {
          await proc.status
        } catch {
          // ignore
        }
      }
    }
    if (!launched) {
      throw new Error(
        'Failed to launch ttyd via tmux on available port starting at 10000',
      )
    }
  }

  // Fire and forget; preserve original lightweight semantics if not launching
  maybeLaunch()

  function assertOpen() {
    if (closed) throw new Error('face is closed')
  }

  function deliver(raw: string) {
    // Prefer delivering to earliest non-canceled waiter; else queue
    while (pendingQueue.length) {
      const p = pendingQueue.shift()!
      pendingById.delete(p.id)
      if (!p.canceled) {
        p.resolve(raw)
        return
      }
    }
    backlog.push(raw)
  }

  function interaction(input: string) {
    assertOpen()
    const id = crypto.randomUUID()
    count += 1
    lastId = id

    // Record a promise that resolves with next notify payload
    const p = new Promise<string>((resolve, reject) => {
      const pending: Pending = { id, resolve, reject, canceled: false }
      if (backlog.length) {
        const raw = backlog.shift()!
        resolve(raw)
      } else {
        pendingQueue.push(pending)
        pendingById.set(id, pending)
      }
    })
    active.set(id, p)
    ;(async () => {
      try {
        if (tmuxSession && tmuxSocket && tmuxWindow) {
          const cmd = new Deno.Command('tmux', {
            args: [
              '-L',
              String(tmuxSocket),
              'send-keys',
              '-t',
              `${tmuxSession}:${tmuxWindow}`,
              String(input),
              'C-m',
            ],
            stdout: 'inherit',
            stderr: 'inherit',
          })
          await cmd.output()
        }
      } catch (_) {
        // ignore
      }
    })()
    // Start a single-use watcher for notify.json on first interaction after idle
    if ((configDir || notifyDirOverride) && !pendingNotifyWatcher) {
      if (!configDir && notifyDirOverride) configDir = notifyDirOverride
      const watchDir = (configDir ?? notifyDirOverride) as string
      pendingNotifyWatcher = startNotifyWatcher(
        watchDir,
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
    return { id }
  }

  async function destroy() {
    closed = true
    if (child) {
      try {
        // Try graceful SIGTERM, then force kill after a short delay
        child.kill('SIGTERM')
        try {
          await child.status
        } catch (_) {
          // ignore
        }
      } catch (_) {
        // ignore
      }
    }
  }

  async function status() {
    await Promise.resolve()
    return {
      startedAt: startedAt.toISOString(),
      closed,
      interactions: count,
      lastInteractionId: lastId,
      pid,
      config: configDir,
      workspace: cwd,
      notifications,
      lastNotificationRaw,
      views,
    }
  }

  async function awaitInteraction(id: string): Promise<string> {
    const rec = active.get(id)
    if (!rec) throw new Error(`unknown interaction id: ${id}`)
    try {
      return await rec
    } finally {
      active.delete(id)
    }
  }

  function cancel(id: string) {
    const rec = active.get(id)
    if (!rec) throw new Error(`unknown interaction id: ${id}`)
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

  return { interaction, awaitInteraction, cancel, destroy, status }
}
