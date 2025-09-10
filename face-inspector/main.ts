#!/usr/bin/env -S deno run
import { join } from '@std/path'
import type { Face, FaceOptions, FaceStatus } from '@artifact/shared'

type InspectorPorts = {
  ui?: number
  server?: number
  uiUrl?: string
  serverUrl?: string
}

/**
 * Start a Face that launches the MCP Inspector via `npx -y @modelcontextprotocol/inspector`.
 * - Adds discovered UI/proxy server ports to status.
 * - Throws on interaction requests (non-interactive face).
 * - By default, only launches the child when both `workspace` and `home` are provided in opts.
 */
export function startFaceInspector(opts: FaceOptions = {}): Face {
  const startedAt = new Date()
  let closed = false
  const interactions = 0
  let lastInteractionId: string | undefined

  // Child process + runtime state
  let child: Deno.ChildProcess | undefined
  let processExited = false
  let exitCode: number | null = null
  let pid: number | undefined
  const ports: InspectorPorts = {}

  function assertOpen() {
    if (closed) throw new Error('face is closed')
  }

  function parseLineForPorts(line: string) {
    // Try to find URLs first
    const urlRegex = /(https?:\/\/[^\s]+)/g
    const urls = [...line.matchAll(urlRegex)].map((m) => m[1])
    for (const u of urls) {
      try {
        const url = new URL(u)
        const port = Number(url.port || (url.protocol === 'https:' ? 443 : 80))
        if (!ports.uiUrl && /ui|client|inspector|web/i.test(line)) {
          ports.uiUrl = url.toString()
          ports.ui = port
        } else if (!ports.serverUrl && /server|proxy/i.test(line)) {
          ports.serverUrl = url.toString()
          ports.server = port
        } else if (!ports.uiUrl) {
          ports.uiUrl = url.toString()
          ports.ui = port
        } else if (!ports.serverUrl) {
          ports.serverUrl = url.toString()
          ports.server = port
        }
      } catch (_) {
        // ignore parse errors
      }
    }

    // Fallback: bare "listening on port <n>" style lines
    const portMatch = /port\s+(\d{2,5})/i.exec(line)
    if (portMatch) {
      const p = Number(portMatch[1])
      if (!ports.ui) ports.ui = p
      else if (!ports.server) ports.server = p
    }
  }

  async function streamLines(stream: ReadableStream<Uint8Array> | null) {
    if (!stream) return
    const reader = stream
      .pipeThrough(new TextDecoderStream())
      .pipeThrough(
        new TransformStream<string, string>({
          start() {},
          transform(chunk, controller) {
            // Split on newlines but keep it simple
            for (const line of chunk.split(/\r?\n/)) {
              controller.enqueue(line)
            }
          },
        }),
      )
      .getReader()
    try {
      while (true) {
        const { value, done } = await reader.read()
        if (done) break
        if (value) parseLineForPorts(value)
      }
    } finally {
      reader.releaseLock()
    }
  }

  async function maybeLaunch() {
    // Gate launching behind presence of both workspace and home to keep tests light
    if (!opts.workspace || !opts.home) return

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

    const env: Record<string, string> = {
      ...Object.fromEntries(
        Object.entries(Deno.env.toObject()).filter(([k]) => !k.startsWith('_')),
      ),
      // Default inspected MCP endpoint: streamable HTTP server on 127.0.0.1:8080
      // Some inspector versions allow pasting/choosing the URL in the UI.
      // We keep this here for reference; the user can paste http://127.0.0.1:8080/mcp
      // If future inspector adds CLI env to preselect target, we can pass it here.
    }

    const cmd = new Deno.Command('npx', {
      args: ['-y', '@modelcontextprotocol/inspector'],
      cwd: workspaceDir,
      env,
      stdin: 'null',
      stdout: 'piped',
      stderr: 'piped',
    })
    child = cmd.spawn()
    pid = child.pid
    ;(async () => {
      try {
        await Promise.all([
          streamLines(child!.stdout),
          streamLines(child!.stderr),
        ])
      } catch (_) {
        // ignore
      }
    })()
    ;(async () => {
      try {
        const st = await child!.status
        exitCode = st.code
      } catch (_) {
        exitCode = null
      } finally {
        processExited = true
      }
    })()
  }

  // fire-and-forget launch
  maybeLaunch()

  function interaction(_input: string): { id: string } {
    assertOpen()
    throw new Error('face-inspector is non-interactive')
  }

  async function cancel(_id: string) {
    await Promise.resolve()
  }

  async function destroy() {
    closed = true
    try {
      child?.kill('SIGTERM')
    } catch (_) {
      // ignore
    }
    await Promise.resolve()
  }

  async function status(): Promise<FaceStatus> {
    await Promise.resolve()
    return {
      startedAt: startedAt.toISOString(),
      closed,
      interactions,
      lastInteractionId,
      pid,
      processExited,
      exitCode,
      ports: { ...ports },
      config: opts.home ? join(opts.home) : undefined,
      workspace: opts.workspace ? join(opts.workspace) : undefined,
    }
  }

  async function waitFor(_id: string): Promise<string> {
    await Promise.resolve()
    throw new Error('face-inspector has no pending interactions')
  }

  return { interaction, waitFor, cancel, status, destroy }
}
