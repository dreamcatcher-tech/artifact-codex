#!/usr/bin/env -S deno run
import { dirname, fromFileUrl, join } from '@std/path'
import type { Face, FaceOptions, FaceStatus, FaceView } from '@artifact/shared'
import { HOST } from '@artifact/shared'

/**
 * Start a Face that launches the MCP Inspector via `npx -y @modelcontextprotocol/inspector`.
 * - Adds discovered UI/proxy server ports to status.
 * - Throws on interaction requests (non-interactive face).
 * - By default, only launches the child when both `workspace` and `home` are provided in opts.
 */
export interface FaceInspectorOptions extends FaceOptions {
  config?: { test?: boolean }
}

export function startFaceInspector(opts: FaceInspectorOptions = {}): Face {
  if (!opts.workspace || !opts.home) {
    throw new Error('face-inspector requires workspace and home options')
  }
  const startedAt = new Date()
  let closed = false
  const interactions = 0
  let lastInteractionId: string | undefined

  // Child process + runtime state
  let child: Deno.ChildProcess | undefined
  let pid: number | undefined
  const externalHost = opts.hostname ?? HOST
  let views: FaceView[] = []

  // readiness gate: status() resolves after the face is ready
  let readyResolve: (() => void) | null = null
  const ready: Promise<void> = new Promise((res) => (readyResolve = res))

  function markReady() {
    if (readyResolve) {
      readyResolve()
      readyResolve = null
    }
  }

  async function isTcpListening(port: number): Promise<boolean> {
    try {
      const conn = await Deno.connect({ hostname: HOST, port })
      try {
        conn.close()
      } catch (_) {
        // ignore close error
      }
      return true
    } catch (_) {
      return false
    }
  }

  async function waitForPorts(ports: number[], timeoutMs = 60_000) {
    const start = Date.now()
    const remaining = new Set(ports)
    while (remaining.size > 0) {
      for (const p of Array.from(remaining)) {
        if (await isTcpListening(p)) remaining.delete(p)
      }
      if (remaining.size === 0) break
      if (Date.now() - start > timeoutMs) {
        throw new Error('Timeout waiting for ports to be listening')
      }
      await new Promise((r) => setTimeout(r, 200))
    }
  }

  async function maybeLaunch() {
    if (!opts.workspace || !opts.home) {
      throw new Error('face-inspector requires both workspace and home options')
    }

    // Ensure the provided directories exist; create home if missing
    const workspaceDir = opts.workspace
    const homeDir = opts.home
    try {
      const st = await Deno.stat(workspaceDir)
      if (!st.isDirectory) throw new Error('workspace is not a directory')
    } catch {
      throw new Error(`workspace directory not found: ${workspaceDir}`)
    }
    try {
      const st = await Deno.stat(homeDir)
      if (!st.isDirectory) throw new Error('home is not a directory')
    } catch {
      await Deno.mkdir(homeDir, { recursive: true })
    }

    const config = opts.config ?? {}

    // Test mode: do not spawn external processes; just set stub views
    if (config.test) {
      const base = 10000
      views = [
        {
          name: 'terminal',
          port: base,
          protocol: 'http',
          url: `http://${externalHost}:${base}`,
        },
        {
          name: 'client',
          port: base + 1,
          protocol: 'http',
          url: `http://${externalHost}:${base + 1}`,
        },
      ]
      markReady()
      return
    }

    // Real launch: try sequential port triplets until ttyd + UI bind successfully.
    const thisDir = dirname(fromFileUrl(import.meta.url))
    const repoRoot = dirname(thisDir)
    const tmuxScript = join(repoRoot, 'shared', 'tmux.sh')
    const windowTitle = 'Inspector'

    const startBase = 10000
    const maxTries = 50
    let launched = false
    for (let attempt = 0; attempt < maxTries && !launched; attempt++) {
      const base = startBase + attempt * 3
      const ttydPort = base
      const uiPort = base + 1
      const apiPort = base + 2

      const env: Record<string, string> = {
        // Network binds
        HOST,
        ALLOWED_ORIGINS: '*',
        MCP_AUTO_OPEN_ENABLED: 'false',
        // Encourage common dev servers to use our chosen port/host
        PORT: String(uiPort),
        CLIENT_PORT: String(uiPort),
        SERVER_PORT: String(apiPort),
        MCP_PROXY_FULL_ADDRESS: `http://${externalHost}:${apiPort}`,

        // tmux.sh related (explicitly read-only by leaving WRITEABLE off)
        WINDOW_TITLE: windowTitle,
        SESSION: `face-inspector-${crypto.randomUUID().slice(0, 8)}`,
        SOCKET: `face-inspector-sock-${crypto.randomUUID().slice(0, 8)}`,
        TTYD_PORT: String(ttydPort),
        TTYD_HOST: externalHost,
      }

      const args = ['npx', '-y', '@modelcontextprotocol/inspector']
      const cmd = new Deno.Command(tmuxScript, { args, cwd: workspaceDir, env })
      const proc = cmd.spawn()

      // Wait for ttyd or process exit (port conflict)
      const ttydOk = await Promise.race([
        waitForPorts([ttydPort], 8_000).then(() => true).catch(() => false),
        proc.status.then(() => false),
      ])
      if (!ttydOk) {
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
        continue
      }

      // Now wait for UI to bind on the chosen port. If it fails (e.g., port in use
      // and the tool refuses to start), retry with the next triplet.
      const uiOk = await waitForPorts([uiPort], 30_000).then(() => true).catch(
        () => false,
      )
      if (!uiOk) {
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
        continue
      }

      // Success
      child = proc
      pid = proc.pid
      views = [
        {
          name: 'terminal',
          port: ttydPort,
          protocol: 'http',
          url: `http://${externalHost}:${ttydPort}`,
        },
        {
          name: 'client',
          port: uiPort,
          protocol: 'http',
          url: `http://${externalHost}:${uiPort}`,
        },
      ]
      launched = true
    }

    if (!launched) {
      throw new Error(
        'Failed to launch face-inspector: no available port triplet starting at 10000',
      )
    }

    markReady()
  }

  // fire-and-forget launch
  maybeLaunch()

  function interaction(): { id: string } {
    throw new Error('face-inspector is non-interactive')
  }

  async function cancel(_id: string) {
    await Promise.resolve()
  }

  async function destroy() {
    closed = true
    try {
      child?.kill('SIGTERM')
    } catch {
      // ignore
    }
    try {
      await child?.status
    } catch {
      // ignore
    }
  }

  async function status(): Promise<FaceStatus> {
    // Only resolves once loading is complete
    await ready
    return {
      startedAt: startedAt.toISOString(),
      closed,
      interactions,
      lastInteractionId,
      pid,
      views,
      config: opts.home ? join(opts.home) : undefined,
      workspace: opts.workspace ? join(opts.workspace) : undefined,
    }
  }

  async function awaitInteraction(_id: string): Promise<string> {
    await Promise.resolve()
    throw new Error('face-inspector has no pending interactions')
  }

  return {
    interaction,
    awaitInteraction,
    cancel,
    status,
    destroy,
  }
}
