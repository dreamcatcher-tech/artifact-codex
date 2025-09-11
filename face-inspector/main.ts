#!/usr/bin/env -S deno run
import { join } from '@std/path'
import type { Face, FaceOptions, FaceStatus, FaceView } from '@artifact/shared'

/**
 * Start a Face that launches the MCP Inspector via `npx -y @modelcontextprotocol/inspector`.
 * - Adds discovered UI/proxy server ports to status.
 * - Throws on interaction requests (non-interactive face).
 * - By default, only launches the child when both `workspace` and `home` are provided in opts.
 */
export function startFaceInspector(opts: FaceOptions = {}): Face {
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
  const CLIENT_PORT = 8080
  const SERVER_PORT = 9000
  const views: FaceView[] = [
    { name: 'client', port: CLIENT_PORT, protocol: 'http' },
    { name: 'server', port: SERVER_PORT, protocol: 'http' },
  ] as const

  // readiness gate: status() resolves after the face is ready
  let readyResolve: (() => void) | null = null
  const ready: Promise<void> = new Promise((res) => (readyResolve = res))

  function markReady() {
    if (readyResolve) {
      readyResolve()
      readyResolve = null
    }
  }

  async function isTcpListening(
    port: number,
    host = 'localhost',
  ): Promise<boolean> {
    try {
      const conn = await Deno.connect({ hostname: host, port })
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
    // Allow tests to skip spawning the inspector process
    const skipLaunch = Boolean(
      (opts.config as Record<string, unknown> | undefined)?.['skipLaunch'],
    )
    if (skipLaunch) {
      markReady()
      return
    }

    const env: Record<string, string> = {
      CLIENT_PORT: String(CLIENT_PORT),
      SERVER_PORT: String(SERVER_PORT),
    }

    const cmd = new Deno.Command('npx', {
      args: ['-y', '@modelcontextprotocol/inspector'],
      cwd: workspaceDir,
      stdin: 'inherit',
      stdout: 'inherit',
      stderr: 'inherit',
      env,
    })
    child = cmd.spawn()
    pid = child.pid

    // Wait for client port to be listening (required). Server port is optional.
    await waitForPorts([CLIENT_PORT])
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
    await Promise.resolve()
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
