#!/usr/bin/env -S deno run
import { dirname, fromFileUrl, join } from '@std/path'
import type { Face, FaceOptions, FaceView } from '@artifact/shared'
import { HOST } from '@artifact/shared'

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

  function assertOpen() {
    if (closed) throw new Error('face is closed')
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
    let launched = false
    for (let port = startPort; port < startPort + 200 && !launched; port += 1) {
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

  // Fire-and-forget launch
  maybeLaunch()

  function interaction(input: string) {
    assertOpen()
    const id = crypto.randomUUID()
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
    return { id }
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
      workspace: cwd,
      views,
    }
  }

  return { interaction, awaitInteraction, cancel, destroy, status }
}
