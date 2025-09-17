#!/usr/bin/env -S deno run
import { dirname, fromFileUrl, join } from '@std/path'
import type { Face, FaceOptions, FaceView } from '@artifact/shared'
import { findAvailablePort, HOST, waitForPort } from '@artifact/shared'

type CmdConfig = {
  /** Command and args to run inside tmux. Example: ["bash", "-lc", "htop"] */
  command: string[]
  /** Optional window title for tmux + ttyd */
  title?: string
}

export function startFaceCmd(
  opts: FaceOptions = {},
): Face {
  const startedAt = new Date()
  let closed = false
  let interactions = 0
  let lastInteractionId: string | undefined

  // tmux/ttyd state
  let views: FaceView[] | undefined
  let tmuxSession: string | undefined
  let tmuxSocket: string | undefined
  let tmuxWindow: string | undefined
  let child: Deno.ChildProcess | undefined
  let pid: number | undefined
  let cwd: string | undefined

  // Simple interaction bookkeeping: resolve immediately after send-keys
  const active = new Map<string, Promise<string>>()
  const seenInteractionIds = new Set<string>()

  function assertOpen() {
    if (closed) throw new Error('face is closed')
  }

  async function maybeLaunch() {
    if (!opts.workspace) return
    const cfg = (opts.config ?? {}) as Partial<CmdConfig>
    if (
      !cfg.command || !Array.isArray(cfg.command) || cfg.command.length === 0
    ) {
      throw new Error('config.command must be a non-empty string[]')
    }

    cwd = opts.workspace
    try {
      const st = await Deno.stat(cwd)
      if (!st.isDirectory) throw new Error()
    } catch {
      throw new Error(`workspace directory not found: ${cwd}`)
    }

    const thisDir = dirname(fromFileUrl(import.meta.url))
    const repoRoot = dirname(thisDir)
    const tmuxScript = join(repoRoot, 'shared', 'tmux.sh')

    tmuxSession = `face-cmd-${crypto.randomUUID().slice(0, 8)}`
    tmuxSocket = `face-cmd-sock-${crypto.randomUUID().slice(0, 8)}`
    tmuxWindow = (cfg.title ?? '').trim() || 'Command'
    const extHost = opts.hostname ?? HOST

    const startPort = 10000
    const exclude = new Set<number>()
    const maxAttempts = 200
    let launched = false
    for (let attempt = 0; attempt < maxAttempts && !launched; attempt += 1) {
      const port = await findAvailablePort({
        min: startPort,
        max: startPort + 199,
        exclude: [...exclude],
        hostname: HOST,
      })
      const env: Record<string, string> = {
        ...Deno.env.toObject(),
        WINDOW_TITLE: tmuxWindow,
        SESSION: tmuxSession,
        SOCKET: tmuxSocket,
        TTYD_PORT: String(port),
        HOST,
        TTYD_HOST: extHost,
        WRITEABLE: 'on',
      }
      const args = [...cfg.command]
      const cmd = new Deno.Command(tmuxScript, { args, cwd, env })
      const proc = cmd.spawn()
      const ok = await Promise.race([
        waitForPort(port, { hostname: HOST, timeoutMs: 5000 }),
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
        exclude.add(port)
      }
    }
    if (!launched) {
      throw new Error(
        'Failed to launch ttyd via tmux on available port starting at 10000',
      )
    }
  }

  // Fire-and-forget launch
  maybeLaunch()

  function interaction(id: string, input: string) {
    assertOpen()
    if (seenInteractionIds.has(id)) {
      throw new Error(`duplicate interaction id: ${id}`)
    }
    seenInteractionIds.add(id)
    interactions += 1
    lastInteractionId = id

    const p = (async () => {
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
      } catch {
        // ignore
      }
      return 'ok'
    })()
    active.set(id, p)
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
    return Promise.resolve()
  }

  async function destroy() {
    closed = true
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
  }

  async function status() {
    await Promise.resolve()
    return {
      startedAt: startedAt.toISOString(),
      closed,
      interactions,
      lastInteractionId,
      pid,
      home: opts.home,
      workspace: cwd ?? opts.workspace,
      views,
    }
  }

  return { interaction, awaitInteraction, cancel, destroy, status }
}
